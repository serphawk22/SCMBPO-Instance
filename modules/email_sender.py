import base64
import smtplib
import imaplib
import ssl
import email as email_lib
import io
import os
import re
import time
import threading
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from email.utils import formatdate, make_msgid, parseaddr

# ── SCM BPO logo (used in every HTML email) ────────────────────────────────
_logo_lock = threading.Lock()
_logo_bytes_cache = None
_LOGO_FILENAME = "static/logo.png"

def _scmbpo_logo_bytes():
    """Load + resize the SCM BPO logo from the static folder, cached, as PNG bytes."""
    global _logo_bytes_cache
    if _logo_bytes_cache is not None:
        return _logo_bytes_cache
    with _logo_lock:
        if _logo_bytes_cache is not None:
            return _logo_bytes_cache
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        path = os.path.join(project_root, _LOGO_FILENAME)
        try:
            from PIL import Image, ImageChops
            with Image.open(path) as im:
                im = im.convert("RGB")
                bg = Image.new("RGB", im.size, (252, 252, 252))
                bbox = ImageChops.difference(im, bg).getbbox()
                if bbox:
                    im = im.crop(bbox)
                w, h = im.size
                target = 170
                scale = min(1.0, target / max(w, h))
                if scale < 1.0:
                    im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
                buf = io.BytesIO()
                im.save(buf, format="PNG", optimize=True)
                _logo_bytes_cache = buf.getvalue()
        except Exception as e:
            print(f"[SCM BPO logo load failed] {e}")
            _logo_bytes_cache = None
    return _logo_bytes_cache


def _logo_img_html(alt="SCM BPO"):
    return (
        f'<img src="cid:scmbpo_logo" alt="{alt}" width="150" height="150" '
        'style="display:block;width:150px;height:auto;border-radius:12px;background:#ffffff;padding:4px;box-sizing:border-box" />'
    )


def _inject_logo(html):
    """Insert the SCM BPO logo into an HTML email body."""
    if "cid:scmbpo_logo" in html:
        return html
    img = _logo_img_html()
    replacements = [
        ('<strong style="font-size:18px">🦅 SERP Hawk CRM</strong>', img),
        ('<strong style="font-size:18px">🦅 SERP Hawk Supplier Portal</strong>', _logo_img_html("SCM BPO Supplier Portal")),
        ('<strong style="font-size:18px">SerpHawk CRM</strong>', img),
        ('<p style="margin:0;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#93c5fd">SerpHawk CRM</p>', img),
        ('<strong style="font-size:18px">🦅 SCM BPO CRM</strong>', img),
        ('<p style="margin:0;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#93c5fd">SCM BPO CRM</p>', img),
    ]
    for old, new in replacements:
        if old in html:
            return html.replace(old, new)
    block = f'<div style="text-align:center;background:#ffffff;padding:18px 18px 4px">{img}</div>'
    m = re.search(r"(<body[^>]*>)", html, re.I)
    if m:
        return html[: m.end()] + block + html[m.end():]
    return block + html

# Folder names (by provider) where a copy of the sent mail is archived via IMAP.
_ARCHIVE_FOLDERS = [
    "INBOX",               # store outgoing copies in the account's Inbox (default)
    "[Gmail]/Sent Mail",   # Gmail fallback
    "Sent Items",          # Outlook / Microsoft 365 fallback
    "Sent",                # generic IMAP fallback
    "INBOX.Sent",          # other generic IMAP fallback
    "INBOX.Sent Items",
]

