"""Public (unauthenticated) endpoints gated by a dashboard share token.

The share token is stored in AppSetting with key ``dashboard_share_token``.
A parent generates it via POST /api/admin/settings/dashboard-token.
"""

from datetime import date, timedelta

from backend.utils import utc_iso

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.database import get_db
from backend.models import (
    AppSetting,
    AssignmentStatus,
    Chore,
    ChoreAssignment,
    User,
    UserRole,
)
from backend.services.assignment_generator import auto_generate_week_assignments
from backend.routers.stats import _effective_streak, _count_today_assignments_by_kid

router = APIRouter(prefix="/api/public", tags=["public"])

_TOKEN_KEY = "dashboard_share_token"


async def _resolve_token(token: str, db: AsyncSession) -> None:
    """Raise 403 if the provided token does not match the stored one."""
    result = await db.execute(
        select(AppSetting).where(AppSetting.key == _TOKEN_KEY)
    )
    setting = result.scalar_one_or_none()
    if not setting or not setting.value or setting.value != token:
        raise HTTPException(status_code=403, detail="Invalid or missing dashboard token")


@router.get("/dashboard")
async def public_dashboard(
    token: str = Query(..., description="Dashboard share token"),
    db: AsyncSession = Depends(get_db),
):
    """Read-only family overview. No authentication — gated by share token only."""
    await _resolve_token(token, db)

    today = date.today()
    monday = today - timedelta(days=today.weekday())
    await auto_generate_week_assignments(db, monday)

    result = await db.execute(
        select(User).where(User.role == UserRole.kid, User.is_active)
    )
    kids = result.scalars().all()

    if not kids:
        return {"kids": [], "date": today.isoformat()}

    kid_ids = [k.id for k in kids]
    today_totals = await _count_today_assignments_by_kid(db, kid_ids, today)
    today_completed_map = await _count_today_assignments_by_kid(
        db, kid_ids, today, completed_only=True
    )

    # Per-kid today assignments with chore title
    assignments_result = await db.execute(
        select(ChoreAssignment)
        .join(Chore, ChoreAssignment.chore_id == Chore.id)
        .where(
            ChoreAssignment.user_id.in_(kid_ids),
            ChoreAssignment.date == today,
            Chore.is_active == True,
        )
        .options(selectinload(ChoreAssignment.chore))
    )
    all_assignments = assignments_result.scalars().all()

    # Group assignments by kid
    assignments_by_kid: dict[int, list] = {k.id: [] for k in kids}
    for a in all_assignments:
        if a.user_id in assignments_by_kid:
            assignments_by_kid[a.user_id].append(a)

    family = []
    for kid in kids:
        effective_streak = await _effective_streak(db, kid)
        chore_list = []
        for a in assignments_by_kid.get(kid.id, []):
            chore_list.append({
                "id": a.id,
                "chore_title": a.chore.title if a.chore else "Quest",
                "points": a.chore.points if a.chore else 0,
                "status": a.status.value if hasattr(a.status, "value") else str(a.status),
                "completed_at": utc_iso(a.completed_at),
            })
        # Sort: pending first, then completed/verified
        chore_list.sort(key=lambda c: (c["status"] in ("completed", "verified"),))

        family.append({
            "id": kid.id,
            "display_name": kid.display_name,
            "avatar_config": kid.avatar_config,
            "points_balance": kid.points_balance,
            "current_streak": effective_streak,
            "today_completed": today_completed_map.get(kid.id, 0),
            "today_total": today_totals.get(kid.id, 0),
            "chores": chore_list,
        })

    return {"kids": family, "date": today.isoformat()}
