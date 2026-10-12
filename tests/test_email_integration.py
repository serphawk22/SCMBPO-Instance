"""
Email Agent sender profile + per-user Email Integration (main.py endpoints, modules/email_crypto.py,
modules/company_mailer.py) and which mailbox each send path uses (D3). In-memory SQLite, fake SMTP,
test-only Fernet key; nothing here reaches a network or a real database.

    venv\\Scripts\\python -m unittest discover -s tests -t . -v
"""
import json
import os
import unittest
from unittest import mock

from sqlmodel import Session, select

from database import EmailAgentProfile, EmailSettings, Lead, SentEmail, Tenant, User, UserEmailIntegration
from modules import company_mailer, email_crypto, email_sender
from tests._support import ENGINE, main_client, reset_db, use_engine

KEY = "dGVzdC1rZXktZm9yLXVuaXQtdGVzdHMtMzJieXRlcyE="  # test-only Fernet key
ADMIN, SALES, OTHER = 1, 2, 3
SERVER_ENV = {"EMAIL_SENDER": "server@scmbpo.test", "EMAIL_PASSWORD": "server-pw", "SMTP_SERVER": "smtp.server.test"}


class CryptoTests(unittest.TestCase):
    def test_round_trip_and_missing_or_changed_key(self):
        with mock.patch.dict(os.environ, {"EMAIL_CREDENTIAL_ENCRYPTION_KEY": KEY}):
            token = email_crypto.encrypt_app_password("app pw ✓")
            self.assertNotIn("app pw", token)
            self.assertEqual(email_crypto.decrypt_app_password(token), "app pw ✓")
        with mock.patch.dict(os.environ, {"EMAIL_CREDENTIAL_ENCRYPTION_KEY": ""}):
            with self.assertRaises(email_crypto.EmailCredentialEncryptionError):
                email_crypto.encrypt_app_password("x")
        with mock.patch.dict(os.environ, {"EMAIL_CREDENTIAL_ENCRYPTION_KEY": "a different passphrase"}):
            with self.assertRaises(email_crypto.EmailCredentialEncryptionError):
                email_crypto.decrypt_app_password(token)


class ApiTestCase(unittest.TestCase):
    def setUp(self):
        p = mock.patch.dict(os.environ, {"EMAIL_CREDENTIAL_ENCRYPTION_KEY": KEY})
        p.start()
        self.addCleanup(p.stop)
        for var in ("EMAIL_SENDER", "EMAIL_PASSWORD", "SMTP_SERVER", "EMAIL_AGENT_SENDER", "EMAIL_AGENT_PASSWORD"):
            self.assertNotIn(var, os.environ)
        use_engine(self)
        reset_db()
        self.client = main_client(self)
        with Session(ENGINE) as s:
            s.add_all([Tenant(id=1, name="BPO", business_name="SCM BPO"), Tenant(id=2, name="Other")])
            s.add_all([
                User(id=ADMIN, tenant_id=1, email="admin@scmbpo.test", password="login-secret", name="Ada Admin", role="Admin"),
                User(id=SALES, tenant_id=1, email="sam@scmbpo.test", password="x", name="Sam Sales", role="SalesManager",
                     phone="+91 90000 00000"),
                User(id=OTHER, tenant_id=1, email="olga@scmbpo.test", password="x", name="Olga", role="Employee"),
            ])
            s.add(Lead(id=1, tenant_id=1, company_name="Asha Freight", email="asha@example.test", owner_id=SALES))
            s.commit()
        self.webhook = mock.patch("httpx.post")
        self.webhook.start()
        self.addCleanup(self.webhook.stop)

    def req(self, method, url, user=ADMIN, **kw):
        return self.client.request(method, url, headers={"X-User-ID": str(user)}, **kw)

    def save_integration(self, user=SALES, email="sam@mail.test", password="sam-app-pw", **kw):
        payload = {"email": email, "app_password": password, "provider": "gmail", "smtp_host": "smtp.mail.test",
                   "smtp_port": 465, "smtp_security": "SSL/TLS", "imap_host": "imap.mail.test", "imap_port": 993,
                   "imap_security": "ssl", **kw}
        return self.req("PUT", "/users/me/email-integration", user=user, json=payload)

    def add_tenant_mailbox(self):
        with Session(ENGINE) as s:
            s.add(EmailSettings(tenant_id=1, smtp_host="mail.scmbpo.test", smtp_port=587, smtp_user="crm@scmbpo.test",
                                smtp_pass="tenant-pw", from_name="SCM BPO Sales", from_email="crm@scmbpo.test"))
            s.commit()


