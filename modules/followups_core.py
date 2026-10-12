"""
Follow-up engine shared by routers/followups.py and the background scheduler.

Background loop (start_followup_scheduler_thread, every
FOLLOWUP_SCHEDULER_INTERVAL_SECONDS, default 60s):
  1. reminders   — Pending follow-ups reminder_minutes before due_at get one in-app
                   notification + one reminder email to the assigned salesperson (owner_id).
                   routers/follow_ups.py's reminder worker reads the same table and claims the
                   same reminder_sent_at column, so each follow-up is reminded once; that worker
                   also sends the "overdue" notice
  2. auto-send   — Pending follow-ups marked auto_send send their prepared email to the
                   contact when due, from the company's configured mailbox
  3. AI scan     — new notes, conversation logs, remarks and linked inbound emails are read
                   once each; when one implies a follow-up ("they'll discuss internally and
                   respond next week") a dated follow-up is created on that lead/client
  4. campaigns   — resumes Excel email campaigns interrupted by a restart

Every "do this once" step claims its row with a conditional UPDATE (or a unique insert)
before acting, so several app instances can run the loop without double reminders or
double sends. Background threads run without a request, so the tenant listener in
main.py is inactive here: every query filters tenant_id itself and every new row gets
tenant_id explicitly.
"""
import os
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, or_, update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

import database
from database import (
    ActivityLog, ClientNote, ClientProfile, Contact, ConversationLog, ConversationReply, FollowUp,
    FollowUpNoteScan, InboxMessage, Lead, LeadNote, Notification, Remark, SentEmail, User,
)

OPEN = "Pending"
DONE = "Completed"
CANCELLED = "Cancelled"
STATUSES = (OPEN, DONE, CANCELLED)
# /follow-ups (routers/follow_ups.py) can also set these; they are still open.
OPEN_STATUSES = (OPEN, "In Progress", "Overdue")

# follow_ups stores the /follow-ups spellings; the /followups API speaks lower case.
CHANNEL_VALUES = {"email": "Email", "call": "Call", "meeting": "Meeting", "whatsapp": "WhatsApp", "other": "Other"}
PRIORITY_VALUES = {"low": "Low", "medium": "Medium", "high": "High", "urgent": "Urgent"}
DEFAULT_REMINDER_MINUTES = 60


def db_channel(value: Optional[str]) -> str:
    return CHANNEL_VALUES.get((value or "").strip().lower(), "Email")


def db_priority(value: Optional[str]) -> str:
    return PRIORITY_VALUES.get((value or "").strip().lower(), "Medium")


def remind_time(fu) -> Optional[datetime]:
    """When the reminder is due: reminder_minutes before due_at."""
    due = as_utc(fu.due_at)
    if due is None:
        return None
    return due - timedelta(minutes=max(0, fu.reminder_minutes or 0))


