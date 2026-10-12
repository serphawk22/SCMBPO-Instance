"""
Tests for the Inbox (modules/inbox_sync.py, modules/email_ai.py, routers/inbox.py), ported from
serphawk_crm_seo (SCM BPO uses the same roles). Self-contained: in-memory SQLite, fake
IMAP/SMTP, stubbed OpenAI. tests/__init__.py has already disabled .env loading and dropped the mail
/ OpenAI variables; every engine reference is repointed at SQLite for each test.

    venv\\Scripts\\python -m unittest discover -s tests -t . -v
"""
import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.header import Header
from unittest import mock

import database  # noqa: E402

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session, select  # noqa: E402
from starlette.middleware.base import BaseHTTPMiddleware  # noqa: E402

from database import (  # noqa: E402
    ActivityLog, ClientProfile, ConversationLog, CRMQuote, EmailReply, InboxMessage, Lead, SentEmail, Task,
    Tenant, User,
)
from modules import email_ai, email_sender, inbox_sync  # noqa: E402
from modules.api_tracker import current_salesperson_id  # noqa: E402
from routers import inbox as inbox_router  # noqa: E402
from tests._support import ENGINE, reset_db, use_engine  # noqa: E402

NOW = datetime.now(timezone.utc)


def _test_session():
    with Session(ENGINE) as s:
        yield s


class _Identity(BaseHTTPMiddleware):
    """Stand-in for main.APIIntelligenceMiddleware's X-User-ID handling."""

    async def dispatch(self, request, call_next):
        uid = request.headers.get("X-User-ID", "")
        current_salesperson_id.set(int(uid) if uid.isdigit() else None)
        return await call_next(request)


def make_app():
    app = FastAPI()
    app.add_middleware(_Identity)
    app.include_router(inbox_router.router)
    app.dependency_overrides[inbox_router.get_session] = _test_session
    return app


def raw_email(*, frm, to="crm@agency.test", subject="Hello", text="Hi there", html=None, message_id="<m1@x.test>",
              date=None, attachment=None, in_reply_to=None):
    msg = MIMEMultipart("mixed")
    msg["From"] = frm
    msg["To"] = to
    msg["Subject"] = subject
    if message_id:
        msg["Message-ID"] = message_id
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    msg["Date"] = (date or NOW).strftime("%a, %d %b %Y %H:%M:%S +0000")
    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(text, "plain", "utf-8"))
    if html:
        alt.attach(MIMEText(html, "html", "utf-8"))
    msg.attach(alt)
    if attachment:
        part = MIMEApplication(b"%PDF-1.4 fake", Name=attachment)
        part["Content-Disposition"] = f'attachment; filename="{attachment}"'
        msg.attach(part)
    return msg.as_bytes()


class FakeIMAP:
    """Just enough of imaplib.IMAP4 for sync_mailbox: UID SEARCH + UID FETCH."""

    def __init__(self, messages, uid_after_literal=False):
        self.messages = {str(i + 1): raw for i, raw in enumerate(messages)}
        self.full_fetches = []
        self.uid_after_literal = uid_after_literal

    def select(self, mailbox, readonly=False):
        return "OK", [str(len(self.messages)).encode()]

    def uid(self, command, *args):
        if command == "SEARCH":
            return "OK", [" ".join(self.messages).encode()]
        uid_set, spec = args
        out = []
        for uid in uid_set.split(","):
            raw = self.messages[uid]
            if "HEADER.FIELDS" in spec:
                header_blob = raw.split(b"\n\n", 1)[0].replace(b"\r\n", b"\n")
                if self.uid_after_literal:  # e.g. b'1 (BODY[...] {85}', <data>, b' UID 1)'
                    out.append((f"{uid} (BODY[HEADER.FIELDS] {{1}}".encode(), header_blob + b"\n\n"))
                    out.append(f" UID {uid})".encode())
                    continue
                out.append((f"{uid} (UID {uid} BODY[HEADER.FIELDS] {{1}}".encode(), header_blob + b"\n\n"))
            else:
                self.full_fetches.append(uid)
                out.append((f"{uid} (UID {uid} BODY[] {{1}}".encode(), raw))
            out.append(b")")
        return "OK", out

    def logout(self):
        return "BYE", []


class DBTestCase(unittest.TestCase):
    def setUp(self):
        use_engine(self)
        reset_db()
        inbox_router._view_summaries._data.clear()
        inbox_router._thread_summaries._data.clear()
        with inbox_sync._status_lock:
            inbox_sync._mailbox_status.clear()


# ─────────────────────────────────────────────────────────────────────────────
# Parsing + IMAP sync
# ─────────────────────────────────────────────────────────────────────────────
class ParseMessageTests(unittest.TestCase):
    def test_parses_headers_bodies_and_attachments(self):
        subject = str(Header("Präsentation – pricing?", "utf-8"))
        raw = raw_email(
            frm='"Jane Doe" <Jane@Acme.com>', subject=subject,
            text="Can you send pricing?\n\nOn Mon, Bob wrote:\n> old stuff",
            html="<html><head><style>p{color:red}</style></head><body><p>Can you send <b>pricing</b>?</p>"
                 "<script>alert(1)</script></body></html>",
            attachment="brief.pdf", in_reply_to="<sent-1@agency.test>",
        )
        parsed = inbox_sync.parse_message(raw)
        self.assertEqual(parsed["from_address"], "jane@acme.com")
        self.assertEqual(parsed["from_name"], "Jane Doe")
        self.assertEqual(parsed["subject"], "Präsentation – pricing?")
        self.assertEqual(parsed["message_id"], "<m1@x.test>")
        self.assertEqual(parsed["in_reply_to"], "<sent-1@agency.test>")
        self.assertEqual(parsed["body_text"], "Can you send pricing?")  # quoted history stripped
        self.assertIn("> old stuff", parsed["body_text_full"])
        self.assertNotIn("<script", parsed["body_html"])
        self.assertEqual([a["filename"] for a in parsed["attachments"]], ["brief.pdf"])
        self.assertEqual(parsed["snippet"], "Can you send pricing?")

    def test_html_only_message_gets_readable_text_and_stable_synthetic_key(self):
        msg = MIMEText("<html><head><style>.x{}</style></head><body><p>Hello&nbsp;team</p><p>Line 2</p></body></html>", "html")
        msg["From"] = "x@y.com"
        msg["Subject"] = "No id"
        msg["Date"] = "Mon, 05 Oct 2026 10:00:00 +0000"
        parsed = inbox_sync.parse_message(msg.as_bytes())
        self.assertNotIn(".x{}", parsed["body_text_full"])
        self.assertIn("Hello", parsed["body_text_full"])
        self.assertTrue(parsed["message_id"].startswith("synthetic-"))
        self.assertEqual(parsed["message_id"], inbox_sync.parse_message(msg.as_bytes())["message_id"])


