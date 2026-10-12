"""
Tests for follow-ups (routers/followups.py, modules/followups_core.py, modules/followup_ai.py, and the
follow_ups table it shares with routers/follow_ups.py) and the company mailbox resolver (modules/company_mailer.py). The Excel campaign tests are in
tests/test_email_campaigns.py and reuse the fixtures below.

    venv\\Scripts\\python -m unittest discover -s tests -t . -v

Ported from serphawk_crm_seo (SCM BPO uses the same roles). Self-contained like tests/test_inbox.py:
in-memory SQLite, a fake SMTP sender, no OpenAI key (so every AI path exercises its rules / template
fallback). tests/__init__.py has already disabled .env loading and dropped the mail / AI variables, and
every engine reference is repointed at SQLite for each test — nothing here can reach production or
send a real email.
"""
import os
import smtplib
import unittest
from datetime import date, datetime, timedelta, timezone
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from starlette.middleware.base import BaseHTTPMiddleware

from database import (
    ActivityLog, ClientNote, ClientProfile, Contact, ConversationLog, EmailAgentProfile, EmailSettings, FollowUp,
    FollowUpNoteScan, InboxMessage, Lead, Notification, SentEmail, Tenant, User, UserEmailIntegration,
)
from modules import company_mailer, followup_ai, followups_core as core
from modules.api_tracker import current_salesperson_id
from modules.email_crypto import encrypt_app_password
from routers import follow_ups as follow_ups_router
from routers import followups as followups_router
from tests._support import ENGINE, reset_db, use_engine

KEY = "dGVzdC1rZXktZm9yLXVuaXQtdGVzdHMtMzJieXRlcyE="  # test-only Fernet key
NOW = datetime.now(timezone.utc)
ADMIN, SALES, OTHER_SALES, INTERN, ADMIN_T2 = 1, 2, 3, 4, 5


