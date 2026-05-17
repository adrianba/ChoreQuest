"""Tests for the kid_id query parameter on POST /api/chores/{chore_id}/complete."""

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from backend.models import AssignmentStatus, ChoreAssignment, UserRole
from backend.routers.chores import complete_chore
from tests.unit.conftest import make_category, make_chore, make_user


async def _add_assignment(db, chore_id, user_id, assignment_date, status):
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
async def test_admin_completes_on_behalf_of_kid(db):
    """Admin with kid_id should complete the kid's pending assignment."""
    today = date.today()
    category = await make_category(db)
    admin = await make_user(db, "admin_user", role=UserRole.admin)
    kid = await make_user(db, "kid_user", role=UserRole.kid)
    chore = await make_chore(db, admin.id, category.id)

    assignment = await _add_assignment(db, chore.id, kid.id, today, AssignmentStatus.pending)
    await db.commit()

    result = await complete_chore(
        chore_id=chore.id,
        kid_id=kid.id,
        file=None,
        db=db,
        user=admin,
    )

    assert result.status == AssignmentStatus.completed
    assert result.user_id == kid.id


@pytest.mark.asyncio
async def test_admin_with_invalid_kid_id_returns_400(db):
    """Admin with a non-existent kid_id should get a 400 error."""
    from fastapi import HTTPException

    category = await make_category(db)
    admin = await make_user(db, "admin_user2", role=UserRole.admin)
    chore = await make_chore(db, admin.id, category.id)
    await db.commit()

    with pytest.raises(HTTPException) as exc_info:
        await complete_chore(
            chore_id=chore.id,
            kid_id=99999,
            file=None,
            db=db,
            user=admin,
        )
    assert exc_info.value.status_code == 400
    assert "Invalid kid_id" in exc_info.value.detail


@pytest.mark.asyncio
async def test_admin_without_kid_id_gets_404(db):
    """Admin without kid_id has no assignments, so should get 404."""
    from fastapi import HTTPException

    today = date.today()
    category = await make_category(db)
    admin = await make_user(db, "admin_user3", role=UserRole.admin)
    kid = await make_user(db, "kid_user3", role=UserRole.kid)
    chore = await make_chore(db, admin.id, category.id)

    await _add_assignment(db, chore.id, kid.id, today, AssignmentStatus.pending)
    await db.commit()

    with pytest.raises(HTTPException) as exc_info:
        await complete_chore(
            chore_id=chore.id,
            kid_id=None,
            file=None,
            db=db,
            user=admin,
        )
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_kid_with_kid_id_ignores_parameter(db):
    """A kid user providing kid_id should have it ignored — completes their own assignment."""
    today = date.today()
    category = await make_category(db)
    admin = await make_user(db, "admin_user4", role=UserRole.admin)
    kid1 = await make_user(db, "kid_user4a", role=UserRole.kid)
    kid2 = await make_user(db, "kid_user4b", role=UserRole.kid)
    chore = await make_chore(db, admin.id, category.id)

    await _add_assignment(db, chore.id, kid1.id, today, AssignmentStatus.pending)
    await _add_assignment(db, chore.id, kid2.id, today, AssignmentStatus.pending)
    await db.commit()

    # kid1 passes kid2's id — should be ignored, kid1's own assignment is completed
    result = await complete_chore(
        chore_id=chore.id,
        kid_id=kid2.id,
        file=None,
        db=db,
        user=kid1,
    )

    assert result.status == AssignmentStatus.completed
    assert result.user_id == kid1.id
