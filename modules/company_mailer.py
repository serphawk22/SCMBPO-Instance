"""
Which mailbox the CRM sends a person's email from, and the send + record step.

Email Agent mail that reaches contacts (Excel campaigns, follow-up emails) goes
out from the company's own configured account, never the server's fixed
EMAIL_SENDER mailbox:

  1. the sending user's Email Integration (Email Agent -> Settings), when saved
     and active — user_email_integrations, app password Fernet-encrypted
  2. the tenant's mailbox (Settings -> SMTP) — email_settings

Internal reminders to staff (allow_server_fallback=True) may additionally fall
back to the server mailbox, so a reminder still arrives in a tenant that has
not configured email yet.

The plaintext password only ever lives in a MailAccount for the duration of a
send; MailAccount.public() is what may be returned to API callers.
"""
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import formataddr, make_msgid
from typing import Optional

from sqlmodel import Session, select

from database import EmailAgentProfile, EmailSettings, SentEmail, User, UserEmailIntegration

SOURCE_LABELS = {
    "user_integration": "Your Email Integration",
    "tenant_settings": "Company mailbox (Settings → SMTP)",
    "server_env": "Server default mailbox",
}

NOT_CONFIGURED_MESSAGE = (
    "No company email account is configured. Connect your mailbox under Email Agent → Settings "
    "(Email Integration), or ask an admin to add the company mailbox under Settings → SMTP."
)


class MailAccountError(Exception):
    """No usable sending account (missing, or stored credentials can't be decrypted)."""


@dataclass
class MailAccount:
    email: str
    password: str
    smtp_host: str
    smtp_port: int
    source: str
    security: Optional[str] = None
    auth_user: Optional[str] = None
    imap_host: Optional[str] = None
    imap_security: Optional[str] = None
    from_name: Optional[str] = None

    def public(self) -> dict:
        return {"configured": True, "address": self.email, "source": self.source,
                "label": SOURCE_LABELS.get(self.source, self.source), "from_name": self.from_name}

    def __repr__(self):  # never leak the password into logs / tracebacks
        return f"MailAccount({self.email!r}, {self.smtp_host}:{self.smtp_port}, {self.source})"


def _user_integration(session: Session, user_id: Optional[int]) -> Optional[MailAccount]:
    if not user_id:
        return None
    row = session.exec(
        select(UserEmailIntegration).where(UserEmailIntegration.user_id == user_id).execution_options(skip_tenant=True)
    ).first()
    if not row or not row.is_active or not row.email or not row.encrypted_app_password or not row.smtp_host:
        return None
    from modules.email_crypto import EmailCredentialEncryptionError, decrypt_app_password
    try:
        password = decrypt_app_password(row.encrypted_app_password)
    except EmailCredentialEncryptionError as e:
        raise MailAccountError(str(e)) from None
    return MailAccount(
        email=row.email, password=password, smtp_host=row.smtp_host, smtp_port=int(row.smtp_port or 587),
        source="user_integration", security=row.smtp_security, auth_user=row.email,
        imap_host=row.imap_host, imap_security=row.imap_security,
    )


def _tenant_settings(session: Session, tenant_id: Optional[int]) -> Optional[MailAccount]:
    if tenant_id is None:
        return None
    es = session.exec(
        select(EmailSettings).where(EmailSettings.tenant_id == tenant_id).execution_options(skip_tenant=True)
    ).first()
    if not es or not es.from_email or not es.smtp_pass or not es.smtp_host:
        return None
    return MailAccount(
        email=es.from_email, password=es.smtp_pass, smtp_host=es.smtp_host, smtp_port=int(es.smtp_port or 587),
        source="tenant_settings", auth_user=es.smtp_user or es.from_email, from_name=es.from_name or None,
    )


def _server_env() -> Optional[MailAccount]:
    sender = os.getenv("EMAIL_SENDER") or os.getenv("OUTLOOK_EMAIL")
    password = os.getenv("EMAIL_PASSWORD") or os.getenv("OUTLOOK_PASSWORD")
    host = os.getenv("EMAIL_HOST") or os.getenv("SMTP_SERVER")
    if not (sender and password and host):
        return None
    port = int(os.getenv("EMAIL_PORT") or os.getenv("SMTP_PORT") or 587)
    return MailAccount(email=sender, password=password, smtp_host=host, smtp_port=port, source="server_env",
                       imap_host=os.getenv("IMAP_SERVER") or None)


def resolve_account(session: Session, user_id: Optional[int], tenant_id: Optional[int],
                    allow_server_fallback: bool = False) -> MailAccount:
    """The account `user_id` sends from. Raises MailAccountError when none is usable."""
    decrypt_error = None
    try:
        account = _user_integration(session, user_id)
    except MailAccountError as e:
        account, decrypt_error = None, e
    account = account or _tenant_settings(session, tenant_id)
    if account is None and allow_server_fallback:
        account = _server_env()
    if account is None:
        raise decrypt_error or MailAccountError(NOT_CONFIGURED_MESSAGE)
    profile = session.exec(
        select(EmailAgentProfile).where(EmailAgentProfile.user_id == user_id).execution_options(skip_tenant=True)
    ).first() if user_id else None
    user = session.get(User, user_id) if user_id else None
    account.from_name = (profile.agent_name if profile else None) or account.from_name or (user.name if user else None)
    return account


def account_status(session: Session, user_id: Optional[int], tenant_id: Optional[int]) -> dict:
    """Safe, credential-free description of the account `user_id` would send from."""
    try:
        return resolve_account(session, user_id, tenant_id).public()
    except MailAccountError as e:
        return {"configured": False, "address": None, "source": None, "label": None, "message": str(e)}