def minutes_before(due_at: datetime, remind_at: Optional[datetime]) -> int:
    """reminder_minutes for an absolute reminder time (never after due_at)."""
    if remind_at is None:
        return DEFAULT_REMINDER_MINUTES
    return max(0, int((as_utc(due_at) - as_utc(remind_at)).total_seconds() // 60))


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def default_tz_offset_minutes() -> int:
    """Minutes EAST of UTC used when a date has no time (AI-created follow-ups). Default IST (+5:30)."""
    try:
        return int(os.getenv("FOLLOWUP_DEFAULT_TZ_OFFSET_MINUTES", "330"))
    except ValueError:
        return 330


def at_local_hour(d: date, east_offset_minutes: Optional[int] = None, hour: Optional[int] = None) -> datetime:
    """`d` at the default follow-up hour in a fixed UTC offset, as aware UTC."""
    offset = default_tz_offset_minutes() if east_offset_minutes is None else east_offset_minutes
    hour = int(os.getenv("FOLLOWUP_DEFAULT_HOUR", "10")) if hour is None else hour
    local = datetime(d.year, d.month, d.day, hour, 0, tzinfo=timezone(timedelta(minutes=offset)))
    return local.astimezone(timezone.utc)


def frontend_url() -> str:
    return (os.getenv("FRONTEND_URL") or "https://app.scmhub.com").rstrip("/")  # main.py's FRONTEND_URL default


def record_path(lead_id: Optional[int], client_id: Optional[int], tab: str = "followups") -> str:
    if client_id:
        return f"/admin/clients/{client_id}?tab={tab}"
    if lead_id:
        return f"/leads/{lead_id}?tab={tab}"
    return "/follow-ups?tab=email"


# ── Records ──────────────────────────────────────────────────────────────────
def client_label(cp: ClientProfile) -> str:
    sd = (cp.customFields or {}).get("sheet_data") or {} if isinstance(cp.customFields, dict) else {}
    return cp.companyName or cp.projectName or sd.get("Client Name") or cp.websiteUrl or f"Client #{cp.id}"


def record_info(session: Session, lead_id: Optional[int], client_id: Optional[int]) -> dict:
    """Label, owner and best contact for a lead / client (empty dict when neither exists)."""
    if client_id:
        cp = session.get(ClientProfile, client_id)
        if cp:
            cf = cp.customFields if isinstance(cp.customFields, dict) else {}
            user = session.get(User, cp.userId) if cp.userId else None
            contact = session.exec(select(Contact).where(Contact.client_id == cp.id, Contact.email.is_not(None))
                                   .execution_options(skip_tenant=True).limit(1)).first()
            return {
                "kind": "client", "id": cp.id, "tenant_id": cp.tenant_id, "label": client_label(cp),
                "owner_id": cp.assignedEmployeeId, "status": cp.status,
                "contact_name": cp.contact_person or (contact.full_name or contact.first_name if contact else None)
                                or (user.name if user else None),
                "contact_email": (user.email if user else None) or cf.get("email") or (contact.email if contact else None),
            }
    if lead_id:
        lead = session.get(Lead, lead_id)
        if lead:
            contact = session.exec(select(Contact).where(Contact.lead_id == lead.id)
                                   .execution_options(skip_tenant=True).limit(1)).first()
            name = (contact.full_name or " ".join(x for x in [contact.first_name, contact.last_name] if x)) if contact else None
            return {
                "kind": "lead", "id": lead.id, "tenant_id": lead.tenant_id, "label": lead.company_name or f"Lead #{lead.id}",
                "owner_id": lead.owner_id, "status": lead.status,
                "contact_name": name, "contact_email": lead.email or (contact.email if contact else None),
            }
    return {}


def log_activity(session: Session, fu: FollowUp, action: str, details: str = "", user_id: Optional[int] = None):
    if not (fu.lead_id or fu.client_id):
        return
    session.add(ActivityLog(
        tenant_id=fu.tenant_id, userId=user_id, clientId=fu.client_id, lead_id=fu.lead_id,
        action=action[:255], method="Follow-up", content=fu.title[:500], details=(details or "")[:1000],
    ))


def notify(session: Session, user_id: Optional[int], tenant_id: Optional[int], title: str, message: str, link: str):
    if not user_id:
        return
    # notifications.type is a Postgres ENUM in production; "info" is a value every existing caller uses.
    session.add(Notification(tenant_id=tenant_id, user_id=user_id, title=title[:255], message=message,
                             type="info", link=link))


def find_duplicate(session: Session, *, tenant_id, lead_id, client_id, contact_email, due_at: datetime,
                   window_days: int = 3) -> Optional[FollowUp]:
    """An open follow-up on the same record due within ±window_days of due_at."""
    if not (lead_id or client_id or contact_email):
        return None
    stmt = select(FollowUp).where(
        FollowUp.status.in_(OPEN_STATUSES),
        FollowUp.due_at >= due_at - timedelta(days=window_days),
        FollowUp.due_at <= due_at + timedelta(days=window_days),
    ).execution_options(skip_tenant=True)
    if tenant_id is not None:
        stmt = stmt.where(FollowUp.tenant_id == tenant_id)
    if client_id:
        stmt = stmt.where(FollowUp.client_id == client_id)
    elif lead_id:
        stmt = stmt.where(FollowUp.lead_id == lead_id)
    else:
        stmt = stmt.where(func.lower(FollowUp.contact_email) == contact_email.strip().lower())
    return session.exec(stmt.order_by(FollowUp.due_at)).first()


def mark_email_sent(session: Session, fu: FollowUp, sent: SentEmail, *, actor_id: Optional[int], actor_name: str,
                    complete: bool, outcome: Optional[str] = None):
    """Bookkeeping after a follow-up email went out: history entries + follow-up state."""
    now = utcnow()
    fu.email_sent_at = now
    fu.last_email_at = now
    fu.sent_email_id = sent.id
    fu.email_subject = sent.subject
    fu.email_body = sent.english_body
    fu.last_error = None
    if complete:
        fu.status = DONE
        fu.completed_at = now
        fu.completed_by = actor_id
        fu.completion_note = outcome or f"Follow-up email sent to {sent.to_email}."
    fu.updated_at = now
    session.add(fu)
    if fu.lead_id or fu.client_id:
        session.add(ConversationLog(
            tenant_id=fu.tenant_id, client_id=fu.client_id, lead_id=fu.lead_id, title=(sent.subject or "")[:500],
            type="email", description=(sent.english_body or "")[:4000], author_id=actor_id, author_name=actor_name,
        ))
    log_activity(session, fu, f"Follow-up email sent: {sent.subject}", f"To {sent.to_email}", actor_id)
    if fu.client_id:
        cp = session.get(ClientProfile, fu.client_id)
        if cp:
            cp.last_contact_date = now.date().isoformat()
            session.add(cp)
    if fu.lead_id:
        lead = session.get(Lead, fu.lead_id)
        if lead:
            lead.last_activity = f"Follow-up email sent: {sent.subject}"[:500]
            if (lead.status or "New") in ("New", "Generated"):
                lead.status = "Contacted"
            session.add(lead)


# ── 1. Reminders ─────────────────────────────────────────────────────────────
def _claim(session: Session, fu_id: int, column, now: datetime) -> bool:
    """Atomically set a NULL timestamp column; True only for the one caller that wins."""
    result = session.execute(
        update(FollowUp).where(FollowUp.id == fu_id, column.is_(None), FollowUp.status == OPEN)
        .values({column.key: now}).execution_options(skip_tenant=True)
    )
    session.commit()
    return result.rowcount == 1


def _fmt_local(dt: Optional[datetime]) -> str:
    if dt is None:
        return "(no date)"
    offset = default_tz_offset_minutes()
    local = as_utc(dt).astimezone(timezone(timedelta(minutes=offset)))
    sign = "+" if offset >= 0 else "-"
    return local.strftime("%a %d %b %Y, %H:%M") + f" (UTC{sign}{abs(offset) // 60:02d}:{abs(offset) % 60:02d})"


def reminder_email(fu: FollowUp, user: User, info: dict) -> tuple:
    who = " · ".join(x for x in [fu.contact_name, fu.company_name or info.get("label"), fu.contact_email] if x)
    lines = [f"Hi {(user.name or '').split()[0] if user.name else 'there'},", "",
             f"Your follow-up is due: {fu.title}", ""]
    if who:
        lines.append(f"With: {who}")
    lines += [f"Due: {_fmt_local(fu.due_at)}", f"Channel: {fu.channel}"]
    if fu.notes:
        lines += ["", "Context from previous notes:", fu.notes[:1500]]
    if fu.auto_send and fu.email_body and not fu.email_sent_at:
        lines += ["", "A prepared follow-up email will be sent to the contact automatically."]
    lines += ["", f"Open in the CRM: {frontend_url()}{record_path(fu.lead_id, fu.client_id)}"]
    return f"Follow-up due: {fu.title}"[:300], "\n".join(lines)


def process_due_reminders(engine=None, now: Optional[datetime] = None, limit: int = 50, send_email=None) -> int:
    """Notify the assignee of every newly-due follow-up exactly once. Returns how many were reminded."""
    from modules import company_mailer
    engine = engine or database.engine
    now = now or utcnow()
    send_email = send_email or company_mailer.send_via
    emails_on = os.getenv("FOLLOWUP_REMINDER_EMAILS", "1") != "0"
    reminded = 0
    with Session(engine) as session:
        # reminder_minutes varies per row, so narrow in SQL (reminders up to 30 days ahead) and finish in Python.
        candidates = session.exec(
            select(FollowUp).where(
                FollowUp.status == OPEN, FollowUp.reminder_sent_at.is_(None), FollowUp.due_at.is_not(None),
                FollowUp.due_at <= now + timedelta(days=30),
            ).order_by(FollowUp.due_at).execution_options(skip_tenant=True)
        ).all()
        due = [fu for fu in candidates if remind_time(fu) <= now][:limit]
        for fu in due:
            if not _claim(session, fu.id, FollowUp.reminder_sent_at, now):
                continue
            session.refresh(fu)
            if as_utc(fu.due_at) <= now and fu.overdue_notified_at is None:
                # Already due: this reminder says so, the /follow-ups worker need not send an "overdue" too.
                _claim(session, fu.id, FollowUp.overdue_notified_at, now)
                session.refresh(fu)
            user_id = fu.owner_id or fu.created_by
            user = session.get(User, user_id) if user_id else None
            info = record_info(session, fu.lead_id, fu.client_id)
            who = fu.contact_name or fu.company_name or info.get("label") or fu.contact_email or "a contact"
            notify(session, user_id, fu.tenant_id, f"Follow-up due: {fu.title}",
                   f"Your follow-up with {who} is due {_fmt_local(fu.due_at)}.", record_path(fu.lead_id, fu.client_id))
            session.commit()
            reminded += 1
            if emails_on and user and user.email:
                try:
                    account = company_mailer.resolve_account(session, user.id, fu.tenant_id, allow_server_fallback=True)
                    subject, body = reminder_email(fu, user, info)
                    session.commit()  # don't hold a transaction open across SMTP
                    send_email(account, to=user.email, subject=subject, body=body)
                except Exception as e:
                    print(f"[Follow-ups] reminder email for follow-up {fu.id} failed: {company_mailer.friendly_smtp_error(e)}")
    return reminded


# ── 2. Auto-send ─────────────────────────────────────────────────────────────
def process_auto_sends(engine=None, now: Optional[datetime] = None, limit: int = 20, sender=None) -> int:
    """Send prepared follow-up emails whose follow-up is due. Returns how many were sent."""
    from modules import company_mailer
    engine = engine or database.engine
    now = now or utcnow()
    sent_count = 0
    with Session(engine) as session:
        due = session.exec(
            select(FollowUp).where(
                FollowUp.status == OPEN, FollowUp.auto_send.is_(True), FollowUp.email_sent_at.is_(None),
                FollowUp.due_at <= now, FollowUp.contact_email.is_not(None), FollowUp.email_body.is_not(None),
            ).order_by(FollowUp.due_at).limit(limit).execution_options(skip_tenant=True)
        ).all()
        for fu in due:
            if not _claim(session, fu.id, FollowUp.email_sent_at, now):
                continue
            session.refresh(fu)
            actor_id = fu.owner_id or fu.created_by
            actor = session.get(User, actor_id) if actor_id else None
            try:
                account = company_mailer.resolve_account(session, actor_id, fu.tenant_id)
                body = company_mailer.apply_signature(fu.email_body, company_mailer.user_signature(session, actor_id))
                subject = fu.email_subject or f"Following up — {fu.company_name or fu.title}"
                sent = company_mailer.send_and_record(
                    session, account, tenant_id=fu.tenant_id, to=fu.contact_email, subject=subject, body=body,
                    lead_id=fu.lead_id, client_id=fu.client_id,
                    meta={"source": "follow_up_auto", "follow_up_id": fu.id, "sent_by_user_id": actor_id},
                    **({"sender": sender} if sender else {}),
                )
                session.refresh(fu)
                mark_email_sent(session, fu, sent, actor_id=actor_id, actor_name=(actor.name if actor else "") or "Follow-up automation",
                                complete=True, outcome=f"Follow-up email sent automatically to {fu.contact_email}.")
                session.commit()
                sent_count += 1
            except Exception as e:
                session.rollback()
                fu = session.get(FollowUp, fu.id)
                reason = str(e) if isinstance(e, company_mailer.MailAccountError) else company_mailer.friendly_smtp_error(e)
                fu.email_sent_at = None
                fu.auto_send = False  # don't retry every minute; the user re-enables after fixing it
                fu.last_error = f"Automatic follow-up email failed: {reason}"
                fu.updated_at = utcnow()
                session.add(fu)
                notify(session, actor_id, fu.tenant_id, "Follow-up email was not sent",
                       f"“{fu.title}”: {reason}", record_path(fu.lead_id, fu.client_id))
                session.commit()
                print(f"[Follow-ups] auto-send for follow-up {fu.id} failed: {reason}")
    return sent_count


# ── 3. AI scan of notes / conversations ──────────────────────────────────────
def _is_auto_logged_email(session: Session, conv: ConversationLog) -> bool:
    """ConversationLogs of type email that the CRM wrote itself when it sent mail (our own words)."""
    if (conv.type or "").lower() != "email":
        return False
    created = as_utc(conv.created_at)
    stmt = select(SentEmail.id).where(
        SentEmail.subject == (conv.title or "")[:500],
        SentEmail.sent_at >= created - timedelta(minutes=10), SentEmail.sent_at <= created + timedelta(minutes=10),
    ).execution_options(skip_tenant=True)
    if conv.lead_id:
        stmt = stmt.where(SentEmail.lead_id == conv.lead_id)
    if conv.client_id:
        stmt = stmt.where(SentEmail.client_id == conv.client_id)
    return session.exec(stmt.limit(1)).first() is not None


def _note_items(session: Session, cutoff: datetime, lead_id=None, client_id=None, per_source: int = 40) -> list:
    """Candidate texts: [(key, tenant_id, lead_id, client_id, author_id, written_at, text)] newest first."""
    items = []

    def scoped(stmt, model, lead_attr="lead_id", client_attr="client_id"):
        if lead_id:
            stmt = stmt.where(getattr(model, lead_attr) == lead_id)
        if client_id:
            stmt = stmt.where(getattr(model, client_attr) == client_id)
        return stmt.execution_options(skip_tenant=True).limit(per_source)

    for n in session.exec(scoped(select(ClientNote).where(ClientNote.created_at >= cutoff)
                                 .order_by(ClientNote.created_at.desc()), ClientNote)).all():
        items.append((f"note-{n.id}", n.tenant_id, n.lead_id, n.client_id, n.author_id, n.created_at, n.content))
    if not client_id:
        for n in session.exec(scoped(select(LeadNote).where(LeadNote.created_at >= cutoff)
                                     .order_by(LeadNote.created_at.desc()), LeadNote, client_attr="lead_id")).all():
            items.append((f"leadnote-{n.id}", n.tenant_id, n.lead_id, None, n.author_id, n.created_at, n.content))
    for c in session.exec(scoped(select(ConversationLog).where(ConversationLog.created_at >= cutoff)
                                 .order_by(ConversationLog.created_at.desc()), ConversationLog)).all():
        if _is_auto_logged_email(session, c):
            continue
        text = "\n".join(x for x in [f"[{c.type}] {c.title}", c.description] if x)
        items.append((f"conv-{c.id}", c.tenant_id, c.lead_id, c.client_id, c.author_id, c.created_at, text))
    reply_stmt = select(ConversationReply, ConversationLog).join(
        ConversationLog, ConversationLog.id == ConversationReply.conversation_id
    ).where(ConversationReply.created_at >= cutoff).order_by(ConversationReply.created_at.desc())
    if lead_id:
        reply_stmt = reply_stmt.where(ConversationLog.lead_id == lead_id)
    if client_id:
        reply_stmt = reply_stmt.where(ConversationLog.client_id == client_id)
    for r, c in session.exec(reply_stmt.execution_options(skip_tenant=True).limit(per_source)).all():
        items.append((f"convreply-{r.id}", r.tenant_id or c.tenant_id, c.lead_id, c.client_id, r.author_id,
                      r.created_at, f"Reply on “{c.title}”: {r.content}"))
    if not lead_id:
        for r in session.exec(scoped(select(Remark).where(Remark.createdAt >= cutoff, Remark.clientId.is_not(None))
                                     .order_by(Remark.createdAt.desc()), Remark, lead_attr="clientId", client_attr="clientId")).all():
            items.append((f"remark-{r.id}", r.tenant_id, None, r.clientId, r.authorId, r.createdAt, r.content))
    inbox_stmt = select(InboxMessage).where(
        InboxMessage.received_at >= cutoff, or_(InboxMessage.lead_id.is_not(None), InboxMessage.client_id.is_not(None))
    ).order_by(InboxMessage.received_at.desc())
    if lead_id:
        inbox_stmt = inbox_stmt.where(InboxMessage.lead_id == lead_id)
    if client_id:
        inbox_stmt = inbox_stmt.where(InboxMessage.client_id == client_id)
    for m in session.exec(inbox_stmt.execution_options(skip_tenant=True).limit(per_source)).all():
        if (m.ai_category or "") in ("spam", "promotional"):
            continue
        text = f"Email from {m.from_name or m.from_address}: {m.subject or ''}\n{m.body_text or m.snippet or ''}"
        items.append((f"inbox-{m.id}", m.tenant_id, m.lead_id, m.client_id, None, m.received_at, text))
    items = [i for i in items if (i[6] or "").strip() and (i[2] or i[3])]
    items.sort(key=lambda i: as_utc(i[5]) or utcnow(), reverse=True)
    return items


def _already_scanned(session: Session, keys: list) -> set:
    if not keys:
        return set()
    rows = session.exec(select(FollowUpNoteScan.source_key).where(FollowUpNoteScan.source_key.in_(keys))
                        .execution_options(skip_tenant=True)).all()
    return set(rows)


AUTO_SOURCES = ("campaign", "ai_auto")


def _enrich_existing(session: Session, fu: FollowUp, s: dict, key: str, due_at: datetime, written: datetime):
    """A note confirms a follow-up that is already open: add what was said to it instead of a duplicate.

    Auto-generated ones (campaign reminders, earlier AI follow-ups) also move to the date the
    contact gave and take the AI's more specific title; a follow-up a person scheduled keeps
    its date and title and only gains the context."""
    reason = s.get("reason") or s.get("quote") or ""
    line = f"AI ({written.date().isoformat()}): {reason}".strip()
    if reason and reason not in (fu.notes or ""):
        fu.notes = f"{fu.notes}\n\n{line}" if fu.notes else line
    if s.get("quote") and not fu.ai_reason:
        fu.ai_reason = s["quote"]
    if fu.source in AUTO_SOURCES:
        if as_utc(fu.due_at) != due_at:
            fu.due_at = due_at
            fu.reminder_sent_at = fu.overdue_notified_at = None
        if s.get("title"):
            fu.title = s["title"]
        fu.source, fu.source_ref = "ai_auto", key
    fu.updated_at = utcnow()
    session.add(fu)
    log_activity(session, fu, "AI updated a follow-up from a new note", f"{reason} (from {key})", None)


def scan_notes(engine=None, *, lead_id: Optional[int] = None, client_id: Optional[int] = None,
               tenant_id: Optional[int] = None, max_age_days: Optional[int] = None, budget: int = 15,
               extractor=None) -> dict:
    """Read not-yet-scanned notes/conversations and create AI follow-ups. Returns
    {"scanned": n, "created": [follow-up ids], "matched": [existing follow-up ids]}."""
    from modules import followup_ai
    engine = engine or database.engine
    extractor = extractor or followup_ai.extract_from_note
    if max_age_days is None:
        max_age_days = int(os.getenv("FOLLOWUP_AI_SCAN_DAYS", "3"))
    now = utcnow()
    cutoff = now - timedelta(days=max_age_days)
    min_conf = float(os.getenv("FOLLOWUP_AI_MIN_CONFIDENCE", "0.5"))
    result = {"scanned": 0, "created": [], "matched": []}
    with Session(engine) as session:
        items = _note_items(session, cutoff, lead_id=lead_id, client_id=client_id)
        if tenant_id is not None:
            items = [i for i in items if i[1] == tenant_id]
        done = _already_scanned(session, [i[0] for i in items])
        for key, tid, l_id, c_id, author_id, written_at, text in items:
            if key in done:
                continue
            if result["scanned"] >= budget:
                break
            # Claim first (unique source_key) so concurrent scanners never analyse the same note twice.
            mark = FollowUpNoteScan(tenant_id=tid, source_key=key, scanned_at=now)
            session.add(mark)
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
                continue
            result["scanned"] += 1
            info = record_info(session, l_id, c_id)
            written = (as_utc(written_at) or now)
            session.commit()  # release before the AI call
            try:
                s = extractor(text, written.date(), now.date(), info.get("label", ""))
            except Exception as e:
                print(f"[Follow-ups] AI scan of {key} failed: {e}")
                continue
            if not s.get("should_follow_up") or not s.get("due_date") or float(s.get("confidence") or 0) < min_conf:
                continue
            due_day = date.fromisoformat(s["due_date"])
            due_at = at_local_hour(due_day)
            if due_at < now - timedelta(days=7):
                continue  # an old commitment that has long passed — not worth surfacing
            existing = find_duplicate(session, tenant_id=tid, lead_id=l_id, client_id=c_id, contact_email=None, due_at=due_at)
            if existing:
                _enrich_existing(session, existing, s, key, due_at, written)
                mark.follow_up_id = existing.id
                session.add(mark)
                session.commit()
                result["matched"].append(existing.id)
                continue
            assignee = info.get("owner_id") or author_id
            fu = FollowUp(
                tenant_id=tid, lead_id=l_id, client_id=c_id,
                contact_name=info.get("contact_name"), contact_email=info.get("contact_email"),
                company_name=info.get("label"), title=s.get("title") or f"Follow up with {info.get('label', 'contact')}",
                notes=s.get("reason") or None, ai_reason=s.get("quote") or s.get("reason") or None,
                channel=db_channel(s.get("channel")), priority=db_priority(s.get("priority")),
                due_at=due_at, reminder_minutes=DEFAULT_REMINDER_MINUTES, source="ai_auto", source_ref=key,
                owner_id=assignee, created_by=author_id,
            )
            session.add(fu)
            session.flush()
            mark.follow_up_id = fu.id
            session.add(mark)
            log_activity(session, fu, "AI scheduled a follow-up", f"{s.get('reason') or ''} (from {key})", None)
            notify(session, assignee, tid, f"AI scheduled a follow-up: {fu.title}",
                   f"Based on a recent note about {info.get('label', 'a contact')}, a follow-up is set for {due_day.isoformat()}.",
                   record_path(l_id, c_id))
            session.commit()
            result["created"].append(fu.id)
    return result


# ── Scheduler thread ─────────────────────────────────────────────────────────
_thread_started = False
_thread_lock = threading.Lock()


def run_cycle(engine=None) -> dict:
    out = {}
    for name, step in (("reminders", process_due_reminders), ("auto_sent", process_auto_sends)):
        try:
            out[name] = step(engine)
        except Exception as e:
            print(f"[Follow-ups] {name} step failed: {e}")
    if os.getenv("FOLLOWUP_AI_SCAN", "1") != "0":
        try:
            out["scan"] = scan_notes(engine)
        except Exception as e:
            print(f"[Follow-ups] AI scan step failed: {e}")
    try:
        from modules.email_campaign_worker import resume_campaigns
        out["campaigns_resumed"] = resume_campaigns(engine)
    except Exception as e:
        print(f"[Follow-ups] campaign resume failed: {e}")
    return out


def _loop(interval_seconds: int):
    time.sleep(40)  # let startup migrations and the other pollers settle first
    while True:
        try:
            run_cycle()
        except Exception as e:
            print(f"[Follow-ups] scheduler error: {e}")
        time.sleep(interval_seconds)


def start_followup_scheduler_thread():
    """Start the follow-up scheduler once per process. Safe to call repeatedly."""
    global _thread_started
    with _thread_lock:
        if _thread_started:
            return
        interval = int(os.getenv("FOLLOWUP_SCHEDULER_INTERVAL_SECONDS", "60"))
        threading.Thread(target=_loop, args=(interval,), daemon=True, name="followup-scheduler").start()
        _thread_started = True
        print(f"[Follow-ups] scheduler started, every {interval}s.")
