"""
Follow-ups API — dated follow-ups on leads, clients or bare contacts, with reminders,
personalized follow-up emails and AI that reads previous notes.

  GET    /followups                      list (view = all|pending|overdue|today|upcoming|completed|cancelled)
  GET    /followups/summary              dashboard counts + the most urgent items
  GET    /followups/history              one record's follow-ups + its full conversation history
  GET    /followups/sender               which company mailbox follow-up emails go out from
  GET    /followups/assignees            users a follow-up can be assigned to
  POST   /followups                      create
  PATCH  /followups/{id}                 edit / reschedule / reassign / reopen / cancel
  DELETE /followups/{id}
  POST   /followups/{id}/complete        mark done with an outcome, optionally schedule the next one
  POST   /followups/{id}/draft-email     AI (or template) follow-up email from previous notes
  POST   /followups/{id}/send-email      send it from the company mailbox and record it
  POST   /followups/suggest              AI proposal for a record's next follow-up (not saved)
  POST   /followups/scan                 run the AI note scanner for one record now

Access mirrors the Inbox (routers/inbox.py): Admin / SuperAdmin / Demo see the whole tenant;
SalesManager / Employee see follow-ups assigned to or created by them and those on leads they
own or clients assigned to them; other roles get 403. Identity is still the X-User-ID header
(AUDIT_REPORT.md §4), so these checks are only as strong as that.

"Overdue" / "due today" are derived from due_at in the viewer's timezone (tz_offset = JS
Date.getTimezoneOffset(), minutes), never stored.

The follow_ups table is shared with /follow-ups (routers/follow_ups.py) and uses its columns:
the JSON keys here map assigned_to -> owner_id, outcome -> completion_note and
remind_at -> due_at - reminder_minutes; channel / priority are stored capitalised and returned
lower case.
"""
import os
from datetime import date, datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlmodel import Session, select

import database
from database import (
    ActivityLog, ClientNote, ClientProfile, ConversationLog, ConversationReply, FollowUp, InboxMessage, Lead, LeadNote,
    Remark, SentEmail, Tenant, User,
)
from modules import company_mailer, email_ai, followup_ai
from modules import followups_core as core
from routers import inbox

router = APIRouter(tags=["followups"])

CHANNELS = Literal["email", "call", "meeting", "whatsapp", "other"]
PRIORITIES = Literal["urgent", "high", "medium", "low"]
INTERNAL_ROLES = {"Admin", "SuperAdmin", "Demo", "SalesManager", "Employee"}


def get_session():
    with Session(database.engine) as session:
        yield session


def get_viewer(request: Request, session: Session = Depends(get_session)) -> inbox.Viewer:
    try:
        return inbox.get_viewer(request, session)
    except HTTPException as e:
        if e.status_code == 403:
            raise HTTPException(status_code=403, detail="Your role does not have access to follow-ups.")
        raise


# ─────────────────────────────────────────────────────────────────────────────
# Scope + time helpers
# ─────────────────────────────────────────────────────────────────────────────
def _scope(stmt, v: inbox.Viewer):
    stmt = stmt.where(FollowUp.tenant_id == v.tenant_id) if v.tenant_id is not None else stmt
    if v.full_access:
        return stmt
    uid = v.user.id
    return stmt.where(or_(
        FollowUp.owner_id == uid, FollowUp.created_by == uid,
        FollowUp.lead_id.in_(select(Lead.id).where(Lead.owner_id == uid)),
        FollowUp.client_id.in_(select(ClientProfile.id).where(ClientProfile.assignedEmployeeId == uid)),
    ))


def _load(session: Session, v: inbox.Viewer, fu_id: int) -> FollowUp:
    fu = session.exec(_scope(select(FollowUp).where(FollowUp.id == fu_id), v)).first()
    if not fu:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    return fu


def _check_record(session: Session, v: inbox.Viewer, lead_id: Optional[int], client_id: Optional[int]) -> dict:
    """The lead/client must exist in the viewer's tenant and be theirs (unless full access)."""
    if not (lead_id or client_id):
        return {}
    info = core.record_info(session, lead_id if not client_id else None, client_id)
    if not info or (v.tenant_id is not None and info.get("tenant_id") != v.tenant_id):
        raise HTTPException(status_code=404, detail="Client not found" if client_id else "Lead not found")
    if not (v.full_access or info.get("owner_id") == v.user.id):
        raise HTTPException(status_code=403, detail="Only an admin or the salesperson assigned to this record can manage its follow-ups.")
    return info


def _day_bounds(tz_offset: Optional[int]):
    """[start, end) of the viewer's local today, in UTC. tz_offset is JS getTimezoneOffset() (UTC - local)."""
    east = -tz_offset if tz_offset is not None else core.default_tz_offset_minutes()
    tz = timezone(timedelta(minutes=east))
    local_now = datetime.now(tz)
    start = datetime(local_now.year, local_now.month, local_now.day, tzinfo=tz).astimezone(timezone.utc)
    return start, start + timedelta(days=1), east


