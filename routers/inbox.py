"""
Inbox + record Email tab API.

  /inbox/*                                  unified mailbox — inbound (inbox_messages) + outbound
                                            (sent_emails) — with counts, thread view, flags,
                                            replies, the AI assistant, per-filter AI summaries and
                                            sync status
  /{leads|clients}/{id}/email-composer/*    record context, AI drafts grounded in that record's
                                            CRM history, sending, and the record's email history

Access, enforced here rather than by hiding UI:
  Admin / SuperAdmin / Demo  -> the whole tenant mailbox; may email any lead or client
  SalesManager / Employee    -> only mail linked to leads they own (Lead.owner_id) or clients
                                assigned to them (ClientProfile.assignedEmployeeId), and may
                                only email those records
  every other role           -> 403
Identity still comes from the X-User-ID header (AUDIT_REPORT.md §4), so these checks are only
as strong as that.

Message keys are "in-<inbox_messages.id>" and "out-<sent_emails.id>".
Every query also filters tenant_id explicitly: main.py's tenant listener skips aggregate
selects such as count(), so it can't be relied on alone here.
"""
import json
import os
import re
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from email.utils import make_msgid
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, not_, or_
from sqlalchemy.engine import Row
from sqlalchemy.orm import defer
from sqlmodel import Session, select

from database import (
    ActivityLog,
    ClientNote,
    ClientProfile,
    ClientResearch,
    Contact,
    ConversationLog,
    CRMQuote,
    Deal,
    EmailSettings,
    InboxMessage,
    Invoice,
    Lead,
    LeadNote,
    Meeting,
    Proposal,
    Remark,
    SalesOrder,
    SentEmail,
    Task,
    Tenant,
    User,
    UserEmailIntegration,
    engine,
)
from modules import company_mailer, email_ai, inbox_sync
from modules.api_tracker import current_salesperson_id

router = APIRouter(tags=["inbox"])


def get_session():
    with Session(engine) as session:
        yield session


# ─────────────────────────────────────────────────────────────────────────────
# Who is asking
# ─────────────────────────────────────────────────────────────────────────────
FULL_ACCESS_ROLES = {"Admin", "SuperAdmin", "Demo"}
SCOPED_ROLES = {"SalesManager", "Employee"}


@dataclass
class Viewer:
    user: User
    role: str
    tenant_id: Optional[int]
    full_access: bool


def _role_of(user: User) -> str:
    raw = user.role or "Client"
    return {"admin": "Admin", "employee": "Employee", "client": "Client", "intern": "Intern"}.get(raw.lower(), raw)


def get_viewer(request: Request, session: Session = Depends(get_session)) -> Viewer:
    uid = current_salesperson_id.get()
    user = session.get(User, uid) if uid else None
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    role = _role_of(user)
    # Same rule as main._require_roles: admin@serphawk.com is always a superuser.
    if role == "SuperAdmin" or (user.email or "").lower() == "admin@serphawk.com":
        full_access = True
    elif role in FULL_ACCESS_ROLES:
        full_access = True
    elif role in SCOPED_ROLES:
        full_access = False
    else:
        raise HTTPException(status_code=403, detail="Your role does not have access to the Inbox.")
    if role == "SuperAdmin":
        header = request.headers.get("X-Tenant-ID", "")
        tenant_id = int(header) if header.isdigit() else None
    else:
        tenant_id = user.tenant_id
    return Viewer(user=user, role=role, tenant_id=tenant_id, full_access=full_access)


def _tenant(stmt, model, v: Viewer):
    return stmt.where(model.tenant_id == v.tenant_id) if v.tenant_id is not None else stmt


def _owned_leads(v: Viewer):
    return select(Lead.id).where(Lead.owner_id == v.user.id)


def _owned_clients(v: Viewer):
    return select(ClientProfile.id).where(ClientProfile.assignedEmployeeId == v.user.id)


def _scope(stmt, model, v: Viewer):
    """Admins see the whole tenant. Everyone else sees mail linked to their own leads / clients, plus —
    because the Inbox follows each person's Email Integration — everything received in their own
    mailbox and everything they sent themselves."""
    stmt = _tenant(stmt, model, v)
    if v.full_access:
        return stmt
    conds = [model.lead_id.in_(_owned_leads(v)), model.client_id.in_(_owned_clients(v))]
    if model is InboxMessage:
        conds.append(InboxMessage.mailbox.in_(
            select(func.lower(UserEmailIntegration.email)).where(UserEmailIntegration.user_id == v.user.id)))
    elif model is SentEmail:
        conds.append(SentEmail.draft_json.like(f'%"sent_by_user_id": {int(v.user.id)},%'))
    return stmt.where(or_(*conds))


def _owns(session: Session, v: Viewer, lead_id: Optional[int], client_id: Optional[int]) -> bool:
    if v.full_access:
        return True
    if lead_id:
        lead = session.get(Lead, lead_id)
        if lead and lead.owner_id == v.user.id:
            return True
    if client_id:
        cp = session.get(ClientProfile, client_id)
        if cp and cp.assignedEmployeeId == v.user.id:
            return True
    return False


def _charge_trial(session: Session, v: Viewer, kind: str):
    """Demo-tier usage cap — mirrors main.check_tenant_limit for 'emails' / 'searches',
    including the LIMIT_REACHED payload the frontend's upgrade modal listens for."""
    if v.user.role != "Demo" or not v.tenant_id:
        return
    tenant = session.get(Tenant, v.tenant_id)
    if not tenant or not tenant.is_trial:
        return
    if kind == "emails":
        if tenant.usage_emails >= tenant.limit_emails:
            raise HTTPException(status_code=403, detail={"error": "LIMIT_REACHED", "limit_type": "emails", "message": f"Trial limit reached. You can only generate {tenant.limit_emails} AI emails."})
        tenant.usage_emails += 1
    else:
        if tenant.usage_searches >= tenant.limit_searches:
            raise HTTPException(status_code=403, detail={"error": "LIMIT_REACHED", "limit_type": "searches", "message": f"Trial limit reached. You can only perform {tenant.limit_searches} AI searches."})
        tenant.usage_searches += 1
    session.add(tenant)
    session.commit()


def _release(session: Session):
    """End the request's DB transaction before a slow external call (OpenAI, SMTP, IMAP). Otherwise its
    locks are held for seconds, and a pending ALTER TABLE — e.g. another instance's startup migrations —
    queues every other query on those tables behind it."""
    session.commit()


