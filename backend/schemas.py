from datetime import datetime, date
from typing import Annotated
from pydantic import BaseModel, Field
from pydantic.functional_serializers import PlainSerializer
from backend.models import UserRole, Difficulty, Recurrence, AssignmentStatus, RedemptionStatus, PointType, NotificationType, RotationCadence, BountyClaimStatus


def _utc_str(v: datetime) -> str:
    """Serialize a naive UTC datetime to ISO 8601 with 'Z' suffix."""
    return v.strftime("%Y-%m-%dT%H:%M:%S") + "Z"


# Use in Response schemas so all datetime fields get the UTC 'Z' suffix.
# Without this, Pydantic v2 serializes naive datetimes without a timezone
# marker and JavaScript treats them as local time.
UtcDt = Annotated[datetime, PlainSerializer(_utc_str, return_type=str, when_used="json")]


# Auth
class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=50)
    password: str = Field(min_length=6)
    display_name: str = Field(min_length=1, max_length=10)
    role: UserRole = UserRole.kid
    invite_code: str | None = None


class LoginRequest(BaseModel):
    username: str
    password: str


class PinLoginRequest(BaseModel):
    username: str
    pin: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


class SetPinRequest(BaseModel):
    pin: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class UpdateProfileRequest(BaseModel):
    display_name: str | None = Field(None, max_length=10)
    avatar_config: dict | None = None


class UserResponse(BaseModel):
    id: int
    username: str
    display_name: str
    role: UserRole
    points_balance: int
    total_points_earned: int
    current_streak: int
    longest_streak: int
    streak_freezes_used: int = 0
    streak_freeze_month: int | None = None
    avatar_config: dict | None
    is_active: bool
    created_at: UtcDt

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    access_token: str
    user: UserResponse


# Categories
class CategoryCreate(BaseModel):
    name: str = Field(max_length=50)
    icon: str = Field(max_length=50)
    colour: str = Field(max_length=7)


class CategoryResponse(BaseModel):
    id: int
    name: str
    icon: str
    colour: str
    is_default: bool

    model_config = {"from_attributes": True}


# Chores
class ChoreCreate(BaseModel):
    title: str = Field(max_length=200)
    description: str | None = None
    points: int = Field(gt=0)
    difficulty: Difficulty
    icon: str | None = None
    category_id: int
    recurrence: Recurrence
    custom_days: list[int] | None = None
    requires_photo: bool = False
    is_bounty: bool = False
    assigned_user_ids: list[int] = []


class ChoreUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    points: int | None = None
    difficulty: Difficulty | None = None
    icon: str | None = None
    category_id: int | None = None
    recurrence: Recurrence | None = None
    custom_days: list[int] | None = None
    requires_photo: bool | None = None
    is_bounty: bool | None = None
    assigned_user_ids: list[int] | None = None


class RotationSummary(BaseModel):
    current_kid_id: int
    current_kid_name: str
    cadence: RotationCadence
    kid_ids: list[int]
    current_index: int

    model_config = {"from_attributes": True}


class ChoreResponse(BaseModel):
    id: int
    title: str
    description: str | None
    points: int
    difficulty: Difficulty
    icon: str | None
    category_id: int
    category: CategoryResponse | None = None
    recurrence: Recurrence
    custom_days: list[int] | None
    requires_photo: bool
    is_active: bool
    is_bounty: bool = False
    created_by: int
    created_at: UtcDt
    rotation_summary: RotationSummary | None = None
    # Populated by GET /api/chores/{id} when the requester is a kid so
    # ChoreDetail can show the Complete Quest button without a second API call.
    # Named kid_assignments (not assignments) to avoid shadowing the SQLAlchemy
    # relationship of the same name on the Chore ORM model.
    kid_assignments: list[dict] | None = None

    model_config = {"from_attributes": True}


class AssignmentResponse(BaseModel):
    id: int
    chore_id: int
    user_id: int
    date: date
    status: AssignmentStatus
    completed_at: UtcDt | None
    verified_at: UtcDt | None
    verified_by: int | None
    photo_proof_path: str | None
    feedback: str | None = None
    chore: ChoreResponse | None = None
    user: UserResponse | None = None

    model_config = {"from_attributes": True}


# Rewards
class RewardCreate(BaseModel):
    title: str = Field(max_length=200)
    description: str | None = None
    point_cost: int = Field(gt=0)
    icon: str | None = None
    category: str | None = None
    stock: int | None = None
    auto_approve_threshold: int | None = None


class RewardUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    point_cost: int | None = None
    icon: str | None = None
    category: str | None = None
    stock: int | None = None
    auto_approve_threshold: int | None = None


