"""
Open / reply tracking (routers/email_tracking.py, modules/email_sender.py, the /sent-emails routes in
main.py) plus the reply-webhook guard and the BACKGROUND_JOBS switch. In-memory SQLite, fake SMTP and
IMAP; nothing here reaches a network or a real database.

    venv\\Scripts\\python -m unittest discover -s tests -t . -v
"""
import email as email_lib
import os
import unittest
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from starlette.middleware.base import BaseHTTPMiddleware

from database import EmailReply, Lead, SentEmail, Tenant, User
from modules import email_sender
from modules.api_tracker import current_salesperson_id
from routers import email_tracking
from tests._support import ENGINE, main_client, reset_db, use_engine

ADMIN, SALES, EMPLOYEE, ADMIN_T2, ROOT = 1, 2, 4, 5, 9


def utcnow_db():
    """Seed value for sent_at / opened_at. sqlmodel 0.0.47 only accepts aware datetimes; the rows still come
    back naive on 0.0.34 (timestamp without time zone), so the code under test sees both shapes."""
    return datetime.now(timezone.utc)


class _Identity(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        uid = request.headers.get("X-User-ID", "")
        current_salesperson_id.set(int(uid) if uid.isdigit() else None)
        return await call_next(request)


def seed_people():
    with Session(ENGINE) as s:
        s.add_all([Tenant(id=1, name="BPO", business_name="SCM BPO"), Tenant(id=2, name="Other")])
        s.add_all([
            User(id=ADMIN, tenant_id=1, email="admin@scmbpo.test", password="x", name="Ada Admin", role="Admin"),
            User(id=SALES, tenant_id=1, email="sam@scmbpo.test", password="x", name="Sam Sales", role="SalesManager"),
            User(id=EMPLOYEE, tenant_id=1, email="eve@scmbpo.test", password="x", name="Eve", role="Employee"),
            User(id=ADMIN_T2, tenant_id=2, email="admin2@other.test", password="x", name="Other Admin", role="admin"),
            User(id=ROOT, tenant_id=1, email="root@scmbpo.test", password="x", name="Root", role="SuperAdmin"),
        ])
        s.add(Lead(id=1, tenant_id=1, company_name="Asha Freight", email="asha@example.test", owner_id=SALES))
        s.commit()


class DBTestCase(unittest.TestCase):
    def setUp(self):
        use_engine(self)
        reset_db()
        seed_people()


# ─────────────────────────────────────────────────────────────────────────────
# Open-tracking pixel
# ─────────────────────────────────────────────────────────────────────────────
class PixelTests(DBTestCase):
    def setUp(self):
        super().setUp()
        self.client = main_client(self)

    def add_email(self, id, sent_ago, status="Sent", tenant_id=1):
        with Session(ENGINE) as s:
            s.add(SentEmail(id=id, tenant_id=tenant_id, lead_id=1, to_email="asha@example.test", subject="Hi",
                            status=status, sent_at=utcnow_db() - sent_ago))  # read back naive on 0.0.34, aware on 0.0.47
            s.commit()

    def hit(self, id):
        r = self.client.get("/webhook/track-email-open", params={"id": id})  # no identity: mail-provider proxy
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["content-type"], "image/gif")
        with Session(ENGINE) as s:
            return s.get(SentEmail, id)

    def test_prefetch_right_after_sending_counts_as_delivered(self):
        self.add_email(1, timedelta(seconds=5))
        row = self.hit(1)
        self.assertEqual((row.status, row.open_count), ("Delivered", 1))
        self.assertIsNotNone(row.opened_at)
        self.assertEqual(row.opened_at, row.last_opened_at)

    def test_a_later_hit_is_an_open_and_counts_accumulate(self):
        self.add_email(1, timedelta(minutes=10))
        self.hit(1)
        row = self.hit(1)
        self.assertEqual((row.status, row.open_count), ("Opened", 2))

    def test_the_ambiguous_gap_leaves_the_status_alone(self):
        self.add_email(1, timedelta(seconds=120))
        self.assertEqual(self.hit(1).status, "Sent")

    def test_never_downgrades_a_replied_email(self):
        self.add_email(1, timedelta(minutes=10), status="Replied")
        row = self.hit(1)
        self.assertEqual((row.status, row.open_count), ("Replied", 1))

    def test_unauthenticated_lookup_skips_the_tenant_filter(self):
        # main.py's middleware gives anonymous requests tenant -1 and the global do_orm_execute listener
        # would hide every row; the pixel must still find tenant 2's email.
        self.add_email(7, timedelta(minutes=10), tenant_id=2)
        self.assertEqual(self.hit(7).status, "Opened")

    def test_unknown_id_still_returns_the_pixel(self):
        r = self.client.get("/webhook/track-email-open", params={"id": 999})
        self.assertEqual((r.status_code, r.headers["content-type"]), (200, "image/gif"))


