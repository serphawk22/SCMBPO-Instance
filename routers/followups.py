"""
Follow-ups & email reminders
────────────────────────────
* Follow-up creation + scheduling (timezone aware, stored as naive UTC)
* Upcoming / Pending / Overdue / Completed buckets
* Personalised follow-up emails generated from previous discussion history
  (lead / client notes, conversation logs, meetings, calls and earlier emails)
* Automatic reminders: in-app notification + email to the owner shortly before a
  follow-up is due, and again once it becomes overdue

Bucket rules (mutually exclusive, evaluated server-side so every client agrees):
  completed : status == "Completed"
  overdue   : open and due_at is in the past
  pending   : open and (no due date OR due within the next 24 hours)  -> "needs action now"
  upcoming  : open and due more than 24 hours from now

Tenant scoping: ORM SELECTs are auto-filtered by the global listener in main.py and
inserts are auto-stamped by `before_flush`. The reminder worker runs outside a request
(no tenant context) so it sees every tenant and stamps `tenant_id` explicitly.
"""
from __future__ import annotations

import html as _html
import json as _json
import threading
import time
from datetime import datetime, timedelta, timezone as _tz
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import Column, Text, text, update
from sqlmodel import Field, Session, SQLModel, select

from database import (
    engine, User, Lead, LeadNote, ClientProfile, ClientNote, Contact, Meeting,
    ConversationLog, CallLog, SentEmail, Notification,
)
from modules.api_tracker import current_salesperson_id

router = APIRouter(tags=["Follow-ups"])

CHANNELS = ["Email", "Call", "Meeting", "WhatsApp", "Other"]
PRIORITIES = ["Low", "Medium", "High", "Urgent"]
PENDING_WINDOW_HOURS = 24
DEFAULT_REMINDER_MINUTES = 60
ALL_ROLES = {"admin", "salesmanager", "superadmin"}


# ─────────────────────────────────────────────────────────────────────────────
# Model
# ─────────────────────────────────────────────────────────────────────────────

class FollowUp(SQLModel, table=True):
    __tablename__ = "follow_ups"
    __table_args__ = {"extend_existing": True}
    tenant_id: Optional[int] = Field(default=None, foreign_key="tenants.id", index=True)
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str = Field(max_length=500)
    notes: Optional[str] = Field(default=None, sa_column=Column(Text))
    channel: str = Field(default="Email", max_length=30)
    priority: str = Field(default="Medium", max_length=20)
    status: str = Field(default="Pending", max_length=20, index=True)  # Pending | Completed
    due_at: Optional[datetime] = Field(default=None, index=True)       # naive UTC
    timezone: Optional[str] = Field(default=None, max_length=64)       # tz the creator scheduled it in
    reminder_minutes: int = Field(default=DEFAULT_REMINDER_MINUTES)    # remind this long before due_at; 0 = no reminder
    reminder_sent_at: Optional[datetime] = Field(default=None)
    overdue_notified_at: Optional[datetime] = Field(default=None)
    completed_at: Optional[datetime] = Field(default=None)
    completion_note: Optional[str] = Field(default=None, sa_column=Column(Text))
    lead_id: Optional[int] = Field(default=None, index=True)
    client_id: Optional[int] = Field(default=None, index=True)
    contact_id: Optional[int] = Field(default=None, index=True)
    owner_id: Optional[int] = Field(default=None, index=True)
    created_by: Optional[int] = Field(default=None)
    last_email_at: Optional[datetime] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


def ensure_followup_schema() -> None:
    SQLModel.metadata.create_all(engine, tables=[FollowUp.__table__])
    stmts = [
        "ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER DEFAULT 60;",
        "ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMP;",
        "ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS last_email_at TIMESTAMP;",
    ]
    try:
        with engine.connect() as conn:
            for s in stmts:
                try:
                    conn.execute(text(s))
                except Exception as e:  # pragma: no cover
                    print(f"[followups] migration skipped: {s} -> {e}")
            conn.commit()
    except Exception as e:  # pragma: no cover
        print(f"[followups] schema bootstrap warning: {e}")
    print("[followups] schema verified")


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_session():
    with Session(engine) as session:
        yield session


def _tid() -> Optional[int]:
    try:
        import main  # noqa: WPS433  (lazy import avoids a cycle)
        t = main.current_tenant_id.get()
        return t if (t and t > 0) else None
    except Exception:
        return None


def _me(session: Session) -> Optional[User]:
    uid = current_salesperson_id.get()
    return session.get(User, uid) if uid else None


def _require_me(session: Session) -> User:
    me = _me(session)
    if not me:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return me


def _sees_all(user: Optional[User]) -> bool:
    if not user:
        return False
    role = (user.role or "").strip().lower()
    return role in ALL_ROLES or (user.email or "").lower() == "admin@serphawk.com"


