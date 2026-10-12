"""
Inbox sync: mirrors every inbound email of the CRM mailbox(es) into the
inbox_messages table, so the in-app Inbox can list, search and AI-triage all
received mail — not only the replies that email_sender.check_email_replies
records as EmailReply rows.

Mailboxes synced each cycle:
  - the env-configured CRM mailbox (EMAIL_SENDER / EMAIL_PASSWORD /
    IMAP_SERVER — the same one the reply checker polls). It belongs to
    INBOX_DEFAULT_TENANT_ID (default 1, matching the startup migration that
    backfills NULL tenant_id to 1), except that a reply to an email some other
    tenant sent through it is routed to that tenant, same as the reply checker.
  - each tenant's own mailbox from email_settings (IMAP host derived from the
    SMTP host, the same rule _archive_sent_copy uses), linked only within that
    tenant.

Outbound mail is not mirrored: the Inbox reads it from sent_emails. Our own
sent-copies that _archive_sent_copy appends to the INBOX are skipped.

Best-effort throughout, like the reply checker: nothing here may take the app
down, and every query uses skip_tenant because this runs in a background
thread (and in the manual "Sync now" request, where the per-request tenant
filter would otherwise hide other mailboxes' rows).
"""
import email as email_lib
import hashlib
import html as html_lib
import imaplib
import os
import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.header import decode_header, make_header
from email.utils import getaddresses, parseaddr, parsedate_to_datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from database import (
    ClientProfile,
    Contact,
    EmailReply,
    EmailSettings,
    InboxMessage,
    Lead,
    SentEmail,
    Tenant,
    User,
    UserEmailIntegration,
    engine as default_engine,
)
from modules.email_sender import (
    _get_email_settings,
    _get_plain_and_html,
    _sanitize_reply_html,
    _strip_quoted_text,
)

_BODY_MAX_CHARS = 20000
_HTML_MAX_CHARS = 200000
_SNIPPET_CHARS = 280
_HEADER_FETCH_CHUNK = 200


@dataclass(frozen=True)
class MailboxConfig:
    address: str  # lowercased mailbox address, also the inbox_messages.mailbox value
    login: str
    password: str
    imap_host: str
    tenant_id: Optional[int]
    tenant_owned: bool  # True for email_settings mailboxes: never link outside tenant_id
    imap_port: Optional[int] = None  # None = default port, SSL first (legacy env / email_settings mailboxes)
    imap_security: Optional[str] = None  # ssl | starttls | none, from a user's Email Integration
    user_id: Optional[int] = None  # set for a user's own Email Integration mailbox

    def __repr__(self):  # never leak the password into logs / tracebacks
        return f"MailboxConfig({self.address!r}, {self.imap_host}, tenant={self.tenant_id})"


# ── Status (per process; shown by GET /inbox/status) ─────────────────────────
_status_lock = threading.Lock()
_mailbox_status: dict = {}
_sync_locks: dict = {}
_sync_locks_guard = threading.Lock()


def _set_status(address: str, **fields):
    with _status_lock:
        _mailbox_status.setdefault(address, {}).update(fields)


def get_sync_status() -> dict:
    with _status_lock:
        return {addr: dict(s) for addr, s in _mailbox_status.items()}


def _lock_for(address: str) -> threading.Lock:
    with _sync_locks_guard:
        return _sync_locks.setdefault(address, threading.Lock())


# ── Small helpers ────────────────────────────────────────────────────────────
def _decode(value) -> str:
    """Decode an RFC 2047 header ("=?UTF-8?B?...?=") to plain text."""
    if not value:
        return ""
    try:
        return str(make_header(decode_header(str(value)))).strip()
    except Exception:
        return str(value).strip()


def _addresses(msg, header: str) -> list:
    pairs = getaddresses([str(v) for v in (msg.get_all(header, []) or [])])
    out = []
    for name, addr in pairs:
        addr = (addr or "").strip().lower()
        if addr and "@" in addr:
            out.append((_decode(name), addr))
    return out


def _format_addresses(pairs: list) -> str:
    return ", ".join(f"{name} <{addr}>" if name else addr for name, addr in pairs)


def _message_date(msg) -> datetime:
    raw = msg.get("Date")
    if raw:
        try:
            dt = parsedate_to_datetime(str(raw))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            pass
    return datetime.now(timezone.utc)