class _Identity(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        uid = request.headers.get("X-User-ID", "")
        current_salesperson_id.set(int(uid) if uid.isdigit() else None)
        return await call_next(request)


def make_app(*routers):
    app = FastAPI()
    app.add_middleware(_Identity)
    for r in (followups_router.router,) + routers:
        app.include_router(r)
    return app


class FakeSender:
    """Stands in for company_mailer.send_via; optionally fails for some recipients."""

    def __init__(self, fail_for=(), error=None):
        self.calls = []
        self.fail_for = set(fail_for)
        self.error = error

    def __call__(self, account, *, to, subject, body, tracking_id=None, message_id=None, extra_headers=None):
        if to in self.fail_for or self.error:
            raise self.error or smtplib.SMTPRecipientsRefused({to: (550, b"no such user")})
        self.calls.append({"from": account.email, "source": account.source, "to": to, "subject": subject,
                           "body": body, "tracking_id": tracking_id})


class DBTestCase(unittest.TestCase):
    def setUp(self):
        p = mock.patch.dict(os.environ, {"EMAIL_CREDENTIAL_ENCRYPTION_KEY": KEY})
        p.start()
        self.addCleanup(p.stop)
        use_engine(self)
        reset_db()

    def seed(self, integration=True, tenant_mailbox=False):
        with Session(ENGINE) as s:
            s.add_all([Tenant(id=1, name="Agency", business_name="SCM BPO"), Tenant(id=2, name="Other")])
            s.add_all([
                User(id=ADMIN, tenant_id=1, email="admin@agency.test", password="x", name="Ada Admin", role="Admin"),
                User(id=SALES, tenant_id=1, email="sam@agency.test", password="x", name="Sam Sales", role="SalesManager"),
                User(id=OTHER_SALES, tenant_id=1, email="olga@agency.test", password="x", name="Olga", role="SalesManager"),
                User(id=INTERN, tenant_id=1, email="ian@agency.test", password="x", name="Ian", role="Intern"),
                User(id=ADMIN_T2, tenant_id=2, email="admin2@other.test", password="x", name="Other Admin", role="Admin"),
                User(id=20, tenant_id=1, email="xavier@xco.com", password="x", name="Xavier Xu", role="Client"),
            ])
            s.add(Lead(id=1, tenant_id=1, company_name="Acme", email="jane@acme.com", owner_id=SALES, status="New"))
            s.add(Contact(id=1, tenant_id=1, first_name="Jane", last_name="Doe", full_name="Jane Doe",
                          email="jane@acme.com", lead_id=1))
            s.add(Lead(id=2, tenant_id=1, company_name="Beta", email="bob@beta.com", owner_id=OTHER_SALES))
            s.add(Lead(id=3, tenant_id=2, company_name="Gamma", email="gil@gamma.com"))
            s.add(ClientProfile(id=1, tenant_id=1, companyName="XCo", userId=20, assignedEmployeeId=SALES,
                                contact_person="Xavier Xu"))
            if integration:
                for uid, addr in ((ADMIN, "ada@agency-mail.test"), (SALES, "sam@agency-mail.test")):
                    s.add(UserEmailIntegration(
                        tenant_id=1, user_id=uid, email=addr, encrypted_app_password=encrypt_app_password("app-pw"),
                        provider="gmail", smtp_host="smtp.gmail.com", smtp_port=587, smtp_security="starttls",
                        imap_host="imap.gmail.com"))
                s.add(EmailAgentProfile(tenant_id=1, user_id=ADMIN, agent_name="Ada from SCM BPO",
                                        signature="Best Regards,\nAda\nSCM BPO", auto_append_signature=True))
            if tenant_mailbox:
                s.add(EmailSettings(tenant_id=1, smtp_host="mail.agency.test", smtp_port=465, smtp_user="crm@agency.test",
                                    smtp_pass="tenant-pw", from_name="Agency CRM", from_email="crm@agency.test"))
            s.commit()


class ApiTestCase(DBTestCase):
    extra_routers = ()

    def setUp(self):
        super().setUp()
        self.seed()
        self.client = TestClient(make_app(*self.extra_routers))
        self.sender = FakeSender()
        p = mock.patch.object(company_mailer, "send_via", self.sender)
        p.start()
        self.addCleanup(p.stop)

    def req(self, method, url, user=ADMIN, **kw):
        return self.client.request(method, url, headers={"X-User-ID": str(user)}, **kw)


# ─────────────────────────────────────────────────────────────────────────────
# AI fallback: dates from notes
# ─────────────────────────────────────────────────────────────────────────────
class HeuristicTests(unittest.TestCase):
    BASE = date(2026, 10, 9)  # a Friday

    def check(self, text, expected):
        r = followup_ai.heuristic_extract(text, self.BASE)
        self.assertEqual(r["due_date"], expected, text)
        self.assertEqual(r["should_follow_up"], expected is not None, text)

    def test_promises_to_respond_land_at_the_end_of_the_period(self):
        self.check("Spoke today. They will discuss internally and respond next week.", "2026-10-16")
        self.check("Please follow up in 2 weeks about pricing", "2026-10-23")
        self.check("Follow up with them in a couple of weeks", "2026-10-23")
        self.check("Will get back next friday", "2026-10-16")

    def test_specific_days_and_dates(self):
        self.check("Client said call back tomorrow", "2026-10-12")  # Saturday rolls to Monday
        self.check("They will review the proposal and let us know on Monday", "2026-10-12")
        self.check("Need budget approval, will confirm by 20 Oct", "2026-10-20")
        self.check("Asked us to check in early next week", "2026-10-12")

    def test_no_commitment_or_no_date_means_no_follow_up(self):
        self.check("Not interested, closed the deal", None)
        self.check("They will discuss internally.", None)  # commitment but no timing — rules can't date it
        self.check("Met them next week at the expo", None)  # date but nothing pending

    def test_ai_output_is_validated(self):
        cleaned = followup_ai._clean_suggestion(
            {"should_follow_up": True, "due_date": "2026-10-10", "channel": "fax", "priority": "urgent",
             "confidence": "9"}, self.BASE, floor=self.BASE, engine="ai")
        self.assertEqual(cleaned["due_date"], "2026-10-12")  # Saturday -> Monday
        self.assertEqual(cleaned["channel"], "email")
        self.assertEqual(cleaned["priority"], "medium")
        self.assertEqual(cleaned["confidence"], 1.0)
        past = followup_ai._clean_suggestion({"should_follow_up": True, "due_date": "2020-01-01"},
                                             self.BASE, floor=self.BASE, engine="ai")
        self.assertEqual(past["due_date"], "2026-10-09")  # never before the floor

    def test_ai_extraction_is_used_and_falls_back_to_rules(self):
        from modules import email_ai
        ai = {"should_follow_up": True, "due_date": "2026-10-16", "title": "Chase decision", "reason": "Discussing internally",
              "quote": "respond next week", "channel": "call", "priority": "high", "confidence": 0.9}
        with mock.patch.object(email_ai, "_chat_json", return_value=ai) as chat:
            r = followup_ai.extract_from_note("They will discuss internally and respond next week.", self.BASE, self.BASE, "Acme")
        self.assertEqual((r["engine"], r["due_date"], r["channel"], r["priority"]), ("ai", "2026-10-16", "call", "high"))
        self.assertIn("<crm_context>", chat.call_args.args[1])  # note fenced as untrusted data
        with mock.patch.object(email_ai, "_chat_json", side_effect=email_ai.EmailAIError("down")):
            r = followup_ai.extract_from_note("They will discuss internally and respond next week.", self.BASE, self.BASE)
        self.assertEqual((r["engine"], r["due_date"]), ("rules", "2026-10-16"))

    def test_template_email_is_personalized_without_ai(self):
        t = followup_ai.template_email(contact_name="Jane Doe", company="Acme", title="Follow up",
                                       reason="pricing", last_discussion="you said you'd discuss internally",
                                       sender_name="Sam")
        self.assertTrue(t["body"].startswith("Hi Jane,"))
        self.assertIn("discuss internally", t["body"])
        self.assertIn("Acme", t["subject"])


# ─────────────────────────────────────────────────────────────────────────────
# Company mailbox resolution
# ─────────────────────────────────────────────────────────────────────────────
class MailAccountTests(DBTestCase):
    def test_user_integration_wins_then_tenant_mailbox(self):
        self.seed(integration=True, tenant_mailbox=True)
        with Session(ENGINE) as s:
            acct = company_mailer.resolve_account(s, ADMIN, 1)
            self.assertEqual((acct.email, acct.password, acct.source), ("ada@agency-mail.test", "app-pw", "user_integration"))
            self.assertEqual(acct.from_name, "Ada from SCM BPO")
            acct = company_mailer.resolve_account(s, OTHER_SALES, 1)  # no integration of their own
            self.assertEqual((acct.email, acct.source, acct.smtp_port), ("crm@agency.test", "tenant_settings", 465))
            self.assertNotIn("app-pw", repr(company_mailer.resolve_account(s, ADMIN, 1)))

    def test_never_falls_back_to_the_server_mailbox_for_contact_email(self):
        self.seed(integration=False)
        env = {"EMAIL_SENDER": "fixed@server.test", "EMAIL_PASSWORD": "pw", "SMTP_SERVER": "smtp.server.test"}
        with Session(ENGINE) as s, mock.patch.dict(os.environ, env):
            with self.assertRaises(company_mailer.MailAccountError):
                company_mailer.resolve_account(s, ADMIN, 1)
            status = company_mailer.account_status(s, ADMIN, 1)
            self.assertFalse(status["configured"])
            self.assertIn("Email Integration", status["message"])
            # Internal reminders may use it.
            self.assertEqual(company_mailer.resolve_account(s, ADMIN, 1, allow_server_fallback=True).source, "server_env")

    def test_inactive_integration_is_ignored(self):
        self.seed(integration=True, tenant_mailbox=True)
        with Session(ENGINE) as s:
            row = s.exec(select(UserEmailIntegration).where(UserEmailIntegration.user_id == ADMIN)).one()
            row.is_active = False
            s.add(row)
            s.commit()
            self.assertEqual(company_mailer.resolve_account(s, ADMIN, 1).source, "tenant_settings")

    def test_signature_applied_once(self):
        sig = "Best Regards,\nAda\nSCM BPO"
        body = company_mailer.apply_signature("Hi Jane,\n\nThanks!\n\nBest regards,\nAda\nada@scmbpo.test", sig)
        self.assertEqual(body.count("Best Regards"), 1)
        self.assertTrue(body.endswith(sig))
        self.assertEqual(company_mailer.apply_signature(body, sig), body)

    def test_plain_closing_is_replaced_when_the_signature_has_its_own(self):
        sig = "Best Regards,\nAda Lovelace\nEmail: ada@agency.test"
        for body in ("Hi Jane,\n\nShall we talk?\n\nBest regards,\nAda Lovelace",
                     "Hi Jane,\n\nShall we talk?\n\nKind regards,\n\nAda\nE2E Digital"):
            out = company_mailer.apply_signature(body, sig)
            self.assertEqual(out, "Hi Jane,\n\nShall we talk?\n\n" + sig)
        # A signature without a closing line keeps the body's own closing.
        out = company_mailer.apply_signature("Hi,\n\nBest regards,\nAda", "Ada Lovelace | +91 900")
        self.assertIn("Best regards,\nAda\n\nAda Lovelace | +91 900", out)
        # Body text that merely starts with "Thanks" is not a closing.
        self.assertIn("Thanks for your time today.", company_mailer.apply_signature("Hi,\n\nThanks for your time today.", sig))


# ─────────────────────────────────────────────────────────────────────────────
# Follow-up API
# ─────────────────────────────────────────────────────────────────────────────
def iso(dt):
    return dt.isoformat()


class FollowUpApiTests(ApiTestCase):
    def create(self, user=SALES, **body):
        payload = {"lead_id": 1, "title": "Call about pricing", "due_at": iso(NOW + timedelta(days=2)), "tz_offset": 0}
        payload.update(body)
        return self.req("POST", "/followups", user=user, json=payload)

    def test_create_on_a_lead_fills_contact_and_owner(self):
        res = self.create(notes="They will discuss internally")
        self.assertEqual(res.status_code, 200, res.text)
        item = res.json()["item"]
        self.assertEqual((item["contact_name"], item["contact_email"], item["company_name"]), ("Jane Doe", "jane@acme.com", "Acme"))
        self.assertEqual(item["assigned_to"]["id"], SALES)
        self.assertEqual(item["state"], "upcoming")
        self.assertEqual(item["lead"], {"id": 1, "name": "Acme"})
        with Session(ENGINE) as s:
            self.assertEqual(s.exec(select(ActivityLog).where(ActivityLog.lead_id == 1)).one().action, "Follow-up scheduled")

    def test_date_only_due_uses_the_viewers_timezone(self):
        res = self.create(due_at="2026-11-02", tz_offset=-330)  # IST viewer
        self.assertEqual(res.json()["item"]["due_at"], "2026-11-02T04:30:00+00:00")  # 10:00 IST

    def test_access_rules(self):
        self.assertEqual(self.create(user=OTHER_SALES).status_code, 403)  # not their lead
        self.assertEqual(self.create(user=INTERN).status_code, 403)
        self.assertEqual(self.create(user=ADMIN_T2).status_code, 404)  # other tenant
        self.assertEqual(self.create(lead_id=None, contact_email="").status_code, 400)
        fid = self.create().json()["item"]["id"]
        self.assertEqual(self.req("GET", "/followups?view=all", user=OTHER_SALES).json()["total"], 0)
        self.assertEqual(self.req("GET", "/followups?view=all", user=ADMIN).json()["total"], 1)
        self.assertEqual(self.req("PATCH", f"/followups/{fid}", user=OTHER_SALES, json={"title": "x"}).status_code, 404)
        self.assertEqual(self.req("GET", "/followups?view=all", user=ADMIN_T2).json()["total"], 0)

    def test_views_and_summary_separate_overdue_today_upcoming_completed(self):
        start_today = datetime(NOW.year, NOW.month, NOW.day, tzinfo=timezone.utc)
        ids = {}
        for key, due in (("overdue", start_today - timedelta(days=2)), ("today", start_today + timedelta(hours=12)),
                         ("upcoming", start_today + timedelta(days=4)), ("done", start_today - timedelta(days=1))):
            ids[key] = self.create(title=key, due_at=iso(due)).json()["item"]["id"]
        self.assertEqual(self.req("POST", f"/followups/{ids['done']}/complete", user=SALES,
                                  json={"outcome": "Spoke, they signed"}).status_code, 200)
        for view, expected in (("overdue", ["overdue"]), ("today", ["today"]), ("upcoming", ["upcoming"]),
                               ("completed", ["done"]), ("pending", ["overdue", "today", "upcoming"])):
            got = [i["title"] for i in self.req("GET", f"/followups?view={view}&tz_offset=0", user=SALES).json()["items"]]
            self.assertEqual(got, expected, view)
        summary = self.req("GET", "/followups/summary?tz_offset=0", user=SALES).json()
        self.assertEqual({k: summary["counts"][k] for k in ("pending", "overdue", "today", "upcoming", "completed")},
                         {"pending": 3, "overdue": 1, "today": 1, "upcoming": 1, "completed": 1})
        self.assertEqual([i["title"] for i in summary["next"]], ["overdue", "today", "upcoming"])
        states = {i["title"]: i["state"] for i in self.req("GET", "/followups?view=all&tz_offset=0", user=SALES).json()["items"]}
        self.assertEqual(states, {"overdue": "overdue", "today": "today", "upcoming": "upcoming", "done": "completed"})

    def test_reschedule_resets_reminder_and_cancel_reopen(self):
        fid = self.create().json()["item"]["id"]
        with Session(ENGINE) as s:
            fu = s.get(FollowUp, fid)
            fu.reminder_sent_at = NOW
            s.add(fu)
            s.commit()
        res = self.req("PATCH", f"/followups/{fid}", user=SALES, json={"due_at": iso(NOW + timedelta(days=9)), "tz_offset": 0})
        self.assertEqual(res.status_code, 200, res.text)
        item = res.json()["item"]
        self.assertIsNone(item["reminder_sent_at"])
        # The reminder keeps its lead time (default 60 minutes before the follow-up).
        self.assertEqual(datetime.fromisoformat(item["remind_at"]), datetime.fromisoformat(item["due_at"]) - timedelta(minutes=60))
        self.assertEqual(self.req("PATCH", f"/followups/{fid}", user=SALES, json={"status": "Cancelled"}).json()["item"]["state"], "cancelled")
        self.assertEqual(self.req("PATCH", f"/followups/{fid}", user=SALES, json={"status": "Pending"}).json()["item"]["status"], "Pending")
        self.assertEqual(self.req("PATCH", f"/followups/{fid}", user=SALES, json={"auto_send": True}).status_code, 400)

    def test_complete_with_next_follow_up_keeps_the_history_chain(self):
        fid = self.create().json()["item"]["id"]
        res = self.req("POST", f"/followups/{fid}/complete", user=SALES,
                       json={"outcome": "Asked to call again after budget meeting", "next": {"due_at": "2026-12-01"}, "tz_offset": 0})
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["item"]["status"], "Completed")
        self.assertEqual(data["next"]["source"], "completed_chain")
        self.assertIn("budget meeting", data["next"]["notes"])
        self.assertEqual(self.req("POST", f"/followups/{fid}/complete", user=SALES, json={}).status_code, 400)
        history = self.req("GET", "/followups/history?lead_id=1", user=SALES).json()
        self.assertEqual(len(history["followups"]), 2)
        self.assertIn("followup_done", [e["type"] for e in history["timeline"]])

    def test_draft_from_previous_notes_and_send_from_company_account(self):
        with Session(ENGINE) as s:
            s.add(ClientNote(tenant_id=1, lead_id=1, content="Jane said they will discuss internally and respond next week.",
                             author_name="Sam", created_at=NOW - timedelta(days=1)))
            s.commit()
        fid = self.create(notes="Pricing discussion pending").json()["item"]["id"]
        draft = self.req("POST", f"/followups/{fid}/draft-email", user=SALES, json={})
        self.assertEqual(draft.status_code, 200, draft.text)
        d = draft.json()
        self.assertEqual(d["engine"], "template")  # no OPENAI_API_KEY in tests
        self.assertTrue(d["body"].startswith("Hi Jane,"))
        self.assertIn("discuss internally", d["body"])
        sent = self.req("POST", f"/followups/{fid}/send-email", user=SALES,
                        json={"subject": d["subject"], "body": d["body"], "tz_offset": 0})
        self.assertEqual(sent.status_code, 200, sent.text)
        self.assertEqual(sent.json()["from"], "sam@agency-mail.test")
        self.assertEqual(sent.json()["item"]["status"], "Completed")
        self.assertEqual(self.sender.calls[0]["to"], "jane@acme.com")
        with Session(ENGINE) as s:
            row = s.exec(select(SentEmail)).one()
            self.assertEqual((row.lead_id, row.status, row.tenant_id), (1, "Sent", 1))
            self.assertEqual(s.exec(select(ConversationLog).where(ConversationLog.lead_id == 1)).one().type, "email")
            self.assertEqual(s.get(Lead, 1).status, "Contacted")

    def test_send_without_company_account_is_refused(self):
        with Session(ENGINE) as s:
            s.add(Lead(id=7, tenant_id=1, company_name="Olga's", email="o@x.com", owner_id=OTHER_SALES))
            s.commit()
        fid = self.create(user=OTHER_SALES, lead_id=7).json()["item"]["id"]
        res = self.req("POST", f"/followups/{fid}/send-email", user=OTHER_SALES, json={"subject": "Hi", "body": "Hello"})
        self.assertEqual(res.status_code, 503)
        self.assertEqual(self.sender.calls, [])

    def test_suggest_uses_the_latest_commitment_in_the_notes(self):
        with Session(ENGINE) as s:
            s.add(ConversationLog(tenant_id=1, client_id=1, title="Call with Xavier", type="call",
                                  description="Xavier will check with his partner and get back in 2 weeks.",
                                  created_at=NOW))
            s.commit()
        res = self.req("POST", "/followups/suggest", user=SALES, json={"client_id": 1, "tz_offset": 0})
        self.assertEqual(res.status_code, 200, res.text)
        s_ = res.json()["suggestion"]
        expected = followup_ai.parse_relative_date("get back in 2 weeks", NOW.date())
        self.assertEqual(s_["due_date"], expected.isoformat())
        self.assertTrue(res.json()["email"]["body"].startswith("Hi Xavier,"))
        self.assertEqual(self.req("POST", "/followups/suggest", user=OTHER_SALES, json={"client_id": 1}).status_code, 403)

    def test_scan_endpoint_creates_follow_up_from_a_note(self):
        with Session(ENGINE) as s:
            s.add(ClientNote(id=5, tenant_id=1, lead_id=1, content="They will discuss internally and respond next week.",
                             created_at=NOW))
            s.commit()
        res = self.req("POST", "/followups/scan", user=SALES, json={"lead_id": 1, "tz_offset": 0})
        self.assertEqual(res.status_code, 200, res.text)
        created = res.json()["created"]
        self.assertEqual(len(created), 1)
        self.assertEqual(created[0]["source"], "ai_auto")
        self.assertEqual(created[0]["source_ref"], "note-5")
        self.assertEqual(self.req("POST", "/followups/scan", user=SALES, json={"lead_id": 1}).json()["scanned"], 0)