class SyncTests(DBTestCase):
    def seed(self):
        with Session(ENGINE) as s:
            s.add_all([Tenant(id=1, name="Agency"), Tenant(id=2, name="Other")])
            s.add(Lead(id=1, tenant_id=1, company_name="Acme", email="jane@acme.com"))
            s.add(Lead(id=2, tenant_id=2, company_name="Acme (other tenant)", email="bob@beta.com"))
            s.add(SentEmail(id=10, tenant_id=2, lead_id=2, to_email="bob@beta.com", subject="Hi Bob", status="Sent"))
            s.commit()

    def cfg(self, tenant_owned=False):
        return inbox_sync.MailboxConfig("crm@agency.test", "crm@agency.test", "pw", "imap.agency.test", 1, tenant_owned)

    def test_sync_creates_links_skips_own_copies_and_dedupes(self):
        self.seed()
        imap = FakeIMAP([
            raw_email(frm="Jane <jane@acme.com>", subject="Pricing?", message_id="<a@x>"),
            raw_email(frm="crm@agency.test", subject="Our own archived copy", message_id="<own@x>"),
            raw_email(frm="bob@beta.com", subject="Re: Hi Bob", message_id="<b@x>"),
            raw_email(frm="stranger@random.com", subject="Partnership", message_id="<c@x>"),
        ])
        stats = inbox_sync.sync_mailbox(self.cfg(), ENGINE, connect=lambda cfg: imap)
        self.assertIsNone(stats["error"])
        self.assertEqual(stats["created"], 3)
        self.assertNotIn("2", imap.full_fetches, "own sent-copy must be skipped before the full fetch")

        with Session(ENGINE) as s:
            rows = {m.from_address: m for m in s.exec(select(InboxMessage)).all()}
        self.assertEqual(rows["jane@acme.com"].lead_id, 1)
        self.assertEqual(rows["jane@acme.com"].tenant_id, 1)
        # A reply to an email tenant 2 sent through the shared mailbox goes to tenant 2.
        self.assertEqual(rows["bob@beta.com"].tenant_id, 2)
        self.assertEqual(rows["bob@beta.com"].sent_email_id, 10)
        self.assertIsNone(rows["stranger@random.com"].lead_id)

        again = inbox_sync.sync_mailbox(self.cfg(), ENGINE, connect=lambda cfg: imap)
        self.assertEqual(again["created"], 0)
        self.assertEqual(len(imap.full_fetches), 3, "known messages are not fetched again")

    def test_servers_that_send_uid_after_the_header_literal(self):
        self.seed()
        imap = FakeIMAP([raw_email(frm="jane@acme.com", message_id="<a@x>"), raw_email(frm="z@z.com", message_id="<z@x>")],
                        uid_after_literal=True)
        self.assertEqual(inbox_sync.sync_mailbox(self.cfg(), ENGINE, connect=lambda cfg: imap)["created"], 2)

    def test_tenant_owned_mailbox_never_links_across_tenants(self):
        self.seed()
        imap = FakeIMAP([raw_email(frm="bob@beta.com", subject="Re: Hi Bob", message_id="<b@x>")])
        inbox_sync.sync_mailbox(self.cfg(tenant_owned=True), ENGINE, connect=lambda cfg: imap)
        with Session(ENGINE) as s:
            row = s.exec(select(InboxMessage)).one()
        self.assertEqual(row.tenant_id, 1)
        self.assertIsNone(row.sent_email_id)
        self.assertIsNone(row.lead_id)

    def test_mailbox_configs_prefer_tenant_settings_and_dedupe_the_env_mailbox(self):
        self.seed()
        with Session(ENGINE) as s:
            s.add(database.EmailSettings(tenant_id=2, smtp_host="smtp.other.test", smtp_port=587, smtp_user="ops@other.test",
                                         smtp_pass="pw2", from_name="Ops", from_email="ops@other.test"))
            s.commit()
        env = {"EMAIL_SENDER": "crm@agency.test", "EMAIL_PASSWORD": "pw", "IMAP_SERVER": "imap.agency.test"}
        with mock.patch.dict(os.environ, env), Session(ENGINE) as s:
            configs = inbox_sync.get_mailbox_configs(s)
            self.assertEqual([(c.address, c.imap_host, c.tenant_id, c.tenant_owned) for c in configs], [
                ("ops@other.test", "imap.other.test", 2, True),
                ("crm@agency.test", "imap.agency.test", 1, False),
            ])
            self.assertEqual([c.address for c in inbox_sync.mailboxes_for_tenant(s, 2)], ["ops@other.test"])

    def test_connection_failure_is_reported_not_raised(self):
        def boom(cfg):
            raise OSError("connection refused")
        stats = inbox_sync.sync_mailbox(self.cfg(), ENGINE, connect=boom)
        self.assertIn("connection refused", stats["error"])
        self.assertIn("connection refused", inbox_sync.get_sync_status()["crm@agency.test"]["last_error"])

    def test_legacy_replies_are_imported_once(self):
        self.seed()
        with Session(ENGINE) as s:
            s.add(EmailReply(tenant_id=2, sent_email_id=10, message_id="<r1@x>", from_address="Bob <bob@beta.com>",
                             subject="Re: Hi Bob", body_text="Sounds good"))
            s.commit()
        with mock.patch.dict(os.environ, {"EMAIL_SENDER": "crm@agency.test"}):
            self.assertEqual(inbox_sync.import_legacy_replies(ENGINE), 1)
            self.assertEqual(inbox_sync.import_legacy_replies(ENGINE), 0)
        with Session(ENGINE) as s:
            row = s.exec(select(InboxMessage)).one()
        self.assertEqual((row.tenant_id, row.lead_id, row.sent_email_id, row.from_address), (2, 2, 10, "bob@beta.com"))

    def test_relink_attaches_messages_from_senders_who_became_leads(self):
        self.seed()
        with Session(ENGINE) as s:
            s.add(InboxMessage(tenant_id=1, mailbox="crm@agency.test", message_id="<n@x>", from_address="new@lead.com",
                               received_at=NOW))
            s.commit()
            s.add(Lead(id=3, tenant_id=1, company_name="New Co", email="New@Lead.com"))
            s.commit()
        self.assertEqual(inbox_sync.relink_unlinked(ENGINE), 1)
        with Session(ENGINE) as s:
            self.assertEqual(s.exec(select(InboxMessage)).one().lead_id, 3)