def _archive_sent_copy(msg, sender_email, sender_password, smtp_server, imap_server=None, imap_security=None):
    """Append a copy of the sent message into the account's mailbox via IMAP.
    Copies land in the account's Inbox (per requirement); falls back to the
    provider's Sent folder if the Inbox is not writable.
    Best-effort: never raises — send must not fail because archiving failed."""
    # Derive the IMAP host from the SMTP host (smtp.gmail.com -> imap.gmail.com,
    # mail.host.com -> mail.host.com) unless a dedicated server is configured.
    if not imap_server and smtp_server:
        imap_server = smtp_server.replace("smtp.", "imap.", 1) if smtp_server.startswith("smtp.") else smtp_server
    if not imap_server:
        return
    try:
        mode = (imap_security or "").lower()
        if mode == "ssl":
            conn = imaplib.IMAP4_SSL(imap_server, timeout=30, ssl_context=ssl.create_default_context())
        elif mode == "starttls":
            conn = imaplib.IMAP4(imap_server, timeout=30)
            conn.starttls(ssl_context=ssl.create_default_context())
        elif mode == "none":
            conn = imaplib.IMAP4(imap_server, timeout=30)
        else:
            # Legacy behavior: SSL first, plain-text fallback.
            try:
                conn = imaplib.IMAP4_SSL(imap_server, timeout=30)
            except Exception:
                conn = imaplib.IMAP4(imap_server, timeout=30)
        conn.login(sender_email, sender_password)
        for folder in _ARCHIVE_FOLDERS:
            try:
                typ, _ = conn.select(f'"{folder}"', readonly=True)
            except Exception:
                continue
            if typ == "OK":
                conn.append(f'"{folder}"', None, None, msg.as_bytes())
                break
        conn.logout()
    except Exception as e:
        print(f"[Sent-copy archive failed] {e}")


def _tracking_pixel_html(base_url: str, email_id: int) -> str:
    # Deliberately NOT display:none / visibility:hidden: Gmail and other webmail
    # clients specifically detect and skip fetching hidden-tracking-pixel-shaped
    # images. A genuine 1x1 image with no hiding CSS is the standard technique
    # every cold-email tool (Mailchimp, Mixmax, etc.) actually uses.
    base = (base_url or "").rstrip("/")
    return (
        f'<img src="{base}/webhook/track-email-open?id={email_id}" width="1" height="1" '
        'alt="" style="width:1px;height:1px;border:0;" />'
    )


def _inject_tracking_pixel(html: str, base_url: str, email_id: int) -> str:
    """Insert a 1x1 open-tracking pixel just before </body> (or append if no </body> tag)."""
    if not base_url or not email_id:
        return html
    pixel = _tracking_pixel_html(base_url, email_id)
    if re.search(r"</body>", html, re.I):
        return re.sub(r"</body>", pixel + "</body>", html, count=1, flags=re.I)
    return html + pixel