def _ai(session: Session, call, *args, **kwargs):
    _release(session)
    try:
        return call(*args, **kwargs)
    except email_ai.EmailAIError as e:
        raise HTTPException(status_code=502, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# Formatting helpers
# ─────────────────────────────────────────────────────────────────────────────
_EMAIL_RE = re.compile(r"^[^@\s<>,;\"']+@[^@\s<>,;\"']+\.[A-Za-z]{2,}$")
_PLACEHOLDER_RE = re.compile(r"(@placeholder\.com|^unknown@example\.com)$", re.I)
_FOLLOWUP_RE = re.compile(
    r"\b(follow[- ]?up|next step|call (?:him |her |them )?back|callback|remind|reach out|get back|check in|"
    r"send (?:the |a |over )?(?:proposal|quote|deck|details|pricing|contract))\b",
    re.I,
)
_DONE_TASK_STATES = {"done", "completed", "complete", "cancelled", "canceled", "closed"}


def _iso(dt) -> Optional[str]:
    if not dt:
        return None
    if isinstance(dt, date) and not isinstance(dt, datetime):
        return dt.isoformat()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _naive_utc(dt) -> datetime:
    if not dt:
        return datetime.min
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


def _clip(text, limit: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _valid_email(addr: str) -> bool:
    return bool(addr) and bool(_EMAIL_RE.match(addr.strip())) and not _PLACEHOLDER_RE.search(addr.strip())


def _address_list(raw: Optional[str], field: str) -> Optional[str]:
    if not raw or not raw.strip():
        return None
    parts = [p.strip() for p in re.split(r"[,;]", raw) if p.strip()]
    bad = [p for p in parts if not _valid_email(p)]
    if bad or not parts:
        raise HTTPException(status_code=400, detail=f"Invalid {field} address: {', '.join(bad) or raw}")
    if len(parts) > 10:
        raise HTTPException(status_code=400, detail=f"Too many {field} addresses (max 10).")
    return ", ".join(parts)


def _body_to_text(body: Optional[str]) -> str:
    body = body or ""
    return inbox_sync.html_to_text(body) if body.lstrip().startswith("<") else body


def _norm_subject(subject: Optional[str]) -> str:
    s = (subject or "").strip().lower()
    while True:
        stripped = re.sub(r"^(re|fw|fwd|aw|sv|antw|r)\s*(\[\d+\])?\s*:\s*", "", s)
        if stripped == s:
            break
        s = stripped
    return re.sub(r"\s+", " ", s)


def _parse_key(key: str):
    m = re.fullmatch(r"(in|out)-(\d+)", key or "")
    if not m:
        raise HTTPException(status_code=404, detail="Message not found")
    return m.group(1), int(m.group(2))


def _client_label(cp: ClientProfile) -> str:
    sd = (cp.customFields or {}).get("sheet_data") or {}
    return cp.companyName or cp.projectName or sd.get("Client Name") or cp.websiteUrl or f"Client #{cp.id}"


def _names(session: Session, lead_ids: set, client_ids: set):
    leads = {}
    clients = {}
    if lead_ids:
        for lid, name in session.exec(select(Lead.id, Lead.company_name).where(Lead.id.in_(lead_ids))).all():
            leads[lid] = name or f"Lead #{lid}"
    if client_ids:
        for cp in session.exec(select(ClientProfile).where(ClientProfile.id.in_(client_ids))).all():
            clients[cp.id] = _client_label(cp)
    return leads, clients


def _sent_meta(s: SentEmail) -> dict:
    try:
        meta = json.loads(s.draft_json or "{}")
        return meta if isinstance(meta, dict) else {}
    except (TypeError, ValueError):
        return {}


def _row_in(m: InboxMessage, leads: dict, clients: dict) -> dict:
    return {
        "key": f"in-{m.id}",
        "direction": "inbound",
        "from_name": m.from_name,
        "from_address": m.from_address,
        "to": m.to_addresses,
        "subject": m.subject or "(no subject)",
        "snippet": m.snippet,
        "date": _iso(m.received_at),
        "is_read": m.is_read,
        "is_starred": m.is_starred,
        "is_archived": m.is_archived,
        "replied_at": _iso(m.replied_at),
        "has_attachments": bool(m.attachments),
        "status": "Replied" if m.replied_at else None,
        "ai": {
            "category": m.ai_category,
            "priority": m.ai_priority,
            "sentiment": m.ai_sentiment,
            "needs_reply": bool(m.ai_needs_reply) and not m.replied_at,
            "summary": m.ai_summary,
        } if m.ai_classified_at else None,
        "lead": {"id": m.lead_id, "name": leads[m.lead_id]} if m.lead_id in leads else None,
        "client": {"id": m.client_id, "name": clients[m.client_id]} if m.client_id in clients else None,
    }


def _row_out(s, leads: dict, clients: dict, reply_counts: dict, body_head: Optional[str]) -> dict:
    text = _body_to_text(body_head)
    return {
        "key": f"out-{s.id}",
        "direction": "outbound",
        "from_name": None,
        "from_address": None,
        "to": s.to_email,
        "subject": s.subject or "(no subject)",
        "snippet": inbox_sync.make_snippet(text) or None,
        "date": _iso(s.sent_at),
        "is_read": True,
        "is_starred": False,
        "is_archived": False,
        "replied_at": _iso(s.replied_at),
        "has_attachments": False,
        "status": s.status,
        "open_count": s.open_count or 0,
        "reply_count": reply_counts.get(s.id, 0),
        "ai": None,
        "lead": {"id": s.lead_id, "name": leads[s.lead_id]} if s.lead_id in leads else None,
        "client": {"id": s.client_id, "name": clients[s.client_id]} if s.client_id in clients else None,
    }


def _serialize(session: Session, pairs: list) -> list:
    """pairs: [("in", InboxMessage) | ("out", SentEmail or an _outbound_columns() Row)] -> rows, order kept."""
    lead_ids = {r.lead_id for _, r in pairs if r.lead_id}
    client_ids = {r.client_id for _, r in pairs if r.client_id}
    leads, clients = _names(session, lead_ids, client_ids)
    out_ids = [r.id for kind, r in pairs if kind == "out"]
    reply_counts = {}
    if out_ids:
        reply_counts = dict(session.exec(
            select(InboxMessage.sent_email_id, func.count(InboxMessage.id))
            .where(InboxMessage.sent_email_id.in_(out_ids))
            .group_by(InboxMessage.sent_email_id)
        ).all())
    rows = []
    for kind, r in pairs:
        if kind == "in":
            rows.append(_row_in(r, leads, clients))
        else:
            head = r.body_head if isinstance(r, Row) else r.english_body
            rows.append(_row_out(r, leads, clients, reply_counts, head))
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# Unified listing
# ─────────────────────────────────────────────────────────────────────────────
FOLDERS = ("all", "received", "sent", "needs_reply", "unread", "starred", "archived")


class InboxFilters(BaseModel):
    folder: str = "all"
    linked: Optional[str] = None      # lead | client | unlinked
    category: Optional[str] = None    # email_ai.CATEGORIES key
    priority: Optional[str] = None    # high | medium | low
    q: Optional[str] = None


def _clean_filters(f: InboxFilters) -> InboxFilters:
    return InboxFilters(
        folder=f.folder if f.folder in FOLDERS else "all",
        linked=f.linked if f.linked in ("lead", "client", "unlinked") else None,
        category=f.category if f.category in email_ai.CATEGORIES else None,
        priority=f.priority if f.priority in email_ai.PRIORITIES else None,
        q=(f.q or "").strip()[:200] or None,
    )


NEEDS_REPLY = and_(
    InboxMessage.replied_at.is_(None),
    InboxMessage.is_archived == False,  # noqa: E712
    or_(
        InboxMessage.ai_needs_reply == True,  # noqa: E712
        # Not triaged yet: anything from a known lead/client is assumed to need an answer.
        and_(InboxMessage.ai_needs_reply.is_(None), or_(InboxMessage.lead_id.is_not(None), InboxMessage.client_id.is_not(None))),
    ),
)


def _sources(f: InboxFilters):
    inbound = f.folder != "sent"
    outbound = f.folder in ("all", "sent") and not (f.category or f.priority)
    return inbound, outbound


def _linked(stmt, model, linked):
    if linked == "lead":
        return stmt.where(model.lead_id.is_not(None))
    if linked == "client":
        return stmt.where(model.client_id.is_not(None))
    if linked == "unlinked":
        return stmt.where(model.lead_id.is_(None), model.client_id.is_(None))
    return stmt


def _inbound_where(stmt, v: Viewer, f: InboxFilters):
    stmt = _scope(stmt, InboxMessage, v)
    stmt = stmt.where(InboxMessage.is_archived == (f.folder == "archived"))
    if f.folder == "needs_reply":
        stmt = stmt.where(NEEDS_REPLY)
    elif f.folder == "unread":
        stmt = stmt.where(InboxMessage.is_read == False)  # noqa: E712
    elif f.folder == "starred":
        stmt = stmt.where(InboxMessage.is_starred == True)  # noqa: E712
    stmt = _linked(stmt, InboxMessage, f.linked)
    if f.category:
        stmt = stmt.where(InboxMessage.ai_category == f.category)
    if f.priority:
        stmt = stmt.where(InboxMessage.ai_priority == f.priority)
    if f.q:
        like = f"%{f.q}%"
        stmt = stmt.where(or_(
            InboxMessage.subject.ilike(like), InboxMessage.from_address.ilike(like),
            InboxMessage.from_name.ilike(like), InboxMessage.snippet.ilike(like),
            InboxMessage.ai_summary.ilike(like),
        ))
    return stmt


def _sent_visible(stmt):
    return stmt.where(
        SentEmail.status != "Draft",
        SentEmail.status != "Sending",
        SentEmail.to_email != "unknown@example.com",
        not_(SentEmail.to_email.ilike("%@placeholder.com")),
    )


def _outbound_where(stmt, v: Viewer, f: InboxFilters):
    stmt = _sent_visible(_scope(stmt, SentEmail, v))
    stmt = _linked(stmt, SentEmail, f.linked)
    if f.q:
        like = f"%{f.q}%"
        stmt = stmt.where(or_(SentEmail.subject.ilike(like), SentEmail.to_email.ilike(like), SentEmail.english_body.ilike(like)))
    return stmt


_INBOUND_LIST_DEFERS = (defer(InboxMessage.body_html), defer(InboxMessage.body_text_full), defer(InboxMessage.body_text),
                        defer(InboxMessage.references_header))


def _outbound_columns():
    return select(
        SentEmail.id, SentEmail.to_email, SentEmail.subject, SentEmail.status, SentEmail.sent_at,
        SentEmail.open_count, SentEmail.replied_at, SentEmail.lead_id, SentEmail.client_id,
        func.substr(SentEmail.english_body, 1, 800).label("body_head"),
    )


def _list_unified(session: Session, v: Viewer, f: InboxFilters, limit: int, offset: int):
    inbound, outbound = _sources(f)
    window = offset + limit
    pairs, total = [], 0
    if inbound:
        total += session.exec(_inbound_where(select(func.count(InboxMessage.id)), v, f)).one()
        stmt = _inbound_where(select(InboxMessage), v, f).options(*_INBOUND_LIST_DEFERS)
        pairs += [("in", m) for m in session.exec(stmt.order_by(InboxMessage.received_at.desc()).limit(window)).all()]
    if outbound:
        total += session.exec(_outbound_where(select(func.count(SentEmail.id)), v, f)).one()
        stmt = _outbound_where(_outbound_columns(), v, f)
        pairs += [("out", s) for s in session.exec(stmt.order_by(SentEmail.sent_at.desc()).limit(window)).all()]
    pairs.sort(key=lambda kr: _naive_utc(kr[1].received_at if kr[0] == "in" else kr[1].sent_at), reverse=True)
    return _serialize(session, pairs[offset:offset + limit]), total


def _view_label(f: InboxFilters) -> str:
    parts = [{"all": "All mail", "received": "Received", "sent": "Sent", "needs_reply": "Needs reply",
              "unread": "Unread", "starred": "Starred", "archived": "Archived"}[f.folder]]
    if f.linked:
        parts.append({"lead": "Leads", "client": "Clients", "unlinked": "Unknown senders"}[f.linked])
    if f.category:
        parts.append(email_ai.CATEGORIES[f.category])
    if f.priority:
        parts.append(f"{f.priority.capitalize()} priority")
    if f.q:
        parts.append(f'matching "{f.q}"')
    return " · ".join(parts)


@router.get("/inbox/messages")
def list_inbox_messages(
    folder: str = "all", linked: Optional[str] = None, category: Optional[str] = None,
    priority: Optional[str] = None, q: Optional[str] = None,
    limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0, le=5000),
    v: Viewer = Depends(get_viewer), session: Session = Depends(get_session),
):
    f = _clean_filters(InboxFilters(folder=folder, linked=linked, category=category, priority=priority, q=q))
    items, total = _list_unified(session, v, f, limit, offset)
    return {"items": items, "total": total, "limit": limit, "offset": offset, "view": _view_label(f)}


@router.get("/inbox/counts")
def inbox_counts(only: Optional[str] = None, v: Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    live = InboxMessage.is_archived == False  # noqa: E712
    unread_cond = and_(live, InboxMessage.is_read == False)  # noqa: E712
    if only == "unread":  # the sidebar badge poll
        return {"unread": session.exec(_scope(select(func.count(InboxMessage.id)), InboxMessage, v).where(unread_cond)).one()}

    # Conditional aggregates: 3 queries for every badge on the page instead of one query per badge.
    def n_in(cond):
        return func.count(InboxMessage.id).filter(cond)

    def n_out(cond):
        return func.count(SentEmail.id).filter(cond)

    (received, unread, needs_reply, starred, archived, in_lead, in_client, in_unlinked, high, unclassified) = session.exec(
        _scope(select(
            n_in(live), n_in(unread_cond), n_in(NEEDS_REPLY), n_in(and_(live, InboxMessage.is_starred == True)),  # noqa: E712
            n_in(InboxMessage.is_archived == True),  # noqa: E712
            n_in(and_(live, InboxMessage.lead_id.is_not(None))), n_in(and_(live, InboxMessage.client_id.is_not(None))),
            n_in(and_(live, InboxMessage.lead_id.is_(None), InboxMessage.client_id.is_(None))),
            n_in(and_(live, InboxMessage.ai_priority == "high")), n_in(and_(live, InboxMessage.ai_classified_at.is_(None))),
        ), InboxMessage, v)
    ).one()
    sent, out_lead, out_client, out_unlinked = session.exec(
        _sent_visible(_scope(select(
            func.count(SentEmail.id), n_out(SentEmail.lead_id.is_not(None)), n_out(SentEmail.client_id.is_not(None)),
            n_out(and_(SentEmail.lead_id.is_(None), SentEmail.client_id.is_(None))),
        ), SentEmail, v))
    ).one()
    cat_stmt = _inbound_where(select(InboxMessage.ai_category, func.count(InboxMessage.id)), v, InboxFilters(folder="received"))
    categories = {c: n for c, n in session.exec(cat_stmt.group_by(InboxMessage.ai_category)).all() if c}
    return {
        "unread": unread,
        "folders": {
            "all": received + sent, "received": received, "sent": sent, "needs_reply": needs_reply,
            "unread": unread, "starred": starred, "archived": archived,
        },
        "linked": {"lead": in_lead + out_lead, "client": in_client + out_client, "unlinked": in_unlinked + out_unlinked},
        "categories": categories,
        "high_priority": high,
        "unclassified": unclassified,
    }


# ─────────────────────────────────────────────────────────────────────────────
# One message + its thread
# ─────────────────────────────────────────────────────────────────────────────
def _in_my_mailbox(session: Session, v: Viewer, mailbox: Optional[str]) -> bool:
    if not mailbox:
        return False
    return session.exec(select(UserEmailIntegration.id).where(
        UserEmailIntegration.user_id == v.user.id, func.lower(UserEmailIntegration.email) == mailbox.lower())).first() is not None


def _sent_by_me(v: Viewer, msg: SentEmail) -> bool:
    return f'"sent_by_user_id": {int(v.user.id)},' in (msg.draft_json or "")


def _load_message(session: Session, v: Viewer, key: str):
    kind, mid = _parse_key(key)
    if kind == "in":
        msg = session.get(InboxMessage, mid)
        if (not msg or (v.tenant_id is not None and msg.tenant_id != v.tenant_id)
                or not (_owns(session, v, msg.lead_id, msg.client_id) or _in_my_mailbox(session, v, msg.mailbox))):
            raise HTTPException(status_code=404, detail="Message not found")
        return kind, msg
    msg = session.get(SentEmail, mid)
    if (not msg or (v.tenant_id is not None and msg.tenant_id != v.tenant_id) or msg.status in ("Draft", "Sending")
            or not (_owns(session, v, msg.lead_id, msg.client_id) or _sent_by_me(v, msg))):
        raise HTTPException(status_code=404, detail="Message not found")
    return kind, msg


def _full_in(m: InboxMessage, leads, clients) -> dict:
    row = _row_in(m, leads, clients)
    row.update({
        "cc": m.cc_addresses,
        "body_text": m.body_text,
        "body_text_full": m.body_text_full,
        "body_html": m.body_html,
        "attachments": m.attachments or [],
        "message_id": m.message_id,
        "mailbox": m.mailbox,
    })
    return row


def _full_out(s: SentEmail, leads, clients, reply_counts) -> dict:
    row = _row_out(s, leads, clients, reply_counts, s.english_body)
    meta = _sent_meta(s)
    body = s.english_body or ""
    row.update({
        "body_text": _body_to_text(body) if body.lstrip().startswith("<") else body,
        "body_html": body if body.lstrip().startswith("<") else None,
        "body_text_full": None,
        "attachments": [],
        "sent_by": meta.get("sent_by_name"),
        "cc": meta.get("cc"),
        "opened_at": _iso(s.opened_at),
        "last_opened_at": _iso(s.last_opened_at),
    })
    return row


def _thread(session: Session, v: Viewer, counterpart: str, subject: Optional[str], anchor_key: str) -> list:
    """Every message exchanged with `counterpart` under the same normalized subject, oldest first."""
    counterpart = (counterpart or "").strip().lower()
    norm = _norm_subject(subject)
    picked = []  # (date, kind, id) — matched on light columns first, full rows loaded after
    if counterpart and norm:
        ins = session.exec(
            _scope(select(InboxMessage.id, InboxMessage.subject, InboxMessage.received_at), InboxMessage, v)
            .where(func.lower(InboxMessage.from_address) == counterpart)
            .order_by(InboxMessage.received_at.desc()).limit(100)
        ).all()
        outs = session.exec(
            _sent_visible(_scope(select(SentEmail.id, SentEmail.subject, SentEmail.sent_at), SentEmail, v))
            .where(func.lower(SentEmail.to_email) == counterpart)
            .order_by(SentEmail.sent_at.desc()).limit(100)
        ).all()
        picked = [(_naive_utc(r.received_at), "in", r.id) for r in ins if _norm_subject(r.subject) == norm]
        picked += [(_naive_utc(r.sent_at), "out", r.id) for r in outs if _norm_subject(r.subject) == norm]
    picked = sorted(picked)[-30:]
    in_rows = {m.id: m for m in session.exec(select(InboxMessage).where(InboxMessage.id.in_([i for _, k, i in picked if k == "in"]))).all()} if picked else {}
    out_rows = {s.id: s for s in session.exec(select(SentEmail).where(SentEmail.id.in_([i for _, k, i in picked if k == "out"]))).all()} if picked else {}
    pairs = [(k, in_rows[i] if k == "in" else out_rows[i]) for _, k, i in picked if i in (in_rows if k == "in" else out_rows)]
    if not any(f"{k}-{r.id}" == anchor_key for k, r in pairs):
        kind, rec = _load_message(session, v, anchor_key)
        pairs.append((kind, rec))
        pairs.sort(key=lambda kr: _naive_utc(kr[1].received_at if kr[0] == "in" else kr[1].sent_at))

    leads, clients = _names(session, {r.lead_id for _, r in pairs if r.lead_id}, {r.client_id for _, r in pairs if r.client_id})
    out_ids = [r.id for k, r in pairs if k == "out"]
    reply_counts = dict(session.exec(
        select(InboxMessage.sent_email_id, func.count(InboxMessage.id))
        .where(InboxMessage.sent_email_id.in_(out_ids)).group_by(InboxMessage.sent_email_id)
    ).all()) if out_ids else {}
    return [_full_in(r, leads, clients) if k == "in" else _full_out(r, leads, clients, reply_counts) for k, r in pairs]


def _thread_for_ai(thread: list) -> list:
    return [{
        "direction": m["direction"],
        "from": f'{m.get("from_name") or ""} <{m.get("from_address")}>' if m["direction"] == "inbound" else (m.get("sent_by") or "us"),
        "to": m.get("to"),
        "date": m.get("date") or "",
        "subject": m.get("subject"),
        "body": m.get("body_text") or m.get("body_text_full") or m.get("snippet") or "",
    } for m in thread]


@router.get("/inbox/messages/{key}")
def get_inbox_message(key: str, v: Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    kind, msg = _load_message(session, v, key)
    if kind == "in" and not msg.is_read:
        msg.is_read = True
        session.add(msg)
        session.commit()
        session.refresh(msg)
    counterpart = msg.from_address if kind == "in" else msg.to_email
    thread = _thread(session, v, counterpart, msg.subject, key)
    current = next((m for m in thread if m["key"] == key), None)
    return {"message": current, "thread": thread}


class FlagsBody(BaseModel):
    is_read: Optional[bool] = None
    is_starred: Optional[bool] = None
    is_archived: Optional[bool] = None


@router.patch("/inbox/messages/{key}")
def update_inbox_flags(key: str, body: FlagsBody, v: Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    kind, msg = _load_message(session, v, key)
    if kind != "in":
        raise HTTPException(status_code=400, detail="Only received emails can be marked read, starred or archived.")
    for field in ("is_read", "is_starred", "is_archived"):
        value = getattr(body, field)
        if value is not None:
            setattr(msg, field, value)
    session.add(msg)
    session.commit()
    session.refresh(msg)
    leads, clients = _names(session, {msg.lead_id} - {None}, {msg.client_id} - {None})
    return {"ok": True, "item": _row_in(msg, leads, clients)}


class BulkBody(BaseModel):
    keys: List[str] = Field(default_factory=list, max_length=500)
    action: Literal["read", "unread", "star", "unstar", "archive", "unarchive"]


@router.post("/inbox/messages/bulk")
def bulk_update_inbox(body: BulkBody, v: Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    field, value = {
        "read": ("is_read", True), "unread": ("is_read", False), "star": ("is_starred", True),
        "unstar": ("is_starred", False), "archive": ("is_archived", True), "unarchive": ("is_archived", False),
    }[body.action]
    ids = [int(k[3:]) for k in body.keys if re.fullmatch(r"in-\d+", k)]
    if not ids:
        return {"ok": True, "updated": 0}
    rows = session.exec(_scope(select(InboxMessage), InboxMessage, v).where(InboxMessage.id.in_(ids))).all()
    for row in rows:
        setattr(row, field, value)
        session.add(row)
    session.commit()
    return {"ok": True, "updated": len(rows)}


class MarkAllReadBody(InboxFilters):
    pass


@router.post("/inbox/mark-all-read")
def mark_view_read(body: MarkAllReadBody, v: Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    f = _clean_filters(body)
    if f.folder == "sent":
        return {"ok": True, "updated": 0}
    rows = session.exec(_inbound_where(select(InboxMessage), v, f).where(InboxMessage.is_read == False).limit(2000)).all()  # noqa: E712
    for row in rows:
        row.is_read = True
        session.add(row)
    session.commit()
    return {"ok": True, "updated": len(rows)}


# ─────────────────────────────────────────────────────────────────────────────
# AI: thread summary, per-filter summary, assistant
# ─────────────────────────────────────────────────────────────────────────────
class _TTLCache:
    def __init__(self, ttl_seconds: int, max_items: int = 300):
        self.ttl, self.max_items = ttl_seconds, max_items
        self._data: dict = {}
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            hit = self._data.get(key)
            if hit and hit[0] > time.time():
                return hit[1]
            self._data.pop(key, None)
            return None

    def set(self, key, value):
        with self._lock:
            if len(self._data) >= self.max_items:
                self._data.pop(min(self._data, key=lambda k: self._data[k][0]), None)
            self._data[key] = (time.time() + self.ttl, value)


_view_summaries = _TTLCache(ttl_seconds=900)
_thread_summaries = _TTLCache(ttl_seconds=1800)


def _scope_key(v: Viewer) -> str:
    return f"t{v.tenant_id}:" + ("all" if v.full_access else f"u{v.user.id}")


@router.post("/inbox/messages/{key}/summarize")
def summarize_inbox_thread(key: str, refresh: bool = False, v: Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    kind, msg = _load_message(session, v, key)
    thread = _thread(session, v, msg.from_address if kind == "in" else msg.to_email, msg.subject, key)
    cache_key = (_scope_key(v), key, tuple(m["key"] for m in thread))
    cached = None if refresh else _thread_summaries.get(cache_key)
    if cached:
        return {**cached, "cached": True}
    _charge_trial(session, v, "searches")
    summary = _ai(session, email_ai.summarize_thread, _thread_for_ai(thread))
    result = {"summary": summary, "message_count": len(thread), "generated_at": _iso(datetime.now(timezone.utc))}
    _thread_summaries.set(cache_key, result)
    return {**result, "cached": False}


class SummaryBody(InboxFilters):
    refresh: bool = False


@router.post("/inbox/summary")
def summarize_inbox_view(body: SummaryBody, v: Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    f = _clean_filters(body)
    items, total = _list_unified(session, v, f, limit=40, offset=0)
    label = _view_label(f)
    if not items:
        return {"summary": None, "total": 0, "view": label, "cached": False,
                "message": "There are no emails in this view to summarize."}
    fingerprint = (total, items[0]["key"], items[0]["date"])
    cache_key = (_scope_key(v), f.model_dump_json(), fingerprint)
    cached = None if body.refresh else _view_summaries.get(cache_key)
    if cached:
        return {**cached, "cached": True}
    _charge_trial(session, v, "searches")
    summary = _ai(session, email_ai.summarize_view, label, [_compact(i) for i in items], total)
    result = {"summary": summary, "total": total, "view": label, "generated_at": _iso(datetime.now(timezone.utc)),
              "emails": {i["key"]: {"subject": i["subject"], "who": i.get("from_name") or i.get("from_address") or i.get("to")} for i in items}}
    _view_summaries.set(cache_key, result)
    return {**result, "cached": False}


def _compact(row: dict) -> dict:
    """List row -> the compact shape the AI prompts take."""
    ai = row.get("ai") or {}
    linked = None
    if row.get("client"):
        linked = f"client: {row['client']['name']}"
    elif row.get("lead"):
        linked = f"lead: {row['lead']['name']}"
    return {
        "key": row["key"],
        "direction": row["direction"],
        "date": row.get("date") or "",
        "from": f'{row.get("from_name") or ""} <{row.get("from_address")}>'.strip() if row["direction"] == "inbound" else "us",
        "to": row.get("to"),
        "subject": row.get("subject"),
        "category": ai.get("category"),
        "priority": ai.get("priority"),
        "needs_reply": ai.get("needs_reply"),
        "unread": row["direction"] == "inbound" and not row.get("is_read"),
        "status": row.get("status") if row["direction"] == "outbound" else None,
        "linked": linked,
        "summary": ai.get("summary") or row.get("snippet"),
        "excerpt": row.get("snippet"),
    }


class AssistantTurn(BaseModel):
    role: Literal["user", "assistant"] = "user"
    text: str = Field(default="", max_length=4000)


class AssistantBody(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    history: List[AssistantTurn] = Field(default_factory=list, max_length=20)


def _party_matches(model, pattern: str):
    """The email's other party matches `pattern`: its address/name, or the linked lead's / client's company."""
    linked = or_(
        model.lead_id.in_(select(Lead.id).where(Lead.company_name.ilike(pattern))),
        model.client_id.in_(select(ClientProfile.id).where(or_(ClientProfile.companyName.ilike(pattern),
                                                              ClientProfile.projectName.ilike(pattern)))),
    )
    if model is InboxMessage:
        return or_(InboxMessage.from_address.ilike(pattern), InboxMessage.from_name.ilike(pattern), linked)
    return or_(SentEmail.to_email.ilike(pattern), linked)


def _assistant_candidates(session: Session, v: Viewer, parsed: dict, strict: bool = True, limit: int = 150) -> list:
    """Hard-filtered candidates (newest first) for the assistant's relevance ranking."""
    inbound = parsed["direction"] != "outbound"
    outbound = parsed["direction"] != "inbound" and not (
        strict and (parsed["categories"] or parsed["needs_reply"] or parsed["priority"] or parsed["unread"])
    )
    # Bind tz-aware values: SQLModel's UTCDateTime rejects naive datetimes as parameters.
    start = end = None
    if strict and parsed["date_from"]:
        start = datetime.fromisoformat(parsed["date_from"]).replace(tzinfo=timezone.utc)
    if strict and parsed["date_to"]:
        end = datetime.fromisoformat(parsed["date_to"]).replace(tzinfo=timezone.utc) + timedelta(days=1)
    linked = parsed["linked"] if parsed["linked"] != "any" else None
    sender = f"%{parsed['sender']}%" if strict and parsed["sender"] else None

    pairs = []
    if inbound:
        stmt = _linked(_scope(select(InboxMessage), InboxMessage, v), InboxMessage, linked).options(*_INBOUND_LIST_DEFERS)
        if start:
            stmt = stmt.where(InboxMessage.received_at >= start)
        if end:
            stmt = stmt.where(InboxMessage.received_at < end)
        if strict:
            if parsed["categories"]:
                stmt = stmt.where(InboxMessage.ai_category.in_(parsed["categories"]))
            if parsed["needs_reply"]:
                stmt = stmt.where(NEEDS_REPLY)
            if parsed["priority"]:
                stmt = stmt.where(InboxMessage.ai_priority == parsed["priority"])
            if parsed["unread"]:
                stmt = stmt.where(InboxMessage.is_read == False)  # noqa: E712
            if sender:
                stmt = stmt.where(_party_matches(InboxMessage, sender))
        pairs += [("in", m) for m in session.exec(stmt.order_by(InboxMessage.received_at.desc()).limit(limit)).all()]
    if outbound:
        stmt = _linked(_sent_visible(_scope(_outbound_columns(), SentEmail, v)), SentEmail, linked)
        if start:
            stmt = stmt.where(SentEmail.sent_at >= start)
        if end:
            stmt = stmt.where(SentEmail.sent_at < end)
        if sender:
            stmt = stmt.where(_party_matches(SentEmail, sender))
        pairs += [("out", s) for s in session.exec(stmt.order_by(SentEmail.sent_at.desc()).limit(limit)).all()]
    pairs.sort(key=lambda kr: _naive_utc(kr[1].received_at if kr[0] == "in" else kr[1].sent_at), reverse=True)
    return _serialize(session, pairs[:limit])


def _describe_filters(parsed: dict) -> list:
    out = []
    if parsed["direction"] != "any":
        out.append("Received" if parsed["direction"] == "inbound" else "Sent")
    if parsed["date_from"] or parsed["date_to"]:
        out.append(f'{parsed["date_from"] or "…"} → {parsed["date_to"] or "today"}')
    out += [email_ai.CATEGORIES[c] for c in parsed["categories"]]
    if parsed["linked"] != "any":
        out.append({"lead": "Leads", "client": "Clients", "unlinked": "Unknown senders"}[parsed["linked"]])
    if parsed["needs_reply"]:
        out.append("Needs reply")
    if parsed["priority"]:
        out.append("High priority")
    if parsed["unread"]:
        out.append("Unread")
    if parsed["sender"]:
        out.append(f'Sender: {parsed["sender"]}')
    return out


@router.post("/inbox/assistant")
def inbox_assistant(body: AssistantBody, v: Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    question = body.question.strip()
    history = [t.model_dump() for t in body.history]
    today = datetime.now(timezone.utc).date().isoformat()
    _charge_trial(session, v, "searches")

    parsed = _ai(session, email_ai.parse_inbox_question, question, history, today)
    rows = _assistant_candidates(session, v, parsed, strict=True)
    relaxed = False
    if not rows:
        rows = _assistant_candidates(session, v, parsed, strict=False, limit=100)
        relaxed = True
    result = _ai(session, email_ai.answer_inbox_question, question, history, [_compact(r) for r in rows], today)

    by_key = {r["key"]: r for r in rows}
    ordered = [by_key[k] for k in result["keys"] if k in by_key]
    if parsed["sort"] in ("newest", "oldest"):
        ordered.sort(key=lambda r: r.get("date") or "", reverse=parsed["sort"] == "newest")
    return {
        "answer": result["answer"],
        "keys": [r["key"] for r in ordered],
        "items": ordered,
        "suggestions": result["suggestions"],
        "applied_filters": [] if relaxed else _describe_filters(parsed),
        "relaxed": relaxed,
        "considered": len(rows),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Sending (shared by inbox replies and the record Email tab)
# ─────────────────────────────────────────────────────────────────────────────
def sender_account(session: Session, user_id: Optional[int], tenant_id: Optional[int]):
    """The mailbox this user sends from: their own Email Integration (Email Agent → Settings), else the
    company mailbox in Settings → SMTP, else the server's env mailbox. Raises MailAccountError if none."""
    return company_mailer.resolve_account(session, user_id, tenant_id, allow_server_fallback=True)


def sender_status(session: Session, user_id: Optional[int], tenant_id: Optional[int]) -> dict:
    try:
        a = sender_account(session, user_id, tenant_id)
    except company_mailer.MailAccountError as e:
        return {"address": None, "configured": False, "source": None, "label": None, "message": str(e)}
    return {"address": a.email, "configured": True, "source": a.source, "label": company_mailer.SOURCE_LABELS.get(a.source)}


def _send_and_record(session: Session, v: Viewer, *, tenant_id: Optional[int], to: str, cc: Optional[str],
                     subject: str, body: str, lead_id: Optional[int], client_id: Optional[int], purpose: Optional[str],
                     source: str, in_reply_to: Optional[str] = None, references: Optional[str] = None,
                     reply_to_key: Optional[str] = None, log_conversation: bool = True) -> SentEmail:
    try:
        account = sender_account(session, v.user.id, tenant_id)
    except company_mailer.MailAccountError as e:
        raise HTTPException(status_code=503, detail=str(e))

    message_id = make_msgid(domain=account.email.split("@")[-1] if "@" in account.email else None)
    actor = v.user.name or v.user.email
    meta = {
        "source": source, "purpose": purpose, "sent_by_user_id": v.user.id, "sent_by_name": actor,
        "message_id": message_id, "in_reply_to": in_reply_to, "reply_to_key": reply_to_key, "cc": cc,
        "sent_from": account.email, "sent_from_source": account.source,
    }
    row = SentEmail(
        tenant_id=tenant_id, lead_id=lead_id, client_id=client_id, to_email=to, subject=subject[:500],
        english_body=body, manual=True, draft_json=json.dumps(meta), status="Sending",
        sent_at=datetime.now(timezone.utc),
    )
    session.add(row)
    session.commit()
    row_id = row.id
    _release(session)  # SMTP + the IMAP sent-copy can take many seconds

    try:
        company_mailer.send_via(
            account, to=to, subject=subject, body=body, tracking_id=row_id, message_id=message_id,
            extra_headers={"In-Reply-To": in_reply_to, "References": references, "Cc": cc},
        )
    except Exception as e:
        print(f"[Inbox send] SMTP send to {to} failed: {e}")
        session.delete(row)
        session.commit()
        raise HTTPException(status_code=502, detail=f"The mail server did not accept the email: {str(e)[:200]}")

    now = datetime.now(timezone.utc)
    row.status = "Sent"
    row.sent_at = now
    session.add(row)

    session.add(ActivityLog(
        tenant_id=tenant_id, userId=v.user.id, clientId=client_id, lead_id=lead_id,
        action=f"Email sent: {subject}"[:255], method="Email",
        content=f"{actor} emailed {to}", details=_clip(body, 500),
    ))
    if log_conversation and (lead_id or client_id):
        session.add(ConversationLog(
            tenant_id=tenant_id, client_id=client_id, lead_id=lead_id, title=subject[:500], type="email",
            description=body[:4000], author_id=v.user.id, author_name=actor,
        ))
    if client_id:
        cp = session.get(ClientProfile, client_id)
        if cp:
            cp.last_contact_date = now.date().isoformat()
            session.add(cp)
    if lead_id:
        lead = session.get(Lead, lead_id)
        if lead:
            lead.last_activity = f"Email sent: {subject}"[:500]
            if (lead.status or "New") in ("New", "Generated"):
                lead.status = "Contacted"  # same transition as /send-manual
            session.add(lead)
    session.commit()
    session.refresh(row)
    return row


def _check_message(subject: str, body: str):
    if not subject.strip():
        raise HTTPException(status_code=400, detail="Subject is required.")
    if not body.strip():
        raise HTTPException(status_code=400, detail="The email body is empty.")


class ReplyDraftBody(BaseModel):
    instructions: Optional[str] = Field(default=None, max_length=2000)
    tone: str = "professional"


class ReplyBody(BaseModel):
    to: Optional[str] = None
    cc: Optional[str] = None
    subject: str = Field(max_length=300)
    body: str = Field(max_length=20000)


def _company_name(session: Session, tenant_id: Optional[int]) -> str:
    # business_name only: Tenant.name is an internal label ("Default Tenant", "Acme - Jane") that
    # must never end up in a customer-facing signature.
    tenant = session.get(Tenant, tenant_id) if tenant_id else None
    return (tenant.business_name or "").strip() if tenant else ""


@router.post("/inbox/messages/{key}/reply-draft")
def draft_inbox_reply(key: str, body: ReplyDraftBody, v: Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    kind, msg = _load_message(session, v, key)
    thread = _thread(session, v, msg.from_address if kind == "in" else msg.to_email, msg.subject, key)
    context_text = ""
    if msg.lead_id or msg.client_id:
        rec_kind = "clients" if msg.client_id else "leads"
        rec = session.get(ClientProfile if msg.client_id else Lead, msg.client_id or msg.lead_id)
        if rec:
            ctx = _gather_context(session, rec_kind, rec, v)
            context_text = _context_text(session, rec_kind, rec, ctx, ComposerInclude(emails=False))
    _charge_trial(session, v, "emails")
    return _ai(
        session, email_ai.draft_reply, thread=_thread_for_ai(thread), instructions=body.instructions or "", tone=body.tone,
        sender_name=v.user.name or "", company=_company_name(session, msg.tenant_id), context_text=context_text,
    )


@router.post("/inbox/messages/{key}/reply")
def send_inbox_reply(key: str, body: ReplyBody, v: Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    kind, msg = _load_message(session, v, key)
    _check_message(body.subject, body.body)
    to = _address_list(body.to or (msg.from_address if kind == "in" else msg.to_email), "recipient")
    cc = _address_list(body.cc, "cc")

    in_reply_to = references = None
    if kind == "in" and msg.message_id.startswith("<"):
        in_reply_to = msg.message_id
        chain = (msg.references_header or "").split() + [msg.message_id]
        references = " ".join(chain[-10:])
    elif kind == "out":
        prior = _sent_meta(msg).get("message_id")
        if prior:
            in_reply_to = references = prior

    sent = _send_and_record(
        session, v, tenant_id=msg.tenant_id, to=to, cc=cc, subject=body.subject.strip(), body=body.body,
        lead_id=msg.lead_id, client_id=msg.client_id, purpose="reply", source="inbox_reply",
        in_reply_to=in_reply_to, references=references, reply_to_key=key,
    )
    if kind == "in":
        msg.replied_at = datetime.now(timezone.utc)
        msg.is_read = True
        session.add(msg)
        session.commit()
    return {"ok": True, "item": _serialize(session, [("out", sent)])[0]}


# ─────────────────────────────────────────────────────────────────────────────
# Sync status
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/inbox/status")
def inbox_status(v: Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    status = inbox_sync.get_sync_status()
    mailboxes = []
    for cfg in inbox_sync.mailboxes_for_tenant(session, v.tenant_id):
        if not v.full_access and cfg.user_id != v.user.id:
            continue  # a salesperson sees the sync state of their own mailbox only
        s = status.get(cfg.address, {})
        mailboxes.append({
            "address": cfg.address, "own_settings": cfg.tenant_owned,
            "last_sync_at": s.get("last_sync_at"), "last_error": s.get("last_error"),
        })
    return {
        "mailboxes": mailboxes,
        "sender": sender_status(session, v.user.id, v.tenant_id),
        "ai_enabled": bool(os.getenv("OPENAI_API_KEY")),
        "sync_interval_seconds": int(os.getenv("INBOX_SYNC_INTERVAL_SECONDS", "120")),
        "role": v.role,
        "full_access": v.full_access,
    }


@router.post("/inbox/sync")
def inbox_sync_now(v: Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    tenant_id = v.tenant_id
    _release(session)  # the sync talks to IMAP for a while; don't hold this request's transaction meanwhile
    results = inbox_sync.run_sync_cycle(tenant_id=tenant_id, classify=False, max_new=60)
    # AI triage of what just arrived runs in the background so the button returns quickly.
    if os.getenv("OPENAI_API_KEY"):
        threading.Thread(target=lambda: _safe_classify(), daemon=True, name="inbox-classify").start()
    return {"ok": True, "results": results}


def _safe_classify():
    try:
        email_ai.classify_pending()
    except Exception as e:
        print(f"[Inbox] background triage failed: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Record Email tab: /{leads|clients}/{id}/email-composer/*
# ─────────────────────────────────────────────────────────────────────────────
RecordKind = Literal["leads", "clients"]


def _record(session: Session, v: Viewer, kind: str, record_id: int):
    model = Lead if kind == "leads" else ClientProfile
    rec = session.get(model, record_id)
    if not rec or (v.tenant_id is not None and rec.tenant_id != v.tenant_id):
        raise HTTPException(status_code=404, detail="Lead not found" if kind == "leads" else "Client not found")
    owner = rec.owner_id if kind == "leads" else rec.assignedEmployeeId
    if not (v.full_access or owner == v.user.id):
        raise HTTPException(status_code=403, detail="Only an admin or the salesperson assigned to this record can email it.")
    return rec


def _record_label(kind: str, rec) -> str:
    return (rec.company_name or f"Lead #{rec.id}") if kind == "leads" else _client_label(rec)


def _record_links(kind: str, rec) -> dict:
    return {"lead_id": rec.id, "client_id": None} if kind == "leads" else {"lead_id": None, "client_id": rec.id}


def _research(session: Session, kind: str, rec):
    col = ClientResearch.lead_id if kind == "leads" else ClientResearch.client_id
    return session.exec(select(ClientResearch).where(col == rec.id)).first()


def _decision_makers(research) -> list:
    if not research or not research.key_decision_makers:
        return []
    try:
        people = json.loads(research.key_decision_makers)
    except (TypeError, ValueError):
        return []
    return [p for p in people if isinstance(p, dict)] if isinstance(people, list) else []


def _recipients(session: Session, kind: str, rec) -> list:
    out, seen = [], set()

    def add(email, name, source):
        if not isinstance(email, str):
            return
        email = email.strip()
        if not _valid_email(email) or email.lower() in seen:
            return
        seen.add(email.lower())
        out.append({"email": email, "name": str(name or "").strip() or None, "source": source})

    if kind == "leads":
        add(rec.email, None, "Lead email")
        contacts = session.exec(select(Contact).where(Contact.lead_id == rec.id).limit(20)).all()
    else:
        user = session.get(User, rec.userId) if rec.userId else None
        if user:
            add(user.email, user.name, "Client account")
        cf = rec.customFields if isinstance(rec.customFields, dict) else {}
        add(cf.get("email"), rec.contact_person, "Client record")
        sheet = cf.get("sheet_data") if isinstance(cf.get("sheet_data"), dict) else {}
        for k, val in sheet.items():
            if "mail" in str(k).lower():
                add(val, rec.contact_person, f"Imported “{k}”")
        for lead in session.exec(select(Lead).where(Lead.converted_client_id == rec.id).limit(5)).all():
            add(lead.email, None, "Original lead")
        contacts = session.exec(select(Contact).where(Contact.client_id == rec.id).limit(20)).all()
    for c in contacts:
        name = c.full_name or " ".join(x for x in [c.first_name, c.last_name] if x)
        add(c.email, name, c.designation or "Contact")
    for p in _decision_makers(_research(session, kind, rec)):
        add(p.get("email"), p.get("name"), p.get("role") or "Decision maker (AI research)")
    return out[:15]


def _record_messages(session: Session, v: Viewer, kind: str, rec, limit: int) -> list:
    """Every email to/from this record (a client also gets its converted leads' mail), newest first."""
    lead_ids = [rec.id] if kind == "leads" else [
        lid for lid in session.exec(select(Lead.id).where(Lead.converted_client_id == rec.id)).all()
    ]
    in_cond = [InboxMessage.lead_id.in_(lead_ids)] if lead_ids else []
    out_cond = [SentEmail.lead_id.in_(lead_ids)] if lead_ids else []
    if kind == "clients":
        in_cond.append(InboxMessage.client_id == rec.id)
        out_cond.append(SentEmail.client_id == rec.id)
    ins = session.exec(
        _tenant(select(InboxMessage), InboxMessage, v).where(or_(*in_cond)).options(*_INBOUND_LIST_DEFERS)
        .order_by(InboxMessage.received_at.desc()).limit(limit)
    ).all()
    outs = session.exec(
        _sent_visible(_tenant(_outbound_columns(), SentEmail, v)).where(or_(*out_cond))
        .order_by(SentEmail.sent_at.desc()).limit(limit)
    ).all()
    pairs = [("in", m) for m in ins] + [("out", s) for s in outs]
    pairs.sort(key=lambda kr: _naive_utc(kr[1].received_at if kr[0] == "in" else kr[1].sent_at), reverse=True)
    return _serialize(session, pairs[:limit])


def _gather_context(session: Session, kind: str, rec, v: Optional["Viewer"] = None) -> dict:
    is_lead = kind == "leads"
    by_record = (lambda model, attr="lead_id": getattr(model, attr) == rec.id) if is_lead else \
                (lambda model, attr="client_id": getattr(model, attr) == rec.id)

    conversations = [{
        "key": f"conv-{c.id}", "type": c.type, "title": c.title, "description": _clip(c.description, 600),
        "date": _iso(c.created_at), "author": c.author_name,
    } for c in session.exec(select(ConversationLog).where(by_record(ConversationLog)).order_by(ConversationLog.created_at.desc()).limit(8)).all()]

    notes = [{"key": f"note-{n.id}", "content": _clip(n.content, 600), "date": _iso(n.created_at), "author": n.author_name}
             for n in session.exec(select(ClientNote).where(by_record(ClientNote)).order_by(ClientNote.created_at.desc()).limit(8)).all()]
    if is_lead:
        notes += [{"key": f"leadnote-{n.id}", "content": _clip(n.content, 600), "date": _iso(n.created_at), "author": n.author_name}
                  for n in session.exec(select(LeadNote).where(LeadNote.lead_id == rec.id).order_by(LeadNote.created_at.desc()).limit(8)).all()]
        notes.sort(key=lambda n: n["date"] or "", reverse=True)
        notes = notes[:8]

    followups = []
    # Tasks: status is a Postgres ENUM (taskstatus), so filter open/closed in Python — a SQL
    # comparison against a label the enum doesn't have raises instead of matching nothing.
    for t in session.exec(select(Task).where(by_record(Task)).order_by(Task.created_at.desc()).limit(25)).all():
        if str(t.status or "").lower().replace("_", "") in _DONE_TASK_STATES:
            continue
        followups.append({"key": f"task-{t.id}", "source": "Task", "title": t.title, "detail": _clip(t.description, 300),
                          "due": t.due_date, "status": t.status, "date": _iso(t.created_at)})
    if is_lead:
        lines = [ln.strip() for ln in (rec.notes or "").splitlines() if ln.strip()]
        for i, ln in enumerate([ln for ln in lines if _FOLLOWUP_RE.search(ln)][-5:]):
            followups.append({"key": f"leadnotes-{i}", "source": "Follow-up note", "title": _clip(ln, 160), "detail": _clip(ln, 600)})
    else:
        for r in session.exec(select(Remark).where(Remark.clientId == rec.id).order_by(Remark.createdAt.desc()).limit(5)).all():
            followups.append({"key": f"remark-{r.id}", "source": "Follow-up / remark", "title": _clip(r.content, 160),
                              "detail": _clip(r.content, 600), "date": _iso(r.createdAt)})
        if rec.next_followup_date:
            followups.insert(0, {"key": "next-followup", "source": "Follow-up date", "title": "Next follow-up is scheduled",
                                 "due": rec.next_followup_date})
        if rec.nextMilestone:
            followups.append({"key": "milestone", "source": "Milestone", "title": rec.nextMilestone, "due": rec.nextMilestoneDate})
    for n in notes:
        if _FOLLOWUP_RE.search(n["content"] or "") and len(followups) < 14:
            followups.append({"key": n["key"], "source": "Note", "title": _clip(n["content"], 160), "detail": n["content"], "date": n["date"]})

    def money(amount, currency):
        if amount is None:
            return None
        return f"{currency or ''} {amount:,.2f}".strip()

    deals = []
    if not is_lead:
        deals += [{"key": f"deal-{d.id}", "kind": "Deal", "title": d.title, "status": d.stage, "amount": money(d.value, None),
                   "detail": f"expected close {d.expected_close_date}" if d.expected_close_date else None, "date": _iso(d.updated_at or d.created_at)}
                  for d in session.exec(select(Deal).where(Deal.client_id == rec.id).order_by(Deal.updated_at.desc()).limit(5)).all()]
    deals += [{"key": f"quote-{q.id}", "kind": "Quote", "title": " ".join(x for x in [q.quote_number, q.title] if x), "status": q.status,
               "amount": money(q.grand_total, q.currency), "detail": f"valid until {q.valid_until}" if q.valid_until else None,
               "date": _iso(q.updated_at or q.created_at)}
              for q in session.exec(select(CRMQuote).where(by_record(CRMQuote)).order_by(CRMQuote.updated_at.desc()).limit(5)).all()]
    deals += [{"key": f"proposal-{p.id}", "kind": "Proposal", "title": p.title, "status": p.status,
               "amount": money(p.total_value, p.currency), "detail": f"valid until {p.valid_until}" if p.valid_until else None,
               "date": _iso(p.updated_at or p.created_at)}
              for p in session.exec(select(Proposal).where(by_record(Proposal)).order_by(Proposal.updated_at.desc()).limit(5)).all()]
    deals += [{"key": f"order-{o.id}", "kind": "Sales order", "title": o.order_number or f"Order #{o.id}", "status": o.status,
               "amount": money(o.grand_total, o.currency), "detail": f"delivery {o.delivery_date}" if o.delivery_date else None,
               "date": _iso(o.updated_at or o.created_at)}
              for o in session.exec(select(SalesOrder).where(by_record(SalesOrder)).order_by(SalesOrder.updated_at.desc()).limit(3)).all()]
    if not is_lead:
        deals += [{"key": f"invoice-{i.id}", "kind": "Invoice", "title": i.invoice_number, "status": i.status,
                   "amount": money(i.total, i.currency), "detail": f"due {i.due_date}" if i.due_date else None,
                   "date": _iso(i.updated_at or i.created_at)}
                  for i in session.exec(select(Invoice).where(Invoice.client_id == rec.id).order_by(Invoice.updated_at.desc()).limit(3)).all()]
    deals.sort(key=lambda d: d["date"] or "", reverse=True)

    meetings_stmt = select(Meeting).where(by_record(Meeting))
    if v is not None and not v.full_access:
        meetings_stmt = meetings_stmt.where(or_(Meeting.host_id == v.user.id, Meeting.created_by == v.user.id))
    meetings = [{
        "key": f"meeting-{m.id}", "title": m.title, "type": m.meeting_type, "status": m.status,
        "date": _iso(m.scheduled_at or m.created_at), "outcome": _clip(m.outcome or m.notes, 300),
    } for m in session.exec(meetings_stmt.order_by(Meeting.created_at.desc()).limit(5)).all()]

    research = _research(session, kind, rec)
    research_info = None
    if research and (research.company_overview or research.pain_points):
        research_info = {"overview": _clip(research.company_overview, 900), "pain_points": _clip(research.pain_points, 600)}

    return {"conversations": conversations, "followups": followups[:14], "deals": deals[:10], "notes": notes,
            "meetings": meetings, "research": research_info}


def _suggested_purpose(ctx: dict, emails: list) -> str:
    if any(f["source"] in ("Task", "Follow-up date", "Follow-up note", "Follow-up / remark") for f in ctx["followups"]):
        return "follow_up"
    open_deal_states = ("closed", "won", "lost", "paid", "cancelled", "rejected", "fulfilled", "completed", "accepted")
    if any(not any(s in str(d.get("status") or "").lower() for s in open_deal_states) for d in ctx["deals"]):
        return "deal_update"
    if ctx["conversations"]:
        latest = ctx["conversations"][0]["date"]
        if latest and datetime.fromisoformat(latest) > datetime.now(timezone.utc) - timedelta(days=7):
            return "conversation_recap"
    if ctx["conversations"] or emails or ctx["notes"]:
        return "check_in"
    return "intro"


class ComposerInclude(BaseModel):
    conversations: bool = True
    followups: bool = True
    deals: bool = True
    notes: bool = True
    meetings: bool = True
    emails: bool = True
    research: bool = True


def _context_text(session: Session, kind: str, rec, ctx: dict, include: ComposerInclude,
                  emails: Optional[list] = None, focus: Optional[str] = None) -> str:
    today = datetime.now(timezone.utc).date().isoformat()
    if kind == "leads":
        head = f'Lead "{_record_label(kind, rec)}" — status {rec.status or "unknown"}'
        extra = [f"industry {rec.industry}" if rec.industry else None, f"website {rec.website}" if rec.website else None]
    else:
        head = f'Client "{_record_label(kind, rec)}" — status {rec.status or "unknown"}'
        extra = [f"industry {rec.industry}" if rec.industry else None, f"website {rec.websiteUrl}" if rec.websiteUrl else None,
                 f"contact person {rec.contact_person}" if rec.contact_person else None,
                 f"deal value {rec.deal_value:,.0f}" if rec.deal_value else None,
                 f"last contact {rec.last_contact_date}" if rec.last_contact_date else None]
    lines = [f"Today: {today}", head + (" (" + ", ".join(x for x in extra if x) + ")" if any(extra) else "")]

    def section(title, items, fmt):
        if items:
            lines.append(f"\n{title}:")
            lines.extend("- " + fmt(i) for i in items)

    def d(value):
        return (value or "")[:10]

    if include.followups:
        section("Open follow-ups and tasks", ctx["followups"], lambda f: " — ".join(x for x in [
            f'{f["source"]}: {f["title"]}', f'due {f["due"]}' if f.get("due") else None,
            f'status {f["status"]}' if f.get("status") else None,
            _clip(f.get("detail"), 300) if f.get("detail") and f.get("detail") != f.get("title") else None] if x))
    if include.deals:
        section("Deals, quotes, proposals, orders and invoices", ctx["deals"], lambda x: " — ".join(y for y in [
            f'{x["kind"]} "{x["title"]}"', f'status {x["status"]}' if x.get("status") else None, x.get("amount"),
            x.get("detail"), f'updated {d(x.get("date"))}' if x.get("date") else None] if y))
    if include.conversations:
        section("Logged conversations (newest first)", ctx["conversations"], lambda c: (
            f'{d(c["date"])} [{c["type"]}] "{c["title"]}"' + (f": {c['description']}" if c.get("description") else "")
            + (f' (by {c["author"]})' if c.get("author") else "")))
    if include.meetings:
        section("Meetings", ctx["meetings"], lambda m: " — ".join(x for x in [
            f'{d(m["date"])} {m["type"] or "Meeting"} "{m["title"]}"', m.get("status"), m.get("outcome")] if x))
    if include.notes:
        section("Notes", ctx["notes"], lambda n: f'{d(n["date"])}: {n["content"]}')
    if include.emails and emails:
        lines.append("\nRecent emails (newest first):")
        for e in emails[:6]:
            if e["direction"] == "inbound":
                lines.append(f'- {d(e["date"])} received from {e.get("from_address")}: "{e["subject"]}" '
                             f'<email>{_clip((e.get("ai") or {}).get("summary") or e.get("snippet"), 400)}</email>')
            else:
                lines.append(f'- {d(e["date"])} we sent to {e.get("to")}: "{e["subject"]}" ({e.get("status") or "Sent"})'
                             f' — {_clip(e.get("snippet"), 200)}')
    if include.research and ctx.get("research"):
        r = ctx["research"]
        lines.append("\nCompany research (AI-gathered, may be imperfect):")
        if r.get("overview"):
            lines.append(f"- Overview: {r['overview']}")
        if r.get("pain_points"):
            lines.append(f"- Pain points / ICP: {r['pain_points']}")

    if focus:
        all_items = ctx["followups"] + ctx["deals"] + ctx["conversations"] + ctx["meetings"] + ctx["notes"]
        item = next((i for i in all_items if i.get("key") == focus), None)
        if item:
            desc = " — ".join(str(item.get(k)) for k in ("source", "kind", "type", "title", "status", "amount", "due", "detail", "description", "content", "outcome") if item.get(k))
            lines.append(f"\nFOCUS THIS EMAIL ON: {desc}")
    return "\n".join(lines)[:12000]


@router.get("/{kind}/{record_id}/email-composer/context")
def composer_context(kind: RecordKind, record_id: int, v: Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    rec = _record(session, v, kind, record_id)
    ctx = _gather_context(session, kind, rec, v)
    emails = _record_messages(session, v, kind, rec, limit=6)
    owner_id = rec.owner_id if kind == "leads" else rec.assignedEmployeeId
    owner = session.get(User, owner_id) if owner_id else None
    return {
        "record": {"type": "lead" if kind == "leads" else "client", "id": rec.id, "name": _record_label(kind, rec),
                   "status": rec.status, "owner": {"id": owner.id, "name": owner.name or owner.email} if owner else None},
        "recipients": _recipients(session, kind, rec),
        "sender": {**sender_status(session, v.user.id, rec.tenant_id), "user_name": v.user.name or v.user.email},
        "context": {**ctx, "emails": emails},
        "suggested_purpose": _suggested_purpose(ctx, emails),
        "purposes": list(email_ai.PURPOSES),
        "tones": list(email_ai.TONES),
        "ai_enabled": bool(os.getenv("OPENAI_API_KEY")),
    }


class ComposerDraftBody(BaseModel):
    purpose: str = "follow_up"
    tone: str = "professional"
    instructions: Optional[str] = Field(default=None, max_length=2000)
    to: Optional[str] = None
    include: ComposerInclude = Field(default_factory=ComposerInclude)
    focus_key: Optional[str] = Field(default=None, max_length=60)
    reply_to_key: Optional[str] = Field(default=None, max_length=30)


@router.post("/{kind}/{record_id}/email-composer/draft")
def composer_draft(kind: RecordKind, record_id: int, body: ComposerDraftBody,
                   v: Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    rec = _record(session, v, kind, record_id)
    purpose = body.purpose if body.purpose in email_ai.PURPOSES else "custom"
    if purpose == "custom" and not (body.instructions or "").strip():
        raise HTTPException(status_code=400, detail="Describe the email you want in the instructions.")

    reply_to = None
    if body.reply_to_key:
        kind_key, msg = _load_message(session, v, body.reply_to_key)
        if kind_key == "in":
            reply_to = {"from": f"{msg.from_name or ''} <{msg.from_address}>", "subject": msg.subject,
                        "body": msg.body_text or msg.body_text_full or msg.snippet}

    ctx = _gather_context(session, kind, rec, v)
    emails = _record_messages(session, v, kind, rec, limit=6) if body.include.emails else []
    context_text = _context_text(session, kind, rec, ctx, body.include, emails, body.focus_key)
    recipient = next((r for r in _recipients(session, kind, rec) if body.to and r["email"].lower() == body.to.strip().lower()), None)
    recipient_name = (recipient or {}).get("name") or (rec.contact_person if kind == "clients" else "") or ""
    if not recipient_name and body.to:
        # The name they sign their own emails with, e.g. "Vikarn Jha" from their last reply.
        recipient_name = session.exec(
            _tenant(select(InboxMessage.from_name), InboxMessage, v)
            .where(func.lower(InboxMessage.from_address) == body.to.strip().lower(), InboxMessage.from_name.is_not(None))
            .order_by(InboxMessage.received_at.desc()).limit(1)
        ).first() or ""
    _charge_trial(session, v, "emails")
    draft = _ai(
        session, email_ai.draft_record_email, purpose=purpose, tone=body.tone, instructions=(body.instructions or "").strip(),
        record_label=_record_label(kind, rec), context_text=context_text, recipient_name=recipient_name,
        sender_name=v.user.name or "", company=_company_name(session, rec.tenant_id), reply_to=reply_to,
    )
    return {**draft, "purpose": purpose}


class ComposerSendBody(BaseModel):
    to: str = Field(max_length=1000)
    cc: Optional[str] = Field(default=None, max_length=1000)
    subject: str = Field(max_length=300)
    body: str = Field(max_length=20000)
    purpose: Optional[str] = None
    log_conversation: bool = True
    reply_to_key: Optional[str] = Field(default=None, max_length=30)


@router.post("/{kind}/{record_id}/email-composer/send")
def composer_send(kind: RecordKind, record_id: int, body: ComposerSendBody,
                  v: Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    rec = _record(session, v, kind, record_id)
    _check_message(body.subject, body.body)
    to = _address_list(body.to, "recipient")
    cc = _address_list(body.cc, "cc")

    in_reply_to = references = None
    reply_msg = None
    if body.reply_to_key:
        kind_key, reply_msg = _load_message(session, v, body.reply_to_key)
        if kind_key == "in" and reply_msg.message_id.startswith("<"):
            in_reply_to = reply_msg.message_id
            references = " ".join(((reply_msg.references_header or "").split() + [reply_msg.message_id])[-10:])
        elif kind_key != "in":
            reply_msg = None

    sent = _send_and_record(
        session, v, tenant_id=rec.tenant_id, to=to, cc=cc, subject=body.subject.strip(), body=body.body,
        purpose=body.purpose, source="email_composer", in_reply_to=in_reply_to, references=references,
        reply_to_key=body.reply_to_key, log_conversation=body.log_conversation, **_record_links(kind, rec),
    )
    if reply_msg is not None:
        reply_msg.replied_at = datetime.now(timezone.utc)
        reply_msg.is_read = True
        session.add(reply_msg)
        session.commit()
    return {"ok": True, "item": _serialize(session, [("out", sent)])[0], "message": f"Email sent to {to}."}


@router.get("/{kind}/{record_id}/email-composer/history")
def composer_history(kind: RecordKind, record_id: int, limit: int = Query(50, ge=1, le=200),
                     v: Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    rec = _record(session, v, kind, record_id)
    items = _record_messages(session, v, kind, rec, limit)
    sent = [i for i in items if i["direction"] == "outbound"]
    return {
        "items": items,
        "stats": {
            "sent": len(sent),
            "opened": sum(1 for i in sent if (i.get("open_count") or 0) > 0 or i.get("status") in ("Opened", "Replied")),
            "replied": sum(1 for i in sent if i.get("status") == "Replied" or i.get("reply_count")),
            "received": sum(1 for i in items if i["direction"] == "inbound"),
        },
    }
