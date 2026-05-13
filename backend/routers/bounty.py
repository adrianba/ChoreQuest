"""Bounty Board — optional side quests kids can claim for bonus XP.

Kids browse the board, accept bounties they want, complete them, and
parents verify to award XP.  Bounties never count against streaks or
completion rate because they live in bounty_board_claims, not
chore_assignments.
"""

from datetime import datetime, date, timezone, timedelta

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File
from sqlalchemy import select, delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models import (
    User, UserRole, Chore, BountyBoardClaim, BountyClaimStatus,
    PointTransaction, PointType, Notification, NotificationType,
    ChoreCategory, SeasonalEvent, AssignmentStatus, ChoreAssignment,
)
from backend.schemas import BountyResponse, BountyClaimResponse, CategoryResponse, ChoreResponse
from backend.dependencies import get_current_user, require_parent
from backend.websocket_manager import ws_manager

import os, uuid, logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/bounty", tags=["bounty"])

UPLOAD_DIR = "/app/data/uploads"
_WS_BOUNTY_CHANGED = {"type": "data_changed", "data": {"entity": "bounty"}}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_claim(
    claim: BountyBoardClaim,
    user: User | None = None,
    chore_title: str | None = None,
    chore_points: int | None = None,
    chore_requires_photo: bool = False,
) -> BountyClaimResponse:
    return BountyClaimResponse(
        id=claim.id,
        chore_id=claim.chore_id,
        chore_title=chore_title,
        chore_points=chore_points,
        chore_requires_photo=chore_requires_photo,
        user_id=claim.user_id,
        user_display_name=user.display_name if user else None,
        status=claim.status,
        photo_proof_path=claim.photo_proof_path,
        kid_note=claim.kid_note,
        claimed_at=claim.claimed_at,
        completed_at=claim.completed_at,
        verified_at=claim.verified_at,
        verified_by=claim.verified_by,
    )


def _build_bounty(
    chore: Chore,
    my_claim: BountyBoardClaim | None,
    all_claims: list[tuple[BountyBoardClaim, User]],
) -> BountyResponse:
    cat = chore.category
    cat_resp = CategoryResponse(
        id=cat.id, name=cat.name, icon=cat.icon, colour=cat.colour,
        is_default=cat.is_default,
    ) if cat else None

    my_claim_resp = _build_claim(my_claim, chore_title=chore.title, chore_points=chore.points, chore_requires_photo=chore.requires_photo) if my_claim else None

    active_statuses = {BountyClaimStatus.claimed, BountyClaimStatus.completed, BountyClaimStatus.verified}
    claim_count = sum(1 for c, _ in all_claims if c.status in active_statuses)

    claims_resp = [_build_claim(c, u, chore_title=chore.title, chore_points=chore.points, chore_requires_photo=chore.requires_photo) for c, u in all_claims]

    return BountyResponse(
        id=chore.id,
        title=chore.title,
        description=chore.description,
        points=chore.points,
        difficulty=chore.difficulty,
        icon=chore.icon,
        category_id=chore.category_id,
        category=cat_resp,
        requires_photo=chore.requires_photo,
        is_active=chore.is_active,
        my_claim=my_claim_resp,
        claim_count=claim_count,
        claims=claims_resp,
    )


async def _get_active_event_multiplier(db: AsyncSession) -> float:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    result = await db.execute(
        select(SeasonalEvent).where(
            SeasonalEvent.is_active == True,
            SeasonalEvent.start_date <= now,
            SeasonalEvent.end_date >= now,
        )
    )
    events = result.scalars().all()
    if not events:
        return 1.0
    multiplier = 1.0
    for e in events:
        multiplier *= e.multiplier
    return multiplier


# ---------------------------------------------------------------------------
# GET /api/bounty — list bounty board
# ---------------------------------------------------------------------------