def _state(fu: FollowUp, start: datetime, end: datetime) -> str:
    if fu.status == core.DONE:
        return "completed"
    if fu.status == core.CANCELLED:
        return "cancelled"
    due = core.as_utc(fu.due_at)
    if due is None:  # /follow-ups allows a follow-up without a date
        return "upcoming"
    if due < start:
        return "overdue"
    if due < end:
        return "today"
    return "upcoming"


def _parse_due(value: Optional[str], east_offset: int, field: str = "due_at") -> Optional[datetime]:
    """ISO datetime (with or without offset) or a bare YYYY-MM-DD (-> default hour, viewer's timezone)."""
    if value is None or str(value).strip() == "":
        return None
    raw = str(value).strip()
    try:
        if len(raw) == 10:
            return core.at_local_hour(date.fromisoformat(raw), east_offset)
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid {field}: use YYYY-MM-DD or an ISO date-time.")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone(timedelta(minutes=east_offset)))
    return dt.astimezone(timezone.utc)


def _iso(dt) -> Optional[str]:
    return core.as_utc(dt).isoformat() if dt else None


def _names(session: Session, items: list) -> dict:
    user_ids = {i for f in items for i in (f.owner_id, f.created_by, f.completed_by) if i}
    lead_ids = {f.lead_id for f in items if f.lead_id}
    client_ids = {f.client_id for f in items if f.client_id}
    users = {u.id: (u.name or u.email) for u in session.exec(select(User).where(User.id.in_(user_ids))).all()} if user_ids else {}
    leads = {l.id: l.company_name or f"Lead #{l.id}" for l in session.exec(
        select(Lead).where(Lead.id.in_(lead_ids)).execution_options(skip_tenant=True)).all()} if lead_ids else {}
    clients = {c.id: core.client_label(c) for c in session.exec(
        select(ClientProfile).where(ClientProfile.id.in_(client_ids)).execution_options(skip_tenant=True)).all()} if client_ids else {}
    return {"users": users, "leads": leads, "clients": clients}


def _dict(f: FollowUp, names: dict, start: datetime, end: datetime) -> dict:
    ref = lambda i, table: {"id": i, "name": names[table].get(i, f"#{i}")} if i else None  # noqa: E731
    return {
        "id": f.id, "title": f.title, "notes": f.notes, "channel": (f.channel or "email").lower(),
        "priority": (f.priority or "medium").lower(), "status": f.status, "state": _state(f, start, end),
        "due_at": _iso(f.due_at), "remind_at": _iso(core.remind_time(f)),
        "lead": ref(f.lead_id, "leads"), "client": ref(f.client_id, "clients"),
        "contact_name": f.contact_name, "contact_email": f.contact_email, "company_name": f.company_name,
        "source": f.source, "source_ref": f.source_ref, "ai_reason": f.ai_reason,
        "assigned_to": ref(f.owner_id, "users"), "created_by": ref(f.created_by, "users"),
        "email_subject": f.email_subject, "email_body": f.email_body, "auto_send": bool(f.auto_send),
        "email_sent_at": _iso(f.email_sent_at), "sent_email_id": f.sent_email_id, "last_error": f.last_error,
        "reminder_sent_at": _iso(f.reminder_sent_at), "completed_at": _iso(f.completed_at),
        "completed_by": ref(f.completed_by, "users"), "outcome": f.completion_note,
        "created_at": _iso(f.created_at), "updated_at": _iso(f.updated_at),
    }


def _serialize(session: Session, items: list, tz_offset: Optional[int]) -> list:
    start, end, _ = _day_bounds(tz_offset)
    names = _names(session, items)
    return [_dict(f, names, start, end) for f in items]


def _view_filter(stmt, view: str, start: datetime, end: datetime):
    is_open = FollowUp.status.in_(core.OPEN_STATUSES)
    if view == "pending":
        return stmt.where(is_open)
    if view == "overdue":
        return stmt.where(is_open, FollowUp.due_at < start)
    if view == "today":
        return stmt.where(is_open, FollowUp.due_at >= start, FollowUp.due_at < end)
    if view == "upcoming":
        return stmt.where(is_open, or_(FollowUp.due_at >= end, FollowUp.due_at.is_(None)))
    if view == "completed":
        return stmt.where(FollowUp.status == core.DONE)
    if view == "cancelled":
        return stmt.where(FollowUp.status == core.CANCELLED)
    return stmt


def _check_assignee(session: Session, v: inbox.Viewer, user_id: Optional[int]) -> Optional[int]:
    if not user_id:
        return None
    u = session.get(User, user_id)
    if not u or (v.tenant_id is not None and u.tenant_id != v.tenant_id):
        raise HTTPException(status_code=400, detail="The assignee must be a user in your company.")
    if not v.full_access and user_id != v.user.id:
        raise HTTPException(status_code=403, detail="Only an admin can assign follow-ups to someone else.")
    return user_id