# ── Signature (main._apply_signature's rules, plus closing-line dedupe; kept here to avoid importing main) ──
_SIGNOFF_GREETING_RE = re.compile(
    r"^\s*(?:Best regards|Kind regards|Warm regards|Best wishes|Many thanks|Thanks|Thank you|Sincerely|Cheers|"
    r"Saludos cordiales|Saludos|Best|Regards)\s*[,.!]?\s*$", re.IGNORECASE)
_SIGNOFF_SHAPE_RE = re.compile(r"scm\s*(?:bpo|hub|shipping)|dapros|(?:^|\s)[^@\s]+@[^@\s]+\.[^@\s]+|^(?:Email|Phone):\s", re.IGNORECASE | re.MULTILINE)


def apply_signature(body: str, signature: Optional[str]) -> str:
    """Append the saved signature once, replacing a trailing sign-off already in the body.

    A trailing closing ("Best regards," + up to 4 short lines such as a name or company) is
    dropped when it looks like a signature (email / phone / company) — as main._apply_signature
    does — or when the saved signature brings its own closing line, so templates and AI drafts
    that end with "Best regards,\\nAda" don't send two sign-offs.
    """
    if not body or not signature or not signature.strip() or signature.strip() in body:
        return body
    sig_has_closing = bool(_SIGNOFF_GREETING_RE.match(signature.strip().split("\n")[0]))
    lines = body.rstrip().split("\n")
    for i in range(len(lines) - 1, max(len(lines) - 7, 0) - 1, -1):
        if _SIGNOFF_GREETING_RE.match(lines[i]):
            block = [ln for ln in lines[i + 1:] if ln.strip()]
            short = len(block) <= 4 and all(len(ln.strip()) <= 60 for ln in block)
            if (block and _SIGNOFF_SHAPE_RE.search("\n".join(block))) or (sig_has_closing and short):
                lines = lines[:i]
                break
    return "\n".join(lines).rstrip() + "\n\n" + signature.rstrip()


def user_signature(session: Session, user_id: Optional[int]) -> str:
    """The Email Agent signature to append for this user ('' when off or unset)."""
    if not user_id:
        return ""
    prof = session.exec(
        select(EmailAgentProfile).where(EmailAgentProfile.user_id == user_id).execution_options(skip_tenant=True)
    ).first()
    if not prof or not prof.auto_append_signature:
        return ""
    return prof.signature or ""


# ── Sending ──────────────────────────────────────────────────────────────────
def send_via(account: MailAccount, *, to: str, subject: str, body: str, tracking_id: Optional[int] = None,
             message_id: Optional[str] = None, extra_headers: Optional[dict] = None):
    """Send one email from `account`. Raises on SMTP failure. `extra_headers` (In-Reply-To, References, Cc…)
    are added to the message."""
    from modules.email_sender import send_email_outlook
    # send_email_outlook ignores from_name, so set a "Name <address>" From header here.
    headers = {"From": formataddr((account.from_name, account.email), charset="utf-8") if account.from_name else None,
               "Message-ID": message_id, **(extra_headers or {})}
    send_email_outlook(
        to_email=to, subject=subject, body=body, sender_email=account.email, sender_password=account.password,
        smtp_server=account.smtp_host, smtp_port=account.smtp_port, tracking_id=tracking_id,
        tracking_base_url=os.getenv("PUBLIC_BASE_URL"), from_name=account.from_name, reply_to=account.email,
        security=account.security, auth_user=account.auth_user, imap_server=account.imap_host,
        imap_security=account.imap_security, extra_headers=headers,
    )


def send_and_record(session: Session, account: MailAccount, *, tenant_id: Optional[int], to: str, subject: str,
                    body: str, lead_id: Optional[int] = None, client_id: Optional[int] = None,
                    meta: Optional[dict] = None, sender=None) -> SentEmail:
    """Send and keep a sent_emails row (so opens / replies are tracked like every other CRM email).

    The row is written first so its id can be the open-tracking pixel id, and deleted again if the
    mail server refuses the message. Commits the session before the (slow) SMTP call so no row locks
    are held while talking to the mail server. Raises the SMTP error on failure.
    """
    sender = sender or send_via
    message_id = make_msgid(domain=account.email.split("@")[-1] if "@" in account.email else None)
    row = SentEmail(
        tenant_id=tenant_id, lead_id=lead_id, client_id=client_id, to_email=to, subject=subject[:500],
        english_body=body, manual=True, status="Sending", sent_at=datetime.now(timezone.utc),
        draft_json=json.dumps({**(meta or {}), "message_id": message_id, "sent_from": account.email,
                               "sent_from_source": account.source}),
    )
    session.add(row)
    session.commit()
    try:
        sender(account, to=to, subject=subject, body=body, tracking_id=row.id, message_id=message_id)
    except Exception:
        session.delete(row)
        session.commit()
        raise
    row.status = "Sent"
    row.sent_at = datetime.now(timezone.utc)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def friendly_smtp_error(e: Exception) -> str:
    """A short, credential-free reason for a failed send."""
    import smtplib
    if isinstance(e, smtplib.SMTPAuthenticationError):
        return "The mail server rejected the login. Re-check the app password in Email Agent → Settings."
    if isinstance(e, smtplib.SMTPRecipientsRefused):
        return "The mail server refused this recipient address."
    if isinstance(e, smtplib.SMTPSenderRefused):
        return "The mail server refused the sender address."
    if isinstance(e, (TimeoutError, ConnectionError, OSError)) and not isinstance(e, smtplib.SMTPException):
        return f"Could not reach the mail server ({type(e).__name__})."
    return (str(e) or type(e).__name__)[:300]