class RewardResponse(BaseModel):
    id: int
    title: str
    description: str | None
    point_cost: int
    icon: str | None
    category: str | None = None
    stock: int | None
    auto_approve_threshold: int | None
    is_active: bool
    created_by: int
    created_at: UtcDt

    model_config = {"from_attributes": True}


class RedemptionResponse(BaseModel):
    id: int
    reward_id: int
    user_id: int
    points_spent: int
    status: RedemptionStatus
    approved_by: int | None
    approved_at: UtcDt | None
    fulfilled_by: int | None = None
    fulfilled_at: UtcDt | None = None
    created_at: UtcDt
    reward: RewardResponse | None = None
    user: UserResponse | None = None

    model_config = {"from_attributes": True}


# Points
class BonusRequest(BaseModel):
    amount: int = Field(gt=0)
    description: str


class AdjustRequest(BaseModel):
    amount: int
    description: str


class PointTransactionResponse(BaseModel):
    id: int
    user_id: int
    amount: int
    type: PointType
    description: str
    reference_id: int | None
    created_at: UtcDt

    model_config = {"from_attributes": True}


# Achievements
class AchievementResponse(BaseModel):
    id: int
    key: str
    title: str
    description: str
    icon: str
    points_reward: int
    criteria: dict
    tier: str | None = None
    group_key: str | None = None
    sort_order: int
    unlocked: bool = False
    unlocked_at: UtcDt | None = None

    model_config = {"from_attributes": True}


class AchievementUpdate(BaseModel):
    points_reward: int = Field(gt=0)


# Notifications
class NotificationResponse(BaseModel):
    id: int
    user_id: int
    type: NotificationType
    title: str
    message: str
    is_read: bool
    reference_type: str | None
    reference_id: int | None
    created_at: UtcDt

    model_config = {"from_attributes": True}


# Spin
class SpinResultResponse(BaseModel):
    points_won: int


class SpinAvailabilityResponse(BaseModel):
    can_spin: bool
    last_result: int | None = None
    reason: str | None = None
    spin_credits: int = 0


# Calendar
class TradeRequest(BaseModel):
    assignment_id: int
    target_user_id: int


# Wishlist
class WishlistCreate(BaseModel):
    title: str = Field(max_length=200)
    url: str | None = None
    image_url: str | None = None
    notes: str | None = None


class WishlistUpdate(BaseModel):
    title: str | None = None
    url: str | None = None
    image_url: str | None = None
    notes: str | None = None


class WishlistResponse(BaseModel):
    id: int
    user_id: int
    user_display_name: str | None = None
    title: str
    url: str | None
    image_url: str | None
    notes: str | None
    converted_to_reward_id: int | None
    created_at: UtcDt

    model_config = {"from_attributes": True}


class WishlistConvertRequest(BaseModel):
    point_cost: int = Field(gt=0)


# Events
class EventCreate(BaseModel):
    title: str = Field(max_length=200)
    description: str | None = None
    multiplier: float = Field(gt=1.0)
    start_date: datetime
    end_date: datetime


class EventUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    multiplier: float | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None


class EventResponse(BaseModel):
    id: int
    title: str
    description: str | None
    multiplier: float
    start_date: UtcDt
    end_date: UtcDt
    is_active: bool
    created_by: int
    created_at: UtcDt

    model_config = {"from_attributes": True}


# Assignment Rules
class AssignmentRuleItem(BaseModel):
    user_id: int
    recurrence: Recurrence
    custom_days: list[int] | None = None
    requires_photo: bool = False


class AssignmentRuleRotation(BaseModel):
    enabled: bool = False
    cadence: RotationCadence = RotationCadence.weekly
    # Optional: link this rotation as the inverse of another chore's rotation.
    # When set, this rotation advances in lock-step with the referenced chore.
    inverse_of_chore_id: int | None = None


class ChoreAssignRequest(BaseModel):
    assignments: list[AssignmentRuleItem]
    rotation: AssignmentRuleRotation | None = None


class AssignmentRuleUpdate(BaseModel):
    recurrence: Recurrence | None = None
    custom_days: list[int] | None = None
    requires_photo: bool | None = None
    is_active: bool | None = None


class AssignmentRuleResponse(BaseModel):
    id: int
    chore_id: int
    user_id: int
    recurrence: Recurrence
    custom_days: list[int] | None
    requires_photo: bool
    is_active: bool
    user: UserResponse | None = None

    model_config = {"from_attributes": True}


# Quest Templates
class QuestTemplateResponse(BaseModel):
    id: int
    title: str
    description: str | None
    suggested_points: int
    difficulty: Difficulty
    category_name: str
    icon: str | None

    model_config = {"from_attributes": True}