class DraftRuleTests(unittest.TestCase):
    def test_unknown_sender_never_gets_a_placeholder_signature(self):
        rules = email_ai._draft_rules("", "", "professional")
        self.assertIn("never a placeholder name", rules)
        self.assertNotIn("at our agency", rules)
        self.assertIn("first name (Ada)", email_ai._draft_rules("Ada Admin", "", "friendly"))


class ClassifyTests(DBTestCase):
    def test_classify_pending_stores_validated_triage(self):
        with Session(ENGINE) as s:
            s.add(Tenant(id=1, name="Agency"))
            s.add(InboxMessage(id=1, tenant_id=1, mailbox="m", message_id="<1>", from_address="a@b.com", subject="Need a quote"))
            s.add(InboxMessage(id=2, tenant_id=1, mailbox="m", message_id="<2>", from_address="c@d.com", subject="Newsletter"))
            s.commit()
        fake = {"results": [
            {"key": "1", "category": "pricing", "priority": "high", "sentiment": "positive", "needs_reply": True, "summary": "Wants a quote."},
            {"key": "2", "category": "made-up", "priority": "urgent!!", "sentiment": "??", "needs_reply": False, "summary": "Promo."},
        ]}
        with mock.patch.object(email_ai, "_chat_json", return_value=fake):
            self.assertEqual(email_ai.classify_pending(ENGINE), 2)
        with Session(ENGINE) as s:
            one, two = s.get(InboxMessage, 1), s.get(InboxMessage, 2)
        self.assertEqual((one.ai_category, one.ai_priority, one.ai_needs_reply), ("pricing", "high", True))
        self.assertEqual((two.ai_category, two.ai_priority, two.ai_sentiment), ("other", "medium", "neutral"))
        self.assertIsNotNone(two.ai_classified_at)


# ─────────────────────────────────────────────────────────────────────────────
# API
# ─────────────────────────────────────────────────────────────────────────────
ADMIN, SALES, OTHER_SALES, INTERN, ADMIN_T2 = 1, 2, 3, 4, 5