def html_to_text(html: str) -> str:
    """Readable plain text from an HTML body (drops <style>/<script>/<head>)."""
    text = re.sub(r"<(script|style|head)[^>]*>.*?</\1>", " ", html or "", flags=re.S | re.I)
    text = re.sub(r"<br\s*/?>|</(p|div|tr|li|h[1-6])>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html_lib.unescape(text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n\s*(\n\s*)+", "\n\n", text)
    return text.strip()


def make_snippet(text: str) -> str:
    flat = re.sub(r"\s+", " ", text or "").strip()
    return flat[:_SNIPPET_CHARS]


def message_key(message_id: str, from_addr: str, date_raw: str, subject: str) -> str:
    """The stored message_id: the real Message-ID header, or — for the rare
    message without one — a stable hash of headers that the cheap header-only
    IMAP pass can compute too, so such a message isn't re-fetched every cycle."""
    mid = (message_id or "").strip()
    if mid:
        return mid[:998]
    digest = hashlib.sha1(f"{from_addr}|{date_raw}|{subject}".encode("utf-8", "replace")).hexdigest()
    return f"synthetic-{digest}"


def _attachments(msg) -> list:
    found = []
    for part in msg.walk() if msg.is_multipart() else []:
        if part.get_content_maintype() == "multipart":
            continue
        filename = part.get_filename()
        disposition = (part.get("Content-Disposition") or "").lower()
        if not filename or ("attachment" not in disposition and part.get("Content-ID")):
            continue  # inline images are already embedded in body_html
        try:
            size = len(part.get_payload(decode=True) or b"")
        except Exception:
            size = None
        found.append({"filename": _decode(filename)[:255], "size": size, "content_type": part.get_content_type()})
    return found[:20]


def parse_message(raw: bytes) -> dict:
    """Everything worth storing from one RFC 822 message. Pure function."""
    msg = email_lib.message_from_bytes(raw)
    from_name, from_addr = parseaddr(msg.get("From", ""))
    from_addr = (from_addr or "").strip().lower()[:255]
    subject = _decode(msg.get("Subject"))[:500]

    plain, html, cid_map = _get_plain_and_html(msg)
    if not plain and html:
        plain = html_to_text(html)
    body_text_full = (plain or "")[:_BODY_MAX_CHARS]
    body_text = _strip_quoted_text(plain or "")[:_BODY_MAX_CHARS]

    body_html = None
    if html:
        for cid, data_uri in cid_map.items():
            html = html.replace(f"cid:{cid}", data_uri)
        try:
            body_html = _sanitize_reply_html(html[:_HTML_MAX_CHARS])
        except Exception as e:
            print(f"[Inbox sync] HTML sanitize failed, keeping text only: {e}")

    in_reply_to = _decode(msg.get("In-Reply-To"))[:998]
    return {
        "message_id": message_key(_decode(msg.get("Message-ID")), from_addr, str(msg.get("Date") or ""), subject),
        "in_reply_to": in_reply_to or None,
        "references_header": _decode(msg.get("References")) or None,
        "from_name": _decode(from_name)[:255] or None,
        "from_address": from_addr,
        "to_addresses": _format_addresses(_addresses(msg, "To")) or None,
        "cc_addresses": _format_addresses(_addresses(msg, "Cc")) or None,
        "subject": subject or None,
        "snippet": make_snippet(body_text or body_text_full) or None,
        "body_text": body_text or None,
        "body_text_full": body_text_full or None,
        "body_html": body_html,
        "attachments": _attachments(msg),
        "received_at": _message_date(msg),
    }


# ── Mailboxes ────────────────────────────────────────────────────────────────
def _imap_host_for(smtp_host: str) -> str:
    host = (smtp_host or "").strip()
    return host.replace("smtp.", "imap.", 1) if host.startswith("smtp.") else host


def default_tenant_id(session: Session) -> Optional[int]:
    try:
        tid = int(os.getenv("INBOX_DEFAULT_TENANT_ID", "1"))
    except ValueError:
        return None
    return tid if session.get(Tenant, tid) else None


def env_mailbox_address() -> str:
    sender, _, _ = _get_email_settings()
    return (sender or "").strip().lower()


