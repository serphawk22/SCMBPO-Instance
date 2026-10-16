from datetime import datetime, timezone

import threading
import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlmodel import Session, select
from database import engine, SentEmail, User
from modules.api_tracker import current_salesperson_id
import base64
from fastapi.responses import Response
import os

router = APIRouter(prefix="/webhook", tags=["email_tracking"])

# Gmail (and most webmail) pre-fetch every image within seconds of delivery to
# cache it, regardless of whether a human has opened the email yet — so the
# very first pixel hit is almost never a real "open". We use timing as a
# heuristic (not proof) to give a more honest status than a single Sent->Opened
# flip on that first automated fetch:
#   - a hit within PIXEL_PREFETCH_WINDOW_SECONDS of sending -> "Delivered"
#     (still genuinely useful: confirms the mail wasn't bounced/blocked and the
#     provider rendered it enough to fetch images)
#   - a hit at/after PIXEL_OPEN_THRESHOLD_SECONDS -> "Opened" (provider caches
#     have long since expired, so a later fetch is a much stronger signal of an
#     actual later view)
#   - a hit in between the two thresholds doesn't downgrade or upgrade status;
#     we'd rather under-claim than fabricate confidence we don't have.
PIXEL_PREFETCH_WINDOW_SECONDS = int(os.getenv("PIXEL_PREFETCH_WINDOW_SECONDS", "90"))
PIXEL_OPEN_THRESHOLD_SECONDS = int(os.getenv("PIXEL_OPEN_THRESHOLD_SECONDS", "180"))

def get_session():
    with Session(engine) as session:
        yield session

@router.get("/track-email-open")
def track_email_open(id: int, session: Session = Depends(get_session)):
    """
    Webhook receiver for email tracking pixel.
    Updates status using the Delivered/Opened timing heuristic above (never
    downgrades a 'Replied' email), and records hit count + timestamps, then
    returns a transparent 1x1 pixel.

    This is hit by mail-provider image proxies (Gmail, Outlook, etc.) with no
    auth headers at all. main.py's APIIntelligenceMiddleware treats any
    unauthenticated request as tenant_id=-1 and a global do_orm_execute
    listener silently rewrites every query to filter on that tenant_id — so
    without `skip_tenant`, this lookup would always find nothing (and still
    return 200 with the pixel, making the failure invisible).
    """
    email = session.get(SentEmail, id, execution_options={"skip_tenant": True})
    if email:
        # This codebase's own _utcnow() (database.py) writes timezone-aware
        # UTC datetimes, so we match that convention here rather than using
        # naive datetime.utcnow(). sent_at is still normalized defensively
        # below in case the live column round-trips it as naive — subtracting
        # a naive and an aware datetime raises "can't subtract offset-naive
        # and offset-aware datetimes" on every single pixel hit, silently
        # rolling back the whole update.
        now = datetime.now(timezone.utc)
        if not email.opened_at:
            email.opened_at = now
        email.last_opened_at = now
        email.open_count = (email.open_count or 0) + 1

        if email.status != "Replied":
            sent_at = email.sent_at
            if sent_at.tzinfo is None:
                sent_at = sent_at.replace(tzinfo=timezone.utc)
            elapsed_seconds = (now - sent_at).total_seconds()
            if elapsed_seconds >= PIXEL_OPEN_THRESHOLD_SECONDS:
                email.status = "Opened"
            elif elapsed_seconds <= PIXEL_PREFETCH_WINDOW_SECONDS and email.status == "Sent":
                email.status = "Delivered"
            # else: in the ambiguous gap between the two windows — leave status as-is.

        session.add(email)
        session.commit()

    # Base64 encoded transparent 1x1 GIF
    pixel = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
    return Response(
        content=pixel,
        media_type="image/gif",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )


# These two endpoints log in to mailboxes over IMAP, so unlike the pixel / reply webhooks (which must
# stay public) they require a logged-in Admin, only touch that admin's own company's mailboxes
# (SuperAdmin: all) and are rate-limited per scope.
_ADMIN_ROLES = {"admin", "superadmin"}
_cooldowns: dict = {}
_cooldown_lock = threading.Lock()