class ApiTestCase(DBTestCase):
    def setUp(self):
        super().setUp()
        self.client = TestClient(make_app())
        with Session(ENGINE) as s:
            s.add_all([Tenant(id=1, name="Agency", business_name="SCM BPO"), Tenant(id=2, name="Other")])
            s.add_all([
                User(id=ADMIN, tenant_id=1, email="admin@agency.test", password="x", name="Ada Admin", role="Admin"),
                User(id=SALES, tenant_id=1, email="sam@agency.test", password="x", name="Sam Sales", role="SalesManager"),
                User(id=OTHER_SALES, tenant_id=1, email="olga@agency.test", password="x", name="Olga", role="SalesManager"),
                User(id=INTERN, tenant_id=1, email="ian@agency.test", password="x", name="Ian", role="Intern"),
                User(id=ADMIN_T2, tenant_id=2, email="admin2@other.test", password="x", name="Other Admin", role="Admin"),
                User(id=20, tenant_id=1, email="xavier@xco.com", password="x", name="Xavier", role="Client"),
            ])
            s.add(Lead(id=1, tenant_id=1, company_name="Acme", email="jane@acme.com", owner_id=SALES, status="New"))
            s.add(Lead(id=2, tenant_id=1, company_name="Beta", email="bob@beta.com", owner_id=OTHER_SALES))
            s.add(Lead(id=3, tenant_id=2, company_name="Gamma", email="gil@gamma.com"))
            s.add(ClientProfile(id=1, tenant_id=1, companyName="XCo", userId=20, assignedEmployeeId=SALES,
                                next_followup_date="2026-10-10"))
            s.add_all([
                SentEmail(id=1, tenant_id=1, lead_id=1, to_email="jane@acme.com", subject="Our proposal",
                          english_body="Hi Jane, here is the proposal.", status="Opened", open_count=2,
                          sent_at=NOW - timedelta(days=3)),
                SentEmail(id=2, tenant_id=1, lead_id=2, to_email="bob@beta.com", subject="Intro", status="Sent",
                          english_body="<p>Hello <b>Bob</b></p>", sent_at=NOW - timedelta(days=2)),
                SentEmail(id=3, tenant_id=1, lead_id=1, to_email="jane@acme.com", subject="AI draft", status="Draft",
                          sent_at=NOW),
                SentEmail(id=4, tenant_id=1, to_email="unknown_contact_1@placeholder.com", subject="Placeholder",
                          sent_at=NOW),
                SentEmail(id=5, tenant_id=2, lead_id=3, to_email="gil@gamma.com", subject="Other tenant",
                          sent_at=NOW - timedelta(days=1)),
            ])
            s.add_all([
                InboxMessage(id=1, tenant_id=1, mailbox="crm@agency.test", message_id="<in1@acme>", from_name="Jane",
                             from_address="jane@acme.com", subject="Re: Our proposal", snippet="Looks good, what about price?",
                             body_text="Looks good, what about price?", received_at=NOW - timedelta(days=1), lead_id=1,
                             sent_email_id=1),
                InboxMessage(id=2, tenant_id=1, mailbox="crm@agency.test", message_id="<in2@beta>", from_address="bob@beta.com",
                             subject="Question", snippet="Quick question", received_at=NOW - timedelta(hours=5), lead_id=2,
                             ai_category="support", ai_priority="high", ai_needs_reply=True, ai_classified_at=NOW),
                InboxMessage(id=3, tenant_id=1, mailbox="crm@agency.test", message_id="<in3@rand>",
                             from_address="stranger@random.com", subject="Partnership", snippet="Let's partner",
                             received_at=NOW - timedelta(hours=1), ai_category="partnership", ai_priority="low",
                             ai_needs_reply=False, ai_classified_at=NOW),
                InboxMessage(id=4, tenant_id=2, mailbox="crm@other.test", message_id="<in4@gamma>",
                             from_address="gil@gamma.com", subject="Other tenant mail", received_at=NOW, lead_id=3),
            ])
            s.add(Task(id=1, tenant_id=1, lead_id=1, title="Send revised pricing", status="Todo", due_date="2026-10-08"))
            s.add(Task(id=2, tenant_id=1, lead_id=1, title="Old finished task", status="Done"))
            s.add(CRMQuote(id=1, tenant_id=1, lead_id=1, quote_number="Q-7", title="Sea freight", status="Sent",
                           grand_total=1500, currency="USD"))
            s.add(ConversationLog(id=1, tenant_id=1, lead_id=1, title="Discovery call", type="call",
                                  description="Wants sea freight for 3 lanes", created_at=NOW - timedelta(days=4)))
            s.commit()

    def get(self, url, user=ADMIN, **kw):
        return self.client.get(url, headers={"X-User-ID": str(user)}, **kw)

    def post(self, url, json_body=None, user=ADMIN):
        return self.client.post(url, json=json_body or {}, headers={"X-User-ID": str(user)})


class InboxListTests(ApiTestCase):
    def test_requires_identity_and_an_allowed_role(self):
        self.assertEqual(self.client.get("/inbox/messages").status_code, 401)
        self.assertEqual(self.get("/inbox/messages", user=INTERN).status_code, 403)

    def test_admin_sees_unified_tenant_mail_newest_first_without_drafts(self):
        data = self.get("/inbox/messages").json()
        keys = [i["key"] for i in data["items"]]
        self.assertEqual(keys, ["in-3", "in-2", "in-1", "out-2", "out-1"])
        self.assertEqual(data["total"], 5)
        out1 = next(i for i in data["items"] if i["key"] == "out-1")
        self.assertEqual((out1["status"], out1["reply_count"], out1["lead"]["name"]), ("Opened", 1, "Acme"))
        out2 = next(i for i in data["items"] if i["key"] == "out-2")
        self.assertEqual(out2["snippet"], "Hello Bob")  # HTML body flattened for the preview

    def test_other_tenant_admin_only_sees_their_tenant(self):
        keys = [i["key"] for i in self.get("/inbox/messages", user=ADMIN_T2).json()["items"]]
        self.assertEqual(keys, ["in-4", "out-5"])

    def test_salesperson_only_sees_mail_of_their_own_records(self):
        keys = [i["key"] for i in self.get("/inbox/messages", user=SALES).json()["items"]]
        self.assertEqual(keys, ["in-1", "out-1"])
        self.assertEqual(self.get("/inbox/messages/in-2", user=SALES).status_code, 404)

    def test_folders_and_filters(self):
        def keys(**params):
            return [i["key"] for i in self.get("/inbox/messages", params=params).json()["items"]]
        self.assertEqual(keys(folder="sent"), ["out-2", "out-1"])
        # in-1 is untriaged mail from a known lead, so it counts as needing a reply until AI says otherwise.
        self.assertEqual(keys(folder="needs_reply"), ["in-2", "in-1"])
        self.assertEqual(keys(linked="unlinked"), ["in-3"])
        self.assertEqual(keys(category="support"), ["in-2"])
        self.assertEqual(keys(q="proposal"), ["in-1", "out-1"])
        self.assertEqual(keys(limit=2, offset=1), ["in-2", "in-1"])

    def test_counts(self):
        c = self.get("/inbox/counts").json()
        self.assertEqual(c["folders"]["all"], 5)
        self.assertEqual(c["folders"]["unread"], 3)
        self.assertEqual(c["categories"], {"support": 1, "partnership": 1})
        self.assertEqual(c["linked"]["unlinked"], 1)
        self.assertEqual(self.get("/inbox/counts", params={"only": "unread"}).json(), {"unread": 3})
        self.assertEqual(self.get("/inbox/counts", user=SALES).json()["folders"]["all"], 2)


