"""Shared streak-update logic used by chore and bounty verification."""

from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Notification, NotificationType, User

_STREAK_MILESTONES = (7, 30, 100)


async def update_streak(db: AsyncSession, kid: User, today: date | None = None) -> None:
    """Update kid's streak fields and add milestone notifications if earned.

    Handles vacation-gap exemptions and monthly streak-freeze auto-use.
    Mutates ``kid`` in place; caller must commit.
    """
    if today is None:
        today = date.today()

    if kid.last_streak_date == today:
        pass  # already updated today (idempotent)
    elif kid.last_streak_date is not None:
        gap = (today - kid.last_streak_date).days
        if gap == 1:
            kid.current_streak += 1
            kid.last_streak_date = today
        elif gap > 1:
            from backend.routers.vacation import is_vacation_day
            all_vacation = True
            for offset in range(1, gap):
                gap_day = kid.last_streak_date + timedelta(days=offset)
                if not await is_vacation_day(db, gap_day, user_id=kid.id):
                    all_vacation = False
                    break
            if all_vacation:
                kid.current_streak += 1
                kid.last_streak_date = today
            else:
                # Streak freeze: auto-use if available (1 per calendar month)
                current_month = today.month + today.year * 12
                freeze_month = kid.streak_freeze_month or 0
                if kid.current_streak > 0 and freeze_month != current_month:
                    kid.streak_freezes_used = (kid.streak_freezes_used or 0) + 1
                    kid.streak_freeze_month = current_month
                    kid.current_streak += 1
                    kid.last_streak_date = today
                else:
                    kid.current_streak = 1
                    kid.last_streak_date = today
        else:
            kid.current_streak = 1
            kid.last_streak_date = today
    else:
        kid.current_streak = 1
        kid.last_streak_date = today

    if kid.current_streak > kid.longest_streak:
        kid.longest_streak = kid.current_streak

    if kid.current_streak in _STREAK_MILESTONES:
        db.add(Notification(
            user_id=kid.id,
            type=NotificationType.streak_milestone,
            title=f"{kid.current_streak}-Day Streak!",
            message=f"You've completed quests {kid.current_streak} days in a row! Keep it up!",
            reference_type="streak",
        ))