def _require_admin(session: Session = Depends(get_session)):
    """(user, tenant_id to scan or None for every tenant). 401 without identity, 403 for non-admins."""
    uid = current_salesperson_id.get()
    user = session.get(User, uid) if uid else None
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    role = (user.role or "").strip().lower()
    # Same rule as main._require_roles: admin@serphawk.com is always a superuser.
    if role == "superadmin" or (user.email or "").lower() == "admin@serphawk.com":
        return user, None
    if role in _ADMIN_ROLES:
        return user, user.tenant_id
    raise HTTPException(status_code=403, detail="Only an admin can run this.")


def _rate_limit(kind: str, scope, seconds: int):
    key = (kind, scope)
    with _cooldown_lock:
        wait = _cooldowns.get(key, 0) + seconds - time.monotonic()
        if wait > 0:
            raise HTTPException(status_code=429, detail=f"Already ran recently. Try again in {int(wait) + 1}s.",
                                headers={"Retry-After": str(int(wait) + 1)})
        _cooldowns[key] = time.monotonic()


@router.post("/check-replies-now")
def check_replies_now(admin=Depends(_require_admin)):
    """
    Manually trigger an immediate IMAP inbox scan for replies, instead of
    waiting for the background poller's next cycle. Admin only.
    """
    from modules.email_sender import check_email_replies
    _, tenant_id = admin
    _rate_limit("check", tenant_id, 20)
    updated = check_email_replies(tenant_id=tenant_id)
    return {"status": "ok", "updated": updated}


@router.post("/backfill-reply-content")
def backfill_reply_content_now(days_back: int = Query(60, ge=1, le=180), admin=Depends(_require_admin)):
    """
    One-time catch-up: fills reply_from/reply_subject/reply_body on
    SentEmail rows that were already marked "Replied" by the old
    header-only poller, by re-scanning the inbox over a wider window. Admin only.
    """
    from modules.email_sender import backfill_reply_content
    _, tenant_id = admin
    _rate_limit("backfill", tenant_id, 120)
    filled = backfill_reply_content(days_back=days_back, tenant_id=tenant_id)
    return {"status": "ok", "filled": filled}

from pydantic import BaseModel
from typing import Optional

class EmailReplyPayload(BaseModel):
    email: Optional[str] = None
    email_id: Optional[int] = None
    reply_subject: Optional[str] = None
    reply_body: Optional[str] = None

@router.post("/track-email-reply")
def track_email_reply(payload: EmailReplyPayload, session: Session = Depends(get_session)):
    """
    Webhook receiver for email replies (from cron or n8n).
    Expected payload: {"email": "user@example.com"} or {"email_id": 123}

    Same unauthenticated-webhook / tenant_id=-1 issue as track_email_open
    above — `skip_tenant` is required or these lookups silently find nothing.
    """
    if payload.email_id:
        email_record = session.get(SentEmail, payload.email_id, execution_options={"skip_tenant": True})
        if email_record:
            email_record.status = "Replied"
            email_record.replied_at = datetime.now(timezone.utc)
            if payload.reply_subject:
                email_record.reply_subject = payload.reply_subject[:500]
            if payload.reply_body:
                email_record.reply_body = payload.reply_body
            session.add(email_record)
            session.commit()
            return {"status": "success", "message": f"Email ID {payload.email_id} marked as replied"}

    if payload.email:
        from sqlmodel import select, desc
        stmt = (
            select(SentEmail)
            .where(SentEmail.to_email == payload.email)
            .order_by(desc(SentEmail.sent_at))
            .execution_options(skip_tenant=True)
        )
        email_record = session.exec(stmt).first()
        if email_record:
            email_record.status = "Replied"
            email_record.replied_at = datetime.now(timezone.utc)
            if payload.reply_subject:
                email_record.reply_subject = payload.reply_subject[:500]
            if payload.reply_body:
                email_record.reply_body = payload.reply_body
            session.add(email_record)
            session.commit()
            return {"status": "success", "message": f"Most recent email to {payload.email} marked as replied"}
            
    return {"status": "error", "message": "Email record not found or no valid identifier provided"}