def _integration_configs(session: Session) -> list:
    """Each user's own Email Integration mailbox (Email Agent → Settings), so mail sent from and received by
    that address is synced for them. A password that can't be decrypted is skipped, not fatal."""
    from modules.email_crypto import EmailCredentialEncryptionError, decrypt_app_password
    out = []
    rows = session.exec(select(UserEmailIntegration).where(UserEmailIntegration.is_active == True)  # noqa: E712
                        .order_by(UserEmailIntegration.id).execution_options(skip_tenant=True)).all()
    for r in rows:
        if not (r.email and r.encrypted_app_password and r.imap_host):
            continue
        try:
            password = decrypt_app_password(r.encrypted_app_password)
        except EmailCredentialEncryptionError as e:
            print(f"[Inbox sync] skipping {r.email}: {e}")
            continue
        out.append(MailboxConfig(r.email.strip().lower(), r.email.strip(), password, r.imap_host.strip(), r.tenant_id, True,
                                 int(r.imap_port or 993), (r.imap_security or "ssl").lower(), r.user_id))
    return out


def get_mailbox_configs(session: Session) -> list:
    configs, seen = [], set()
    for cfg in _integration_configs(session):  # a user's own mailbox wins over a shared one with the same address
        if (cfg.address, cfg.imap_host) not in seen:
            seen.add((cfg.address, cfg.imap_host))
            configs.append(cfg)
    settings_rows = session.exec(select(EmailSettings).execution_options(skip_tenant=True)).all()
    for es in settings_rows:
        address = (es.from_email or es.smtp_user or "").strip().lower()
        host = _imap_host_for(es.smtp_host)
        if not (address and es.smtp_pass and host) or (address, host) in seen:
            continue
        seen.add((address, host))
        configs.append(MailboxConfig(address, (es.smtp_user or es.from_email).strip(), es.smtp_pass, host, es.tenant_id, True))

    sender, password, imap_host = _get_email_settings()
    if sender and password and imap_host and (sender.strip().lower(), imap_host) not in seen:
        configs.append(MailboxConfig(sender.strip().lower(), sender.strip(), password, imap_host, default_tenant_id(session), False))
    return configs


def mailboxes_for_tenant(session: Session, tenant_id: Optional[int]) -> list:
    """The mailboxes whose mail lands in this tenant's Inbox (None = all, for SuperAdmin)."""
    configs = get_mailbox_configs(session)
    if tenant_id is None:
        return configs
    return [c for c in configs if c.tenant_id == tenant_id]


# ── Linking to CRM records ───────────────────────────────────────────────────
def match_address(session: Session, address: str, tenant_id: Optional[int]) -> dict:
    """Find the lead / client / contact a sender address belongs to, within one tenant."""
    links = {"lead_id": None, "client_id": None, "contact_id": None}
    addr = (address or "").strip().lower()
    if not addr or not tenant_id:
        return links

    def first(stmt, model):
        return session.exec(stmt.where(model.tenant_id == tenant_id).execution_options(skip_tenant=True)).first()

    lead = first(select(Lead).where(func.lower(Lead.email) == addr).order_by(Lead.id.desc()), Lead)
    contact = first(select(Contact).where(func.lower(Contact.email) == addr).order_by(Contact.id.desc()), Contact)
    client = None
    user = session.exec(select(User).where(func.lower(User.email) == addr).execution_options(skip_tenant=True)).first()
    if user:
        client = first(select(ClientProfile).where(ClientProfile.userId == user.id), ClientProfile)

    links["contact_id"] = contact.id if contact else None
    links["lead_id"] = lead.id if lead else (contact.lead_id if contact else None)
    links["client_id"] = client.id if client else (contact.client_id if contact else None)
    if lead and lead.converted_client_id and not links["client_id"]:
        links["client_id"] = lead.converted_client_id  # a converted lead's mail belongs to its client too
    return links


