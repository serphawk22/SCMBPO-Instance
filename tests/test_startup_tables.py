"""
The email-stack tables must appear on a database that already has the CRM's other tables. SCMBPO's
.migration_done file is tracked in git, so on every deploy database.create_db_and_tables() and
main._run_startup_migrations() are skipped; main._email_stack_startup() (run on every startup) creates
the tables instead.

    venv\\Scripts\\python -m unittest discover -s tests -t . -v
"""
import os
import threading
import unittest
import warnings
from unittest import mock

from sqlalchemy import inspect
from sqlalchemy.exc import SAWarning
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine

import database
from tests._support import load_main

EMAIL_TABLES = {"email_replies", "inbox_messages", "email_agent_profiles", "user_email_integrations", "follow_ups",
                "follow_up_note_scans", "email_campaigns", "email_campaign_recipients"}

_real_exists = os.path.exists


def _flag_present(path):
    return True if path == ".migration_done" else _real_exists(path)


class StartupTablesTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        existing = [t for name, t in SQLModel.metadata.tables.items() if name not in EMAIL_TABLES]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", SAWarning)  # leads <-> client_profiles <-> projects FK cycle
            SQLModel.metadata.create_all(self.engine, tables=existing)  # a deployed database before the port

    def tables(self):
        return set(inspect(self.engine).get_table_names())

    def test_existing_database_gets_the_email_tables(self):
        with mock.patch.object(database, "engine", self.engine), mock.patch("os.path.exists", _flag_present):
            database.create_db_and_tables()
        self.assertFalse(EMAIL_TABLES & self.tables(), "create_db_and_tables is skipped while .migration_done exists")

        main = load_main()
        main._ensure_email_tables(self.engine)
        self.assertTrue(EMAIL_TABLES <= self.tables())
        main._ensure_email_tables(self.engine)  # idempotent on every boot
        uniques = {u["name"] for u in inspect(self.engine).get_unique_constraints("inbox_messages")}
        self.assertIn("uq_inbox_messages_mailbox_message_id", uniques)

    def test_an_older_email_table_only_gains_the_missing_columns(self):
        # A database shared with another build already has follow_ups, but without contact_name & co. (the
        # scheduler then failed with "column follow_ups.contact_name does not exist").
        from datetime import datetime, timedelta, timezone

        from sqlalchemy import text
        from sqlmodel import Session, select

        from database import FollowUp
        from modules import followups_core

        with self.engine.begin() as conn:
            conn.execute(text("CREATE TABLE follow_ups (id INTEGER PRIMARY KEY, tenant_id INTEGER, lead_id INTEGER, "
                              "client_id INTEGER, title VARCHAR(500) NOT NULL, notes TEXT, due_at TIMESTAMP NOT NULL, "
                              "status VARCHAR(20) NOT NULL, legacy_flag VARCHAR(10), created_at TIMESTAMP)"))
            conn.execute(text("INSERT INTO follow_ups (id, tenant_id, lead_id, title, due_at, status, legacy_flag) "
                              "VALUES (7, 1, 3, 'Call back', '2026-10-01 10:00:00', 'Pending', 'keep me')"))
        before = {c["name"] for c in inspect(self.engine).get_columns("follow_ups")}

        main = load_main()
        added = main._ensure_email_tables(self.engine)
        after = {c["name"] for c in inspect(self.engine).get_columns("follow_ups")}
        self.assertTrue(before <= after, "no column is ever dropped")
        self.assertEqual(after - before, {c.name for c in FollowUp.__table__.columns} - before)
        self.assertIn("follow_ups.contact_name", added)
        self.assertTrue(EMAIL_TABLES <= self.tables())
        self.assertEqual(main._ensure_email_tables(self.engine), [])  # idempotent

        with self.engine.connect() as conn:
            self.assertEqual(conn.execute(text("SELECT title, legacy_flag FROM follow_ups WHERE id = 7")).one(),
                             ("Call back", "keep me"))  # existing row and legacy column kept
        with Session(self.engine) as s:
            self.assertIsNone(s.exec(select(FollowUp)).one().contact_name)
        now = datetime.now(timezone.utc) + timedelta(days=30)
        followups_core.process_due_reminders(self.engine, now=now, send_email=mock.Mock())  # the failing query
        followups_core.process_auto_sends(self.engine, now=now, sender=mock.Mock())

    def test_startup_with_the_flag_present_still_creates_them(self):
        main = load_main()
        with mock.patch.object(database, "engine", self.engine), mock.patch.object(main, "engine", self.engine), \
                mock.patch("os.path.exists", _flag_present), \
                mock.patch.object(main, "_run_startup_migrations") as gated, \
                mock.patch.object(main, "patch_openai"), \
                mock.patch.dict(os.environ, {"BACKGROUND_JOBS": "0"}), \
                mock.patch.object(threading.Thread, "start"):  # the DB keep-alive thread
            main.on_startup()
        gated.assert_not_called()
        self.assertTrue(EMAIL_TABLES <= self.tables())


if __name__ == "__main__":
    unittest.main()