# ─────────────────────────────────────────────────────────────────────────────
# Scheduler: reminders, auto-send, AI note scan
# ─────────────────────────────────────────────────────────────────────────────
class SchedulerTests(DBTestCase):
    def setUp(self):
        super().setUp()
        self.seed(integration=True)

    def add_fu(self, **kw):
        base = dict(tenant_id=1, lead_id=1, title="Call Jane", due_at=NOW - timedelta(minutes=5), owner_id=SALES,
                    created_by=SALES, contact_name="Jane Doe", contact_email="jane@acme.com", company_name="Acme")
        base.update(kw)
        with Session(ENGINE) as s:
            fu = FollowUp(**base)
            s.add(fu)
            s.commit()
            return fu.id

    def test_due_reminder_is_sent_exactly_once(self):
        due = self.add_fu(notes="They promised an answer this week")
        self.add_fu(title="Later", due_at=NOW + timedelta(days=1))
        self.add_fu(title="Done", status="Completed")
        sender = FakeSender()
        self.assertEqual(core.process_due_reminders(send_email=sender), 1)
        self.assertEqual(core.process_due_reminders(send_email=sender), 0)
        self.assertEqual(len(sender.calls), 1)
        self.assertEqual(sender.calls[0]["to"], "sam@agency.test")
        self.assertEqual(sender.calls[0]["from"], "sam@agency-mail.test")
        self.assertIn("Call Jane", sender.calls[0]["subject"])
        self.assertIn("They promised an answer", sender.calls[0]["body"])
        with Session(ENGINE) as s:
            notes = s.exec(select(Notification)).all()
            self.assertEqual([(n.user_id, n.link) for n in notes], [(SALES, "/leads/1?tab=followups")])
            self.assertIsNotNone(s.get(FollowUp, due).reminder_sent_at)

    def test_custom_remind_time_fires_before_due(self):
        self.add_fu(due_at=NOW + timedelta(days=1), reminder_minutes=24 * 60 + 1)
        self.add_fu(title="Not yet", due_at=NOW + timedelta(days=1), reminder_minutes=60)
        self.assertEqual(core.process_due_reminders(send_email=FakeSender()), 1)

    def test_auto_send_sends_prepared_email_and_completes(self):
        fid = self.add_fu(auto_send=True, email_subject="Checking in", email_body="Hi Jane,\n\nAny update?")
        self.add_fu(title="Not yet", auto_send=True, email_subject="x", email_body="y", due_at=NOW + timedelta(hours=3))
        sender = FakeSender()
        self.assertEqual(core.process_auto_sends(sender=sender), 1)
        self.assertEqual(core.process_auto_sends(sender=sender), 0)
        self.assertEqual([(c["to"], c["from"]) for c in sender.calls], [("jane@acme.com", "sam@agency-mail.test")])
        with Session(ENGINE) as s:
            fu = s.get(FollowUp, fid)
            self.assertEqual(fu.status, "Completed")
            self.assertIsNotNone(fu.sent_email_id)
            self.assertEqual(s.get(SentEmail, fu.sent_email_id).to_email, "jane@acme.com")

    def test_auto_send_failure_is_reported_and_not_retried(self):
        fid = self.add_fu(auto_send=True, email_subject="Checking in", email_body="Hi")
        self.assertEqual(core.process_auto_sends(sender=FakeSender(fail_for={"jane@acme.com"})), 0)
        with Session(ENGINE) as s:
            fu = s.get(FollowUp, fid)
            self.assertEqual((fu.status, fu.auto_send, fu.email_sent_at), ("Pending", False, None))
            self.assertIn("refused", fu.last_error)
            self.assertEqual(s.exec(select(Notification)).one().title, "Follow-up email was not sent")
            self.assertEqual(s.exec(select(SentEmail)).all(), [])

    def test_note_scan_creates_dated_follow_up_once(self):
        with Session(ENGINE) as s:
            s.add(ClientNote(id=1, tenant_id=1, lead_id=1, author_id=OTHER_SALES,
                             content="Call went well. They will discuss internally and respond next week.", created_at=NOW))
            s.add(ClientNote(id=2, tenant_id=1, lead_id=1, content="Sent them our brochure.", created_at=NOW))
            s.commit()
        result = core.scan_notes()
        self.assertEqual(result["scanned"], 2)
        self.assertEqual(len(result["created"]), 1)
        self.assertEqual(core.scan_notes()["scanned"], 0)  # each note is read once
        with Session(ENGINE) as s:
            fu = s.exec(select(FollowUp)).one()
            expected = followup_ai.parse_relative_date("respond next week", NOW.date())
            self.assertEqual(core.as_utc(fu.due_at), core.at_local_hour(expected))
            self.assertEqual((fu.source, fu.source_ref, fu.owner_id, fu.lead_id), ("ai_auto", "note-1", SALES, 1))
            self.assertEqual(fu.contact_email, "jane@acme.com")
            self.assertIn("respond next week", fu.ai_reason)
            self.assertEqual(s.exec(select(Notification)).one().user_id, SALES)
            self.assertEqual(len(s.exec(select(FollowUpNoteScan)).all()), 2)

    def test_note_scan_skips_duplicates_own_emails_spam_and_stale_commitments(self):
        due = core.at_local_hour(followup_ai.parse_relative_date("respond next week", NOW.date()))
        existing = self.add_fu(due_at=due)
        with Session(ENGINE) as s:
            s.add(ClientNote(tenant_id=1, lead_id=1, content="They will respond next week.", created_at=NOW))
            s.add(SentEmail(tenant_id=1, lead_id=1, to_email="jane@acme.com", subject="Follow up",
                            english_body="Let me know next week", sent_at=NOW))
            s.add(ConversationLog(tenant_id=1, lead_id=1, title="Follow up", type="email",
                                  description="Please let us know next week", created_at=NOW))
            s.add(InboxMessage(tenant_id=1, mailbox="m", message_id="<s>", from_address="spam@x.com", lead_id=1,
                               subject="Win", body_text="Reply tomorrow to confirm your prize", ai_category="spam",
                               received_at=NOW))
            s.add(ClientNote(tenant_id=1, client_id=1, content="Will call back tomorrow",
                             created_at=NOW - timedelta(days=20)))  # outside the scan window
            s.commit()
        result = core.scan_notes()
        self.assertEqual(result["created"], [])
        self.assertEqual(result["matched"], [existing])
        with Session(ENGINE) as s:
            self.assertEqual(len(s.exec(select(FollowUp)).all()), 1)
            fu = s.get(FollowUp, existing)
            self.assertEqual((fu.source, fu.title, core.as_utc(fu.due_at)), ("manual", "Call Jane", due))  # a person's choice stays
            self.assertIn("respond next week", fu.ai_reason)  # ...but gains what was said
            self.assertIn("AI (", fu.notes)

    def test_note_moves_a_matching_campaign_follow_up_to_the_promised_date(self):
        promised = core.at_local_hour(followup_ai.parse_relative_date("respond next week", NOW.date()))
        campaign_fu = self.add_fu(source="campaign", title="Follow up on “Growth ideas”", due_at=promised - timedelta(days=2),
                                  reminder_sent_at=NOW)
        with Session(ENGINE) as s:
            s.add(ClientNote(tenant_id=1, lead_id=1, content="Jane: we'll discuss internally and respond next week.", created_at=NOW))
            s.commit()
        self.assertEqual(core.scan_notes()["matched"], [campaign_fu])
        with Session(ENGINE) as s:
            fu = s.get(FollowUp, campaign_fu)
            self.assertEqual((core.as_utc(fu.due_at), fu.source, fu.reminder_sent_at), (promised, "ai_auto", None))
            self.assertTrue(fu.title.startswith("Follow up:"))

    def test_inbound_email_reply_can_create_a_follow_up(self):
        with Session(ENGINE) as s:
            s.add(InboxMessage(tenant_id=1, mailbox="m", message_id="<r>", from_address="xavier@xco.com", from_name="Xavier",
                               client_id=1, subject="Re: proposal",
                               body_text="Thanks — we'll review it with the board and get back to you next week.",
                               received_at=NOW))
            s.commit()
        result = core.scan_notes()
        self.assertEqual(len(result["created"]), 1)
        with Session(ENGINE) as s:
            fu = s.get(FollowUp, result["created"][0])
            self.assertEqual((fu.client_id, fu.source_ref, fu.contact_email), (1, f"inbox-1", "xavier@xco.com"))


