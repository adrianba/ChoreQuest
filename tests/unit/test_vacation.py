"""Unit tests for vacation creation logic.

Exercises the create_vacation router path that previously triggered a
MissingGreenlet error when accessing the lazy-loaded ``vacation.kid``
relationship inside an AsyncSession.
"""

from datetime import date, timedelta

import pytest

from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import UserRole, VacationPeriod
from backend.routers.vacation import create_vacation
from backend.schemas import VacationCreate

from tests.unit.conftest import make_user


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _FakeParent:
    """Minimal stand-in for the authenticated parent User dependency."""

    def __init__(self, id_: int) -> None:
        self.id = id_


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
