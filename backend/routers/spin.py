import random
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models import (
    SpinResult,
    ChoreAssignment,
    AssignmentStatus,
    AppSetting,
    User,
    PointTransaction,
    PointType,
)
from backend.schemas import SpinResultResponse, SpinAvailabilityResponse
from backend.dependencies import get_current_user
from backend.achievements import check_achievements
from backend.websocket_manager import ws_manager
from backend.services.pet_leveling import award_pet_xp_db

router = APIRouter(prefix="/api/spin", tags=["spin"])

SPIN_MIN = 1
SPIN_MAX = 25

# Must mirror SEGMENTS in frontend SpinWheel.jsx — backend picks from
# these values so the wheel animation always matches the awarded points.
WHEEL_VALUES = [1, 5, 2, 10, 3, 15, 1, 25, 2, 5, 3, 10]


async def _can_spin_today(
    db: AsyncSession, user: User
) -> tuple[bool, int | None, str | None, int, list[date]]:
    """
    Determine if the user is eligible to spin today.

    Rules:
    1. A spin credit is earned for each day whose assignments are fully satisfied.
    2. Spin credits can be used later (carry-over), so late approvals still count.
    3. One spin result consumes one unspent credit day.

    Whether "satisfied" means parent-verified or just kid self-reported is
    controlled by the ``spin_requires_verification`` app setting (default: true).
    When true, only ``verified`` status counts — kids cannot game the wheel by
    tapping "Mark Done" on chores they haven't actually completed.

    Returns (can_spin, last_result_points_or_none, reason_or_none,
             available_credit_count, available_credit_dates).
    """
    today = date.today()
    lookback_start = today - timedelta(days=3)

    # Get last spin result for display
    last_result: int | None = None
    last_spin_query = await db.execute(
        select(SpinResult)
        .where(SpinResult.user_id == user.id)
        .order_by(SpinResult.created_at.desc())
        .limit(1)
    )
    last_spin = last_spin_query.scalar_one_or_none()
    if last_spin is not None:
        last_result = last_spin.points_won

    # Load the spin_requires_verification setting (default: true)
    setting_result = await db.execute(
        select(AppSetting).where(AppSetting.key == "spin_requires_verification")
    )
    spin_setting = setting_result.scalar_one_or_none()
    requires_verification = (spin_setting is None) or (spin_setting.value != "false")

    # Statuses that count as "done" depends on the setting.
    # Skipped always counts — it means the parent or rotation system
    # intentionally bypassed the quest for this kid today.
    done_statuses = (
        (AssignmentStatus.verified, AssignmentStatus.skipped)
        if requires_verification
        else (AssignmentStatus.completed, AssignmentStatus.verified, AssignmentStatus.skipped)
    )

    # Load assignments from the last 3 days through today.
    # Fully-satisfied dates become available spins.
    # A short lookback window prevents historical backlog from accumulating
    # unlimited spins while still allowing late parent approvals to count.
    result = await db.execute(
        select(ChoreAssignment.date, ChoreAssignment.status)
        .where(
            ChoreAssignment.user_id == user.id,
            ChoreAssignment.date >= lookback_start,
            ChoreAssignment.date <= today,
        )
        .order_by(ChoreAssignment.date.asc())
    )
    assignments_by_date: dict[date, list[AssignmentStatus]] = {}
    for assignment_date, status in result.all():
        assignments_by_date.setdefault(assignment_date, []).append(status)

    eligible_credit_dates = [
        assignment_date
        for assignment_date, statuses in assignments_by_date.items()
        if statuses and all(status in done_statuses for status in statuses)
    ]
    # Keep the existing "no assignments today" behavior: allow one same-day spin.
    # We only add *today* (never past no-assignment days), so this preserves that
    # behavior without creating backlogged credits that could be farmed on idle days.
    if today not in assignments_by_date:
        eligible_credit_dates.append(today)

    used_dates_result = await db.execute(
        select(SpinResult.spin_date)
        .where(SpinResult.user_id == user.id)
        .order_by(SpinResult.spin_date.asc())
    )
    used_credit_dates = set(used_dates_result.scalars().all())
    available_credit_dates = [
        credit_date for credit_date in eligible_credit_dates if credit_date not in used_credit_dates
    ]

    if available_credit_dates:
        return True, last_result, None, len(available_credit_dates), available_credit_dates

    if today in used_credit_dates:
        earn_more_hint = (
            "Complete and verify quests to earn more."
            if requires_verification
            else "Complete quests to earn more."
        )
        return (
            False,
            last_result,
            f"You already used all available spins. {earn_more_hint}",
            0,
            [],
        )

    today_assignments = assignments_by_date.get(today, [])
    all_done = all(status in done_statuses for status in today_assignments)
    if today_assignments and not all_done:
        if requires_verification:
            # Distinguish between "not submitted yet" and "waiting on parent"
            awaiting_parent = sum(
                1 for status in today_assignments if status == AssignmentStatus.completed
            )
            truly_pending = sum(
                1
                for status in today_assignments
                if status not in done_statuses and status != AssignmentStatus.completed
            )
            if truly_pending == 0 and awaiting_parent > 0:
                return (
                    False,
                    last_result,
                    f"Almost there! Waiting for a parent to verify {awaiting_parent} quest(s).",
                    0,
                    [],
                )
            pending = truly_pending
        else:
            pending = sum(1 for status in today_assignments if status not in done_statuses)
        return (
            False,
            last_result,
            f"Complete all of today's quests to unlock a spin! {pending} remaining.",
            0,
            [],
        )
    no_credit_msg = (
        "No spins yet. Complete and verify quests to earn one."
        if requires_verification
        else "No spins yet. Complete quests to earn one."
    )
    return (False, last_result, no_credit_msg, 0, [])