class IntegrationEndpointTests(ApiTestCase):
    def test_requires_identity(self):
        self.assertEqual(self.client.get("/users/me/email-integration").status_code, 401)
        self.assertEqual(self.client.get("/users/me/agent-profile").status_code, 401)

    def test_save_never_returns_or_stores_the_plain_password(self):
        self.assertEqual(self.req("GET", "/users/me/email-integration", user=SALES).json()["integration"]["configured"], False)
        r = self.save_integration()
        self.assertEqual(r.status_code, 200, r.text)
        self.assertNotIn("sam-app-pw", r.text)
        self.assertNotIn("password", r.text)
        got = self.req("GET", "/users/me/email-integration", user=SALES)
        self.assertNotIn("sam-app-pw", got.text)
        self.assertEqual(got.json()["integration"]["smtp_security"], "ssl")  # "SSL/TLS" normalized
        with Session(ENGINE) as s:
            row = s.exec(select(UserEmailIntegration)).one()
            self.assertNotEqual(row.encrypted_app_password, "sam-app-pw")
            self.assertEqual(email_crypto.decrypt_app_password(row.encrypted_app_password), "sam-app-pw")
            self.assertEqual((row.user_id, row.tenant_id), (SALES, 1))
        # Server settings can change without re-entering the password.
        self.assertEqual(self.req("PUT", "/users/me/email-integration", user=SALES, json={"smtp_port": 587, "smtp_security": "starttls"}).status_code, 200)
        self.assertEqual(self.req("GET", "/users/me/email-integration", user=OTHER).json()["integration"]["configured"], False)

    def test_validation(self):
        self.assertEqual(self.save_integration(email="not-an-email").status_code, 400)
        self.assertEqual(self.save_integration(smtp_port=70000).status_code, 400)
        self.assertEqual(self.save_integration(smtp_security="quantum").status_code, 400)
        self.assertEqual(self.req("PUT", "/users/me/email-integration", user=SALES, json={"email": "sam@mail.test"}).status_code, 400)
        with Session(ENGINE) as s:
            self.assertEqual(s.exec(select(UserEmailIntegration)).all(), [])

    def test_test_before_save_never_persists(self):
        with mock.patch("modules.email_integration.test_smtp_connection", return_value=(True, "ok")) as smtp, \
                mock.patch("modules.email_integration.test_imap_connection", return_value=(False, "IMAP authentication failed.")):
            r = self.req("POST", "/users/me/email-integration/test", user=SALES, json={
                "scope": "all", "email": "new@mail.test", "app_password": "temp-pw", "smtp_host": "smtp.mail.test",
                "smtp_port": 587, "smtp_security": "starttls", "imap_host": "imap.mail.test", "imap_port": 993})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()["ok"], r.json()["smtp"]["ok"], r.json()["imap"]["ok"]), (False, True, False))
        self.assertEqual(smtp.call_args.args[:2], ("new@mail.test", "temp-pw"))
        self.assertNotIn("temp-pw", r.text)
        with Session(ENGINE) as s:
            self.assertEqual(s.exec(select(UserEmailIntegration)).all(), [])

        self.save_integration()
        with mock.patch("modules.email_integration.test_smtp_connection", return_value=(True, "ok")), \
                mock.patch("modules.email_integration.test_imap_connection", return_value=(True, "ok")):
            self.req("POST", "/users/me/email-integration/test", user=SALES, json={"scope": "smtp", "app_password": "other"})
            with Session(ENGINE) as s:
                row = s.exec(select(UserEmailIntegration)).one()
                self.assertEqual((row.smtp_status, row.last_tested_at), ("not_tested", None))  # override test: not saved
                self.assertEqual(email_crypto.decrypt_app_password(row.encrypted_app_password), "sam-app-pw")
            r = self.req("POST", "/users/me/email-integration/test", user=SALES, json={"scope": "smtp"})
        self.assertTrue(r.json()["ok"])
        with Session(ENGINE) as s:
            self.assertEqual(s.exec(select(UserEmailIntegration)).one().smtp_status, "connected")