class ReplyWebhookTests(DBTestCase):
    def setUp(self):
        super().setUp()
        self.client = main_client(self)
        with Session(ENGINE) as s:
            s.add(SentEmail(id=1, tenant_id=2, to_email="asha@example.test", subject="Old", sent_at=utcnow_db() - timedelta(days=2)))
            s.add(SentEmail(id=2, tenant_id=2, to_email="asha@example.test", subject="New", sent_at=utcnow_db()))
            s.commit()

    def test_by_id_and_by_address(self):
        r = self.client.post("/webhook/track-email-reply", json={"email_id": 1, "reply_subject": "Re: Old", "reply_body": "Yes"})
        self.assertEqual(r.json()["status"], "success")
        r = self.client.post("/webhook/track-email-reply", json={"email": "asha@example.test"})
        self.assertEqual(r.json()["status"], "success")
        with Session(ENGINE) as s:
            old, new = s.get(SentEmail, 1), s.get(SentEmail, 2)
        self.assertEqual((old.status, old.reply_subject, old.reply_body), ("Replied", "Re: Old", "Yes"))
        self.assertEqual(new.status, "Replied")  # the most recent email to that address
        self.assertIsNotNone(new.replied_at)
        self.assertEqual(self.client.post("/webhook/track-email-reply", json={"email": "nobody@x.test"}).json()["status"], "error")


# ─────────────────────────────────────────────────────────────────────────────
# /webhook/check-replies-now and /backfill-reply-content guard (D11)
# ─────────────────────────────────────────────────────────────────────────────
class WebhookGuardTests(DBTestCase):
    """These log in to mailboxes, so they are admin-only, tenant-scoped and rate-limited.
    (The open pixel and reply webhooks stay public.)"""

    def setUp(self):
        super().setUp()
        email_tracking._cooldowns.clear()
        app = FastAPI()
        app.add_middleware(_Identity)
        app.include_router(email_tracking.router)
        self.client = TestClient(app)

    def post(self, url, user=None):
        return self.client.post(url, headers={"X-User-ID": str(user)} if user else {})

    def test_only_admins_may_trigger_scans_and_only_for_their_own_company(self):
        self.assertEqual(self.post("/webhook/check-replies-now").status_code, 401)
        self.assertEqual(self.post("/webhook/check-replies-now", user=SALES).status_code, 403)
        self.assertEqual(self.post("/webhook/check-replies-now", user=EMPLOYEE).status_code, 403)
        with mock.patch.object(email_sender, "check_email_replies", return_value=2) as scan:
            r = self.post("/webhook/check-replies-now", user=ADMIN)
            self.assertEqual((r.status_code, r.json()), (200, {"status": "ok", "updated": 2}))
            scan.assert_called_once_with(tenant_id=1)
            self.assertEqual(self.post("/webhook/check-replies-now", user=ADMIN).status_code, 429)  # rate limited
            self.assertEqual(self.post("/webhook/check-replies-now", user=ADMIN_T2).status_code, 200)  # per tenant; lower-case role
            self.assertEqual(scan.call_args.kwargs, {"tenant_id": 2})
            self.assertEqual(self.post("/webhook/check-replies-now", user=ROOT).status_code, 200)
            self.assertEqual(scan.call_args.kwargs, {"tenant_id": None})  # SuperAdmin: every mailbox

    def test_backfill_is_admin_only_bounded_and_rate_limited(self):
        self.assertEqual(self.post("/webhook/backfill-reply-content", user=SALES).status_code, 403)
        with mock.patch.object(email_sender, "backfill_reply_content", return_value=3) as fill:
            self.assertEqual(self.post("/webhook/backfill-reply-content?days_back=999", user=ADMIN).status_code, 422)
            r = self.post("/webhook/backfill-reply-content?days_back=30", user=ADMIN)
            self.assertEqual((r.status_code, r.json()["filled"]), (200, 3))
            fill.assert_called_once_with(days_back=30, tenant_id=1)
            self.assertEqual(self.post("/webhook/backfill-reply-content", user=ADMIN).status_code, 429)

    def test_public_webhooks_stay_public(self):
        self.assertEqual(self.client.get("/webhook/track-email-open", params={"id": 1}).status_code, 200)
        self.assertEqual(self.client.post("/webhook/track-email-reply", json={}).status_code, 200)


