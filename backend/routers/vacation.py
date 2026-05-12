from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models import ChoreAssignment, AssignmentStatus, User, UserRole, VacationPeriod
from backend.schemas import VacationCreate, VacationResponse, VacationTrimRequest
from backend.dependencies import require_parent

router = APIRouter(prefix="/api/vacation", tags=["vacation"])


@router.get("", response_model=list[VacationResponse])
async def list_vacations(
    parent: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
):
    """List all active vacation periods, enriched with kid display names."""
    result = await db.execute(
        select(VacationPeriod)
        .where(VacationPeriod.is_active == True)
        .order_by(VacationPeriod.start_date.desc())
    )
    vacations = result.scalars().all()

    # Fetch kid names for per-kid vacations in a single query
    kid_ids = {v.user_id for v in vacations if v.user_id is not None}
    kid_map: dict[int, str] = {}
    if kid_ids:
        kr = await db.execute(select(User).where(User.id.in_(kid_ids)))
        for k in kr.scalars().all():
            kid_map[k.id] = k.display_name or k.username

    out = []
    for v in vacations:
        resp = VacationResponse.model_validate(v)
        resp.kid_name = kid_map.get(v.user_id) if v.user_id else None
        out.append(resp)
    return out


@router.post("", response_model=VacationResponse, status_code=201)
async def create_vacation(
    body: VacationCreate,
    parent: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
):
    """Create a vacation/blackout period. Parent+ only.

    Set ``user_id`` to a specific kid's ID for a per-kid vacation, or
    leave it null for a family-wide vacation.
    """
    if body.end_date < body.start_date:
        raise HTTPException(status_code=400, detail="End date must be after start date")
    if body.end_date < date.today():
        raise HTTPException(status_code=400, detail="Cannot create vacation in the past")

    # Validate kid belongs to this family when per-kid is requested.
    # Keep the kid object so we can populate kid_name without a second query.
    kid: User | None = None
    if body.user_id is not None:
        kid_result = await db.execute(
            select(User).where(User.id == body.user_id, User.role == UserRole.kid)
        )
        kid = kid_result.scalar_one_or_none()
        if kid is None:
            raise HTTPException(status_code=404, detail="Kid not found")

    vacation = VacationPeriod(
        start_date=body.start_date,
        end_date=body.end_date,
        created_by=parent.id,
        user_id=body.user_id,
    )
    db.add(vacation)
    await db.commit()
    await db.refresh(vacation)

    # Auto-skip any pending assignments that fall within the vacation window
    # so the kid's dashboard is immediately clean.
    skip_filters = [
        ChoreAssignment.date >= body.start_date,
        ChoreAssignment.date <= body.end_date,
        ChoreAssignment.status == AssignmentStatus.pending,
    ]
    if body.user_id is not None:
        # Per-kid vacation — only skip that kid's assignments
        skip_filters.append(ChoreAssignment.user_id == body.user_id)
    # Family-wide vacation — skip all pending assignments within the window
    # (no user filter needed)
    await db.execute(update(ChoreAssignment).where(*skip_filters).values(status=AssignmentStatus.skipped))
    await db.commit()

    resp = VacationResponse.model_validate(vacation)
    if vacation.user_id is not None and kid is not None:
        resp.kid_name = kid.display_name or kid.username
    return resp


@router.patch("/{vacation_id}", response_model=VacationResponse)
async def trim_vacation(
    vacation_id: int,
    body: VacationTrimRequest,
    parent: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
):
    """Trim a vacation's end date (early return).

    Restores any skipped assignments that fall after the new end date back to
    pending, so kids get their chores back for the days they're home early.
    Only future assignments (today or later) are restored — past days stay
    skipped since those days already passed.
    """
    result = await db.execute(
        select(VacationPeriod).where(VacationPeriod.id == vacation_id, VacationPeriod.is_active == True)
    )
    vacation = result.scalar_one_or_none()
    if not vacation:
        raise HTTPException(status_code=404, detail="Vacation not found")

    if body.end_date < vacation.start_date:
        raise HTTPException(status_code=400, detail="New end date cannot be before the vacation start date")
    if body.end_date >= vacation.end_date:
        raise HTTPException(status_code=400, detail="New end date must be earlier than the current end date")

    original_end = vacation.end_date
    vacation.end_date = body.end_date

    # Restore skipped assignments for the now-removed tail of the vacation.
    # Only restore from today onward — past days are already done/missed.
    restore_from = max(body.end_date + timedelta(days=1), date.today())
    restore_filters = [
        ChoreAssignment.date >= restore_from,
        ChoreAssignment.date <= original_end,
        ChoreAssignment.status == AssignmentStatus.skipped,
    ]
    if vacation.user_id is not None:
        restore_filters.append(ChoreAssignment.user_id == vacation.user_id)

    await db.execute(
        update(ChoreAssignment).where(*restore_filters).values(status=AssignmentStatus.pending)
    )
    await db.commit()
    await db.refresh(vacation)
    return vacation


@router.delete("/{vacation_id}", status_code=204)
async def cancel_vacation(
    vacation_id: int,
    parent: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
):
    """Cancel a vacation period entirely.

    Restores all future skipped assignments that were covered by this vacation
    back to pending so kids get their chores back immediately.
    """
    result = await db.execute(
        select(VacationPeriod).where(VacationPeriod.id == vacation_id)
    )
    vacation = result.scalar_one_or_none()
    if not vacation:
        raise HTTPException(status_code=404, detail="Vacation not found")

    restore_from = max(vacation.start_date, date.today())
    restore_filters = [
        ChoreAssignment.date >= restore_from,
        ChoreAssignment.date <= vacation.end_date,
        ChoreAssignment.status == AssignmentStatus.skipped,
    ]
    if vacation.user_id is not None:
        restore_filters.append(ChoreAssignment.user_id == vacation.user_id)

    await db.execute(
        update(ChoreAssignment).where(*restore_filters).values(status=AssignmentStatus.pending)
    )

    vacation.is_active = False
    await db.commit()


async def is_vacation_day(
    db: AsyncSession,
    check_date: date,
    user_id: int | None = None,
) -> bool:
    """Check whether a given date is a vacation day.

    Args:
        user_id: When supplied, returns True if there is a *family-wide*
                 vacation OR a vacation specifically for that kid.
                 When omitted (None), returns True only for family-wide
                 vacations (backward-compatible behaviour).
    """
    base = [
        VacationPeriod.is_active == True,
        VacationPeriod.start_date <= check_date,
        VacationPeriod.end_date >= check_date,
    ]

    if user_id is not None:
        # Family-wide (user_id IS NULL) OR this specific kid
        scope = or_(
            VacationPeriod.user_id == None,   # noqa: E711
            VacationPeriod.user_id == user_id,
        )
    else:
        # Only family-wide vacations
        scope = VacationPeriod.user_id == None  # noqa: E711

    result = await db.execute(select(VacationPeriod).where(*base, scope))
    return result.scalar_one_or_none() is not None
