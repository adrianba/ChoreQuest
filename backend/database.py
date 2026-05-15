from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from backend.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False},
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    async with engine.begin() as conn:
        # Enable WAL mode
        await conn.exec_driver_sql("PRAGMA journal_mode=WAL")
        from backend.models import (  # noqa: F401
            User, Chore, ChoreAssignment, ChoreCategory, ChoreRotation,
            ChoreExclusion, ChoreAssignmentRule, QuestTemplate,
            Reward, RewardRedemption, PointTransaction,
            Achievement, UserAchievement, WishlistItem, SeasonalEvent,
            Notification, SpinResult, ApiKey, AuditLog, AppSetting,
            InviteCode, RefreshToken, PushSubscription,
            AvatarItem, UserAvatarItem,
            Shoutout, VacationPeriod, BountyBoardClaim,
        )
        await conn.run_sync(Base.metadata.create_all)

        # Lightweight column migrations for SQLite (create_all won't add
        # new columns to existing tables).
        _migrations = [
            ("reward_redemptions", "fulfilled_by", "INTEGER REFERENCES users(id)"),
            ("reward_redemptions", "fulfilled_at", "DATETIME"),
            # v2 feature columns
            ("users", "streak_freezes_used", "INTEGER DEFAULT 0"),
            ("users", "streak_freeze_month", "INTEGER"),
            ("chore_assignments", "feedback", "TEXT"),
            ("rewards", "category", "VARCHAR(50)"),
            ("achievements", "tier", "VARCHAR(10)"),
            ("achievements", "group_key", "VARCHAR(50)"),
            ("achievements", "sort_order", "INTEGER DEFAULT 0"),
            # Bounty Board
            ("chores", "is_bounty", "INTEGER DEFAULT 0"),
            # Rotation day-of-week (0=Mon…6=Sun); default Monday
            ("chore_rotations", "rotation_day", "INTEGER DEFAULT 0"),
            # Kid note on bounty claim completion (bug reports, descriptions, etc.)
            ("bounty_board_claims", "kid_note", "TEXT"),
            # Inverse rotation linking: two chores that advance in lock-step
            ("chore_rotations", "inverse_of_chore_id", "INTEGER REFERENCES chores(id)"),
            # Per-kid vacation: NULL = family-wide, set = individual kid only
            ("vacation_periods", "user_id", "INTEGER REFERENCES users(id)"),
        ]
        for table, col, typedef in _migrations:
            try:
                await conn.exec_driver_sql(
                    f"ALTER TABLE {table} ADD COLUMN {col} {typedef}"
                )
            except Exception:
                pass  # column already exists

        await conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS idx_chore_assignments_user_date "
            "ON chore_assignments(user_id, date)"
        )


async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