class BackgroundSwitchTests(unittest.TestCase):
    def test_background_jobs_switch(self):
        from modules import background
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("BACKGROUND_JOBS", None)
            self.assertTrue(background.jobs_enabled())
        for off in ("0", "false", "No", "OFF", " 0 "):
            with mock.patch.dict(os.environ, {"BACKGROUND_JOBS": off}):
                self.assertFalse(background.jobs_enabled(), off)
        with mock.patch.dict(os.environ, {"BACKGROUND_JOBS": "1"}):
            self.assertTrue(background.jobs_enabled())

    def test_startup_starts_no_poller_when_switched_off(self):
        from tests._support import load_main
        main = load_main()
        with mock.patch.dict(os.environ, {"BACKGROUND_JOBS": "0"}), \
                mock.patch.object(main, "_ensure_email_tables"), \
                mock.patch.object(email_sender, "start_reply_checker_thread") as reply_checker:
            main._email_stack_startup()
        reply_checker.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# SMTP send: pixel, SCM From default, escaping
# ─────────────────────────────────────────────────────────────────────────────
class FakeSMTP:
    instances = []

    def __init__(self, host, port, timeout=None, context=None):
        self.host, self.port = host, port
        self.calls = []
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def ehlo(self):
        self.calls.append("ehlo")

    def starttls(self, **kwargs):
        self.calls.append("starttls")

    def login(self, user, pw):
        self.calls.append(("login", user, pw))

    def send_message(self, msg):
        self.msg = msg


class FakeSSL(FakeSMTP):
    pass


class SmtpTests(unittest.TestCase):
    def setUp(self):
        FakeSMTP.instances = []
        for name, fake in (("SMTP", FakeSMTP), ("SMTP_SSL", FakeSSL)):
            p = mock.patch.object(email_sender.smtplib, name, fake)
            p.start()
            self.addCleanup(p.stop)
        for name, value in (("_archive_sent_copy", None), ("_scmbpo_logo_bytes", None)):
            p = mock.patch.object(email_sender, name, return_value=value)
            p.start()
            self.addCleanup(p.stop)

    def send(self, **kw):
        args = dict(to_email="to@example.test", subject="Hello", body="Plain body", sender_email="crm@scmbpo.test",
                    sender_password="pw", smtp_server="smtp.scmbpo.test")
        args.update(kw)
        email_sender.send_email_outlook(**args)
        return FakeSMTP.instances[-1]

    def test_scm_from_default_and_extra_headers(self):
        msg = self.send().msg
        self.assertEqual(msg["From"], "SCMHub Logistics <crm@scmbpo.test>")
        msg = self.send(extra_headers={"From": "Ada Admin <ada@scmbpo.test>", "Message-ID": "<mine@scmbpo.test>",
                                       "In-Reply-To": "<theirs@x>", "References": "<theirs@x>", "Cc": "cc@x.test",
                                       "Bcc": None}).msg
        self.assertEqual(msg.get_all("From"), ["Ada Admin <ada@scmbpo.test>"])
        self.assertEqual(msg.get_all("Message-ID"), ["<mine@scmbpo.test>"])
        self.assertEqual((msg["In-Reply-To"], msg["Cc"], msg["Bcc"]), ("<theirs@x>", "cc@x.test", None))

    def test_security_modes(self):
        ssl_conn = self.send(security="ssl", smtp_port=465, auth_user="login@scmbpo.test")
        self.assertIsInstance(ssl_conn, FakeSSL)
        self.assertIn(("login", "login@scmbpo.test", "pw"), ssl_conn.calls)
        starttls = self.send(security="starttls")
        self.assertNotIsInstance(starttls, FakeSSL)
        self.assertIn("starttls", starttls.calls)
        plain = self.send(security="none", smtp_port=25)
        self.assertNotIn("starttls", plain.calls)
        self.assertIsInstance(self.send(smtp_port=465), FakeSSL)  # legacy port heuristic
        self.assertIn("starttls", self.send(smtp_port=587).calls)

    def test_tracking_pixel_only_with_a_public_base_url(self):
        html = self.send(tracking_id=42, tracking_base_url="https://api.scmbpo.test/").msg.as_string()
        self.assertIn("https://api.scmbpo.test/webhook/track-email-open?id=42", html)
        self.assertNotIn("track-email-open", self.send(tracking_id=42, tracking_base_url=None).msg.as_string())

    def test_plain_text_is_escaped_inside_the_branded_shell(self):
        raw = self.send(body="Hi <b>there</b>\nline two").msg.as_string()
        self.assertIn("&lt;b&gt;there&lt;/b&gt;<br>line two", email_lib.message_from_string(raw).get_payload()[0].get_payload(decode=True).decode())