def send_email_outlook(
    to_email: str,
    subject: str,
    body: str,
    sender_email: str,
    sender_password: str,
    smtp_server: str = "smtp.gmail.com",
    smtp_port: int = 587,
    imap_server: str = None,
    attachments: list = None,
    tracking_id: int = None,
    tracking_base_url: str = None,
    extra_headers: dict = None,
    from_name: str = None,
    reply_to: str = None,
    footer_email: str = None,
    footer_phone: str = None,
    security: str = None,
    auth_user: str = None,
    imap_security: str = None,
):
    """
    Send an email over SMTP (supports STARTTLS on 587, falls back to implicit TLS on 465).

    `body` may contain plain text or HTML. If it starts with '<' it is sent as HTML.
    `attachments` is an optional list of (filename, bytes, mime_type) tuples attached to the mail.
    After sending, a copy is archived into the account's Inbox (falling back to the
    "Sent" folder) over IMAP so the sent mail stays stored in the sender's mailbox. If
    `imap_server` is not provided it is derived from `smtp_server`.

    `tracking_id` + `tracking_base_url`: when both are given, a 1x1 open-tracking pixel
    pointing at `{tracking_base_url}/webhook/track-email-open?id={tracking_id}` is embedded
    in the HTML body. `tracking_base_url` MUST be a publicly reachable URL (not localhost)
    for this to work, since it's the recipient's mail client that requests it.

    `extra_headers`: optional {name: value} set on the message, replacing any
    default of the same name — e.g. In-Reply-To/References so a reply threads
    in the recipient's client, Cc (smtplib also delivers to Cc), or a
    caller-generated Message-ID the caller wants to remember.
    """
    msg = MIMEMultipart("mixed")
    msg["From"] = f"SCMHub Logistics <{sender_email}>"
    msg["To"] = to_email
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid()
    for name, value in (extra_headers or {}).items():
        if value:
            del msg[name]  # no-op when absent; avoids duplicate headers
            msg[name] = value

    is_html = isinstance(body, str) and body.lstrip().startswith("<")

    if isinstance(body, str) and not is_html:
        # Plain text → render it inside the branded shell too, so every email
        # (PDF notifications, orders, credentials, …) carries the SerpHawk
        # logo and clean layout instead of a bare text blob.
        # Escape FIRST so any HTML in the text stays inert, then convert newlines
        # to <br> (escaping after would show the tags as literal "<br>" text).
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body.strip())]
        body = "".join(
            f"<p>{_escape_html(p).replace(chr(10), '<br>')}</p>" for p in paragraphs if p
        )
        is_html = True

    if is_html:
        # Wrap short fragments into the branded shell; leave full documents
        # (e.g. generated by `branded_email`) exactly as-is.
        is_document = body.lstrip().lower().startswith(("<!doctype", "<html"))
        if not is_document:
            body = branded_email(title=subject, body_html=body.lstrip())

        if tracking_id and tracking_base_url:
            body = _inject_tracking_pixel(body, tracking_base_url, tracking_id)

        logo_bytes = _scmbpo_logo_bytes()
        if logo_bytes:
            body = _inject_logo(body)
            body_part = MIMEText(body, "html")
            related = MIMEMultipart("related")
            related.attach(body_part)
            img_part = MIMEBase("image", "png")
            img_part.set_payload(logo_bytes)
            encoders.encode_base64(img_part)
            img_part.add_header("Content-ID", "<scmbpo_logo>")
            img_part.add_header("Content-Disposition", "inline", filename="scmbpo_logo.png")
            related.attach(img_part)
            msg.attach(related)
        else:
            msg.attach(MIMEText(body, "html"))
    else:
        msg.attach(MIMEText(body, "plain"))

    for filename, data, mime_type in (attachments or []):
        part = MIMEBase(*mime_type.split("/", 1))
        part.set_payload(data)
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", "attachment", filename=filename)
        msg.attach(part)

    sent_success = False
    # Explicit security mode wins ("ssl" | "starttls" | "none"); when not
    # provided, keep the legacy port-based heuristic (465 => implicit SSL).
    mode = (security or "").lower()
    if mode == "ssl" or (not mode and str(smtp_port) == "465"):
        with smtplib.SMTP_SSL(smtp_server, int(smtp_port), timeout=20, context=ssl.create_default_context()) as server:
            server.login(auth_user or sender_email, sender_password)
            server.send_message(msg)
        sent_success = True
    elif mode == "none":
        with smtplib.SMTP(smtp_server, int(smtp_port), timeout=20) as server:
            server.ehlo()
            server.login(auth_user or sender_email, sender_password)
            server.send_message(msg)
        sent_success = True
    else:
        # starttls (also the legacy default for every non-465 port)
        with smtplib.SMTP(smtp_server, int(smtp_port), timeout=20) as server:
            server.ehlo()
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
            server.login(auth_user or sender_email, sender_password)
            server.send_message(msg)
        sent_success = True

    if sent_success:
        # Keep a copy of the sent mail in the account's Inbox / Sent mailbox (Gmail/Outlook/etc.)
        _archive_sent_copy(msg, sender_email, sender_password, smtp_server, imap_server, imap_security=imap_security)


# ── Branded email shell ───────────────────────────────────────────────────
# Wrap any content in the SerpHawk visual identity: logo header, clean body,
# and a footer. `send_email_outlook` auto-embeds the SerpHawk logo whenever
# the HTML references cid:serphawk_logo (see _inject_logo), so the header
# below always resolves to the real logo image.