@router.get("", response_model=list[BountyResponse])
async def list_bounties(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all active bounty-board chores with claim status."""
    result = await db.execute(
        select(Chore)
        .where(Chore.is_bounty == True, Chore.is_active == True)
        .options()
    )
    chores = result.scalars().all()
    if not chores:
        return []

    chore_ids = [c.id for c in chores]

    # Load all claims for these chores
    claims_result = await db.execute(
        select(BountyBoardClaim, User)
        .join(User, BountyBoardClaim.user_id == User.id)
        .where(BountyBoardClaim.chore_id.in_(chore_ids))
    )
    claim_rows = claims_result.all()

    # Build lookup: chore_id -> [(claim, user)]
    from collections import defaultdict
    claims_by_chore: dict[int, list[tuple[BountyBoardClaim, User]]] = defaultdict(list)
    my_claim_by_chore: dict[int, BountyBoardClaim] = {}
    for claim, user in claim_rows:
        claims_by_chore[claim.chore_id].append((claim, user))
        if claim.user_id == current_user.id:
            my_claim_by_chore[claim.chore_id] = claim

    # Load categories
    cat_ids = list({c.category_id for c in chores})
    cat_result = await db.execute(
        select(ChoreCategory).where(ChoreCategory.id.in_(cat_ids))
    )
    cats = {cat.id: cat for cat in cat_result.scalars().all()}
    for chore in chores:
        chore.category = cats.get(chore.category_id)

    bounties = []
    for chore in chores:
        my_claim = my_claim_by_chore.get(chore.id)
        all_claims = claims_by_chore.get(chore.id, [])

        # Kids can see all bounties including ones they abandoned,
        # so they know they can re-claim them.
        # Verified claims are hidden once the daily reset has cleared them anyway.

        bounties.append(_build_bounty(chore, my_claim, all_claims))

    return bounties


# ---------------------------------------------------------------------------
# POST /api/bounty/{chore_id}/claim — kid accepts a bounty
# ---------------------------------------------------------------------------

@router.post("/{chore_id}/claim", response_model=BountyClaimResponse, status_code=201)
async def claim_bounty(
    chore_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Kid accepts a bounty from the board."""
    if current_user.role not in (UserRole.kid,):
        raise HTTPException(status_code=403, detail="Only kids can claim bounties")

    # Verify the chore exists and is a bounty
    chore_result = await db.execute(
        select(Chore).where(Chore.id == chore_id, Chore.is_bounty == True, Chore.is_active == True)
    )
    chore = chore_result.scalar_one_or_none()
    if not chore:
        raise HTTPException(status_code=404, detail="Bounty not found")

    # Guard: kid can't claim a bounty if they already have a regular assignment
    # for this chore today (prevents double-XP path)
    today = date.today()
    existing_assignment = await db.execute(
        select(ChoreAssignment).where(
            ChoreAssignment.chore_id == chore_id,
            ChoreAssignment.user_id == current_user.id,
            ChoreAssignment.date == today,
            ChoreAssignment.status != AssignmentStatus.skipped,
        )
    )
    if existing_assignment.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="This quest is already in your regular quest list for today",
        )

    # Check for existing claim
    existing_claim_result = await db.execute(
        select(BountyBoardClaim).where(
            BountyBoardClaim.chore_id == chore_id,
            BountyBoardClaim.user_id == current_user.id,
        )
    )
    existing_claim = existing_claim_result.scalar_one_or_none()

    if existing_claim:
        if existing_claim.status == BountyClaimStatus.abandoned:
            # Re-activate abandoned claim
            existing_claim.status = BountyClaimStatus.claimed
            existing_claim.claimed_at = datetime.now(timezone.utc).replace(tzinfo=None)
            existing_claim.completed_at = None
            existing_claim.verified_at = None
            existing_claim.photo_proof_path = None
            await db.commit()
            await db.refresh(existing_claim)
            await ws_manager.broadcast(_WS_BOUNTY_CHANGED)
            return _build_claim(existing_claim, current_user, chore_title=chore.title, chore_points=chore.points, chore_requires_photo=chore.requires_photo)
        raise HTTPException(status_code=409, detail="You have already claimed this bounty")

    claim = BountyBoardClaim(
        chore_id=chore_id,
        user_id=current_user.id,
        status=BountyClaimStatus.claimed,
        claimed_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(claim)

    # Notify parents
    parent_result = await db.execute(
        select(User).where(User.role.in_([UserRole.parent, UserRole.admin]), User.is_active == True)
    )
    for parent in parent_result.scalars().all():
        db.add(Notification(
            user_id=parent.id,
            type=NotificationType.bounty_claimed,
            title="Bounty Accepted!",
            message=f"{current_user.display_name} accepted the bounty: {chore.title}",
            reference_type="bounty_claim",
            reference_id=None,
        ))

    await db.commit()
    await db.refresh(claim)
    await ws_manager.broadcast(_WS_BOUNTY_CHANGED)
    return _build_claim(claim, current_user, chore_title=chore.title, chore_points=chore.points, chore_requires_photo=chore.requires_photo)


# ---------------------------------------------------------------------------
# POST /api/bounty/{chore_id}/complete — kid marks bounty done
# ---------------------------------------------------------------------------

@router.post("/{chore_id}/complete", response_model=BountyClaimResponse)
async def complete_bounty(
    chore_id: int,
    file: UploadFile | None = File(None),
    kid_note: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Kid marks their claimed bounty as done (optionally with photo proof and a note)."""
    if current_user.role != UserRole.kid:
        raise HTTPException(status_code=403, detail="Only kids can complete bounties")

    claim_result = await db.execute(
        select(BountyBoardClaim).where(
            BountyBoardClaim.chore_id == chore_id,
            BountyBoardClaim.user_id == current_user.id,
            BountyBoardClaim.status == BountyClaimStatus.claimed,
        )
    )
    claim = claim_result.scalar_one_or_none()
    if not claim:
        raise HTTPException(status_code=404, detail="No active claim found for this bounty")

    # Validate chore requires_photo
    chore_result = await db.execute(select(Chore).where(Chore.id == chore_id))
    chore = chore_result.scalar_one_or_none()

    if chore and chore.requires_photo and not file:
        raise HTTPException(status_code=400, detail="This bounty requires a photo")

    # Handle photo upload
    if file and file.filename:
        content = await file.read()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Photo must be under 10 MB")
        allowed_mime = {"image/jpeg", "image/png", "image/gif", "image/webp"}
        if file.content_type not in allowed_mime:
            raise HTTPException(status_code=400, detail="Invalid file type")
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
            raise HTTPException(status_code=400, detail="Invalid file type")
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        filename = f"bounty_{claim.id}_{uuid.uuid4().hex}{ext}"
        path = os.path.join(UPLOAD_DIR, filename)
        with open(path, "wb") as f:
            f.write(content)
        claim.photo_proof_path = filename

    claim.status = BountyClaimStatus.completed
    claim.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    if kid_note and kid_note.strip():
        claim.kid_note = kid_note.strip()[:1000]  # cap at 1000 chars

    # Notify parents there's a bounty to review
    parent_result = await db.execute(
        select(User).where(User.role.in_([UserRole.parent, UserRole.admin]), User.is_active == True)
    )
    chore_title = chore.title if chore else f"Bounty #{chore_id}"
    for parent in parent_result.scalars().all():
        db.add(Notification(
            user_id=parent.id,
            type=NotificationType.chore_completed,
            title="Bounty Ready to Verify!",
            message=f"{current_user.display_name} completed the bounty: {chore_title}",
            reference_type="bounty_claim",
            reference_id=claim.id,
        ))

    await db.commit()
    await db.refresh(claim)
    await ws_manager.broadcast(_WS_BOUNTY_CHANGED)
    return _build_claim(claim, current_user, chore_title=chore.title if chore else None, chore_points=chore.points if chore else None, chore_requires_photo=chore.requires_photo if chore else False)


# ---------------------------------------------------------------------------
# DELETE /api/bounty/{chore_id}/claim — kid abandons a bounty
# ---------------------------------------------------------------------------

@router.delete("/{chore_id}/claim", status_code=200)
async def abandon_bounty(
    chore_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Kid abandons their bounty claim."""
    if current_user.role != UserRole.kid:
        raise HTTPException(status_code=403, detail="Only kids can abandon bounties")

    claim_result = await db.execute(
        select(BountyBoardClaim).where(
            BountyBoardClaim.chore_id == chore_id,
            BountyBoardClaim.user_id == current_user.id,
            BountyBoardClaim.status.in_([BountyClaimStatus.claimed, BountyClaimStatus.completed]),
        )
    )
    claim = claim_result.scalar_one_or_none()
    if not claim:
        raise HTTPException(status_code=404, detail="No active claim found")

    claim.status = BountyClaimStatus.abandoned
    await db.commit()
    await ws_manager.broadcast(_WS_BOUNTY_CHANGED)
    return {"detail": "Bounty abandoned"}


# ---------------------------------------------------------------------------
# GET /api/bounty/claims — parent sees all pending claims
# ---------------------------------------------------------------------------

@router.get("/claims", response_model=list[BountyClaimResponse])
async def list_pending_claims(
    db: AsyncSession = Depends(get_db),
    parent: User = Depends(require_parent),
):
    """List all completed (awaiting approval) bounty claims. Parent+ only."""
    result = await db.execute(
        select(BountyBoardClaim, User, Chore)
        .join(User, BountyBoardClaim.user_id == User.id)
        .outerjoin(Chore, BountyBoardClaim.chore_id == Chore.id)
        .where(BountyBoardClaim.status == BountyClaimStatus.completed)
        .order_by(BountyBoardClaim.completed_at.desc())
    )
    return [
        _build_claim(
            claim, user,
            chore_title=chore.title if chore else None,
            chore_points=chore.points if chore else None,
            chore_requires_photo=chore.requires_photo if chore else False,
        )
        for claim, user, chore in result.all()
    ]


# ---------------------------------------------------------------------------
# POST /api/bounty/claims/{claim_id}/verify — parent approves, awards XP
# ---------------------------------------------------------------------------

@router.post("/claims/{claim_id}/verify", response_model=BountyClaimResponse)
async def verify_bounty_claim(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    parent: User = Depends(require_parent),
):
    """Parent approves a completed bounty claim — awards XP to the kid."""
    # Atomically transition the claim from completed → verified.
    # Using a conditional UPDATE means only one concurrent request can succeed;
    # the second will see rowcount=0 and receive a 409 rather than double-awarding XP.
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    result = await db.execute(
        update(BountyBoardClaim)
        .where(
            BountyBoardClaim.id == claim_id,
            BountyBoardClaim.status == BountyClaimStatus.completed,
        )
        .values(
            status=BountyClaimStatus.verified,
            verified_at=now,
            verified_by=parent.id,
        )
        .execution_options(synchronize_session="fetch")
    )
    if result.rowcount == 0:
        # Either not found or already verified/rejected by a concurrent request
        check = await db.execute(select(BountyBoardClaim).where(BountyBoardClaim.id == claim_id))
        existing = check.scalar_one_or_none()
        if not existing:
            raise HTTPException(status_code=404, detail="Claim not found")
        raise HTTPException(status_code=409, detail="Claim already processed. Please refresh.")

    claim_result = await db.execute(select(BountyBoardClaim).where(BountyBoardClaim.id == claim_id))
    claim = claim_result.scalar_one()

    # Load chore and kid
    chore_result = await db.execute(select(Chore).where(Chore.id == claim.chore_id))
    chore = chore_result.scalar_one_or_none()
    if not chore:
        raise HTTPException(status_code=404, detail="Chore not found")

    kid_result = await db.execute(select(User).where(User.id == claim.user_id))
    kid = kid_result.scalar_one_or_none()
    if not kid:
        raise HTTPException(status_code=404, detail="Kid not found")

    # Apply seasonal event multiplier — split into base + bonus transactions
    # to match the audit-log structure used by regular chore verification.
    multiplier = await _get_active_event_multiplier(db)
    base_points = chore.points
    bonus_points = int(base_points * multiplier) - base_points if multiplier > 1.0 else 0
    total_awarded = base_points + bonus_points

    kid.points_balance += total_awarded
    kid.total_points_earned += total_awarded

    db.add(PointTransaction(
        user_id=kid.id,
        amount=base_points,
        type=PointType.chore_complete,
        description=f"Bounty completed: {chore.title}",
        reference_id=claim.id,
        created_by=parent.id,
    ))
    if bonus_points > 0:
        db.add(PointTransaction(
            user_id=kid.id,
            amount=bonus_points,
            type=PointType.event_multiplier,
            description=f"Event bonus ({multiplier}x): {chore.title}",
            reference_id=claim.id,
            created_by=parent.id,
        ))

    # Pet XP
    from backend.services.pet_leveling import award_pet_xp_db
    pet_levelup = await award_pet_xp_db(db, kid, total_awarded)
    if pet_levelup:
        db.add(Notification(
            user_id=kid.id,
            type=NotificationType.pet_levelup,
            title="Pet Leveled Up!",
            message=f"Your pet reached level {pet_levelup['new_level']} — {pet_levelup['name']}!",
            reference_type="pet",
        ))

    # Update streak via shared service (same logic as regular chore verification)
    from backend.services.streak import update_streak
    today = date.today()
    await update_streak(db, kid, today)

    # Notify kid (status/verified_at/verified_by already set by the atomic UPDATE above)
    db.add(Notification(
        user_id=kid.id,
        type=NotificationType.bounty_verified,
        title="Bounty Rewarded!",
        message=f"'{chore.title}' approved — you earned {total_awarded} XP!",
        reference_type="bounty_claim",
        reference_id=claim.id,
    ))

    await db.commit()
    await db.refresh(claim)

    # Check achievements (same pattern as chore verification)
    from backend.achievements import check_achievements
    await check_achievements(db, kid)

    await ws_manager.send_to_user(kid.id, {
        "type": "bounty_verified",
        "data": {"title": chore.title, "xp": total_awarded},
    })
    await ws_manager.broadcast(_WS_BOUNTY_CHANGED)

    return _build_claim(claim, kid, chore_title=chore.title, chore_points=chore.points, chore_requires_photo=chore.requires_photo)


# ---------------------------------------------------------------------------
# POST /api/bounty/claims/{claim_id}/reject — parent rejects, back to claimed
# ---------------------------------------------------------------------------

@router.post("/claims/{claim_id}/reject", response_model=BountyClaimResponse)
async def reject_bounty_claim(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    parent: User = Depends(require_parent),
):
    """Parent rejects a completed bounty claim — kid can try again."""
    claim_result = await db.execute(
        select(BountyBoardClaim).where(BountyBoardClaim.id == claim_id)
    )
    claim = claim_result.scalar_one_or_none()
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.status != BountyClaimStatus.completed:
        raise HTTPException(status_code=400, detail="Claim is not in completed state")

    # Load kid and chore for response + notification
    kid_result = await db.execute(select(User).where(User.id == claim.user_id))
    kid = kid_result.scalar_one_or_none()
    chore_result = await db.execute(select(Chore).where(Chore.id == claim.chore_id))
    chore = chore_result.scalar_one_or_none()

    photo_to_delete = claim.photo_proof_path

    claim.status = BountyClaimStatus.claimed
    claim.completed_at = None
    claim.photo_proof_path = None

    # Notify kid with correct notification type
    db.add(Notification(
        user_id=claim.user_id,
        type=NotificationType.bounty_rejected,
        title="Bounty Needs Redo",
        message=f"'{chore.title if chore else 'Bounty'}' needs more work — give it another try!",
        reference_type="bounty_claim",
        reference_id=claim.id,
    ))

    # Commit DB changes first; only delete the file after a successful commit
    # so we never orphan a DB reference nor silently lose a file on rollback.
    await db.commit()
    await db.refresh(claim)

    if photo_to_delete:
        from pathlib import Path
        try:
            (Path("/app/data/uploads") / photo_to_delete).unlink(missing_ok=True)
        except OSError:
            pass

    await ws_manager.broadcast(_WS_BOUNTY_CHANGED)
    return _build_claim(claim, kid, chore_title=chore.title if chore else None, chore_points=chore.points if chore else None, chore_requires_photo=chore.requires_photo if chore else False)


# ---------------------------------------------------------------------------
# POST /api/bounty/reset-claims — parent manually resets verified claims
# ---------------------------------------------------------------------------

@router.post("/reset-claims")
async def reset_verified_claims(
    db: AsyncSession = Depends(get_db),
    parent: User = Depends(require_parent),
):
    """Parent-triggered reset: delete all verified bounty claims so every
    kid can claim and complete those bounties again today."""
    result = await db.execute(
        delete(BountyBoardClaim)
        .where(BountyBoardClaim.status == BountyClaimStatus.verified)
        .returning(BountyBoardClaim.id)
    )
    deleted = result.fetchall()
    await db.commit()
    await ws_manager.broadcast(_WS_BOUNTY_CHANGED)
    return {"reset": len(deleted)}


# ---------------------------------------------------------------------------
# Cleanup helper — called from daily reset task
# ---------------------------------------------------------------------------

async def expire_stale_bounty_claims(db: AsyncSession) -> None:
    """Reset verified bounty claims from previous days.

    Deletes claim records whose status is 'verified' and whose verified_at
    timestamp is before today, so kids can re-claim those bounties fresh
    each day (useful for bounties that are effectively daily tasks).
    In-progress claims (claimed/completed) are intentionally left alone.
    Kids are notified so they know the board has refreshed.
    """
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)

    # Fetch affected claims before deleting so we can notify the kids
    stale_result = await db.execute(
        select(BountyBoardClaim).where(
            BountyBoardClaim.status == BountyClaimStatus.verified,
            BountyBoardClaim.verified_at < today_start,
        )
    )
    stale_claims = stale_result.scalars().all()

    if stale_claims:
        # Notify each unique kid whose claims are being reset
        notified_kids: set[int] = set()
        for claim in stale_claims:
            if claim.user_id not in notified_kids:
                notified_kids.add(claim.user_id)
                db.add(Notification(
                    user_id=claim.user_id,
                    type=NotificationType.announcement,
                    title="Bounty Board Refreshed!",
                    message="The bounty board has reset — these quests are available to claim again!",
                    reference_type="bounty",
                ))

    await db.execute(
        delete(BountyBoardClaim).where(
            BountyBoardClaim.status == BountyClaimStatus.verified,
            BountyBoardClaim.verified_at < today_start,
        )
    )