# ─────────────────────────────────────────────────────────────────────────────
# Reading
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/followups")
def list_followups(
    view: Literal["all", "pending", "overdue", "today", "upcoming", "completed", "cancelled"] = "pending",
    lead_id: Optional[int] = None, client_id: Optional[int] = None, mine: bool = False,
    q: Optional[str] = Query(None, max_length=200), tz_offset: Optional[int] = None,
    limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
    v: inbox.Viewer = Depends(get_viewer), session: Session = Depends(get_session),
):
    start, end, _ = _day_bounds(tz_offset)
    stmt = _view_filter(_scope(select(FollowUp), v), view, start, end)
    if lead_id:
        stmt = stmt.where(FollowUp.lead_id == lead_id)
    if client_id:
        stmt = stmt.where(FollowUp.client_id == client_id)
    if mine:
        stmt = stmt.where(FollowUp.owner_id == v.user.id)
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(*[func.lower(func.coalesce(col, "")).like(like) for col in (
            FollowUp.title, FollowUp.notes, FollowUp.contact_name, FollowUp.contact_email, FollowUp.company_name)]))
    total = session.exec(select(func.count()).select_from(stmt.subquery())).one()
    if view in ("completed", "cancelled"):
        order = (FollowUp.completed_at.desc(), FollowUp.updated_at.desc())
    elif view == "all":
        order = (FollowUp.status.desc(), FollowUp.due_at)  # Pending first, then by date
    else:
        order = (FollowUp.due_at,)
    items = session.exec(stmt.order_by(*order, FollowUp.id).offset(offset).limit(limit)).all()
    return {"items": _serialize(session, items, tz_offset), "total": total}