def _escape_html(value):
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def branded_email(title, body_html, hero_accent="#2563eb"):
    """Return a complete, responsive HTML email with the SerpHawk header,
    the given title and body, and a standard footer."""
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#eef1f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e9f0;">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#16233b,{hero_accent});padding:22px 28px;text-align:center;">
            {_logo_img_html()}
          </td>
        </tr>
        <!-- Title -->
        <tr>
          <td style="padding:26px 32px 4px;">
            <h2 style="margin:0;color:#0f172a;font-size:21px;line-height:1.3;">{_escape_html(title)}</h2>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:10px 32px 24px;color:#475569;font-size:14px;line-height:1.7;">
            {body_html}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:18px 32px;border-top:1px solid #e6e9f0;text-align:center;">
            <p style="margin:0;color:#7b8794;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">SCMHub Logistics</p>
            <p style="margin:6px 0 0;color:#94a3b8;font-size:11px;line-height:1.6;">This is an automated email from SCMHub Logistics. If you have questions, reply to this message or contact your account manager.</p>
            <p style="margin:8px 0 0;color:#94a3b8;font-size:10px;line-height:1.5;">If this email looks unusual, you can safely ignore it. Check your spam folder if a message you expected is missing.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""


def _summary_table(rows, total_label, total_value, currency_symbol="₹"):
    """Build a clean two-column summary table for transactional emails.
    `rows` is a list of (label, value) tuples."""
    trs = ""
    for i, (label, value) in enumerate(rows):
        bg = "background:#f8fafc;" if i % 2 else ""
        trs += (
            f'<tr><td style="padding:9px 6px;border-bottom:1px solid #eef1f7;{bg}color:#64748b;font-size:13px;">{_escape_html(label)}</td>'
            f'<td style="padding:9px 6px;border-bottom:1px solid #eef1f7;{bg}text-align:right;color:#0f172a;font-size:13px;font-weight:600;">{_escape_html(value)}</td></tr>'
        )
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="margin:14px 0 0;border-collapse:collapse;border:1px solid #e6e9f0;border-radius:10px;overflow:hidden;">'
        f'{trs}'
        f'<tr><td style="padding:12px 6px;background:#fef9e7;color:#0f172a;font-size:14px;font-weight:800;">{_escape_html(total_label)}</td>'
        f'<td style="padding:12px 6px;background:#fef9e7;text-align:right;color:#0f172a;font-size:15px;font-weight:800;">{_escape_html(total_value)}</td></tr>'
        f'</table>'
    )


def _attachment_note(filename):
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" width="100%" '
        f'style="margin:16px 0 0;">'
        f'<tr><td style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 16px;color:#1d4ed8;font-size:13px;font-weight:600;">'
        f'&#128206;&nbsp; Attachment: <span style="color:#0f172a;">{_escape_html(filename)}</span></td></tr>'
        f'</table>'
    )


def send_password_reset_email(to_email: str, reset_url: str):
    """Send a branded password-reset link. Best-effort: returns True on success."""
    sender = __import__("os").environ.get("EMAIL_SENDER") or __import__("os").environ.get("OUTLOOK_EMAIL") or ""
    password = __import__("os").environ.get("EMAIL_PASSWORD") or __import__("os").environ.get("OUTLOOK_PASSWORD") or ""
    smtp_server = __import__("os").environ.get("EMAIL_HOST") or __import__("os").environ.get("SMTP_SERVER", "smtp.gmail.com")
    smtp_port = __import__("os").environ.get("EMAIL_PORT") or __import__("os").environ.get("SMTP_PORT", 587)
    if not sender or not password:
        return False
    subject = "Reset your SERP Hawk CRM password"
    html = branded_email(
        title="Reset your password",
        body_html=(
            "<p>We received a request to reset the password for your account. Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.</p>"
            f'<p style="margin:22px 0 0"><a href="{reset_url}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:700;">Set a new password</a></p>'
            '<p style="color:#64748b;font-size:13px;line-height:1.6;margin:20px 0 0">If you did not request this, you can safely ignore this email. The link may only be used once.</p>'
        ),
    )
    try:
        send_email_outlook(
            to_email=to_email,
            subject=subject,
            body=html,
            sender_email=sender,
            sender_password=password,
            smtp_server=smtp_server,
            smtp_port=smtp_port,
        )
        return True
    except Exception as e:
        print(f"[Password reset email failed] {e}")
        return False