class InboxMessageTests(ApiTestCase):
    def test_detail_marks_read_and_builds_the_thread(self):
        data = self.get("/inbox/messages/in-1").json()
        self.assertEqual(data["message"]["body_text"], "Looks good, what about price?")
        self.assertEqual([m["key"] for m in data["thread"]], ["out-1", "in-1"])
        self.assertTrue(data["message"]["is_read"])
        self.assertEqual(self.get("/inbox/messages/in-999").status_code, 404)
        self.assertEqual(self.get("/inbox/messages/out-3").status_code, 404)  # drafts aren't messages
        self.assertEqual(self.get("/inbox/messages/in-4").status_code, 404)   # other tenant

    def test_flags_and_bulk(self):
        r = self.client.patch("/inbox/messages/in-3", json={"is_starred": True, "is_archived": True}, headers={"X-User-ID": "1"})
        self.assertTrue(r.json()["item"]["is_starred"])
        self.assertEqual([i["key"] for i in self.get("/inbox/messages", params={"folder": "archived"}).json()["items"]], ["in-3"])
        self.assertEqual(self.post("/inbox/messages/bulk", {"keys": ["in-1", "in-2", "in-4", "out-1"], "action": "read"}).json()["updated"], 2)
        self.assertEqual(self.post("/inbox/mark-all-read", {"folder": "all"}).json()["updated"], 0)

    @mock.patch.dict(os.environ, {"EMAIL_SENDER": "crm@agency.test", "EMAIL_PASSWORD": "pw", "SMTP_SERVER": "smtp.agency.test"})
    def test_reply_threads_records_and_marks_replied(self):
        with mock.patch.object(email_sender, "send_email_outlook") as send:
            r = self.post("/inbox/messages/in-1/reply", {"subject": "Re: Our proposal", "body": "Pricing attached."})
        self.assertEqual(r.status_code, 200, r.text)
        kwargs = send.call_args.kwargs
        self.assertEqual(kwargs["to_email"], "jane@acme.com")
        self.assertEqual(kwargs["extra_headers"]["In-Reply-To"], "<in1@acme>")
        self.assertIn("<in1@acme>", kwargs["extra_headers"]["References"])
        self.assertTrue(kwargs["extra_headers"]["Message-ID"].endswith("@agency.test>"))
        with Session(ENGINE) as s:
            sent = s.get(SentEmail, int(r.json()["item"]["key"][4:]))
            self.assertEqual((sent.status, sent.lead_id, sent.tenant_id), ("Sent", 1, 1))
            self.assertEqual(json.loads(sent.draft_json)["sent_by_name"], "Ada Admin")
            self.assertIsNotNone(s.get(InboxMessage, 1).replied_at)
            self.assertEqual(s.get(Lead, 1).status, "Contacted")
            self.assertEqual(len(s.exec(select(ActivityLog).where(ActivityLog.lead_id == 1)).all()), 1)
            self.assertEqual(len(s.exec(select(ConversationLog).where(ConversationLog.type == "email")).all()), 1)

    @mock.patch.dict(os.environ, {"EMAIL_SENDER": "crm@agency.test", "EMAIL_PASSWORD": "pw", "SMTP_SERVER": "smtp.agency.test"})
    def test_failed_smtp_send_leaves_no_phantom_sent_row(self):
        before = self.get("/inbox/messages", params={"folder": "sent"}).json()["total"]
        with mock.patch.object(email_sender, "send_email_outlook", side_effect=OSError("auth failed")):
            r = self.post("/inbox/messages/in-1/reply", {"subject": "Re", "body": "x"})
        self.assertEqual(r.status_code, 502)
        self.assertIn("auth failed", r.json()["detail"])
        self.assertEqual(self.get("/inbox/messages", params={"folder": "sent"}).json()["total"], before)

    def test_reply_validates_and_requires_configured_mailbox(self):
        self.assertEqual(self.post("/inbox/messages/in-1/reply", {"subject": "Re", "body": "x", "to": "not-an-email"}).status_code, 400)
        self.assertEqual(self.post("/inbox/messages/in-1/reply", {"subject": "Re", "body": "x"}).status_code, 503)