@router.get("/followups/summary")
def followups_summary(tz_offset: Optional[int] = None, mine: bool = False,
                      v: inbox.Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    start, end, _ = _day_bounds(tz_offset)
    base = _scope(select(FollowUp), v)
    if mine:
        base = base.where(FollowUp.owner_id == v.user.id)

    def count(view, extra=None):
        stmt = _view_filter(base, view, start, end)
        if extra is not None:
            stmt = stmt.where(extra)
        return session.exec(select(func.count()).select_from(stmt.subquery())).one()

    week_ago = core.utcnow() - timedelta(days=7)
    counts = {
        "pending": count("pending"), "overdue": count("overdue"), "today": count("today"),
        "upcoming": count("upcoming"), "completed": count("completed"),
        "completed_7d": count("completed", FollowUp.completed_at >= week_ago),
        "upcoming_7d": count("upcoming", FollowUp.due_at < end + timedelta(days=7)),
    }
    urgent = session.exec(_view_filter(base, "pending", start, end).where(FollowUp.due_at < end)
                          .order_by(FollowUp.due_at).limit(8)).all()
    if len(urgent) < 8:
        urgent += session.exec(_view_filter(base, "upcoming", start, end).order_by(FollowUp.due_at).limit(8 - len(urgent))).all()
    return {"counts": counts, "next": _serialize(session, urgent, tz_offset)}


@router.get("/followups/sender")
def followup_sender(v: inbox.Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    return company_mailer.account_status(session, v.user.id, v.tenant_id if v.tenant_id is not None else v.user.tenant_id)


@router.get("/followups/assignees")
def followup_assignees(v: inbox.Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    if not v.full_access:
        return {"users": [{"id": v.user.id, "name": v.user.name or v.user.email}]}
    stmt = select(User).where(User.is_active.is_(True))
    if v.tenant_id is not None:
        stmt = stmt.where(User.tenant_id == v.tenant_id)
    users = [u for u in session.exec(stmt.order_by(User.name)).all() if inbox._role_of(u) in INTERNAL_ROLES]
    return {"users": [{"id": u.id, "name": u.name or u.email, "role": inbox._role_of(u)} for u in users[:300]]}


def _timeline(session: Session, v: inbox.Viewer, kind: str, rec, limit: int = 80) -> list:
    """Notes, conversations (with replies), remarks, emails and follow-ups of one record, newest first."""
    is_lead = kind == "leads"
    by = (lambda m, a="lead_id": getattr(m, a) == rec.id) if is_lead else (lambda m, a="client_id": getattr(m, a) == rec.id)
    events = []
    for n in session.exec(select(ClientNote).where(by(ClientNote)).order_by(ClientNote.created_at.desc()).limit(40)).all():
        events.append({"key": f"note-{n.id}", "type": "note", "title": "Note", "body": n.content,
                       "author": n.author_name, "date": _iso(n.created_at)})
    if is_lead:
        for n in session.exec(select(LeadNote).where(LeadNote.lead_id == rec.id).order_by(LeadNote.created_at.desc()).limit(40)).all():
            events.append({"key": f"leadnote-{n.id}", "type": "note", "title": "Note", "body": n.content,
                           "author": n.author_name, "date": _iso(n.created_at)})
        for i, line in enumerate([ln.strip() for ln in (rec.notes or "").splitlines() if ln.strip()][-20:]):
            events.append({"key": f"leadnotes-{i}", "type": "note", "title": "Lead note", "body": line, "author": None, "date": None})
    else:
        for r in session.exec(select(Remark).where(Remark.clientId == rec.id).order_by(Remark.createdAt.desc()).limit(40)).all():
            events.append({"key": f"remark-{r.id}", "type": "remark", "title": "Remark", "body": r.content,
                           "author": None, "date": _iso(r.createdAt)})
    convs = session.exec(select(ConversationLog).where(by(ConversationLog)).order_by(ConversationLog.created_at.desc()).limit(40)).all()
    replies = {}
    if convs:
        for r in session.exec(select(ConversationReply).where(ConversationReply.conversation_id.in_([c.id for c in convs]))
                              .order_by(ConversationReply.created_at)).all():
            replies.setdefault(r.conversation_id, []).append({"content": r.content, "author": r.author_name, "date": _iso(r.created_at)})
    for c in convs:
        events.append({"key": f"conv-{c.id}", "type": c.type or "conversation", "title": c.title, "body": c.description,
                       "author": c.author_name, "date": _iso(c.created_at), "replies": replies.get(c.id, [])})
    for e in inbox._record_messages(session, v, kind, rec, limit=25):
        events.append({"key": e["key"], "type": "email_in" if e["direction"] == "inbound" else "email_out",
                       "title": e["subject"], "body": (e.get("ai") or {}).get("summary") or e.get("snippet"),
                       "author": e.get("from_name") or e.get("from_address") if e["direction"] == "inbound" else e.get("to"),
                       "date": e.get("date"), "status": e.get("status")})
    col = FollowUp.lead_id if is_lead else FollowUp.client_id
    for f in session.exec(select(FollowUp).where(col == rec.id).order_by(FollowUp.created_at.desc()).limit(40)).all():
        if f.status == core.DONE:
            events.append({"key": f"fu-done-{f.id}", "type": "followup_done", "title": f"Follow-up completed: {f.title}",
                           "body": f.completion_note, "author": None, "date": _iso(f.completed_at)})
        events.append({"key": f"fu-{f.id}", "type": "followup", "title": f"Follow-up scheduled: {f.title}",
                       "body": f.notes, "author": None, "date": _iso(f.created_at), "due_at": _iso(f.due_at)})
    events.sort(key=lambda e: e.get("date") or "", reverse=True)
    return events[:limit]


def _record_from_query(session: Session, v: inbox.Viewer, lead_id: Optional[int], client_id: Optional[int]):
    if bool(lead_id) == bool(client_id):
        raise HTTPException(status_code=400, detail="Pass exactly one of lead_id or client_id.")
    kind = "leads" if lead_id else "clients"
    rec = inbox._record(session, v, kind, lead_id or client_id)
    return kind, rec


@router.get("/followups/history")
def followup_history(lead_id: Optional[int] = None, client_id: Optional[int] = None, tz_offset: Optional[int] = None,
                     v: inbox.Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    kind, rec = _record_from_query(session, v, lead_id, client_id)
    col = FollowUp.lead_id if kind == "leads" else FollowUp.client_id
    items = session.exec(select(FollowUp).where(col == rec.id).order_by(FollowUp.status.desc(), FollowUp.due_at.desc())).all()
    info = core.record_info(session, rec.id if kind == "leads" else None, rec.id if kind == "clients" else None)
    return {
        "record": {"type": "lead" if kind == "leads" else "client", "id": rec.id, "name": info.get("label"),
                   "contact_name": info.get("contact_name"), "contact_email": info.get("contact_email"),
                   "owner_id": info.get("owner_id")},
        "recipients": inbox._recipients(session, kind, rec),
        "followups": _serialize(session, items, tz_offset),
        "timeline": _timeline(session, v, kind, rec),
        "ai_enabled": bool(os.getenv("OPENAI_API_KEY")),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Writing
# ─────────────────────────────────────────────────────────────────────────────
class FollowUpCreate(BaseModel):
    lead_id: Optional[int] = None
    client_id: Optional[int] = None
    contact_name: Optional[str] = Field(default=None, max_length=255)
    contact_email: Optional[str] = Field(default=None, max_length=255)
    company_name: Optional[str] = Field(default=None, max_length=255)
    title: str = Field(min_length=1, max_length=500)
    notes: Optional[str] = Field(default=None, max_length=8000)
    channel: CHANNELS = "email"
    priority: PRIORITIES = "medium"
    due_at: str
    remind_at: Optional[str] = None
    assigned_to: Optional[int] = None
    email_subject: Optional[str] = Field(default=None, max_length=500)
    email_body: Optional[str] = Field(default=None, max_length=20000)
    auto_send: bool = False
    source: Literal["manual", "ai_suggested"] = "manual"
    source_ref: Optional[str] = Field(default=None, max_length=100)
    ai_reason: Optional[str] = Field(default=None, max_length=4000)
    tz_offset: Optional[int] = None


def _validate_email_fields(fu: FollowUp):
    if fu.contact_email and not inbox._valid_email(fu.contact_email):
        raise HTTPException(status_code=400, detail=f"“{fu.contact_email}” is not a valid email address.")
    if fu.auto_send:
        if not fu.contact_email:
            raise HTTPException(status_code=400, detail="Automatic sending needs the contact's email address.")
        if not (fu.email_body or "").strip() or not (fu.email_subject or "").strip():
            raise HTTPException(status_code=400, detail="Automatic sending needs an email subject and body — draft the email first.")


@router.post("/followups")
def create_followup(body: FollowUpCreate, v: inbox.Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    info = _check_record(session, v, body.lead_id, body.client_id)
    if not (body.lead_id or body.client_id or (body.contact_email or "").strip()):
        raise HTTPException(status_code=400, detail="Link the follow-up to a lead, a client, or a contact email.")
    _, _, east = _day_bounds(body.tz_offset)
    due = _parse_due(body.due_at, east)
    if due is None:
        raise HTTPException(status_code=400, detail="A follow-up date is required.")
    tenant_id = info.get("tenant_id") if info else (v.tenant_id if v.tenant_id is not None else v.user.tenant_id)
    fu = FollowUp(
        tenant_id=tenant_id, lead_id=body.lead_id if not body.client_id else None, client_id=body.client_id,
        contact_name=(body.contact_name or "").strip() or info.get("contact_name"),
        contact_email=(body.contact_email or "").strip() or info.get("contact_email"),
        company_name=(body.company_name or "").strip() or info.get("label"),
        title=body.title.strip(), notes=(body.notes or "").strip() or None,
        channel=core.db_channel(body.channel), priority=core.db_priority(body.priority),
        due_at=due, reminder_minutes=core.minutes_before(due, _parse_due(body.remind_at, east, "remind_at")),
        owner_id=_check_assignee(session, v, body.assigned_to) or info.get("owner_id") or v.user.id,
        created_by=v.user.id, email_subject=(body.email_subject or "").strip() or None,
        email_body=(body.email_body or "").strip() or None, auto_send=body.auto_send,
        source=body.source, source_ref=body.source_ref, ai_reason=body.ai_reason,
    )
    _validate_email_fields(fu)
    session.add(fu)
    session.flush()
    core.log_activity(session, fu, "Follow-up scheduled", f"Due {due.date().isoformat()} via {fu.channel.lower()}", v.user.id)
    if fu.owner_id and fu.owner_id != v.user.id:
        core.notify(session, fu.owner_id, fu.tenant_id, f"New follow-up assigned: {fu.title}",
                    f"{v.user.name or v.user.email} assigned you a follow-up due {due.date().isoformat()}.",
                    core.record_path(fu.lead_id, fu.client_id))
    session.commit()
    session.refresh(fu)
    return {"item": _serialize(session, [fu], body.tz_offset)[0]}


class FollowUpUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=500)
    notes: Optional[str] = Field(default=None, max_length=8000)
    channel: Optional[CHANNELS] = None
    priority: Optional[PRIORITIES] = None
    due_at: Optional[str] = None
    remind_at: Optional[str] = None
    assigned_to: Optional[int] = None
    contact_name: Optional[str] = Field(default=None, max_length=255)
    contact_email: Optional[str] = Field(default=None, max_length=255)
    email_subject: Optional[str] = Field(default=None, max_length=500)
    email_body: Optional[str] = Field(default=None, max_length=20000)
    auto_send: Optional[bool] = None
    status: Optional[Literal["Pending", "Cancelled"]] = None
    tz_offset: Optional[int] = None


@router.patch("/followups/{fu_id}")
def update_followup(fu_id: int, body: FollowUpUpdate, v: inbox.Viewer = Depends(get_viewer),
                    session: Session = Depends(get_session)):
    fu = _load(session, v, fu_id)
    _, _, east = _day_bounds(body.tz_offset)
    fields = body.model_dump(exclude_unset=True)
    rescheduled = False
    for key in ("title", "notes", "contact_name", "contact_email", "email_subject", "email_body"):
        if key in fields:
            value = fields[key]
            setattr(fu, key, (value.strip() or None) if isinstance(value, str) else value)
    if body.channel is not None:
        fu.channel = core.db_channel(body.channel)
    if body.priority is not None:
        fu.priority = core.db_priority(body.priority)
    if fu.title is None:
        raise HTTPException(status_code=400, detail="Title is required.")
    if "due_at" in fields:
        new_due = _parse_due(body.due_at, east)
        if new_due is None:
            raise HTTPException(status_code=400, detail="A follow-up date is required.")
        rescheduled = core.as_utc(fu.due_at) != new_due
        fu.due_at = new_due  # the reminder keeps its lead time (reminder_minutes)
    if "remind_at" in fields:
        if fu.due_at is None:
            raise HTTPException(status_code=400, detail="Set a follow-up date before a reminder time.")
        remind = _parse_due(body.remind_at, east, "remind_at")
        fu.reminder_minutes = core.minutes_before(fu.due_at, remind) if remind else 0
        rescheduled = True
    if rescheduled:
        fu.reminder_sent_at = fu.overdue_notified_at = None  # remind again for the new date
    if "assigned_to" in fields:
        fu.owner_id = _check_assignee(session, v, body.assigned_to) or v.user.id
    if body.auto_send is not None:
        fu.auto_send = body.auto_send
        if body.auto_send:
            fu.last_error = None
    if body.status == "Cancelled" and fu.status in core.OPEN_STATUSES:
        fu.status = core.CANCELLED
        fu.completed_at = core.utcnow()
        fu.completed_by = v.user.id
        core.log_activity(session, fu, "Follow-up cancelled", "", v.user.id)
    elif body.status == "Pending" and fu.status not in core.OPEN_STATUSES:
        fu.status = core.OPEN
        fu.completed_at = fu.completed_by = fu.completion_note = None
        fu.reminder_sent_at = fu.overdue_notified_at = None
        core.log_activity(session, fu, "Follow-up reopened", "", v.user.id)
    elif rescheduled and fu.due_at is not None:
        core.log_activity(session, fu, "Follow-up rescheduled", f"New date {core.as_utc(fu.due_at).date().isoformat()}", v.user.id)
    _validate_email_fields(fu)
    fu.updated_at = core.utcnow()
    session.add(fu)
    session.commit()
    session.refresh(fu)
    return {"item": _serialize(session, [fu], body.tz_offset)[0]}


@router.delete("/followups/{fu_id}")
def delete_followup(fu_id: int, v: inbox.Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    fu = _load(session, v, fu_id)
    session.delete(fu)
    session.commit()
    return {"ok": True}


class NextFollowUp(BaseModel):
    title: Optional[str] = Field(default=None, max_length=500)
    due_at: str
    channel: Optional[CHANNELS] = None
    notes: Optional[str] = Field(default=None, max_length=8000)


class CompleteBody(BaseModel):
    outcome: Optional[str] = Field(default=None, max_length=8000)
    next: Optional[NextFollowUp] = None
    tz_offset: Optional[int] = None


@router.post("/followups/{fu_id}/complete")
def complete_followup(fu_id: int, body: CompleteBody, v: inbox.Viewer = Depends(get_viewer),
                      session: Session = Depends(get_session)):
    fu = _load(session, v, fu_id)
    if fu.status not in core.OPEN_STATUSES:
        raise HTTPException(status_code=400, detail="This follow-up is already closed.")
    _, _, east = _day_bounds(body.tz_offset)
    now = core.utcnow()
    fu.status, fu.completed_at, fu.completed_by = core.DONE, now, v.user.id
    fu.completion_note = (body.outcome or "").strip() or None
    fu.updated_at = now
    session.add(fu)
    core.log_activity(session, fu, "Follow-up completed", fu.completion_note or "", v.user.id)
    nxt = None
    if body.next:
        due = _parse_due(body.next.due_at, east)
        if due is None:
            raise HTTPException(status_code=400, detail="The next follow-up needs a date.")
        nxt = FollowUp(
            tenant_id=fu.tenant_id, lead_id=fu.lead_id, client_id=fu.client_id, contact_name=fu.contact_name,
            contact_email=fu.contact_email, company_name=fu.company_name,
            title=(body.next.title or "").strip() or fu.title,
            channel=core.db_channel(body.next.channel) if body.next.channel else fu.channel,
            notes=(body.next.notes or "").strip() or (f"Previous follow-up outcome: {fu.completion_note}" if fu.completion_note else fu.notes),
            priority=fu.priority, due_at=due, reminder_minutes=fu.reminder_minutes,
            source="completed_chain", source_ref=f"followup-{fu.id}",
            owner_id=fu.owner_id or v.user.id, created_by=v.user.id,
        )
        session.add(nxt)
        session.flush()
        core.log_activity(session, nxt, "Next follow-up scheduled", f"Due {due.date().isoformat()}", v.user.id)
    session.commit()
    items = [fu] + ([nxt] if nxt else [])
    for i in items:
        session.refresh(i)
    out = _serialize(session, items, body.tz_offset)
    return {"item": out[0], "next": out[1] if nxt else None}


# ─────────────────────────────────────────────────────────────────────────────
# AI: suggestions, drafts, scanning
# ─────────────────────────────────────────────────────────────────────────────
def _company_name(session: Session, tenant_id: Optional[int]) -> str:
    tenant = session.get(Tenant, tenant_id) if tenant_id else None
    return ((tenant.business_name or tenant.name) if tenant else "") or ""


def _followup_history_text(session: Session, col, rec_id: int, exclude_id: Optional[int] = None) -> str:
    rows = session.exec(select(FollowUp).where(col == rec_id).order_by(FollowUp.created_at.desc()).limit(8)).all()
    lines = []
    for f in rows:
        if f.id == exclude_id:
            continue
        due = core.as_utc(f.due_at).date().isoformat() if f.due_at else "no date"
        line = f"- {due} [{f.status}] {f.title}"
        if f.completion_note:
            line += f" — outcome: {inbox._clip(f.completion_note, 300)}"
        elif f.notes:
            line += f" — {inbox._clip(f.notes, 200)}"
        lines.append(line)
    return ("\nPrevious follow-ups (newest first):\n" + "\n".join(lines)) if lines else ""


def _record_context(session: Session, v: inbox.Viewer, kind: str, rec, exclude_followup: Optional[int] = None) -> tuple:
    """(context_text, latest_texts) for a lead/client: notes, conversations, emails, deals, follow-ups."""
    ctx = inbox._gather_context(session, kind, rec)
    emails = inbox._record_messages(session, v, kind, rec, limit=6)
    text = inbox._context_text(session, kind, rec, ctx, inbox.ComposerInclude(), emails)
    text += _followup_history_text(session, FollowUp.lead_id if kind == "leads" else FollowUp.client_id, rec.id, exclude_followup)
    latest = []
    for item in ctx["notes"] + ctx["conversations"]:
        when = item.get("date")
        body = item.get("content") or " ".join(x for x in [item.get("title"), item.get("description")] if x)
        if when and body:
            latest.append((datetime.fromisoformat(when).date(), body))
    latest.sort(key=lambda t: t[0], reverse=True)
    return text[:12000], latest


class SuggestBody(BaseModel):
    lead_id: Optional[int] = None
    client_id: Optional[int] = None
    include_email: bool = True
    tone: str = "professional"
    tz_offset: Optional[int] = None


@router.post("/followups/suggest")
def suggest_followup(body: SuggestBody, v: inbox.Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    kind, rec = _record_from_query(session, v, body.lead_id, body.client_id)
    info = core.record_info(session, body.lead_id, body.client_id)
    context_text, latest = _record_context(session, v, kind, rec)
    _, _, east = _day_bounds(body.tz_offset)
    today = datetime.now(timezone(timedelta(minutes=east))).date()
    if os.getenv("OPENAI_API_KEY"):
        inbox._charge_trial(session, v, "emails")
    inbox._release(session)
    s = followup_ai.suggest_from_history(context_text=context_text, record_label=info.get("label") or "",
                                         today=today, latest_texts=latest)
    email = None
    if body.include_email and s.get("should_follow_up"):
        email = followup_ai.draft_followup_email(
            contact_name=info.get("contact_name") or "", company=info.get("label") or "",
            record_label=info.get("label") or "", title=s["title"], reason=s["reason"], context_text=context_text,
            sender_name=v.user.name or "", sender_company=_company_name(session, rec.tenant_id), tone=body.tone,
            last_discussion=s.get("quote") or "",
        )
    return {"suggestion": s, "email": email, "record": {"label": info.get("label"), "contact_name": info.get("contact_name"),
                                                        "contact_email": info.get("contact_email")}}


class DraftBody(BaseModel):
    tone: str = "professional"
    instructions: Optional[str] = Field(default=None, max_length=2000)
    save: bool = True


@router.post("/followups/{fu_id}/draft-email")
def draft_followup_email(fu_id: int, body: DraftBody, v: inbox.Viewer = Depends(get_viewer),
                         session: Session = Depends(get_session)):
    fu = _load(session, v, fu_id)
    label = fu.company_name or fu.contact_name or fu.contact_email or "the contact"
    if fu.lead_id or fu.client_id:
        kind = "clients" if fu.client_id else "leads"
        rec = inbox._record(session, v, kind, fu.client_id or fu.lead_id)
        context_text, latest = _record_context(session, v, kind, rec, exclude_followup=fu.id)
        label = core.record_info(session, fu.lead_id, fu.client_id).get("label") or label
    else:
        # A bare contact (e.g. from an Excel campaign): the emails we sent them are the history.
        sent = session.exec(select(SentEmail).where(func.lower(SentEmail.to_email) == (fu.contact_email or "").lower(),
                                                    SentEmail.tenant_id == fu.tenant_id)
                            .order_by(SentEmail.sent_at.desc()).limit(4)).all()
        context_text = "\n".join(
            [f"Today: {core.utcnow().date().isoformat()}", f"Contact: {fu.contact_name or ''} <{fu.contact_email}> {fu.company_name or ''}"]
            + [f"- {core.as_utc(s.sent_at).date().isoformat()} we sent: “{s.subject}” — {inbox._clip(s.english_body, 600)}" for s in sent]
            + ([f"- Reply received: {inbox._clip(s.reply_body, 600)}" for s in sent if s.reply_body]))
        latest = []
    context_text += f"\nFollow-up notes: {fu.notes or ''}" + (f"\nAI reason: {fu.ai_reason}" if fu.ai_reason else "")
    if os.getenv("OPENAI_API_KEY"):
        inbox._charge_trial(session, v, "emails")
    inbox._release(session)
    draft = followup_ai.draft_followup_email(
        contact_name=fu.contact_name or "", company=fu.company_name or "", record_label=label, title=fu.title,
        reason=fu.notes or "", context_text=context_text, sender_name=v.user.name or "",
        sender_company=_company_name(session, fu.tenant_id), tone=body.tone, instructions=(body.instructions or "").strip(),
        last_discussion=fu.ai_reason or (latest[0][1][:300] if latest else ""),
    )
    if body.save:
        fu.email_subject, fu.email_body, fu.updated_at = draft["subject"], draft["body"], core.utcnow()
        session.add(fu)
        session.commit()
    return draft


class SendBody(BaseModel):
    to: Optional[str] = Field(default=None, max_length=255)
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=20000)
    complete: bool = True
    outcome: Optional[str] = Field(default=None, max_length=4000)
    tz_offset: Optional[int] = None


@router.post("/followups/{fu_id}/send-email")
def send_followup_email(fu_id: int, body: SendBody, v: inbox.Viewer = Depends(get_viewer),
                        session: Session = Depends(get_session)):
    fu = _load(session, v, fu_id)
    to = (body.to or fu.contact_email or "").strip()
    if not inbox._valid_email(to):
        raise HTTPException(status_code=400, detail="Add a valid recipient email address.")
    if not body.subject.strip() or not body.body.strip():
        raise HTTPException(status_code=400, detail="Subject and body are required.")
    tenant_id = fu.tenant_id if fu.tenant_id is not None else v.user.tenant_id
    try:
        account = company_mailer.resolve_account(session, v.user.id, tenant_id)
    except company_mailer.MailAccountError as e:
        raise HTTPException(status_code=503, detail=str(e))
    text = company_mailer.apply_signature(body.body, company_mailer.user_signature(session, v.user.id))
    try:
        sent = company_mailer.send_and_record(
            session, account, tenant_id=tenant_id, to=to, subject=body.subject.strip(), body=text,
            lead_id=fu.lead_id, client_id=fu.client_id,
            meta={"source": "follow_up", "follow_up_id": fu.id, "sent_by_user_id": v.user.id,
                  "sent_by_name": v.user.name or v.user.email},
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"The mail server did not accept the email: {company_mailer.friendly_smtp_error(e)}")
    fu = session.get(FollowUp, fu_id)
    if not fu.contact_email:
        fu.contact_email = to
    core.mark_email_sent(session, fu, sent, actor_id=v.user.id, actor_name=v.user.name or v.user.email,
                         complete=body.complete and fu.status in core.OPEN_STATUSES, outcome=(body.outcome or "").strip() or None)
    fu.auto_send = False
    session.commit()
    session.refresh(fu)
    return {"ok": True, "item": _serialize(session, [fu], body.tz_offset)[0], "sent_email_id": sent.id,
            "from": account.email, "message": f"Follow-up email sent to {to} from {account.email}."}


class ScanBody(BaseModel):
    lead_id: Optional[int] = None
    client_id: Optional[int] = None
    days: int = Field(default=30, ge=1, le=365)
    tz_offset: Optional[int] = None


@router.post("/followups/scan")
def scan_record_notes(body: ScanBody, v: inbox.Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    """Read this record's not-yet-analysed notes/conversations now and create follow-ups they imply."""
    kind, rec = _record_from_query(session, v, body.lead_id, body.client_id)
    inbox._release(session)
    result = core.scan_notes(lead_id=rec.id if kind == "leads" else None, client_id=rec.id if kind == "clients" else None,
                             tenant_id=rec.tenant_id, max_age_days=body.days, budget=10)
    created = session.exec(select(FollowUp).where(FollowUp.id.in_(result["created"]))).all() if result["created"] else []
    updated = session.exec(select(FollowUp).where(FollowUp.id.in_(result["matched"]))).all() if result["matched"] else []
    return {"scanned": result["scanned"], "created": _serialize(session, created, body.tz_offset),
            "updated": _serialize(session, updated, body.tz_offset), "matched_existing": len(result["matched"])}
