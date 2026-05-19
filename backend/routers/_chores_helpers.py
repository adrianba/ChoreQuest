"""Helper functions extracted from backend/routers/chores.py.

These are internal utilities used across the chores router endpoints:
- _get_chore_or_404 / _reload_chore_with_category
- _reload_assignment_with_relations
- _quest_assigned_notification
- _build_rotation_summaries
"""

from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.models import (
    AssignmentStatus,
    Chore,
    ChoreAssignment,
    ChoreRotation,
    User,
    Notification,
    NotificationType,
)
from backend.schemas import RotationSummary
from backend.services.rotation import get_rotation_kid_for_day, should_advance_rotation


async def get_chore_or_404(
    db: AsyncSession,
    chore_id: int,
    *,
    active_only: bool = True,
    load_category: bool = False,
) -> Chore:
    """Load a chore by ID, raising 404 if not found."""
    stmt = select(Chore).where(Chore.id == chore_id)
    if active_only:
        stmt = stmt.where(Chore.is_active == True)  # noqa: E712
    if load_category:
        stmt = stmt.options(selectinload(Chore.category))
    result = await db.execute(stmt)
    chore = result.scalar_one_or_none()
    if chore is None:
        raise HTTPException(status_code=404, detail="Chore not found")
    return chore


async def reload_chore_with_category(db: AsyncSession, chore_id: int) -> Chore:
    """Reload a chore with its category relationship eagerly loaded."""
    result = await db.execute(
        select(Chore)
        .where(Chore.id == chore_id)
        .options(selectinload(Chore.category))
    )
    return result.scalar_one()


async def reload_assignment_with_relations(
    db: AsyncSession, assignment_id: int
) -> ChoreAssignment:
    """Reload an assignment with chore (+ category) and user eagerly loaded."""
    result = await db.execute(
        select(ChoreAssignment)
        .where(ChoreAssignment.id == assignment_id)
        .options(
            selectinload(ChoreAssignment.chore).selectinload(Chore.category),
            selectinload(ChoreAssignment.user),
        )
    )
    return result.scalar_one()


def quest_assigned_notification(user_id: int, chore: Chore) -> Notification:
    """Build a 'quest assigned' notification for the given user."""
    return Notification(
        user_id=user_id,
        type=NotificationType.chore_assigned,
        title="New Quest Assigned!",
        message=f"You've been given a new quest: '{chore.title}' (+{chore.points} XP)",
        reference_type="chore",
        reference_id=chore.id,
    )


async def build_rotation_summaries(
    db: AsyncSession, chore_ids: list[int]
) -> dict[int, RotationSummary]:
    """Batch-load rotations for the given chore IDs and return a map of
    chore_id → RotationSummary (only for chores that have an active rotation)."""
    if not chore_ids:
        return {}

    rot_result = await db.execute(
        select(ChoreRotation).where(ChoreRotation.chore_id.in_(chore_ids))
    )
    rotations = rot_result.scalars().all()
    if not rotations:
        return {}

    # Gather all kid IDs referenced by any rotation
    all_kid_ids: set[int] = set()
    for r in rotations:
        all_kid_ids.update(r.kid_ids or [])

    kid_result = await db.execute(
        select(User.id, User.display_name).where(User.id.in_(all_kid_ids))
    )
    kid_names: dict[int, str] = {row.id: row.display_name for row in kid_result.all()}

    today = date.today()
    now = datetime.now(timezone.utc)

    # Batch-load today's actual assignments for all rotation chores so we can
    # ground the "currently X's turn" display in what was really scheduled for
    # today rather than blindly trusting current_index.
    #
    # This matters when the daily reset fires before local midnight (e.g. UTC
    # midnight = 7 pm CDT): current_index is already advanced to tomorrow's
    # kid, but today's local assignment still belongs to the previous kid.
    all_chore_ids = [r.chore_id for r in rotations]
    # Order so that the most "active" row wins when multiple non-skipped
    # assignments exist for the same chore/date (e.g. a stale verified row
    # left over from a previous rotation cycle alongside a new pending one).
    # pending=0 < completed=1 < verified=2, then newest id first as tiebreak.
    _status_priority = case(
        (ChoreAssignment.status == AssignmentStatus.pending, 0),
        (ChoreAssignment.status == AssignmentStatus.completed, 1),
        else_=2,
    )
    today_assignment_result = await db.execute(
        select(ChoreAssignment.chore_id, ChoreAssignment.user_id)
        .where(
            ChoreAssignment.chore_id.in_(all_chore_ids),
            ChoreAssignment.user_id.in_(all_kid_ids),
            ChoreAssignment.date == today,
            ChoreAssignment.status != AssignmentStatus.skipped,
        )
        .order_by(_status_priority, ChoreAssignment.id.desc())
    )
    # chore_id → kid_id who has today's most-active assignment.
    # setdefault keeps only the first (highest-priority) row per chore.
    today_assigned_kid: dict[int, int] = {}
    for row in today_assignment_result.all():
        today_assigned_kid.setdefault(row.chore_id, row.user_id)

    summaries: dict[int, RotationSummary] = {}
    for r in rotations:
        kid_ids = r.kid_ids or []
        if not kid_ids:
            continue

        # Use the same projection logic as _generate_from_rules so this
        # summary stays in sync with actual assignments even when the daily
        # reset hasn't advanced current_index yet.
        #
        # If should_advance_rotation() is True the daily reset hasn't fired
        # yet — project forward to today using get_rotation_kid_for_day
        # (identical math to the calendar/week assignment generator).
        # Otherwise current_index is already at the right position.
        if should_advance_rotation(r, now):
            reference_day = (
                r.last_rotated.date()
                if r.last_rotated and hasattr(r.last_rotated, "date")
                else today
            )
            current_kid_id = get_rotation_kid_for_day(r, today, reference_day)
            idx = kid_ids.index(current_kid_id) if current_kid_id in kid_ids else r.current_index % len(kid_ids)
        else:
            idx = r.current_index % len(kid_ids)
            current_kid_id = kid_ids[idx]

        # Ground-truth override: if there is an actual non-skipped assignment
        # for today belonging to one of this rotation's kids, that kid is who
        # the family will see doing the chore today — show them as "current".
        # This prevents the display from jumping to tomorrow's kid after the
        # UTC-midnight reset fires before local midnight.
        actual_today_kid = today_assigned_kid.get(r.chore_id)
        if actual_today_kid is not None and actual_today_kid in kid_ids:
            current_kid_id = actual_today_kid
            idx = kid_ids.index(current_kid_id)

        summaries[r.chore_id] = RotationSummary(
            current_kid_id=current_kid_id,
            current_kid_name=kid_names.get(current_kid_id, f"Kid #{current_kid_id}"),
            cadence=r.cadence,
            kid_ids=kid_ids,
            current_index=idx,
        )
    return summaries