class InboxAITests(ApiTestCase):
    def test_assistant_ranks_only_real_candidate_keys(self):
        responses = [
            {"direction": "inbound", "categories": [], "linked": "any", "sort": "relevance"},
            {"answer": "Bob from Beta needs help.", "keys": ["in-2", "in-999", "in-1", "in-2"], "suggestions": ["What else?"]},
        ]
        with mock.patch.object(email_ai, "_chat_json", side_effect=responses) as chat:
            data = self.post("/inbox/assistant", {"question": "who needs help?"}).json()
        self.assertEqual(data["keys"], ["in-2", "in-1"])
        self.assertEqual(data["items"][0]["subject"], "Question")
        self.assertEqual(data["applied_filters"], ["Received"])
        self.assertIn("in-3", chat.call_args_list[1].args[1])     # candidates were sent to the model
        self.assertNotIn("in-4", chat.call_args_list[1].args[1])  # …but never another tenant's mail

    def test_assistant_date_range_filters_apply(self):
        today = NOW.date()
        responses = [
            {"direction": "any", "date_from": (today - timedelta(days=2)).isoformat(), "date_to": today.isoformat()},
            {"answer": "Recent mail.", "keys": [], "suggestions": []},
        ]
        with mock.patch.object(email_ai, "_chat_json", side_effect=responses) as chat:
            data = self.post("/inbox/assistant", {"question": "what came in the last two days?"}).json()
        prompt = chat.call_args_list[1].args[1]
        self.assertFalse(data["relaxed"])
        self.assertIn("in-3", prompt)       # 1 hour ago
        self.assertNotIn("out-1", prompt)   # 3 days ago
        self.assertEqual(len(data["applied_filters"]), 1)

    def test_assistant_sender_filter_matches_the_linked_company_name(self):
        with Session(ENGINE) as s:
            s.add(Lead(id=9, tenant_id=1, company_name="Zeta Corp", email="pat@unrelated-domain.com"))
            s.add(InboxMessage(id=9, tenant_id=1, mailbox="crm@agency.test", message_id="<z9@x>", from_name="Pat",
                               from_address="pat@unrelated-domain.com", subject="Contract question", lead_id=9,
                               received_at=NOW))
            s.commit()
        responses = [{"direction": "any", "sender": "Zeta"}, {"answer": "Pat from Zeta asked about the contract.", "keys": ["in-9"]}]
        with mock.patch.object(email_ai, "_chat_json", side_effect=responses) as chat:
            data = self.post("/inbox/assistant", {"question": "what did Zeta send us?"}).json()
        self.assertFalse(data["relaxed"])
        self.assertEqual(data["keys"], ["in-9"])
        self.assertIn("in-9", chat.call_args_list[1].args[1])
        self.assertNotIn("in-1", chat.call_args_list[1].args[1])

    def test_assistant_relaxes_filters_when_nothing_matches(self):
        responses = [
            {"direction": "any", "sender": "nobody@nowhere.com", "linked": "any"},
            {"answer": "No emails from that sender.", "keys": [], "suggestions": []},
        ]
        with mock.patch.object(email_ai, "_chat_json", side_effect=responses):
            data = self.post("/inbox/assistant", {"question": "emails from nobody@nowhere.com?"}).json()
        self.assertTrue(data["relaxed"])
        self.assertEqual(data["considered"], 5)

    def test_view_summary_is_cached_until_the_view_changes(self):
        fake = {"headline": "Two leads waiting", "overview": "…", "key_points": ["a"],
                "action_items": [{"key": "in-2", "text": "Answer Bob"}, {"key": "in-404", "text": "bogus"}],
                "highlights": []}
        with mock.patch.object(email_ai, "_chat_json", return_value=fake) as chat:
            first = self.post("/inbox/summary", {"folder": "needs_reply"}).json()
            second = self.post("/inbox/summary", {"folder": "needs_reply"}).json()
        self.assertEqual(chat.call_count, 1)
        self.assertFalse(first["cached"])
        self.assertTrue(second["cached"])
        self.assertEqual(first["summary"]["action_items"], [{"key": "in-2", "text": "Answer Bob"}])
        self.assertIn("in-2", first["emails"])

    def test_ai_failure_becomes_a_502_with_a_message(self):
        with mock.patch.object(email_ai, "_chat_json", side_effect=email_ai.EmailAIError("The AI service did not respond.")):
            r = self.post("/inbox/messages/in-1/summarize")
        self.assertEqual(r.status_code, 502)
        self.assertEqual(r.json()["detail"], "The AI service did not respond.")

    def test_demo_trial_quota_is_enforced(self):
        with Session(ENGINE) as s:
            s.add(Tenant(id=3, name="Trial", is_trial=True, limit_searches=1, usage_searches=1))
            s.add(User(id=30, tenant_id=3, email="demo@t.test", password="x", role="Demo"))
            s.commit()
        r = self.post("/inbox/assistant", {"question": "anything?"}, user=30)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["detail"]["error"], "LIMIT_REACHED")


class ComposerTests(ApiTestCase):
    def test_context_collects_recipients_followups_deals_and_history(self):
        data = self.get("/leads/1/email-composer/context", user=SALES).json()
        self.assertEqual(data["record"]["name"], "Acme")
        self.assertEqual(data["recipients"][0]["email"], "jane@acme.com")
        self.assertEqual([f["title"] for f in data["context"]["followups"]], ["Send revised pricing"])  # done task dropped
        self.assertEqual(data["context"]["deals"][0]["amount"], "USD 1,500.00")
        self.assertEqual([e["key"] for e in data["context"]["emails"]], ["in-1", "out-1"])
        self.assertEqual(data["suggested_purpose"], "follow_up")

        client_ctx = self.get("/clients/1/email-composer/context", user=SALES).json()
        self.assertEqual(client_ctx["recipients"][0], {"email": "xavier@xco.com", "name": "Xavier", "source": "Client account"})
        self.assertEqual(client_ctx["context"]["followups"][0]["source"], "Follow-up date")

    def test_only_admins_and_the_assigned_salesperson_may_email_a_record(self):
        self.assertEqual(self.get("/leads/2/email-composer/context", user=SALES).status_code, 403)
        self.assertEqual(self.get("/leads/3/email-composer/context", user=ADMIN).status_code, 404)  # other tenant
        self.assertEqual(self.get("/leads/1/email-composer/context", user=INTERN).status_code, 403)
        self.assertEqual(self.get("/projects/1/email-composer/context").status_code, 422)

    def test_draft_is_grounded_in_the_records_history(self):
        with mock.patch.object(email_ai, "_chat_json", return_value={"subject": "Revised pricing", "body": "Hi Jane,\n\n…"}) as chat:
            r = self.post("/leads/1/email-composer/draft",
                          {"purpose": "follow_up", "tone": "friendly", "to": "jane@acme.com", "focus_key": "quote-1"}, user=SALES)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["subject"], "Revised pricing")
        system, prompt = chat.call_args.args[0], chat.call_args.args[1]
        for expected in ("Send revised pricing", "Discovery call", "Q-7 Sea freight", "FOCUS THIS EMAIL ON", "<crm_context>"):
            self.assertIn(expected, prompt)
        self.assertNotIn("Old finished task", prompt)
        self.assertIn("Recipient: Jane at Acme", prompt)  # name taken from her own email, the lead has none
        self.assertIn("first name (Sam) and the company name (SCM BPO)", system)  # business_name, not Tenant.name
        self.assertEqual(self.post("/leads/1/email-composer/draft", {"purpose": "custom"}, user=SALES).status_code, 400)

    @mock.patch.dict(os.environ, {"EMAIL_SENDER": "crm@agency.test", "EMAIL_PASSWORD": "pw", "SMTP_SERVER": "smtp.agency.test"})
    def test_send_from_client_tab_records_everything(self):
        with mock.patch.object(email_sender, "send_email_outlook") as send:
            r = self.post("/clients/1/email-composer/send",
                          {"to": "xavier@xco.com", "cc": "boss@xco.com", "subject": "Next steps", "body": "Hi Xavier",
                           "purpose": "check_in"}, user=SALES)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(send.call_args.kwargs["extra_headers"]["Cc"], "boss@xco.com")
        with Session(ENGINE) as s:
            sent = s.exec(select(SentEmail).where(SentEmail.subject == "Next steps")).one()
            self.assertEqual((sent.client_id, sent.status), (1, "Sent"))
            self.assertEqual(json.loads(sent.draft_json)["purpose"], "check_in")
            self.assertEqual(s.get(ClientProfile, 1).last_contact_date, datetime.now(timezone.utc).date().isoformat())
        history = self.get("/clients/1/email-composer/history", user=SALES).json()
        self.assertEqual(history["stats"]["sent"], 1)
        self.assertEqual(history["items"][0]["subject"], "Next steps")
        self.assertEqual(self.post("/clients/1/email-composer/send", {"to": "x@y.com", "subject": "x", "body": "y"},
                                   user=OTHER_SALES).status_code, 403)

    def test_lead_history_contains_both_directions(self):
        data = self.get("/leads/1/email-composer/history", user=SALES).json()
        self.assertEqual([i["key"] for i in data["items"]], ["in-1", "out-1"])
        self.assertEqual(data["stats"], {"sent": 1, "opened": 1, "replied": 1, "received": 1})