def link_inbound(session: Session, cfg: MailboxConfig, parsed: dict) -> dict:
    """Decide tenant + CRM links for one inbound message."""
    links = {"tenant_id": cfg.tenant_id, "lead_id": None, "client_id": None, "contact_id": None, "sent_email_id": None}
    from_addr = parsed["from_address"]

    sent = None
    # 1. The reply checker already matched this exact message to a sent email.
    if parsed.get("message_id") and not parsed["message_id"].startswith("synthetic-"):
        reply = session.exec(
            select(EmailReply).where(EmailReply.message_id == parsed["message_id"]).execution_options(skip_tenant=True)
        ).first()
        if reply:
            sent = session.get(SentEmail, reply.sent_email_id, execution_options={"skip_tenant": True})
    # 2. Same heuristic as the reply checker: the newest email we sent to this address.
    if sent is None and from_addr:
        stmt = (
            select(SentEmail)
            .where(func.lower(SentEmail.to_email) == from_addr, SentEmail.status != "Draft")
            .order_by(SentEmail.sent_at.desc())
            .execution_options(skip_tenant=True)
        )
        if cfg.tenant_owned:
            stmt = stmt.where(SentEmail.tenant_id == cfg.tenant_id)
        sent = session.exec(stmt).first()

    if sent is not None:
        links["sent_email_id"] = sent.id
        links["lead_id"] = sent.lead_id
        links["client_id"] = sent.client_id
        if sent.tenant_id:
            links["tenant_id"] = sent.tenant_id

    if not (links["lead_id"] or links["client_id"]):
        matched = match_address(session, from_addr, links["tenant_id"])
        links.update({k: v for k, v in matched.items() if v})
    return links


# ── IMAP ─────────────────────────────────────────────────────────────────────
def _connect(cfg: MailboxConfig):
    import ssl
    mode = (cfg.imap_security or "").lower()
    if mode == "ssl":
        conn = imaplib.IMAP4_SSL(cfg.imap_host, cfg.imap_port or 993, timeout=30, ssl_context=ssl.create_default_context())
    elif mode == "starttls":
        conn = imaplib.IMAP4(cfg.imap_host, cfg.imap_port or 143, timeout=30)
        conn.starttls(ssl_context=ssl.create_default_context())
    elif mode == "none":
        conn = imaplib.IMAP4(cfg.imap_host, cfg.imap_port or 143, timeout=30)
    else:  # legacy env / email_settings mailboxes: SSL first, plain-text fallback
        try:
            conn = imaplib.IMAP4_SSL(cfg.imap_host, timeout=30)
        except Exception:
            conn = imaplib.IMAP4(cfg.imap_host, timeout=30)
    conn.login(cfg.login, cfg.password)
    return conn


def _fetch_header_keys(conn, uids: list) -> dict:
    """uid (str) -> (message key, from address), from a cheap header-only fetch."""
    result = {}

    def record(uid: bytes, header_bytes: bytes):
        hdr = email_lib.message_from_bytes(header_bytes)
        from_addr = (parseaddr(hdr.get("From", ""))[1] or "").strip().lower()
        subject = _decode(hdr.get("Subject"))[:500]
        key = message_key(_decode(hdr.get("Message-ID")), from_addr, str(hdr.get("Date") or ""), subject)
        result[uid.decode()] = (key, from_addr)

    for i in range(0, len(uids), _HEADER_FETCH_CHUNK):
        chunk = uids[i:i + _HEADER_FETCH_CHUNK]
        typ, data = conn.uid("FETCH", ",".join(chunk), "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID FROM DATE SUBJECT)])")
        if typ != "OK" or not data:
            continue
        # Servers may put "UID n" before the header literal (in the tuple's first element) or
        # after it (in the closing bytes element) — RFC 3501 leaves the item order to the server.
        pending = None
        for item in data:
            if isinstance(item, tuple) and len(item) >= 2:
                m = re.search(rb"UID (\d+)", item[0])
                if m:
                    record(m.group(1), item[1])
                    pending = None
                else:
                    pending = item[1]
            elif isinstance(item, bytes) and pending is not None:
                m = re.search(rb"UID (\d+)", item)
                if m:
                    record(m.group(1), pending)
                pending = None
    return result


def _existing_keys(session: Session, mailbox: str, keys: list) -> set:
    existing = set()
    for i in range(0, len(keys), 500):
        chunk = keys[i:i + 500]
        rows = session.exec(
            select(InboxMessage.message_id)
            .where(InboxMessage.mailbox == mailbox, InboxMessage.message_id.in_(chunk))
            .execution_options(skip_tenant=True)
        ).all()
        existing.update(rows)
    return existing


def _store(session: Session, row: InboxMessage) -> bool:
    """Insert one row; a duplicate from a concurrent sync is not an error."""
    try:
        session.add(row)
        session.commit()
        return True
    except IntegrityError:
        session.rollback()
        return False