def send_otp_email(to_email: str, otp_code: str, purpose: str = "email verification"):
    """Send a branded OTP code email. Best-effort: returns True on success."""
    import os
    sender = os.environ.get("EMAIL_SENDER") or os.environ.get("OUTLOOK_EMAIL") or ""
    password = os.environ.get("EMAIL_PASSWORD") or os.environ.get("OUTLOOK_PASSWORD") or ""
    smtp_server = os.environ.get("EMAIL_HOST") or os.environ.get("SMTP_SERVER", "smtp.gmail.com")
    smtp_port = os.environ.get("EMAIL_PORT") or os.environ.get("SMTP_PORT", 587)
    if not sender or not password:
        return False
    subject = f"Your SERP Hawk CRM verification code: {otp_code}"
    html = branded_email(
        title="Verify your email address",
        body_html=(
            f"<p>Use the code below to complete your {purpose}. This code expires in <strong>10 minutes</strong>.</p>"
            f'<div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;padding:22px;text-align:center;margin:20px 0 0;">'
            f'<span style="font-size:34px;font-weight:800;letter-spacing:8px;color:#1e293b">{otp_code}</span></div>'
            '<p style="color:#64748b;font-size:13px;line-height:1.6;margin:20px 0 0">If you did not request this, you can safely ignore this email.</p>'
        ),
    )
    try:
        send_email_outlook(
            to_email=to_email,
            subject=subject,
            body=html,
            sender_email=sender,
            sender_password=password,
            smtp_server=smtp_server,
            smtp_port=smtp_port,
        )
        return True
    except Exception as e:
        print(f"[OTP email failed] {e}")
        return False


# ── Reply detection (IMAP inbox poller) ──────────────────────────────────────
# No external cron/n8n dependency: a background thread periodically checks the
# configured mailbox for new messages and, when the sender matches the
# `to_email` of a previously sent (and not-yet-replied) SentEmail row, flips
# that row's status to "Replied". Best-effort throughout: any failure here
# must never take down the app.

_reply_checker_started = False
_reply_checker_lock = threading.Lock()


def _get_email_settings():
    sender = os.environ.get("EMAIL_SENDER") or os.environ.get("OUTLOOK_EMAIL") or ""
    password = os.environ.get("EMAIL_PASSWORD") or os.environ.get("OUTLOOK_PASSWORD") or ""
    imap_server = os.environ.get("IMAP_SERVER") or ""
    if not imap_server:
        smtp_server = os.environ.get("EMAIL_HOST") or os.environ.get("SMTP_SERVER", "")
        if smtp_server.startswith("smtp."):
            imap_server = smtp_server.replace("smtp.", "imap.", 1)
    return sender, password, imap_server


_REPLY_BODY_MAX_CHARS = 20000
_REPLY_HTML_MAX_CHARS = 200000

# Common reply/quote-block openers across Gmail, Outlook, Apple Mail, etc.
# Anything from the first match onward is quoted history, not the reply itself.
_QUOTE_HEADER_RE = re.compile(
    r"""^\s*(
        On\ .+?\ wrote:\s*$                                  # Gmail/Apple: "On <date>, <name> <email> wrote:"
        |-{2,}\s*Original\ Message\s*-{2,}\s*$                # Outlook: "-----Original Message-----"
        |-{2,}\s*Forwarded\ message\s*-{2,}\s*$                # Forwarded message header
        |From:\s*.+$                                          # Outlook plain-text quote block start
        |>.*                                                  # Any '>' quoted line
    )""",
    re.IGNORECASE | re.VERBOSE | re.MULTILINE,
)