# ─────────────────────────────────────────────────────────────────────────────
# Reply parsing and matching
# ─────────────────────────────────────────────────────────────────────────────
def reply_message(frm="Asha <asha@example.test>", subject="Re: Freight quote", message_id="<r1@example.test>",
                  text="Yes, please book the container.\n\nOn Mon, Ada wrote:\n> Freight quote", html=None):
    msg = MIMEMultipart("alternative")
    msg["From"] = frm
    msg["To"] = "crm@scmbpo.test"
    msg["Subject"] = subject
    if message_id:
        msg["Message-ID"] = message_id
    msg.attach(MIMEText(text, "plain", "utf-8"))
    if html:
        msg.attach(MIMEText(html, "html", "utf-8"))
    return msg.as_bytes()


class FakeMailbox:
    def __init__(self, raws):
        self.raws = raws

    def search(self, charset, criteria):
        return "OK", [" ".join(str(i + 1) for i in range(len(self.raws))).encode()]

    def fetch(self, uid, spec):
        return "OK", [(b"1 (BODY[] {1}", self.raws[int(uid) - 1]), b")"]


class ReplyParsingTests(DBTestCase):
    def test_fields_strip_quotes_and_sanitize_html(self):
        msg = email_lib.message_from_bytes(reply_message(
            html='<p onclick="x()">Yes <b>please</b></p><script>alert(1)</script><img src="cid:logo1">'))
        fields = email_sender._build_reply_fields(msg)
        self.assertEqual(fields["body_text"], "Yes, please book the container.")
        self.assertIn("> Freight quote", fields["body_text_full"])
        self.assertNotIn("<script", fields["body_html"])
        self.assertNotIn("onclick", fields["body_html"])
        self.assertIn("<b>please</b>", fields["body_html"])

    def seed_sent(self):
        with Session(ENGINE) as s:
            s.add(SentEmail(id=1, tenant_id=1, lead_id=1, to_email="Asha@Example.test", subject="Freight quote",
                            sent_at=utcnow_db() - timedelta(days=2)))
            s.add(SentEmail(id=2, tenant_id=1, lead_id=1, to_email="asha@example.test", subject="Transit times",
                            sent_at=utcnow_db() - timedelta(days=1)))
            s.add(SentEmail(id=3, tenant_id=2, to_email="asha@example.test", subject="Other tenant",
                            sent_at=utcnow_db() - timedelta(hours=1)))
            s.commit()

    def test_replies_attach_to_the_latest_matching_email_once(self):
        self.seed_sent()
        box = FakeMailbox([reply_message(), reply_message(frm="crm@scmbpo.test", message_id="<own@x>")])
        self.assertEqual(email_sender._process_inbox_replies(box, "crm@scmbpo.test", 5, tenant_id=1), 1)
        self.assertEqual(email_sender._process_inbox_replies(box, "crm@scmbpo.test", 5, tenant_id=1), 0)  # deduped
        with Session(ENGINE) as s:
            sent = s.get(SentEmail, 2)
            reply = s.exec(select(EmailReply)).one()
            self.assertEqual((sent.status, sent.reply_subject, sent.reply_body),
                             ("Replied", "Re: Freight quote", "Yes, please book the container."))
            self.assertIsNotNone(sent.replied_at)
            self.assertEqual((reply.sent_email_id, reply.tenant_id, reply.message_id), (2, 1, "<r1@example.test>"))
            self.assertEqual(s.get(SentEmail, 3).status, "Sent")  # tenant-owned mailbox never matches another tenant

    def test_without_a_tenant_scope_the_newest_email_anywhere_wins(self):
        self.seed_sent()
        email_sender._process_inbox_replies(FakeMailbox([reply_message()]), "crm@scmbpo.test", 5)
        with Session(ENGINE) as s:
            self.assertEqual(s.get(SentEmail, 3).status, "Replied")

    def test_backfill_only_touches_emails_without_reply_content(self):
        self.seed_sent()
        with Session(ENGINE) as s:
            for i in (1, 2, 3):
                row = s.get(SentEmail, i)
                row.reply_body = "already captured" if i != 1 else None
                s.add(row)
            s.commit()
        email_sender._process_inbox_replies(FakeMailbox([reply_message()]), "crm@scmbpo.test", 60, only_missing=True)
        with Session(ENGINE) as s:
            self.assertEqual(s.exec(select(EmailReply)).one().sent_email_id, 1)

    def test_scan_never_raises_without_mailboxes(self):
        self.assertEqual(email_sender.check_email_replies(), 0)