def _validate_tz(name: Optional[str]) -> Optional[str]:
    if not name or not name.strip():
        return None
    val = name.strip()
    try:
        from zoneinfo import ZoneInfo
        ZoneInfo(val)
        return val
    except Exception:
        # Fallback: if zoneinfo data is missing in environment, accept IANA names
        if "/" in val or val.upper() in ("UTC", "GMT", "IST"):
            return val
        return "UTC"


def _to_utc(value: Optional[str], tz_name: Optional[str]) -> Optional[datetime]:
    """Parse a datetime string -> naive UTC. Naive input is read in `tz_name`."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid date/time")
    if dt.tzinfo is None and tz_name:
        try:
            from zoneinfo import ZoneInfo
            dt = dt.replace(tzinfo=ZoneInfo(tz_name))
        except Exception:
            low = tz_name.lower()
            if "kolkata" in low or "calcutta" in low or "ist" in low:
                dt = dt.replace(tzinfo=_tz(timedelta(hours=5, minutes=30)))
            elif "dubai" in low:
                dt = dt.replace(tzinfo=_tz(timedelta(hours=4)))
            elif "singapore" in low or "shanghai" in low or "tokyo" in low:
                dt = dt.replace(tzinfo=_tz(timedelta(hours=8)))
            else:
                dt = dt.replace(tzinfo=_tz.utc)
    if dt.tzinfo is not None:
        dt = dt.astimezone(_tz.utc).replace(tzinfo=None)
    return dt


def _to_naive_dt(dt: Any) -> Optional[datetime]:
    if dt is None or not isinstance(dt, datetime):
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(_tz.utc).replace(tzinfo=None)
    return dt


def _local_label(dt: Optional[datetime], tz_name: Optional[str]) -> Optional[str]:
    dt = _to_naive_dt(dt)
    if not dt:
        return None
    try:
        from zoneinfo import ZoneInfo
        local = dt.replace(tzinfo=_tz.utc).astimezone(ZoneInfo(tz_name)) if tz_name else dt
        return local.strftime("%b %d, %Y %I:%M %p") + (f" ({tz_name})" if tz_name else " UTC")
    except Exception:
        low = (tz_name or "").lower()
        if "kolkata" in low or "calcutta" in low or "ist" in low:
            local = dt + timedelta(hours=5, minutes=30)
            return local.strftime("%b %d, %Y %I:%M %p") + f" ({tz_name})"
        return dt.strftime("%b %d, %Y %I:%M %p") + " UTC"


def _iso_z(dt: Optional[datetime]) -> Optional[str]:
    dt = _to_naive_dt(dt)
    return (dt.isoformat() + "Z") if dt else None


def _bucket(f: FollowUp, now: datetime) -> str:
    if f.status == "Completed":
        return "completed"
    due_at = _to_naive_dt(f.due_at)
    if due_at is None:
        return "pending"
    if due_at < now:
        return "overdue"
    if due_at <= now + timedelta(hours=PENDING_WINDOW_HOURS):
        return "pending"
    return "upcoming"


def _contact_name(c: Contact) -> str:
    return (c.full_name or f"{c.first_name or ''} {c.last_name or ''}").strip() or f"Contact #{c.id}"


def _name_maps(session: Session, rows: List[FollowUp]) -> Dict[str, Dict[int, Any]]:
    """Batch-load related names (avoids N+1)."""
    lead_ids = {r.lead_id for r in rows if r.lead_id}
    client_ids = {r.client_id for r in rows if r.client_id}
    contact_ids = {r.contact_id for r in rows if r.contact_id}
    user_ids = {r.owner_id for r in rows if r.owner_id}
    leads = {l.id: l for l in session.exec(select(Lead).where(Lead.id.in_(lead_ids))).all()} if lead_ids else {}
    clients = {c.id: c for c in session.exec(select(ClientProfile).where(ClientProfile.id.in_(client_ids))).all()} if client_ids else {}
    contacts = {c.id: c for c in session.exec(select(Contact).where(Contact.id.in_(contact_ids))).all()} if contact_ids else {}
    users = {u.id: u for u in session.exec(select(User).where(User.id.in_(user_ids))).all()} if user_ids else {}
    return {"leads": leads, "clients": clients, "contacts": contacts, "users": users}


def _fu_dict(f: FollowUp, maps: Dict[str, Dict[int, Any]], now: datetime) -> dict:
    lead = maps["leads"].get(f.lead_id) if f.lead_id else None
    client = maps["clients"].get(f.client_id) if f.client_id else None
    contact = maps["contacts"].get(f.contact_id) if f.contact_id else None
    owner = maps["users"].get(f.owner_id) if f.owner_id else None
    entity_type = "client" if client else "lead" if lead else "contact" if contact else None
    entity_name = (client.companyName if client else lead.company_name if lead else _contact_name(contact) if contact else None)
    local_str = None
    due_at = _to_naive_dt(f.due_at)
    if due_at and f.timezone:
        try:
            from zoneinfo import ZoneInfo
            local_str = due_at.replace(tzinfo=_tz.utc).astimezone(ZoneInfo(f.timezone)).strftime("%Y-%m-%dT%H:%M")
        except Exception:
            low = f.timezone.lower()
            if "kolkata" in low or "calcutta" in low or "ist" in low:
                local_str = (due_at + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%dT%H:%M")
            else:
                local_str = due_at.strftime("%Y-%m-%dT%H:%M")
    return {
        "id": f.id, "title": f.title, "notes": f.notes, "channel": f.channel,
        "priority": f.priority, "status": f.status, "bucket": _bucket(f, now),
        "due_at": _iso_z(f.due_at), "due_at_local": local_str, "timezone": f.timezone,
        "reminder_minutes": f.reminder_minutes, "reminder_sent": bool(f.reminder_sent_at),
        "completed_at": _iso_z(f.completed_at), "completion_note": f.completion_note,
        "minutes_until_due": int((due_at - now).total_seconds() // 60) if due_at else None,
        "lead_id": f.lead_id, "client_id": f.client_id, "contact_id": f.contact_id,
        "entity_type": entity_type, "entity_name": entity_name,
        "owner_id": f.owner_id, "owner_name": owner.name if owner else None,
        "last_email_at": _iso_z(f.last_email_at),
        "created_at": _iso_z(f.created_at), "updated_at": _iso_z(f.updated_at),
    }


def _notify(session: Session, user_id: Optional[int], tenant_id: Optional[int], title: str, message: str,
            kind: str = "info", link: str = "/follow-ups") -> None:
    if not user_id:
        return
    session.add(Notification(user_id=user_id, tenant_id=tenant_id, title=title[:255], message=message,
                             type=kind, link=link))


def _email_html(heading: str, rows: List[tuple], footer: str = "") -> str:
    esc = _html.escape
    body_rows = "".join(
        f'<tr><td style="padding:8px 14px;border-bottom:1px solid #eef2f7;color:#64748b;font-size:13px;font-weight:600;width:110px;vertical-align:top">{esc(k)}</td>'
        f'<td style="padding:8px 14px;border-bottom:1px solid #eef2f7;color:#0f172a;font-size:14px;font-weight:600">{esc(str(v))}</td></tr>'
        for k, v in rows if v
    )
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:linear-gradient(135deg,#1e3a8a,#2563eb);padding:22px 26px">
<p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#93c5fd">SerpHawk CRM</p>
<p style="margin:6px 0 0;font-size:20px;font-weight:800;color:#fff">{esc(heading)}</p></td></tr>
<tr><td style="padding:20px 26px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">{body_rows}</table>
<p style="margin:16px 0 0;color:#64748b;font-size:12px">{esc(footer)}</p></td></tr>
</table></td></tr></table></body></html>"""