def _decode_part(part) -> str:
    try:
        payload = part.get_payload(decode=True) or b""
        charset = part.get_content_charset() or "utf-8"
        return payload.decode(charset, errors="replace")
    except Exception:
        return ""


def _get_plain_and_html(msg):
    """Return (plain_text, html_text, cid_map) for an email.message.Message,
    skipping attachments. cid_map maps Content-ID -> data: URI for inline images."""
    plain, html = "", ""
    cid_map = {}
    parts = msg.walk() if msg.is_multipart() else [msg]
    for part in parts:
        if part.get_content_maintype() == "multipart":
            continue
        cid = part.get("Content-ID")
        if cid:
            cid = cid.strip("<>")
            try:
                payload = part.get_payload(decode=True) or b""
                mime = part.get_content_type() or "application/octet-stream"
                cid_map[cid] = f"data:{mime};base64,{base64.b64encode(payload).decode()}"
            except Exception:
                pass
        if part.get("Content-Disposition", "").startswith("attachment"):
            continue
        ctype = part.get_content_type()
        if ctype == "text/plain" and not plain:
            plain = _decode_part(part)
        elif ctype == "text/html" and not html:
            html = _decode_part(part)
    return plain, html, cid_map


def _strip_quoted_text(plain_text: str) -> str:
    """Cut a plain-text reply body at the first quote-block marker, leaving
    just the new message the person actually typed."""
    match = _QUOTE_HEADER_RE.search(plain_text)
    body = plain_text[: match.start()] if match else plain_text
    return re.sub(r"\n{3,}", "\n\n", body).strip()


_ALLOWED_HTML_TAGS = [
    "p", "br", "div", "span", "b", "i", "u", "strong", "em", "a", "ul", "ol", "li",
    "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody",
    "tr", "td", "th", "img", "hr", "pre", "code", "font", "small",
]
_ALLOWED_HTML_ATTRS = {
    "a": ["href", "title", "target"],
    "img": ["src", "alt", "width", "height", "style"],
    "font": ["color", "size", "face"],
    "*": ["style"],
}
_ALLOWED_URL_PROTOCOLS = ["http", "https", "mailto", "data"]


_ALLOWED_CSS_PROPERTIES = [
    "color", "background-color", "background", "font-size", "font-family",
    "font-weight", "font-style", "text-align", "text-decoration", "padding",
    "margin", "border", "border-collapse", "border-radius", "width", "height",
    "max-width", "line-height", "vertical-align", "display",
]


def _sanitize_reply_html(html: str) -> str:
    """
    Strip anything that isn't safe to render in the dashboard (scripts, event
    handlers, forms, iframes, javascript: URLs) while keeping enough tags/
    attributes/CSS to preserve the reply's original formatting and inline
    images (already inlined as data: URIs by the caller).
    """
    import bleach
    from bleach.css_sanitizer import CSSSanitizer
    css_sanitizer = CSSSanitizer(allowed_css_properties=_ALLOWED_CSS_PROPERTIES)
    return bleach.clean(
        html,
        tags=_ALLOWED_HTML_TAGS,
        attributes=_ALLOWED_HTML_ATTRS,
        protocols=_ALLOWED_URL_PROTOCOLS,
        css_sanitizer=css_sanitizer,
        strip=True,
    )


def _build_reply_fields(msg) -> dict:
    """Extract everything worth storing from an inbound reply message."""
    plain, html, cid_map = _get_plain_and_html(msg)
    if not plain and html:
        plain = re.sub(r"<[^>]+>", " ", html)
        plain = re.sub(r"[ \t]+", " ", plain).strip()

    body_text_full = plain[:_REPLY_BODY_MAX_CHARS]
    body_text = _strip_quoted_text(plain)[:_REPLY_BODY_MAX_CHARS]

    body_html = None
    if html:
        for cid, data_uri in cid_map.items():
            html = html.replace(f"cid:{cid}", data_uri)
        try:
            body_html = _sanitize_reply_html(html[:_REPLY_HTML_MAX_CHARS])
        except Exception as e:
            print(f"[Reply checker] HTML sanitize failed, falling back to text-only: {e}")
            body_html = None

    return {
        "body_text": body_text,
        "body_text_full": body_text_full,
        "body_html": body_html,
    }


