"""Unit tests for vacation creation logic.

Exercises the create_vacation router path that previously triggered a
MissingGreenlet error when accessing the lazy-loaded ``vacation.kid``
relationship inside an AsyncSession.
"""

from datetime import date, timedelta

import pytest

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import (
    AssignmentStatus,
    ChoreAssignment,
    UserRole,
    VacationPeriod,
)
from backend.routers.vacation import create_vacation
from backend.schemas import VacationCreate

from tests.unit.conftest import make_chore, make_category, make_user


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _FakeParent:
    """Minimal stand-in for the authenticated parent User dependency."""

    def __init__(self, id_: int) -> None:
        self.id = id_


async def _make_pending_assignment(
    db: AsyncSession,
    chore_id: int,
    user_id: int,
    assign_date: date,
) -> ChoreAssignment:
    assignment = ChoreAssignment(
        chore_id=chore_id,
        user_id=user_id,
        date=assign_date,
        status=AssignmentStatus.pending,
    )
    db.add(assignment)
    await db.flush()
    return assignment


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestCreateVacation:
    """create_vacation() should return 201 with the correct kid_name."""

    @pytest.mark.asyncio
    async def test_per_kid_vacation_returns_kid_name(self, db: AsyncSession):
        """Regression: creating a per-kid vacation must NOT raise MissingGreenlet
        and must return the kid's display name in the response."""
        parent = await make_user(db, "vac_parent1", role=UserRole.parent)
        kid = await make_user(db, "vac_kid1")

        today = date.today()
        body = VacationCreate(
            start_date=today + timedelta(days=1),
            end_date=today + timedelta(days=5),
            user_id=kid.id,
        )

        resp = await create_vacation(body=body, parent=parent, db=db)

        assert resp.user_id == kid.id
        assert resp.kid_name == kid.display_name or resp.kid_name == kid.username
        assert resp.is_active is True

    @pytest.mark.asyncio
    async def test_family_vacation_has_no_kid_name(self, db: AsyncSession):
        """Family-wide vacations (user_id=None) must return kid_name=None."""
        parent = await make_user(db, "vac_parent2", role=UserRole.parent)

        today = date.today()
        body = VacationCreate(
            start_date=today + timedelta(days=1),
            end_date=today + timedelta(days=3),
            user_id=None,
        )

        resp = await create_vacation(body=body, parent=parent, db=db)

        assert resp.user_id is None
        assert resp.kid_name is None
        assert resp.is_active is True

    @pytest.mark.asyncio
    async def test_per_kid_vacation_invalid_kid_raises_404(self, db: AsyncSession):
        """Passing an unknown user_id must raise HTTPException 404."""
        from fastapi import HTTPException

        parent = await make_user(db, "vac_parent3", role=UserRole.parent)

        today = date.today()
        body = VacationCreate(
            start_date=today + timedelta(days=1),
            end_date=today + timedelta(days=3),
            user_id=99999,  # non-existent
        )

        with pytest.raises(HTTPException) as exc_info:
            await create_vacation(body=body, parent=parent, db=db)

        assert exc_info.value.status_code == 404


class TestVacationSkipsPendingAssignments:
    """Creating a vacation should auto-skip pending assignments in the window."""

    @pytest.mark.asyncio
    async def test_per_kid_vacation_skips_that_kids_pending_assignments(
        self, db: AsyncSession
    ):
        """Pending assignments for the vacationing kid are skipped; other kids
        are unaffected."""
        parent = await make_user(db, "skip_parent1", role=UserRole.parent)
        kid_a  = await make_user(db, "skip_kid_a")
        kid_b  = await make_user(db, "skip_kid_b")

        cat   = await make_category(db, "Chores")
        chore = await make_chore(db, parent.id, cat.id)

        today = date.today()
        vac_start = today + timedelta(days=1)
        vac_end   = today + timedelta(days=3)

        # kid_a has a pending assignment inside the vacation window
        a_inside = await _make_pending_assignment(db, chore.id, kid_a.id, vac_start)
        # kid_a has a pending assignment OUTSIDE the window (should stay pending)
        a_outside = await _make_pending_assignment(db, chore.id, kid_a.id, vac_end + timedelta(days=1))
        # kid_b has a pending assignment inside the window (must NOT be skipped)
        b_inside  = await _make_pending_assignment(db, chore.id, kid_b.id, vac_start)
        await db.commit()

        body = VacationCreate(start_date=vac_start, end_date=vac_end, user_id=kid_a.id)
        await create_vacation(body=body, parent=parent, db=db)

        # Reload assignments from the DB
        for obj in (a_inside, a_outside, b_inside):
            await db.refresh(obj)

        assert a_inside.status  == AssignmentStatus.skipped,  "inside-window assignment for vacationing kid must be skipped"
        assert a_outside.status == AssignmentStatus.pending,   "outside-window assignment must remain pending"
        assert b_inside.status  == AssignmentStatus.pending,   "other kid's assignment must not be touched"

    @pytest.mark.asyncio
    async def test_family_vacation_skips_all_pending_assignments_in_window(
        self, db: AsyncSession
    ):
        """Family-wide vacation skips pending assignments for every kid."""
        parent = await make_user(db, "skip_parent2", role=UserRole.parent)
        kid_a  = await make_user(db, "skip_kid_c")
        kid_b  = await make_user(db, "skip_kid_d")

        cat   = await make_category(db, "Chores2")
        chore = await make_chore(db, parent.id, cat.id)

        today = date.today()
        vac_start = today + timedelta(days=1)
        vac_end   = today + timedelta(days=2)

        a_inside = await _make_pending_assignment(db, chore.id, kid_a.id, vac_start)
        b_inside = await _make_pending_assignment(db, chore.id, kid_b.id, vac_start)
        # Assignment outside window should stay pending
        a_outside = await _make_pending_assignment(db, chore.id, kid_a.id, vac_end + timedelta(days=1))
        await db.commit()

        body = VacationCreate(start_date=vac_start, end_date=vac_end, user_id=None)
        await create_vacation(body=body, parent=parent, db=db)

        for obj in (a_inside, b_inside, a_outside):
            await db.refresh(obj)

        assert a_inside.status  == AssignmentStatus.skipped, "kid_a inside-window must be skipped"
        assert b_inside.status  == AssignmentStatus.skipped, "kid_b inside-window must be skipped"
        assert a_outside.status == AssignmentStatus.pending, "outside-window must remain pending"

    @pytest.mark.asyncio
    async def test_completed_assignments_are_not_touched(self, db: AsyncSession):
        """Already-completed assignments must NOT be reverted to skipped."""
        parent = await make_user(db, "skip_parent3", role=UserRole.parent)
        kid    = await make_user(db, "skip_kid_e")

        cat   = await make_category(db, "Chores3")
        chore = await make_chore(db, parent.id, cat.id)

        today = date.today()
        vac_start = today + timedelta(days=1)
        vac_end   = today + timedelta(days=2)

        completed = ChoreAssignment(
            chore_id=chore.id,
            user_id=kid.id,
            date=vac_start,
            status=AssignmentStatus.completed,
        )
        db.add(completed)
        await db.commit()

        body = VacationCreate(start_date=vac_start, end_date=vac_end, user_id=kid.id)
        await create_vacation(body=body, parent=parent, db=db)

        await db.refresh(completed)
        assert completed.status == AssignmentStatus.completed, "completed assignments must not be touched"