class AgentProfileTests(ApiTestCase):
    def test_defaults_come_from_the_login_record_read_only(self):
        p = self.req("GET", "/users/me/agent-profile", user=SALES).json()["agent_profile"]
        self.assertEqual((p["agent_name"], p["agent_email"], p["agent_phone"]), ("Sam Sales", "sam@scmbpo.test", "+91 90000 00000"))
        self.assertTrue(p["auto_append_signature"])
        self.save_integration()
        self.assertEqual(self.req("GET", "/users/me/agent-profile", user=SALES).json()["agent_profile"]["agent_email"], "sam@mail.test")

    def test_update_regenerates_the_signature_and_never_touches_the_login(self):
        r = self.req("PUT", "/users/me/agent-profile", user=ADMIN, json={"agent_name": "Ada", "agent_phone": "+91 98765 43210"})
        self.assertEqual(r.json()["agent_profile"]["signature"],
                         "Best Regards,\nAda\nEmail: admin@scmbpo.test\nPhone: +91 98765 43210")
        self.assertEqual(self.req("PUT", "/users/me/agent-profile", user=ADMIN, json={"agent_email": "bad"}).status_code, 400)
        r = self.req("PUT", "/users/me/agent-profile", user=ADMIN, json={"signature": "Thanks,\nAda", "auto_append_signature": False})
        self.assertEqual((r.json()["agent_profile"]["signature"], r.json()["agent_profile"]["auto_append_signature"]),
                         ("Thanks,\nAda", False))
        self.assertEqual(self.req("PUT", "/users/me/signature", user=ADMIN, json={"signature": "Regards"}).json(), {"ok": True})
        with Session(ENGINE) as s:
            user = s.get(User, ADMIN)
            self.assertEqual((user.email, user.password, user.name), ("admin@scmbpo.test", "login-secret", "Ada Admin"))
            self.assertEqual(s.exec(select(EmailAgentProfile)).one().signature, "Regards")

    def test_sender_fallbacks_are_scm_not_serphawk(self):
        import main
        with Session(ENGINE) as s:
            anon = main._email_agent_sender(s)
            self.assertEqual((anon["name"], anon["phone"]), ("SCMHub Logistics", ""))
            from modules.api_tracker import current_salesperson_id
            token = current_salesperson_id.set(OTHER)
            try:
                me = main._email_agent_sender(s)
            finally:
                current_salesperson_id.reset(token)
        self.assertEqual((me["name"], me["email"], me["phone"]), ("Olga", "olga@scmbpo.test", ""))


class SignatureTests(unittest.TestCase):
    SIG = "Best Regards,\nAda\nEmail: ada@scmbpo.test"

    def test_appended_once_and_replaces_scm_signoffs(self):
        import main
        for apply in (main._apply_signature, company_mailer.apply_signature):
            body = "Hello Asha,\n\nYour container is booked for Monday.\n\nBest regards,\nNoushad C I | SCM BPO"
            out = apply(body, self.SIG)
            self.assertEqual(out.count("Best Regards,"), 1, apply)
            self.assertNotIn("SCM BPO", out)
            self.assertTrue(out.endswith(self.SIG))
            self.assertEqual(apply(out, self.SIG), out)  # idempotent
            dapros = apply("Hi,\n\nThanks.\n\nBest,\nDapros Team", self.SIG)
            self.assertNotIn("Dapros", dapros)
            self.assertEqual(apply(body, ""), body)