class SyncEndpointTests(ApiTestCase):
    def test_status_and_manual_sync(self):
        status = self.get("/inbox/status").json()
        self.assertEqual(status["mailboxes"], [])
        self.assertFalse(status["sender"]["configured"])
        with mock.patch.object(inbox_sync, "sync_mailbox") as sync:
            r = self.post("/inbox/sync")
        self.assertEqual(r.status_code, 200)
        sync.assert_not_called()  # no mailbox configured for this tenant


class OwnMailboxTests(ApiTestCase):
    """Each person's Email Integration drives sending, Inbox sync/visibility and reply tracking."""

    KEY = "dGVzdC1rZXktZm9yLXVuaXQtdGVzdHMtMzJieXRlcyE="

    def setUp(self):
        super().setUp()
        patcher = mock.patch.dict(os.environ, {"EMAIL_CREDENTIAL_ENCRYPTION_KEY": self.KEY,
                                               "EMAIL_SENDER": "crm@agency.test", "EMAIL_PASSWORD": "env-pw",
                                               "SMTP_SERVER": "smtp.agency.test", "IMAP_SERVER": "imap.agency.test"})
        patcher.start()
        self.addCleanup(patcher.stop)
        from modules.email_crypto import encrypt_app_password
        with Session(ENGINE) as s:
            s.add(database.UserEmailIntegration(
                tenant_id=1, user_id=SALES, email="Sam@Mine.test", encrypted_app_password=encrypt_app_password("sam-pw"),
                smtp_host="smtp.mine.test", smtp_port=465, smtp_security="ssl", imap_host="imap.mine.test",
                imap_port=993, imap_security="ssl"))
            s.add(InboxMessage(id=20, tenant_id=1, mailbox="sam@mine.test", message_id="<own1@x>", from_address="stranger@x.com",
                               subject="Direct to Sam", received_at=NOW))
            s.add(InboxMessage(id=21, tenant_id=1, mailbox="other@mine.test", message_id="<own2@x>", from_address="s2@x.com",
                               subject="Someone else's mailbox", received_at=NOW))
            s.commit()

    def test_email_tab_sends_from_the_users_own_integration_not_the_server_mailbox(self):
        with mock.patch.object(email_sender, "send_email_outlook") as send:
            r = self.post("/leads/1/email-composer/send", {"to": "jane@acme.com", "subject": "Hi", "body": "Hello"}, user=SALES)
        self.assertEqual(r.status_code, 200, r.text)
        kw = send.call_args.kwargs
        self.assertEqual((kw["sender_email"], kw["sender_password"], kw["smtp_server"], kw["smtp_port"], kw["security"]),
                         ("Sam@Mine.test", "sam-pw", "smtp.mine.test", 465, "ssl"))
        self.assertIn("sam@mine.test", kw["extra_headers"]["From"].lower())
        self.assertTrue(kw["extra_headers"]["Message-ID"].endswith("@Mine.test>"))
        with Session(ENGINE) as s:
            sent = s.exec(select(SentEmail).where(SentEmail.subject == "Hi")).one()
            self.assertEqual(json.loads(sent.draft_json)["sent_from"], "Sam@Mine.test")
        # A colleague without an integration still falls back to the server mailbox.
        with mock.patch.object(email_sender, "send_email_outlook") as send:
            self.post("/leads/2/email-composer/send", {"to": "bob@beta.com", "subject": "Yo", "body": "x"}, user=OTHER_SALES)
        self.assertEqual(send.call_args.kwargs["sender_email"], "crm@agency.test")

    def test_sender_status_reports_the_users_account(self):
        st = self.get("/inbox/status", user=SALES).json()["sender"]
        self.assertEqual((st["address"], st["source"]), ("Sam@Mine.test", "user_integration"))
        self.assertEqual(self.get("/inbox/status", user=OTHER_SALES).json()["sender"]["source"], "server_env")

    def test_integration_mailboxes_are_synced_with_their_port_and_security(self):
        with Session(ENGINE) as s:
            cfgs = inbox_sync.get_mailbox_configs(s)
        mine = cfgs[0]
        self.assertEqual((mine.address, mine.login, mine.password, mine.imap_host, mine.imap_port, mine.imap_security,
                          mine.user_id, mine.tenant_id), ("sam@mine.test", "Sam@Mine.test", "sam-pw", "imap.mine.test",
                                                          993, "ssl", SALES, 1))
        self.assertNotIn("sam-pw", repr(mine))
        self.assertIn("crm@agency.test", [c.address for c in cfgs])

    def test_a_person_sees_everything_in_their_own_mailbox_and_an_admin_sees_all(self):
        keys = [i["key"] for i in self.get("/inbox/messages", user=SALES).json()["items"]]
        self.assertIn("in-20", keys)
        self.assertNotIn("in-21", keys)
        self.assertEqual(self.get("/inbox/messages/in-20", user=SALES).status_code, 200)
        self.assertEqual(self.get("/inbox/messages/in-21", user=SALES).status_code, 404)
        self.assertEqual(self.get("/inbox/messages/in-20", user=OTHER_SALES).status_code, 404)
        admin_keys = [i["key"] for i in self.get("/inbox/messages").json()["items"]]
        self.assertTrue({"in-20", "in-21"} <= set(admin_keys))
        mine = self.get("/inbox/status", user=SALES).json()["mailboxes"]
        self.assertEqual([m["address"] for m in mine], ["sam@mine.test"])

    def test_what_a_person_sent_themselves_is_visible_to_them(self):
        with mock.patch.object(email_sender, "send_email_outlook"):
            r = self.post("/leads/1/email-composer/send", {"to": "newperson@elsewhere.com", "subject": "Mine", "body": "x"}, user=SALES)
        key = r.json()["item"]["key"]
        self.assertIn(key, [i["key"] for i in self.get("/inbox/messages", params={"folder": "sent"}, user=SALES).json()["items"]])
        self.assertEqual(self.get(f"/inbox/messages/{key}", user=OTHER_SALES).status_code, 404)

    def test_reply_checker_marks_replies_arriving_in_an_integration_mailbox(self):
        with Session(ENGINE) as s:
            s.add(SentEmail(id=30, tenant_id=1, lead_id=1, to_email="jane@acme.com", subject="Campaign", status="Sent", sent_at=NOW + timedelta(minutes=1)))
            s.add(SentEmail(id=31, tenant_id=2, lead_id=3, to_email="jane@acme.com", subject="Other tenant's", status="Sent", sent_at=NOW))
            s.commit()
        raw = raw_email(frm="Jane <jane@acme.com>", to="sam@mine.test", subject="Re: Campaign", message_id="<reply-1@acme>")

        class OneMessageIMAP:
            def select(self, *a, **k):
                return "OK", [b"1"]

            def search(self, *a):
                return "OK", [b"1"]

            def fetch(self, uid, spec):
                return "OK", [(b"1 (BODY[] {1}", raw), b")"]

            def logout(self):
                return "BYE", []

        opened = []

        def fake_connect(cfg):
            opened.append(cfg.address)
            return OneMessageIMAP() if cfg.address == "sam@mine.test" else mock.Mock(**{"select.return_value": ("OK", [b"0"]),
                                                                                           "search.return_value": ("OK", [b""])})
        with mock.patch.object(inbox_sync, "_connect", fake_connect):
            self.assertEqual(email_sender.check_email_replies(), 1)
        self.assertIn("sam@mine.test", opened)
        with Session(ENGINE) as s:
            mine, other = s.get(SentEmail, 30), s.get(SentEmail, 31)
            self.assertEqual(mine.status, "Replied")
            self.assertNotEqual(other.status, "Replied")  # a user's mailbox only matches their own tenant's mail
            self.assertEqual(len(s.exec(select(EmailReply)).all()), 1)