# ---------- GET /availability ----------
@router.get("/availability", response_model=SpinAvailabilityResponse)
async def check_availability(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Check if the user can spin today."""
    can_spin, last_result, reason, spin_credits, _ = await _can_spin_today(db, user)
    return SpinAvailabilityResponse(
        can_spin=can_spin,
        last_result=last_result,
        reason=reason,
        spin_credits=spin_credits,
    )


# ---------- POST /spin ----------
@router.post("/spin", response_model=SpinResultResponse)
async def execute_spin(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Execute the daily spin. Validates eligibility, generates random XP, awards points."""
    can_spin, _last_result, reason, _spin_credits, credit_dates = await _can_spin_today(db, user)
    if not can_spin:
        raise HTTPException(
            status_code=400,
            detail=reason or "Cannot spin today.",
        )
    if not credit_dates:
        raise HTTPException(
            status_code=500,
            detail="Unable to process spin right now. Please try again.",
        )

    # Pick from the wheel segments so the frontend animation matches
    points_won = random.choice(WHEEL_VALUES)
    # Create spin result
    spin_result = SpinResult(
        user_id=user.id,
        points_won=points_won,
        spin_date=credit_dates[0],
    )
    db.add(spin_result)

    # Award XP via PointTransaction
    transaction = PointTransaction(
        user_id=user.id,
        amount=points_won,
        type=PointType.spin,
        description=f"Daily spin: won {points_won} XP",
        reference_id=None,
        created_by=None,
    )
    db.add(transaction)

    # Update user balance
    user.points_balance += points_won
    user.total_points_earned += points_won

    # Award pet XP alongside user XP
    await award_pet_xp_db(db, user, points_won)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Spin already recorded. Please try again.")
    await db.refresh(spin_result)

    # Check achievements (non-blocking on failure)
    try:
        await check_achievements(db, user)
    except Exception:
        pass

    # Notify via WebSocket
    try:
        await ws_manager.send_to_user(user.id, {
            "type": "spin_result",
            "data": {"points_won": points_won},
        })
    except Exception:
        pass

    return SpinResultResponse(points_won=points_won)