# ─────────────────────────────────────────────────────────────────────────────
# Which mailbox each path sends from (D3)
# ─────────────────────────────────────────────────────────────────────────────
class ChainTests(ApiTestCase):
    def send_manual(self, user=SALES, **extra):
        payload = {"to_email": "asha@example.test", "company_name": "Asha Freight", "subject": "Your freight quote",
                   "english_body": "Hello Asha,\n\nBest regards,\nNoushad C I | SCM BPO", "action_type": "System", **extra}
        with mock.patch.object(email_sender, "send_email_outlook") as send:
            r = self.req("POST", "/send-manual", user=user, json=payload)
        return r, send

    def test_send_manual_uses_own_integration_then_company_mailbox_then_server(self):
        self.save_integration()
        self.req("PUT", "/users/me/agent-profile", user=SALES, json={"agent_name": "Sam at the Freight Desk"})
        r, send = self.send_manual()
        self.assertEqual(r.status_code, 200, r.text)
        kw = send.call_args.kwargs
        self.assertEqual((kw["sender_email"], kw["sender_password"], kw["smtp_server"], kw["smtp_port"], kw["security"]),
                         ("sam@mail.test", "sam-app-pw", "smtp.mail.test", 465, "ssl"))
        self.assertEqual(kw["extra_headers"]["From"], "Sam at the Freight Desk <sam@mail.test>")
        self.assertEqual(kw["tracking_id"], r.json()["sent_email_id"])
        self.assertEqual(kw["body"].count("Best Regards,"), 1)  # saved signature replaced the template sign-off
        self.assertNotIn("SCM BPO", kw["body"])

        r, send = self.send_manual(user=OTHER)  # no integration, no company mailbox, no server mailbox
        self.assertEqual(r.status_code, 200)
        send.assert_not_called()

        self.add_tenant_mailbox()
        r, send = self.send_manual(user=OTHER)
        self.assertEqual((send.call_args.kwargs["sender_email"], send.call_args.kwargs["sender_password"]),
                         ("crm@scmbpo.test", "tenant-pw"))

    def test_server_mailbox_is_last_and_the_email_agent_mailbox_wins_there(self):
        with mock.patch.dict(os.environ, SERVER_ENV):
            _, send = self.send_manual(user=OTHER)
            self.assertEqual(send.call_args.kwargs["sender_email"], "server@scmbpo.test")
            with mock.patch.dict(os.environ, {"EMAIL_AGENT_SENDER": "agent@scmbpo.test", "EMAIL_AGENT_PASSWORD": "agent-pw"}):
                _, send = self.send_manual(user=OTHER)
            self.assertEqual((send.call_args.kwargs["sender_email"], send.call_args.kwargs["sender_password"]),
                             ("agent@scmbpo.test", "agent-pw"))
            self.assertEqual(send.call_args.kwargs["extra_headers"]["From"], "Olga <agent@scmbpo.test>")

    def test_send_errors_keep_their_codes(self):
        self.save_integration()
        with mock.patch.object(email_sender, "send_email_outlook", side_effect=OSError("refused")):
            r = self.req("POST", "/send-manual", user=SALES, json={"to_email": "asha@example.test", "company_name": "A",
                                                                  "subject": "S", "english_body": "B"})
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (502, "email_integration_send_failed"))
        with mock.patch.dict(os.environ, {"EMAIL_CREDENTIAL_ENCRYPTION_KEY": "rotated key"}):
            r, send = self.send_manual()
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (500, "email_integration_decrypt_failed"))
        send.assert_not_called()

    def test_auto_send_from_the_email_agent_uses_the_chain(self):
        payload = {"company_name": "Asha Freight", "to_email": "asha@example.test", "subject": "Hello", "body": "Hi Asha",
                   "manual": False}
        stub = {"company_name": "Asha Freight", "key_value_props": ["Freight forwarding"], "contacts": []}
        with mock.patch("modules.llm_engine.analyze_content", return_value=stub), \
                mock.patch("modules.llm_engine.generate_email", return_value={}), \
                mock.patch.object(email_sender, "send_email_outlook") as send:
            r = self.req("POST", "/generate", user=OTHER, json=payload)
            self.assertEqual((r.status_code, r.json()["detail"]["code"]), (400, "email_integration_not_configured"))
            self.add_tenant_mailbox()
            r = self.req("POST", "/generate", user=OTHER, json=payload)
        self.assertEqual(r.status_code, 200, r.text)
        kw = send.call_args.kwargs
        self.assertEqual((kw["sender_email"], kw["tracking_id"]), ("crm@scmbpo.test", r.json()["email_id"]))

    def test_quotes_use_the_users_own_integration_first(self):
        import main
        from modules.api_tracker import current_salesperson_id
        self.save_integration()
        self.add_tenant_mailbox()
        with Session(ENGINE) as s:
            token = current_salesperson_id.set(SALES)
            try:
                self.assertEqual(main._quote_smtp_sender(s), ("sam@mail.test", "sam-app-pw", "smtp.mail.test", 465))
            finally:
                current_salesperson_id.reset(token)

    def test_contact_mail_never_falls_back_to_the_server_mailbox(self):
        with mock.patch.dict(os.environ, SERVER_ENV), Session(ENGINE) as s:
            with self.assertRaises(company_mailer.MailAccountError):
                company_mailer.resolve_account(s, OTHER, 1)  # Excel campaigns / follow-up emails
            self.assertEqual(company_mailer.resolve_account(s, OTHER, 1, allow_server_fallback=True).source, "server_env")
            self.assertFalse(company_mailer.account_status(s, OTHER, 1)["configured"])

    def test_send_and_record_keeps_a_tracked_row_and_drops_it_on_failure(self):
        self.save_integration()
        with Session(ENGINE) as s:
            account = company_mailer.resolve_account(s, SALES, 1)
            self.assertNotIn("sam-app-pw", repr(account))
            calls = []
            row = company_mailer.send_and_record(s, account, tenant_id=1, to="asha@example.test", subject="Hi", body="B",
                                                 lead_id=1, sender=lambda acc, **kw: calls.append(kw))
            self.assertEqual((row.status, calls[0]["tracking_id"]), ("Sent", row.id))
            self.assertEqual(json.loads(row.draft_json)["sent_from_source"], "user_integration")

            def boom(acc, **kw):
                raise OSError("down")
            with self.assertRaises(OSError):
                company_mailer.send_and_record(s, account, tenant_id=1, to="x@example.test", subject="X", body="B", sender=boom)
            self.assertEqual(len(s.exec(select(SentEmail)).all()), 1)


if __name__ == "__main__":
    unittest.main()