def sync_mailbox(cfg: MailboxConfig, engine=None, days_back: int = 3, max_new: int = 200, connect=_connect) -> dict:
    """Mirror new INBOX messages from the last `days_back` days. Never raises."""
    engine = engine or default_engine
    stats = {"mailbox": cfg.address, "scanned": 0, "created": 0, "error": None}
    lock = _lock_for(cfg.address)
    if not lock.acquire(blocking=False):
        stats["error"] = "A sync of this mailbox is already running."
        return stats

    conn = None
    try:
        conn = connect(cfg)
        typ, _ = conn.select("INBOX", readonly=True)
        if typ != "OK":
            raise RuntimeError("could not open INBOX")
        since = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%d-%b-%Y")
        typ, data = conn.uid("SEARCH", None, f'(SINCE "{since}")')
        uids = [u.decode() for u in data[0].split()] if typ == "OK" and data and data[0] else []
        stats["scanned"] = len(uids)

        with Session(engine) as session:
            # Mailbox ingestion is system activity, not a user edit: skip the
            # per-row audit-log dump of every full email body (see
            # _audit_log_changes in main.py).
            session._is_auditing = True

            headers = _fetch_header_keys(conn, uids) if uids else {}
            # Skip our own sent-copies (_archive_sent_copy files them in INBOX)
            # before paying for a full fetch.
            candidates = {uid: kf for uid, kf in headers.items() if kf[1] and kf[1] != cfg.address}
            known = _existing_keys(session, cfg.address, [k for k, _ in candidates.values()])
            session.commit()  # no transaction open while waiting on IMAP; each message below commits on its own
            new_uids = [uid for uid in uids if uid in candidates and candidates[uid][0] not in known]
            new_uids = new_uids[-max_new:]  # newest first; any older remainder is picked up next cycle

            for uid in new_uids:
                try:
                    typ, msg_data = conn.uid("FETCH", uid, "(BODY.PEEK[])")
                    if typ != "OK" or not msg_data or not isinstance(msg_data[0], tuple):
                        continue
                    parsed = parse_message(msg_data[0][1])
                    if not parsed["from_address"] or parsed["from_address"] == cfg.address:
                        continue
                    links = link_inbound(session, cfg, parsed)
                    row = InboxMessage(mailbox=cfg.address, imap_uid=int(uid), **parsed, **links)
                    if _store(session, row):
                        stats["created"] += 1
                except Exception as inner:
                    session.rollback()
                    print(f"[Inbox sync] {cfg.address}: failed on uid {uid}: {inner}")

        _set_status(cfg.address, tenant_id=cfg.tenant_id, last_sync_at=datetime.now(timezone.utc).isoformat(),
                    last_error=None, last_created=stats["created"])
    except Exception as e:
        stats["error"] = str(e)[:300]
        _set_status(cfg.address, tenant_id=cfg.tenant_id, last_attempt_at=datetime.now(timezone.utc).isoformat(),
                    last_error=stats["error"])
        print(f"[Inbox sync] {cfg.address}: {e}")
    finally:
        if conn is not None:
            try:
                conn.logout()
            except Exception:
                pass
        lock.release()
    return stats


# ── Keeping older data visible ───────────────────────────────────────────────
def import_legacy_replies(engine=None, limit: int = 500) -> int:
    """Copy EmailReply rows (recorded by the reply checker, including ones from
    before this sync existed) into inbox_messages, so historical replies show
    up in the Inbox too. Idempotent; the unique (mailbox, message_id) key
    dedupes against the same message arriving through the IMAP sync."""
    engine = engine or default_engine
    mailbox = env_mailbox_address() or "crm-mailbox"
    created = 0
    with Session(engine) as session:
        session._is_auditing = True
        pairs = session.exec(
            select(EmailReply, SentEmail)
            .join(SentEmail, SentEmail.id == EmailReply.sent_email_id)
            .order_by(EmailReply.id.desc())
            .limit(limit)
            .execution_options(skip_tenant=True)
        ).all()
        if not pairs:
            return 0
        keys = {reply.id: (reply.message_id or f"email-reply-{reply.id}")[:998] for reply, _ in pairs}
        known = _existing_keys(session, mailbox, list(keys.values()))
        for reply, sent in reversed(pairs):
            key = keys[reply.id]
            if key in known:
                continue
            from_name, from_addr = parseaddr(reply.from_address or "")
            row = InboxMessage(
                tenant_id=reply.tenant_id or sent.tenant_id,
                mailbox=mailbox,
                message_id=key,
                from_name=_decode(from_name)[:255] or None,
                from_address=(from_addr or sent.to_email or "").strip().lower()[:255],
                to_addresses=mailbox if "@" in mailbox else None,
                subject=_decode(reply.subject)[:500] or None,
                snippet=make_snippet(reply.body_text or reply.body_text_full) or None,
                body_text=reply.body_text,
                body_text_full=reply.body_text_full,
                body_html=reply.body_html,
                attachments=[],
                received_at=reply.received_at or datetime.now(timezone.utc),
                lead_id=sent.lead_id,
                client_id=sent.client_id,
                sent_email_id=sent.id,
            )
            if _store(session, row):
                created += 1
                known.add(key)
    return created