class ScopedReplyScanTests(ApiTestCase):
    """The reply scan behind /webhook/check-replies-now only logs in to the requested tenant's mailboxes.
    (The webhook guard itself, the BACKGROUND_JOBS switch and the SMTP header tests are in
    tests/test_email_tracking.py.)"""

    def test_scan_only_logs_in_to_the_requested_tenants_mailboxes(self):
        with Session(ENGINE) as s:
            s.add(database.EmailSettings(tenant_id=2, smtp_host="smtp.other.test", smtp_port=587, smtp_user="ops@other.test",
                                         smtp_pass="pw2", from_name="Ops", from_email="ops@other.test"))
            s.add(database.EmailSettings(tenant_id=1, smtp_host="smtp.agency.test", smtp_port=587, smtp_user="crm@agency.test",
                                         smtp_pass="pw1", from_name="Agency", from_email="crm@agency.test"))
            s.commit()
        opened = []

        def fake_connect(cfg):
            opened.append(cfg.address)
            return mock.Mock(**{"select.return_value": ("OK", [b"0"]), "search.return_value": ("OK", [b""])})
        with mock.patch.object(inbox_sync, "_connect", fake_connect):
            email_sender.check_email_replies(tenant_id=2)
            self.assertEqual(opened, ["ops@other.test"])
            opened.clear()
            email_sender.check_email_replies()
            self.assertEqual(sorted(opened), ["crm@agency.test", "ops@other.test"])


if __name__ == "__main__":
    unittest.main()