def _send_email_async(to_email: str, subject: str, html_body: str) -> None:
    try:
        import main  # noqa: WPS433
        main._send_notification_email(to_email, subject, html_body)
    except Exception as e:  # never block the request / worker
        print(f"[followups] email send failed: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────────────

class FollowUpBody(BaseModel):
    title: str
    notes: Optional[str] = None
    channel: Optional[str] = "Email"
    priority: Optional[str] = "Medium"
    due_at: Optional[str] = None          # wall-clock in `timezone` (or ISO with offset/Z)
    timezone: Optional[str] = None
    reminder_minutes: Optional[int] = DEFAULT_REMINDER_MINUTES
    lead_id: Optional[int] = None
    client_id: Optional[int] = None
    contact_id: Optional[int] = None
    owner_id: Optional[int] = None
    send_notification: Optional[bool] = False
    notify_email: Optional[str] = None


class FollowUpUpdate(BaseModel):
    title: Optional[str] = None
    notes: Optional[str] = None
    channel: Optional[str] = None
    priority: Optional[str] = None
    due_at: Optional[str] = None
    timezone: Optional[str] = None
    reminder_minutes: Optional[int] = None
    lead_id: Optional[int] = None
    client_id: Optional[int] = None
    contact_id: Optional[int] = None
    owner_id: Optional[int] = None


class RescheduleBody(BaseModel):
    due_at: str
    timezone: Optional[str] = None


class CompleteBody(BaseModel):
    note: Optional[str] = None


class EmailDraftBody(BaseModel):
    follow_up_id: Optional[int] = None
    lead_id: Optional[int] = None
    client_id: Optional[int] = None
    contact_id: Optional[int] = None
    goal: Optional[str] = None            # e.g. "book a demo", "chase proposal"
    tone: Optional[str] = "friendly and professional"


class SendEmailBody(BaseModel):
    follow_up_id: Optional[int] = None
    lead_id: Optional[int] = None
    client_id: Optional[int] = None
    contact_id: Optional[int] = None
    to_email: str
    subject: str
    body: str
    mark_complete: Optional[bool] = False


# ─────────────────────────────────────────────────────────────────────────────
# CRUD / listing
# ─────────────────────────────────────────────────────────────────────────────

def _clean_choice(value: Optional[str], allowed: List[str], default: str) -> str:
    if not value:
        return default
    for a in allowed:
        if a.lower() == value.strip().lower():
            return a
    return default


@router.get("/follow-ups/summary")
def followup_summary(scope: Optional[str] = None, session: Session = Depends(get_session)):
    me = _require_me(session)
    now = datetime.utcnow()
    rows = _scoped_rows(session, me, scope)
    counts = {"upcoming": 0, "pending": 0, "overdue": 0, "completed": 0}
    next_due: Optional[FollowUp] = None
    for r in rows:
        b = _bucket(r, now)
        counts[b] += 1
        r_due = _to_naive_dt(r.due_at)
        next_due_dt = _to_naive_dt(next_due.due_at) if next_due else None
        if b in ("pending", "upcoming") and r_due and (next_due is None or r_due < next_due_dt):
            next_due = r
    return {
        "counts": counts, "total": len(rows), "open": counts["upcoming"] + counts["pending"] + counts["overdue"],
        "next_due": {"id": next_due.id, "title": next_due.title, "due_at": _iso_z(next_due.due_at)} if next_due else None,
        "server_time": _iso_z(now),
    }


def _scoped_rows(session: Session, me: User, scope: Optional[str]) -> List[FollowUp]:
    q = select(FollowUp)
    mine_only = (scope == "mine") or (scope != "all" and not _sees_all(me))
    if mine_only:
        q = q.where((FollowUp.owner_id == me.id) | (FollowUp.created_by == me.id))
    return list(session.exec(q).all())


@router.get("/follow-ups")
def list_followups(
    bucket: Optional[str] = None,          # upcoming | pending | overdue | completed
    scope: Optional[str] = None,           # mine | all
    lead_id: Optional[int] = None,
    client_id: Optional[int] = None,
    contact_id: Optional[int] = None,
    q: Optional[str] = None,
    session: Session = Depends(get_session),
):
    me = _require_me(session)
    now = datetime.utcnow()
    rows = _scoped_rows(session, me, scope)
    if lead_id:
        rows = [r for r in rows if r.lead_id == lead_id]
    if client_id:
        rows = [r for r in rows if r.client_id == client_id]
    if contact_id:
        rows = [r for r in rows if r.contact_id == contact_id]

    counts = {"upcoming": 0, "pending": 0, "overdue": 0, "completed": 0}
    for r in rows:
        counts[_bucket(r, now)] += 1

    if bucket:
        rows = [r for r in rows if _bucket(r, now) == bucket]
    maps = _name_maps(session, rows)
    items = [_fu_dict(r, maps, now) for r in rows]
    if q:
        needle = q.strip().lower()
        items = [i for i in items if needle in (i["title"] or "").lower()
                 or needle in (i["entity_name"] or "").lower() or needle in (i["notes"] or "").lower()]

    # overdue: most overdue first; completed: latest first; others: soonest first
    far = datetime.max.replace(tzinfo=None).isoformat()
    if bucket == "completed":
        items.sort(key=lambda i: i["completed_at"] or "", reverse=True)
    else:
        items.sort(key=lambda i: (i["due_at"] or far))
    return {"follow_ups": items, "counts": counts, "server_time": _iso_z(now)}


@router.post("/follow-ups")
def create_followup(body: FollowUpBody, session: Session = Depends(get_session)):
    me = _require_me(session)
    if not body.title or not body.title.strip():
        raise HTTPException(status_code=400, detail="Title is required")
    tz_name = _validate_tz(body.timezone) or getattr(me, "timezone", None)
    due = _to_utc(body.due_at, tz_name)
    reminder = max(0, int(body.reminder_minutes if body.reminder_minutes is not None else DEFAULT_REMINDER_MINUTES))
    f = FollowUp(
        tenant_id=_tid(), title=body.title.strip(), notes=body.notes,
        channel=_clean_choice(body.channel, CHANNELS, "Email"),
        priority=_clean_choice(body.priority, PRIORITIES, "Medium"),
        due_at=due, timezone=tz_name, reminder_minutes=reminder,
        lead_id=body.lead_id, client_id=body.client_id, contact_id=body.contact_id,
        owner_id=body.owner_id or me.id, created_by=me.id,
    )
    session.add(f)
    session.commit()
    session.refresh(f)
    if f.owner_id and f.owner_id != me.id:
        _notify(session, f.owner_id, f.tenant_id, "New follow-up assigned",
                f"{me.name or 'A teammate'} assigned you: {f.title}"
                + (f" (due {_local_label(f.due_at, f.timezone)})" if f.due_at else ""))
        session.commit()

    if body.send_notification:
        target_email = (body.notify_email or "").strip()
        if not target_email:
            if body.client_id:
                cl = session.get(ClientProfile, body.client_id)
                target_email = getattr(cl, "email", None) or getattr(cl, "companyEmail", None)
            elif body.lead_id:
                ld = session.get(Lead, body.lead_id)
                target_email = getattr(ld, "email", None)

        recipients = [target_email] if target_email and "@" in target_email else []
        owner_obj = session.get(User, f.owner_id) if f.owner_id else None
        if owner_obj and owner_obj.email and owner_obj.email not in recipients:
            recipients.append(owner_obj.email)

        label = _local_label(f.due_at, f.timezone) if f.due_at else "No date specified"
        for r_email in recipients:
            rows = [
                ("Follow-up Title", f.title),
                ("Scheduled Date & Time", label),
                ("Channel", f.channel),
                ("Reason / Notes", f.notes or "Scheduled follow-up"),
                ("Reminder Setup", f"Automatic reminder email {f.reminder_minutes} min before scheduled time" if f.reminder_minutes else "None"),
            ]
            _send_email_async(
                r_email,
                f"Follow-up Scheduled: {f.title}",
                _email_html("📅 Follow-up Scheduled", rows, f"An automatic reminder email will be delivered {f.reminder_minutes // 60 if f.reminder_minutes >= 60 else f.reminder_minutes} hour before this scheduled follow-up.")
            )

    now = datetime.utcnow()
    return {"follow_up": _fu_dict(f, _name_maps(session, [f]), now)}


def _get_or_404(session: Session, follow_up_id: int) -> FollowUp:
    f = session.get(FollowUp, follow_up_id)
    if not f:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    return f


@router.put("/follow-ups/{follow_up_id}")
def update_followup(follow_up_id: int, body: FollowUpUpdate, session: Session = Depends(get_session)):
    _require_me(session)
    f = _get_or_404(session, follow_up_id)
    data = body.model_dump(exclude_unset=True)
    if "title" in data and not (data["title"] or "").strip():
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    tz_name = _validate_tz(data.get("timezone")) if "timezone" in data else f.timezone
    if "channel" in data:
        data["channel"] = _clean_choice(data["channel"], CHANNELS, f.channel)
    if "priority" in data:
        data["priority"] = _clean_choice(data["priority"], PRIORITIES, f.priority)
    if "reminder_minutes" in data and data["reminder_minutes"] is not None:
        data["reminder_minutes"] = max(0, int(data["reminder_minutes"]))
    if "due_at" in data:
        f.due_at = _to_utc(data.pop("due_at"), tz_name)
        # a new due date re-arms both reminders
        f.reminder_sent_at = None
        f.overdue_notified_at = None
    data.pop("timezone", None)
    f.timezone = tz_name
    for k, v in data.items():
        setattr(f, k, v)
    f.updated_at = datetime.utcnow()
    session.add(f)
    session.commit()
    session.refresh(f)
    return {"follow_up": _fu_dict(f, _name_maps(session, [f]), datetime.utcnow())}


@router.post("/follow-ups/{follow_up_id}/reschedule")
def reschedule_followup(follow_up_id: int, body: RescheduleBody, session: Session = Depends(get_session)):
    _require_me(session)
    f = _get_or_404(session, follow_up_id)
    tz_name = _validate_tz(body.timezone) or f.timezone
    f.due_at = _to_utc(body.due_at, tz_name)
    f.timezone = tz_name
    f.status = "Pending"
    f.completed_at = None
    f.reminder_sent_at = None
    f.overdue_notified_at = None
    f.updated_at = datetime.utcnow()
    session.add(f)
    session.commit()
    session.refresh(f)
    return {"follow_up": _fu_dict(f, _name_maps(session, [f]), datetime.utcnow())}


@router.post("/follow-ups/{follow_up_id}/complete")
def complete_followup(follow_up_id: int, body: Optional[CompleteBody] = None, session: Session = Depends(get_session)):
    _require_me(session)
    f = _get_or_404(session, follow_up_id)
    f.status = "Completed"
    f.completed_at = datetime.utcnow()
    if body and body.note:
        f.completion_note = body.note
    f.updated_at = datetime.utcnow()
    session.add(f)
    session.commit()
    session.refresh(f)
    return {"follow_up": _fu_dict(f, _name_maps(session, [f]), datetime.utcnow())}


@router.post("/follow-ups/{follow_up_id}/reopen")
def reopen_followup(follow_up_id: int, session: Session = Depends(get_session)):
    _require_me(session)
    f = _get_or_404(session, follow_up_id)
    f.status = "Pending"
    f.completed_at = None
    f.updated_at = datetime.utcnow()
    session.add(f)
    session.commit()
    session.refresh(f)
    return {"follow_up": _fu_dict(f, _name_maps(session, [f]), datetime.utcnow())}


@router.delete("/follow-ups/{follow_up_id}")
def delete_followup(follow_up_id: int, session: Session = Depends(get_session)):
    _require_me(session)
    f = _get_or_404(session, follow_up_id)
    session.delete(f)
    session.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Personalised follow-up email (uses previous discussion details)
# ─────────────────────────────────────────────────────────────────────────────

def _trim(s: Optional[str], n: int = 400) -> str:
    s = (s or "").strip().replace("\r", "")
    return s if len(s) <= n else s[: n - 1] + "…"


def _gather_context(session: Session, lead_id: Optional[int], client_id: Optional[int],
                    contact_id: Optional[int]) -> Dict[str, Any]:
    """Collect everything we know about prior discussions with this prospect."""
    ctx: Dict[str, Any] = {
        "company": None, "recipient_name": None, "to_email": None, "industry": None,
        "status": None, "history": [], "counts": {},
    }
    contact = session.get(Contact, contact_id) if contact_id else None
    lead = session.get(Lead, lead_id) if lead_id else None
    client = session.get(ClientProfile, client_id) if client_id else None
    if contact:
        lead = lead or (session.get(Lead, contact.lead_id) if contact.lead_id else None)
        client = client or (session.get(ClientProfile, contact.client_id) if contact.client_id else None)
        ctx["recipient_name"] = _contact_name(contact)
        ctx["to_email"] = contact.email
    if lead:
        ctx["company"] = lead.company_name
        ctx["industry"] = lead.industry
        ctx["status"] = lead.status
        ctx["to_email"] = ctx["to_email"] or lead.email
        if lead.notes:
            ctx["history"].append(("Lead notes", _trim(lead.notes, 500), None))
    if client:
        ctx["company"] = ctx["company"] or client.companyName
        try:
            ctx["to_email"] = ctx["to_email"] or (client.user.email if client.user else None)
            ctx["recipient_name"] = ctx["recipient_name"] or (client.user.name if client.user else None)
        except Exception:
            pass

    lead_id = lead.id if lead else lead_id
    client_id = client.id if client else client_id
    events: List[tuple] = []  # (datetime, label, text)

    if lead_id:
        for n in session.exec(select(LeadNote).where(LeadNote.lead_id == lead_id).order_by(LeadNote.created_at.desc()).limit(8)).all():
            events.append((n.created_at, "Note", _trim(n.content)))
    if client_id:
        for n in session.exec(select(ClientNote).where(ClientNote.client_id == client_id).order_by(ClientNote.created_at.desc()).limit(8)).all():
            events.append((n.created_at, "Note", _trim(n.content)))

    conv_q = []
    if lead_id:
        conv_q.append(ConversationLog.lead_id == lead_id)
    if client_id:
        conv_q.append(ConversationLog.client_id == client_id)
    if conv_q:
        from sqlalchemy import or_
        for c in session.exec(select(ConversationLog).where(or_(*conv_q)).order_by(ConversationLog.created_at.desc()).limit(8)).all():
            events.append((c.created_at, f"{(c.type or 'conversation').title()}", _trim(f"{c.title}: {c.description or ''}")))

    meet_q = []
    if lead_id:
        meet_q.append(Meeting.lead_id == lead_id)
    if client_id:
        meet_q.append(Meeting.client_id == client_id)
    if contact_id:
        meet_q.append(Meeting.contact_id == contact_id)
    if meet_q:
        from sqlalchemy import or_
        for m in session.exec(select(Meeting).where(or_(*meet_q)).order_by(Meeting.scheduled_at.desc()).limit(6)).all():
            bits = [m.title or "Meeting", f"status {m.status}"]
            if m.outcome:
                bits.append(f"outcome: {_trim(m.outcome, 250)}")
            elif m.notes:
                bits.append(f"notes: {_trim(m.notes, 250)}")
            events.append((m.scheduled_at or m.created_at, "Meeting", "; ".join(bits)))

    if client_id:
        for c in session.exec(select(CallLog).where(CallLog.client_id == client_id).order_by(CallLog.createdAt.desc()).limit(5)).all():
            t = c.summary or c.description or c.work_done
            if t:
                events.append((c.createdAt, "Call", _trim(t, 300)))

    mail_q = []
    if lead_id:
        mail_q.append(SentEmail.lead_id == lead_id)
    if client_id:
        mail_q.append(SentEmail.client_id == client_id)
    if mail_q:
        from sqlalchemy import or_
        for e in session.exec(select(SentEmail).where(or_(*mail_q)).order_by(SentEmail.sent_at.desc()).limit(4)).all():
            events.append((e.sent_at, "Email sent", _trim(f"{e.subject} — {e.english_body or ''}", 300)))

    events.sort(key=lambda x: x[0] or datetime.min, reverse=True)
    ctx["events"] = events[:14]
    ctx["counts"] = {}
    for _, label, _ in events:
        ctx["counts"][label] = ctx["counts"].get(label, 0) + 1
    ctx["lead_id"], ctx["client_id"] = lead_id, client_id
    return ctx


def _fallback_email(ctx: Dict[str, Any], sender: str, goal: Optional[str], follow_title: Optional[str]) -> Dict[str, str]:
    name = (ctx.get("recipient_name") or "there").split(" ")[0] if ctx.get("recipient_name") else "there"
    company = ctx.get("company") or "your team"
    subject = f"Following up — {follow_title or company}"
    recap = ""
    if ctx.get("events"):
        d, label, t = ctx["events"][0]
        recap = f"\n\nWhen we last spoke ({label.lower()}), we discussed: {t}\n"
    ask = goal or "Would you have 15 minutes this week to continue the conversation?"
    body = (f"Hi {name},\n\nI wanted to follow up regarding {company}.{recap}\n{ask}\n\n"
            f"Looking forward to hearing from you.\n\nBest regards,\n{sender}")
    return {"subject": subject, "body": body}


@router.post("/follow-ups/email-draft")
def generate_followup_email(body: EmailDraftBody, session: Session = Depends(get_session)):
    me = _require_me(session)
    lead_id, client_id, contact_id = body.lead_id, body.client_id, body.contact_id
    f: Optional[FollowUp] = None
    if body.follow_up_id:
        f = _get_or_404(session, body.follow_up_id)
        lead_id, client_id, contact_id = lead_id or f.lead_id, client_id or f.client_id, contact_id or f.contact_id
    if not (lead_id or client_id or contact_id):
        raise HTTPException(status_code=400, detail="Link the follow-up to a lead, client or contact first so previous discussions can be used.")

    ctx = _gather_context(session, lead_id, client_id, contact_id)
    sender = me.name or "The team"
    history = "\n".join(f"- [{(d.strftime('%b %d, %Y') if d else 'undated')}] {label}: {t}" for d, label, t in ctx["events"]) or "- (no previous discussion recorded)"
    goal = body.goal or (f.title if f else None) or "continue the conversation and agree next steps"

    ai_used = False
    result: Dict[str, str]
    try:
        from modules.llm_engine import get_openai_client
        client = get_openai_client()
        prompt = f"""You are {sender}, a sales professional writing a personalised follow-up email.

Recipient: {ctx.get('recipient_name') or 'unknown name'}  |  Company: {ctx.get('company') or 'unknown'}  |  Industry: {ctx.get('industry') or 'n/a'}
Relationship status: {ctx.get('status') or 'n/a'}
Follow-up purpose: {goal}
Follow-up internal notes: {(f.notes if f else None) or 'n/a'}
Tone: {body.tone or 'friendly and professional'}

Previous discussion history (newest first):
{history}

Rules:
- Reference specific details from the history so it is obvious we remember the conversation; never invent facts that are not listed.
- If there is no history, write a short, warm check-in instead.
- 90-150 words, plain text, no placeholders like [Name], greet by first name when known.
- End with ONE clear call to action and sign off as {sender}.

Return ONLY JSON: {{"subject": "...", "body": "..."}}"""
        resp = client.chat.completions.create(
            model="gpt-4o-mini", temperature=0.6, max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )
        content = resp.choices[0].message.content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        parsed = _json.loads(content)
        if not parsed.get("subject") or not parsed.get("body"):
            raise ValueError("incomplete AI response")
        result = {"subject": str(parsed["subject"]).strip(), "body": str(parsed["body"]).strip()}
        ai_used = True
    except Exception as e:
        print(f"[followups] AI draft fallback: {e}")
        result = _fallback_email(ctx, sender, body.goal, f.title if f else None)

    return {
        **result, "ai": ai_used,
        "to_email": ctx.get("to_email"), "to_name": ctx.get("recipient_name"), "company": ctx.get("company"),
        "context_used": ctx["counts"], "context_total": sum(ctx["counts"].values()),
    }


@router.post("/follow-ups/send-email")
def send_followup_email(body: SendEmailBody, session: Session = Depends(get_session)):
    me = _require_me(session)
    to_email = (body.to_email or "").strip()
    if "@" not in to_email:
        raise HTTPException(status_code=400, detail="A valid recipient email is required")
    if not body.subject.strip() or not body.body.strip():
        raise HTTPException(status_code=400, detail="Subject and message are required")

    f: Optional[FollowUp] = _get_or_404(session, body.follow_up_id) if body.follow_up_id else None
    lead_id = body.lead_id or (f.lead_id if f else None)
    client_id = body.client_id or (f.client_id if f else None)

    html_body = ("<div style=\"font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a\">"
                 + _html.escape(body.body).replace("\n", "<br>") + "</div>")
    _send_email_async(to_email, body.subject.strip(), html_body)

    session.add(SentEmail(tenant_id=_tid(), client_id=client_id, lead_id=lead_id, to_email=to_email,
                          subject=body.subject.strip()[:500], english_body=body.body, manual=True, status="Sent"))
    # log it as a conversation so later AI drafts can reference what we already said
    if lead_id or client_id:
        session.add(ConversationLog(tenant_id=_tid(), lead_id=lead_id, client_id=client_id,
                                    title=body.subject.strip()[:500], type="email", description=_trim(body.body, 1500),
                                    author_id=me.id, author_name=me.name))
    if f:
        f.last_email_at = datetime.utcnow()
        if body.mark_complete:
            f.status = "Completed"
            f.completed_at = datetime.utcnow()
        f.updated_at = datetime.utcnow()
        session.add(f)
    session.commit()
    return {"ok": True, "follow_up": _fu_dict(f, _name_maps(session, [f]), datetime.utcnow()) if f else None}


# ─────────────────────────────────────────────────────────────────────────────
# Automatic reminders (background worker)
# ─────────────────────────────────────────────────────────────────────────────

def _claim(session: Session, follow_up_id: int, column: str, now: datetime) -> bool:
    """Atomically stamp a reminder column; returns False if another worker won the race."""
    col = getattr(FollowUp, column)
    res = session.execute(
        update(FollowUp).where(FollowUp.id == follow_up_id, col.is_(None)).values({column: now})
    )
    session.commit()
    return bool(res.rowcount)


def process_due_reminders() -> int:
    """Send due-soon and overdue reminders. Safe to call repeatedly. Returns #reminders sent."""
    sent = 0
    now = datetime.utcnow()
    with Session(engine) as session:
        open_rows = session.exec(
            select(FollowUp).where(FollowUp.status == "Pending", FollowUp.due_at.is_not(None))
        ).all()
        for f in open_rows:
            try:
                due_at = _to_naive_dt(f.due_at)
                if not due_at:
                    continue
                owner = session.get(User, f.owner_id) if f.owner_id else None
                entity = ""
                if f.client_id:
                    c = session.get(ClientProfile, f.client_id)
                    entity = c.companyName if c else ""
                elif f.lead_id:
                    l = session.get(Lead, f.lead_id)
                    entity = l.company_name if l else ""
                label = _local_label(due_at, (owner.timezone if owner and getattr(owner, "timezone", None) else f.timezone))
                rows = [("Follow-up", f.title), ("Due", label), ("With", entity), ("Channel", f.channel),
                        ("Priority", f.priority), ("Notes", (f.notes or "")[:300])]

                # 1) overdue notice
                if due_at < now and not f.overdue_notified_at:
                    if _claim(session, f.id, "overdue_notified_at", now):
                        _notify(session, f.owner_id, f.tenant_id, f"⚠️ Overdue follow-up: {f.title}",
                                f"Was due {label}" + (f" · {entity}" if entity else ""), "warning")
                        session.commit()
                        if owner and owner.email:
                            _send_email_async(owner.email, f"Overdue follow-up: {f.title}",
                                              _email_html("⚠️ Follow-up overdue", rows, "Open the CRM to complete or reschedule it."))
                        sent += 1
                    continue

                # 2) upcoming reminder
                lead_time = timedelta(minutes=f.reminder_minutes or 0)
                if f.reminder_minutes and not f.reminder_sent_at and due_at - lead_time <= now < due_at:
                    if _claim(session, f.id, "reminder_sent_at", now):
                        mins = max(1, int((due_at - now).total_seconds() // 60))
                        when = f"in {mins} min" if mins < 120 else f"in {mins // 60} h"
                        _notify(session, f.owner_id, f.tenant_id, f"⏰ Follow-up due {when}: {f.title}",
                                f"{label}" + (f" · {entity}" if entity else ""), "info")
                        session.commit()
                        if owner and owner.email:
                            _send_email_async(owner.email, f"Reminder: follow-up due {when} — {f.title}",
                                              _email_html(f"⏰ Follow-up due {when}", rows, "You asked to be reminded before this follow-up."))
                        sent += 1
            except Exception as e:
                session.rollback()
                print(f"[followups] reminder error for #{f.id}: {e}")
    return sent


_worker_started = False


def start_reminder_worker(interval_seconds: int = 60) -> None:
    """Start the single background reminder loop (idempotent)."""
    global _worker_started
    if _worker_started:
        return
    _worker_started = True

    def _loop():
        time.sleep(15)  # let the app finish booting
        while True:
            try:
                n = process_due_reminders()
                if n:
                    print(f"[followups] sent {n} reminder(s)")
            except Exception as e:
                print(f"[followups] reminder loop error: {e}")
            time.sleep(interval_seconds)

    threading.Thread(target=_loop, daemon=True, name="followup-reminders").start()
    print(f"[followups] reminder worker started (every {interval_seconds}s)")
