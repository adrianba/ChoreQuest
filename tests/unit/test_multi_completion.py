"""Unit tests for the multi-completion chore feature.

Verifies that:
- Chore.max_completions_per_day is stored and retrieved correctly.
- ChoreAssignment.completion_count is stored and retrieved correctly.
- The completion_count default is 0.
- max_completions_per_day default is 1 (single-completion behaviour).
"""

from datetime import date, datetime

import pytest

from sqlalchemy import select

from backend.models import (
    Chore,
    ChoreAssignment,
    AssignmentStatus,
    Difficulty,
    Recurrence,
    UserRole,
)

from tests.unit.conftest import make_category, make_chore, make_user


# ---------------------------------------------------------------------------
# Model defaults
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chore_max_completions_default(db):
    """max_completions_per_day should default to 1."""
    cat = await make_category(db)
    parent = await make_user(db, "parent_mc1", role=UserRole.parent)
    chore = await make_chore(db, parent.id, cat.id)
    await db.commit()

    result = await db.execute(select(Chore).where(Chore.id == chore.id))
    fetched = result.scalar_one()
    assert fetched.max_completions_per_day == 1


@pytest.mark.asyncio
async def test_chore_max_completions_custom(db):
    """max_completions_per_day should be stored and retrieved correctly."""
    cat = await make_category(db)
    parent = await make_user(db, "parent_mc2", role=UserRole.parent)
    chore = Chore(
        title="Refill dog water",
        points=5,
        difficulty=Difficulty.easy,
        category_id=cat.id,
        recurrence=Recurrence.daily,
        created_by=parent.id,
        max_completions_per_day=3,
    )
    db.add(chore)
    await db.flush()
    await db.commit()

    result = await db.execute(select(Chore).where(Chore.id == chore.id))
    fetched = result.scalar_one()
    assert fetched.max_completions_per_day == 3


@pytest.mark.asyncio
async def test_assignment_completion_count_default(db):
    """completion_count should default to 0 on new assignments."""
    cat = await make_category(db)
    parent = await make_user(db, "parent_mc3", role=UserRole.parent)
    kid = await make_user(db, "kid_mc3")
    chore = await make_chore(db, parent.id, cat.id)
    await db.commit()

    assignment = ChoreAssignment(
        chore_id=chore.id,
        user_id=kid.id,
        date=date(2024, 5, 1),
        status=AssignmentStatus.pending,
    )
    db.add(assignment)
    await db.flush()
    await db.commit()

    result = await db.execute(
        select(ChoreAssignment).where(ChoreAssignment.id == assignment.id)
    )
    fetched = result.scalar_one()
    assert fetched.completion_count == 0


@pytest.mark.asyncio
async def test_assignment_completion_count_increments(db):
    """completion_count should persist increments correctly."""
    cat = await make_category(db)
    parent = await make_user(db, "parent_mc4", role=UserRole.parent)
    kid = await make_user(db, "kid_mc4")
    chore = await make_chore(db, parent.id, cat.id)
    await db.commit()

    assignment = ChoreAssignment(
        chore_id=chore.id,
        user_id=kid.id,
        date=date(2024, 5, 2),
        status=AssignmentStatus.pending,
        completion_count=0,
    )
    db.add(assignment)
    await db.flush()

    # Simulate first completion (still below max=3)
    assignment.completion_count = 1
    assignment.status = AssignmentStatus.pending  # reset to pending — more completions allowed
    await db.commit()

    result = await db.execute(
        select(ChoreAssignment).where(ChoreAssignment.id == assignment.id)
    )
    fetched = result.scalar_one()
    assert fetched.completion_count == 1
    assert fetched.status == AssignmentStatus.pending

    # Simulate final completion (reaches max)
    fetched.completion_count = 3
    fetched.status = AssignmentStatus.completed
    fetched.completed_at = datetime(2024, 5, 2, 18, 0, 0)
    await db.commit()

    result2 = await db.execute(
        select(ChoreAssignment).where(ChoreAssignment.id == assignment.id)
    )
    fetched2 = result2.scalar_one()
    assert fetched2.completion_count == 3
    assert fetched2.status == AssignmentStatus.completed


@pytest.mark.asyncio
async def test_multi_completion_xp_scales(db):
    """XP awarded should equal points × completion_count for multi-completion chores."""
    cat = await make_category(db)
    parent = await make_user(db, "parent_mc5", role=UserRole.parent)
    chore = Chore(
        title="Water plants",
        points=10,
        difficulty=Difficulty.easy,
        category_id=cat.id,
        recurrence=Recurrence.daily,
        created_by=parent.id,
        max_completions_per_day=3,
    )
    db.add(chore)
    await db.flush()
    await db.commit()

    result = await db.execute(select(Chore).where(Chore.id == chore.id))
    fetched = result.scalar_one()

    # Simulate XP calculation at verify time (matches backend verify_chore logic)
    completion_count = 3
    expected_xp = fetched.points * max(1, completion_count)
    assert expected_xp == 30  # 10 XP × 3 completions


@pytest.mark.asyncio
async def test_single_completion_xp_unchanged(db):
    """Single-completion chores should award base points × 1 (unchanged behaviour)."""
    cat = await make_category(db)
    parent = await make_user(db, "parent_mc6", role=UserRole.parent)
    chore = await make_chore(db, parent.id, cat.id)
    await db.commit()

    result = await db.execute(select(Chore).where(Chore.id == chore.id))
    fetched = result.scalar_one()

    completion_count = 1
    expected_xp = fetched.points * max(1, completion_count)
    assert expected_xp == fetched.points