def _process_inbox_replies(conn, sender_email: str, days_back: int, only_missing: bool = False,
                           tenant_id=None) -> int:
    """
    Shared IMAP scan used by both check_email_replies (regular polling) and
    backfill_reply_content (one-off catch-up for old rows). For every inbox
    message in the window:
      - skip our own archived sent-copy
      - skip it if already recorded (by the *inbound* message's own
        Message-ID) so re-scanning the same date window never duplicates rows
      - match it to the most recently sent email addressed to that sender
        (heuristic: SentEmail.to_email == reply's From address); every reply
        in a thread attaches to that same sent email as its own EmailReply row
      - `only_missing=True` restricts matching to sent emails that don't yet
        have any recorded reply (used by the historical backfill so it never
        touches threads check_email_replies has already picked up)
    Returns the number of EmailReply rows created.
    """
    since_date = (
        __import__("datetime").datetime.utcnow() - __import__("datetime").timedelta(days=days_back)
    ).strftime("%d-%b-%Y")
    typ, data = conn.search(None, f'(SINCE "{since_date}")')
    if typ != "OK" or not data or not data[0]:
        return 0

    uids = data[0].split()
    # Imported here (not at module top) to avoid a hard import-time dependency
    # between modules/email_sender.py and database.py.
    from database import engine, SentEmail, EmailReply
    from sqlmodel import Session, select
    from datetime import datetime as _dt, timezone as _tz

    created = 0
    with Session(engine) as session:
        for uid in uids:
            try:
                # Full RFC822 fetch (not just headers) so the reply's own
                # subject/body/HTML can be stored alongside the status flip.
                typ, msg_data = conn.fetch(uid, "(BODY.PEEK[])")
                if typ != "OK" or not msg_data or not isinstance(msg_data[0], tuple):
                    continue
                msg = email_lib.message_from_bytes(msg_data[0][1])
                from_name, from_addr = parseaddr(msg.get("From", ""))
                from_addr = (from_addr or "").strip().lower()
                if not from_addr or from_addr == sender_email.strip().lower():
                    continue  # our own archived sent-copy, not a real reply

                inbound_message_id = (msg.get("Message-ID") or "").strip()

                # skip_tenant throughout: this function also runs synchronously
                # inside the unauthenticated POST /webhook/check-replies-now
                # (and /webhook/backfill-reply-content) requests, where main.py's
                # tenant-filter listener would otherwise force every query here
                # to see zero rows (see routers/email_tracking.py notes).
                if inbound_message_id:
                    dup_stmt = (
                        select(EmailReply)
                        .where(EmailReply.message_id == inbound_message_id)
                        .execution_options(skip_tenant=True)
                    )
                    if session.exec(dup_stmt).first():
                        continue  # already recorded on a previous poll cycle

                match_stmt = (
                    select(SentEmail)
                    .where(SentEmail.to_email.ilike(from_addr))
                    .order_by(SentEmail.sent_at.desc())
                    .execution_options(skip_tenant=True)
                )
                if only_missing:
                    match_stmt = match_stmt.where(SentEmail.reply_body.is_(None))
                if tenant_id is not None:  # a tenant's / user's own mailbox only matches that tenant's sent mail
                    match_stmt = match_stmt.where(SentEmail.tenant_id == tenant_id)
                match = session.exec(match_stmt).first()
                if not match:
                    continue

                fields = _build_reply_fields(msg)
                reply_row = EmailReply(
                    tenant_id=match.tenant_id,
                    sent_email_id=match.id,
                    message_id=inbound_message_id or None,
                    from_address=msg.get("From", "") or from_addr,
                    subject=(msg.get("Subject", "") or "")[:500],
                    body_text=fields["body_text"],
                    body_text_full=fields["body_text_full"],
                    body_html=fields["body_html"],
                    received_at=_dt.now(_tz.utc),
                )
                session.add(reply_row)

                # Keep the sent_emails snapshot columns pointed at the latest
                # reply, for any older code path still reading them directly.
                match.status = "Replied"
                if not match.replied_at:
                    match.replied_at = reply_row.received_at
                match.reply_from = reply_row.from_address
                match.reply_subject = reply_row.subject
                match.reply_body = reply_row.body_text
                session.add(match)
                session.commit()
                created += 1
            except Exception as inner_e:
                print(f"[Reply checker] error processing message: {inner_e}")
                continue
    return created