# ─────────────────────────────────────────────────────────────────────────────
# One follow_ups table, two APIs: /follow-ups (routers/follow_ups.py) and /followups
# ─────────────────────────────────────────────────────────────────────────────
def iso_z(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


class SharedTableTests(ApiTestCase):
    extra_routers = (follow_ups_router.router,)

    def setUp(self):
        super().setUp()
        self.mails = []
        for name, fake in (("_tid", lambda: 1), ("_send_email_async", lambda to, subject, html: self.mails.append(to))):
            p = mock.patch.object(follow_ups_router, name, fake)
            p.start()
            self.addCleanup(p.stop)

    def find(self, items, fid):
        return next(i for i in items if i["id"] == fid)

    def test_a_follow_up_from_follow_ups_shows_in_followups(self):
        res = self.req("POST", "/follow-ups", user=SALES, json={
            "title": "Call Jane", "channel": "call", "priority": "high", "due_at": iso_z(NOW + timedelta(days=2)), "lead_id": 1})
        self.assertEqual(res.status_code, 200, res.text)
        fid = res.json()["follow_up"]["id"]
        item = self.find(self.req("GET", "/followups?view=all&tz_offset=0", user=SALES).json()["items"], fid)
        self.assertEqual((item["channel"], item["priority"], item["state"]), ("call", "high", "upcoming"))
        self.assertEqual((item["assigned_to"]["id"], item["lead"]), (SALES, {"id": 1, "name": "Acme"}))
        self.assertEqual(datetime.fromisoformat(item["remind_at"]), datetime.fromisoformat(item["due_at"]) - timedelta(minutes=60))
        res = self.req("POST", f"/followups/{fid}/complete", user=SALES, json={"outcome": "Spoke, they signed"})
        self.assertEqual(res.status_code, 200, res.text)
        done = self.find(self.req("GET", "/follow-ups?bucket=completed", user=SALES).json()["follow_ups"], fid)
        self.assertEqual((done["status"], done["completion_note"]), ("Completed", "Spoke, they signed"))

    def test_a_follow_up_from_followups_shows_in_follow_ups(self):
        res = self.req("POST", "/followups", user=SALES, json={
            "lead_id": 1, "title": "Send pricing", "due_at": iso(NOW + timedelta(days=2)), "tz_offset": 0})
        self.assertEqual(res.status_code, 200, res.text)
        fid = res.json()["item"]["id"]
        item = self.find(self.req("GET", "/follow-ups", user=SALES).json()["follow_ups"], fid)
        self.assertEqual((item["owner_id"], item["channel"], item["priority"], item["reminder_minutes"]), (SALES, "Email", "Medium", 60))
        self.assertEqual((item["entity_name"], item["bucket"]), ("Acme", "upcoming"))
        res = self.req("PUT", f"/follow-ups/{fid}/status", user=SALES, json={"status": "Completed", "completion_note": "Signed"})
        self.assertEqual(res.status_code, 200, res.text)
        done = self.find(self.req("GET", "/followups?view=completed&tz_offset=0", user=SALES).json()["items"], fid)
        self.assertEqual((done["state"], done["outcome"]), ("completed", "Signed"))

    def test_in_progress_and_undated_follow_ups_stay_open(self):
        with Session(ENGINE) as s:
            busy = FollowUp(tenant_id=1, lead_id=1, title="Busy", status="In Progress", due_at=NOW + timedelta(days=3), owner_id=SALES)
            undated = FollowUp(tenant_id=1, lead_id=1, title="Someday", owner_id=SALES)
            s.add_all([busy, undated])
            s.commit()
            busy_id, undated_id = busy.id, undated.id
        items = self.req("GET", "/followups?view=pending&tz_offset=0", user=SALES).json()["items"]
        self.assertEqual({i["id"]: i["state"] for i in items}, {busy_id: "upcoming", undated_id: "upcoming"})
        history = self.req("GET", "/followups/history?lead_id=1", user=SALES)
        self.assertEqual(history.status_code, 200, history.text)
        self.assertEqual(self.req("POST", f"/followups/{busy_id}/complete", user=SALES, json={}).status_code, 200)

    def test_each_follow_up_is_reminded_once_whichever_worker_runs_first(self):
        def add(title):
            with Session(ENGINE) as s:
                fu = FollowUp(tenant_id=1, lead_id=1, title=title, due_at=NOW + timedelta(minutes=30), reminder_minutes=60,
                              owner_id=SALES, created_by=SALES)
                s.add(fu)
                s.commit()
                return fu.id

        add("Upstream first")
        self.assertEqual(follow_ups_router.process_due_reminders(), 1)
        self.assertEqual(core.process_due_reminders(send_email=FakeSender()), 0)
        add("Email stack first")
        self.assertEqual(core.process_due_reminders(send_email=FakeSender()), 1)
        self.assertEqual(follow_ups_router.process_due_reminders(), 0)
        self.assertEqual(self.mails, ["sam@agency.test"])

    def test_a_reminder_for_an_already_due_follow_up_replaces_the_overdue_notice(self):
        with Session(ENGINE) as s:
            s.add(FollowUp(tenant_id=1, lead_id=1, title="Late", due_at=NOW - timedelta(minutes=5), owner_id=SALES))
            s.commit()
        self.assertEqual(core.process_due_reminders(send_email=FakeSender()), 1)
        self.assertEqual(follow_ups_router.process_due_reminders(), 0)


if __name__ == "__main__":
    unittest.main()
