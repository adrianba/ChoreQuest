from datetime import date, timedelta

import pytest
from sqlalchemy import select

import backend.routers.spin as spin_router
from backend.models import AppSetting, AssignmentStatus, ChoreAssignment, SpinResult, UserRole
from backend.routers.spin import _can_spin_today, execute_spin
from tests.unit.conftest import make_category, make_chore, make_user


async def _add_assignment(
    db,
    chore_id: int,
    user_id: int,
    assignment_date: date,
    status: AssignmentStatus,
) -> ChoreAssignment:
    assignment = ChoreAssignment(
        chore_id=chore_id,
        user_id=user_id,
        date=assignment_date,
        status=status,
    )
    db.add(assignment)
    await db.flush()
    return assignment


@pytest.mark.asyncio
async def test_spin_credit_carries_to_next_day(db):
    today = date.today()
    yesterday = today - timedelta(days=1)

    category = await make_category(db)
    parent = await make_user(db, "spin_parent_1", role=UserRole.parent)
    kid = await make_user(db, "spin_kid_1")
    chore = await make_chore(db, parent.id, category.id)

    await _add_assignment(db, chore.id, kid.id, yesterday, AssignmentStatus.verified)
    await _add_assignment(db, chore.id, kid.id, today, AssignmentStatus.pending)
    await db.commit()

    can_spin, _, reason, spin_credits, credit_dates = await _can_spin_today(db, kid)

    assert can_spin is True
    assert reason is None
    assert spin_credits == 1
    assert credit_dates == [yesterday]


@pytest.mark.asyncio
async def test_execute_spin_consumes_oldest_credit_first(db, monkeypatch):
    today = date.today()
    two_days_ago = today - timedelta(days=2)
    yesterday = today - timedelta(days=1)

    category = await make_category(db)
    parent = await make_user(db, "spin_parent_2", role=UserRole.parent)
    kid = await make_user(db, "spin_kid_2")
    chore = await make_chore(db, parent.id, category.id)

    await _add_assignment(db, chore.id, kid.id, two_days_ago, AssignmentStatus.verified)
    await _add_assignment(db, chore.id, kid.id, yesterday, AssignmentStatus.verified)
    await db.commit()

    monkeypatch.setattr(spin_router.random, "choice", lambda values: values[0])

    await execute_spin(db=db, user=kid)
    await execute_spin(db=db, user=kid)

    results = (
        await db.execute(
            select(SpinResult)
            .where(SpinResult.user_id == kid.id)
            .order_by(SpinResult.spin_date.asc())
        )
    ).scalars().all()

    assert [result.spin_date for result in results] == [two_days_ago, yesterday]
    assert kid.points_balance == 2
    assert kid.total_points_earned == 2

    # The remaining credit is today's existing no-assignment free spin.
    can_spin, _, reason, spin_credits, credit_dates = await _can_spin_today(db, kid)
    assert can_spin is True
    assert reason is None
    assert spin_credits == 1
    assert credit_dates == [today]


@pytest.mark.asyncio
async def test_no_credit_when_today_still_pending(db):
    today = date.today()

    category = await make_category(db)
    parent = await make_user(db, "spin_parent_3", role=UserRole.parent)
    kid = await make_user(db, "spin_kid_3")
    chore = await make_chore(db, parent.id, category.id)

    await _add_assignment(db, chore.id, kid.id, today, AssignmentStatus.pending)
    await db.commit()

    can_spin, _, reason, spin_credits, credit_dates = await _can_spin_today(db, kid)

    assert can_spin is False
    assert spin_credits == 0
    assert credit_dates == []
    assert reason is not None
    assert "unlock a spin credit" in reason


@pytest.mark.asyncio
async def test_no_credit_message_omits_verify_when_verification_disabled(db):
    """When spin_requires_verification=false, the no-credits message should not
    mention 'verify' since kids don't need parent approval to earn credits."""
    today = date.today()

    category = await make_category(db)
    parent = await make_user(db, "spin_parent_4", role=UserRole.parent)
    kid = await make_user(db, "spin_kid_4")
    chore = await make_chore(db, parent.id, category.id)

    await _add_assignment(db, chore.id, kid.id, today, AssignmentStatus.pending)

    setting = AppSetting(key="spin_requires_verification", value="false")
    db.add(setting)
    await db.commit()

    can_spin, _, reason, spin_credits, credit_dates = await _can_spin_today(db, kid)

    assert can_spin is False
    assert spin_credits == 0
    assert reason is not None
    assert "verify" not in reason.lower()