# ─────────────────────────────────────────────────────────────────────────────
# main.py: /sent-emails, delete, bulk delete, lead history, send-manual pixel
# ─────────────────────────────────────────────────────────────────────────────
class SentEmailRoutesTests(DBTestCase):
    def setUp(self):
        super().setUp()
        self.client = main_client(self)
        with Session(ENGINE) as s:
            s.add(SentEmail(id=1, tenant_id=1, lead_id=1, to_email="asha@example.test", subject="Freight quote",
                            status="Opened", open_count=3, opened_at=utcnow_db(), sent_at=utcnow_db()))
            s.add(SentEmail(id=2, tenant_id=1, lead_id=1, to_email="asha@example.test", subject="Rates",
                            sent_at=utcnow_db() - timedelta(days=1)))
            s.add(SentEmail(id=3, tenant_id=1, to_email="x@example.test", subject="Other", sent_at=utcnow_db()))
            s.add(EmailReply(tenant_id=1, sent_email_id=1, message_id="<r@x>", from_address="asha@example.test",
                             subject="Re: Freight quote", body_text="Thanks", received_at=datetime.now(timezone.utc)))
            s.commit()

    def get(self, url, **kw):
        return self.client.get(url, headers={"X-User-ID": str(ADMIN)}, **kw)

    def test_list_includes_tracking_and_replies(self):
        data = self.get("/sent-emails").json()
        first = next(e for e in data["emails"] if e["id"] == 1)
        self.assertEqual((first["status"], first["open_count"]), ("Opened", 3))
        self.assertIsNotNone(first["opened_at"])
        self.assertEqual([r["body_text"] for r in first["replies"]], ["Thanks"])
        lead = self.get("/leads/1/sent-emails").json()["emails"]
        self.assertEqual({e["id"]: len(e["replies"]) for e in lead}, {1: 1, 2: 0})

    def test_delete_and_bulk_delete(self):
        h = {"X-User-ID": str(ADMIN)}
        self.assertEqual(self.client.delete("/sent-emails/2", headers=h).json(), {"ok": True})
        self.assertEqual(self.client.delete("/sent-emails/2", headers=h).status_code, 404)
        r = self.client.post("/sent-emails/bulk-delete", json={"ids": [3, 404]}, headers=h)
        self.assertEqual((r.status_code, r.json()), (200, {"ok": True, "deleted": 1}))
        self.assertEqual(self.client.post("/sent-emails/bulk-delete", json={"ids": []}, headers=h).json()["deleted"], 0)
        with Session(ENGINE) as s:
            self.assertEqual([e.id for e in s.exec(select(SentEmail)).all()], [1])

    @mock.patch.dict(os.environ, {"EMAIL_SENDER": "crm@scmbpo.test", "EMAIL_PASSWORD": "pw",
                                  "SMTP_SERVER": "smtp.scmbpo.test", "PUBLIC_BASE_URL": "https://api.scmbpo.test"})
    def test_send_manual_tracks_the_row_it_just_created(self):
        with mock.patch.object(email_sender, "send_email_outlook") as send, mock.patch("httpx.post") as webhook:
            r = self.client.post("/send-manual", headers={"X-User-ID": str(ADMIN)}, json={
                "to_email": "asha@example.test", "company_name": "Asha Freight", "subject": "Your freight quote",
                "english_body": "Hi Asha", "action_type": "System"})
        self.assertEqual(r.status_code, 200, r.text)
        new_id = r.json()["sent_email_id"]
        kw = send.call_args.kwargs
        self.assertEqual((kw["tracking_id"], kw["tracking_base_url"]), (new_id, "https://api.scmbpo.test"))
        webhook.assert_called_once()
        with Session(ENGINE) as s:
            self.assertEqual(s.get(SentEmail, new_id).status, "Sent")


if __name__ == "__main__":
    unittest.main()