def relink_unlinked(engine=None, max_addresses: int = 100) -> int:
    """Link recent unlinked messages whose sender has since become a lead,
    contact or client (e.g. a lead created after their first email)."""
    engine = engine or default_engine
    updated = 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=120)
    with Session(engine) as session:
        rows = session.exec(
            select(InboxMessage)
            .where(InboxMessage.lead_id.is_(None), InboxMessage.client_id.is_(None), InboxMessage.received_at >= cutoff)
            .order_by(InboxMessage.received_at.desc())
            .limit(500)
            .execution_options(skip_tenant=True)
        ).all()
        by_sender: dict = {}
        for row in rows:
            by_sender.setdefault((row.from_address, row.tenant_id), []).append(row)
        for (address, tenant_id), group in list(by_sender.items())[:max_addresses]:
            links = match_address(session, address, tenant_id)
            if not (links["lead_id"] or links["client_id"]):
                continue
            for row in group:
                row.lead_id, row.client_id = links["lead_id"], links["client_id"]
                row.contact_id = row.contact_id or links["contact_id"]
                session.add(row)
                updated += 1
        if updated:
            session.commit()
    return updated


# ── Cycle + background thread ────────────────────────────────────────────────
_cycle_count = 0


def run_sync_cycle(engine=None, tenant_id: Optional[int] = None, classify: bool = True, max_new: int = 200) -> list:
    """One full pass: legacy replies, every (or one tenant's) mailbox, relink, AI triage."""
    global _cycle_count
    engine = engine or default_engine
    _cycle_count += 1
    try:
        import_legacy_replies(engine)
    except Exception as e:
        print(f"[Inbox sync] legacy reply import failed: {e}")

    with Session(engine) as session:
        configs = mailboxes_for_tenant(session, tenant_id) if tenant_id is not None else get_mailbox_configs(session)

    backfill_days = int(os.getenv("INBOX_SYNC_BACKFILL_DAYS", "30"))
    recent_days = int(os.getenv("INBOX_SYNC_DAYS", "3"))
    results = []
    for cfg in configs:
        backfilled = get_sync_status().get(cfg.address, {}).get("backfilled")
        stats = sync_mailbox(cfg, engine, days_back=recent_days if backfilled else backfill_days, max_new=max_new)
        # Only a run that fetched everything outstanding completes the backfill.
        if not stats["error"] and not backfilled and stats["created"] < max_new:
            _set_status(cfg.address, backfilled=True)
        results.append(stats)

    if _cycle_count % 10 == 1:
        try:
            relink_unlinked(engine)
        except Exception as e:
            print(f"[Inbox sync] relink failed: {e}")

    if classify and os.getenv("OPENAI_API_KEY"):
        try:
            from modules.email_ai import classify_pending
            classify_pending(engine)
        except Exception as e:
            print(f"[Inbox sync] AI triage failed: {e}")
    return results


_thread_started = False
_thread_lock = threading.Lock()


def _sync_loop(interval_seconds: int):
    time.sleep(25)  # let startup and the reply checker settle first
    while True:
        try:
            run_sync_cycle()
        except Exception as e:
            print(f"[Inbox sync] loop error: {e}")
        time.sleep(interval_seconds)


def start_inbox_sync_thread():
    """Start the background inbox sync once per process. Safe to call repeatedly.
    Runs even without a configured mailbox so older EmailReply history and
    AI triage still reach the Inbox."""
    global _thread_started
    with _thread_lock:
        if _thread_started:
            return
        interval = int(os.getenv("INBOX_SYNC_INTERVAL_SECONDS", "120"))
        threading.Thread(target=_sync_loop, args=(interval,), daemon=True, name="inbox-sync").start()
        _thread_started = True
        print(f"[Inbox sync] started, every {interval}s.")