def _scan_all_mailboxes(days_back: int, only_missing: bool, label: str, tenant_id=None) -> int:
    """Run the reply scan over every mailbox the CRM syncs: each user's own Email Integration mailbox,
    each tenant's Settings → SMTP mailbox, and the server's env mailbox. Never raises."""
    try:
        from database import engine
        from sqlmodel import Session
        from modules import inbox_sync
        with Session(engine) as session:
            configs = (inbox_sync.mailboxes_for_tenant(session, tenant_id) if tenant_id is not None
                       else inbox_sync.get_mailbox_configs(session))
    except Exception as e:
        print(f"[{label}] could not load mailboxes: {e}")
        return 0
    total = 0
    for cfg in configs:
        conn = None
        try:
            conn = inbox_sync._connect(cfg)
            conn.select("INBOX", readonly=True)
            total += _process_inbox_replies(conn, cfg.address, days_back, only_missing=only_missing,
                                            tenant_id=cfg.tenant_id if cfg.tenant_owned else None)
        except Exception as e:
            print(f"[{label}] IMAP check of {cfg.address} failed: {e}")
        finally:
            if conn is not None:
                try:
                    conn.logout()
                except Exception:
                    pass
    return total


def check_email_replies(days_back: int = 5, tenant_id=None) -> int:
    """
    Scan every configured mailbox's INBOX for messages received in the last `days_back` days, and
    record a matching reply for any SentEmail whose to_email == the message's From address. A thread
    with several replies gets one EmailReply row per message, not a single overwritten field.

    Returns the number of new replies recorded. Never raises.
    """
    return _scan_all_mailboxes(days_back, only_missing=False, label="Reply checker", tenant_id=tenant_id)


def backfill_reply_content(days_back: int = 60, tenant_id=None) -> int:
    """
    One-time catch-up for SentEmail rows that were already flipped to "Replied" by the old header-only
    poller (before reply content was captured at all) and so still have reply_body IS NULL. Re-scans
    the inbox over a wider window and records the reply as a proper EmailReply row, same as the regular
    poller. Never raises.
    """
    return _scan_all_mailboxes(days_back, only_missing=True, label="Reply backfill", tenant_id=tenant_id)


def _reply_checker_loop(interval_seconds: int):
    # Small initial delay so this doesn't compete with app startup for the DB/IMAP connection.
    time.sleep(15)
    while True:
        try:
            n = check_email_replies()
            if n:
                print(f"[Reply checker] marked {n} email(s) as Replied.")
        except Exception as e:
            print(f"[Reply checker] loop error: {e}")
        time.sleep(interval_seconds)


def start_reply_checker_thread():
    """Start the background IMAP reply-polling loop once per process. Safe to call multiple times."""
    global _reply_checker_started
    with _reply_checker_lock:
        if _reply_checker_started:
            return
        interval = int(os.environ.get("REPLY_CHECK_INTERVAL_SECONDS", "180"))
        t = threading.Thread(target=_reply_checker_loop, args=(interval,), daemon=True)
        t.start()
        _reply_checker_started = True
        print(f"[Reply checker] started, polling every {interval}s.")
        return False