# Rotations
class RotationCreate(BaseModel):
    chore_id: int
    kid_ids: list[int]
    cadence: RotationCadence
    # 0=Monday … 6=Sunday; used by weekly/fortnightly cadences
    rotation_day: int = 0


class RotationUpdate(BaseModel):
    kid_ids: list[int] | None = None
    cadence: RotationCadence | None = None
    rotation_day: int | None = None


class RotationResponse(BaseModel):
    id: int
    chore_id: int
    kid_ids: list[int]
    cadence: RotationCadence
    rotation_day: int
    current_index: int
    last_rotated: UtcDt | None
    inverse_of_chore_id: int | None = None
    created_at: UtcDt

    model_config = {"from_attributes": True}


# Admin
class AdminUserUpdate(BaseModel):
    role: UserRole | None = None
    is_active: bool | None = None


class AdminResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=6)


class ApiKeyCreate(BaseModel):
    name: str = Field(max_length=100)
    scopes: list[str] = []


class ApiKeyResponse(BaseModel):
    id: int
    name: str
    key_prefix: str
    scopes: list
    last_used_at: UtcDt | None
    is_active: bool
    created_at: UtcDt

    model_config = {"from_attributes": True}


class InviteCodeCreate(BaseModel):
    role: UserRole
    max_uses: int = 1
    expires_at: datetime | None = None


class InviteCodeResponse(BaseModel):
    id: int
    code: str
    role: UserRole
    max_uses: int
    times_used: int
    expires_at: UtcDt | None
    created_at: UtcDt

    model_config = {"from_attributes": True}


class AuditLogResponse(BaseModel):
    id: int
    user_id: int | None
    action: str
    details: dict | None
    ip_address: str | None
    created_at: UtcDt

    model_config = {"from_attributes": True}


class SettingsUpdate(BaseModel):
    settings: dict[str, str]


# Shoutouts
class ShoutoutCreate(BaseModel):
    to_user_id: int
    message: str = Field(max_length=200)
    emoji: str = Field(max_length=10, default="star")


class ShoutoutResponse(BaseModel):
    id: int
    from_user_id: int
    from_user_name: str | None = None
    to_user_id: int
    to_user_name: str | None = None
    message: str
    emoji: str
    created_at: UtcDt

    model_config = {"from_attributes": True}


# Vacation
class VacationCreate(BaseModel):
    start_date: date
    end_date: date
    user_id: int | None = None  # None = family-wide; set = specific kid only


class VacationTrimRequest(BaseModel):
    end_date: date  # new (earlier) end date — must be >= start_date and < current end_date


class VacationResponse(BaseModel):
    id: int
    start_date: date
    end_date: date
    created_by: int
    user_id: int | None = None
    kid_name: str | None = None  # display name injected by the router
    is_active: bool
    created_at: UtcDt

    model_config = {"from_attributes": True}


# Announcements (Bulletin Board)
class AnnouncementCreate(BaseModel):
    title: str = Field(max_length=200)
    message: str = Field(max_length=1000)
    icon: str | None = None
    is_pinned: bool = False


class AnnouncementResponse(BaseModel):
    id: int
    title: str
    message: str
    icon: str | None
    is_pinned: bool
    created_by: int
    creator_name: str | None = None
    created_at: UtcDt

    model_config = {"from_attributes": True}


# Quest Feedback
class QuestFeedbackRequest(BaseModel):
    feedback: str = Field(max_length=500)


# Streak Freeze
class StreakFreezeResponse(BaseModel):
    used: bool
    freezes_used_this_month: int
    month: int


# Pet Interaction
class PetInteractionRequest(BaseModel):
    action: str = Field(pattern=r"^(feed|pet|play)$")


# Bounty Board
class BountyClaimResponse(BaseModel):
    id: int
    chore_id: int
    chore_title: str | None = None  # injected by router so Review Claims always has a title
    chore_points: int | None = None
    chore_requires_photo: bool = False
    user_id: int
    user_display_name: str | None = None
    status: BountyClaimStatus
    photo_proof_path: str | None
    kid_note: str | None = None
    claimed_at: UtcDt
    completed_at: UtcDt | None
    verified_at: UtcDt | None
    verified_by: int | None

    model_config = {"from_attributes": True}


class BountyResponse(BaseModel):
    id: int
    title: str
    description: str | None
    points: int
    difficulty: Difficulty
    icon: str | None
    category_id: int
    category: CategoryResponse | None = None
    requires_photo: bool
    is_active: bool
    # Enriched at query time
    my_claim: BountyClaimResponse | None = None
    claim_count: int = 0
    claims: list[BountyClaimResponse] = []

    model_config = {"from_attributes": True}
