"""
Write paths that bind datetimes, through the real main.app. sqlmodel 0.0.47+ (requirements.txt pins 0.0.47)
maps `datetime` fields to a tz-aware type that rejects naive values on write and in query binds, so meetings,
scheduled calls, the Work Queue and "Closed Won" used to answer 500. Also covers the contact-link and
ticket-note routes whose models main.py did not import (NameError -> 500).

    venv\\Scripts\\python -m unittest discover -s tests -t . -v

In-memory SQLite, no network, nothing is sent. Passes on sqlmodel 0.0.34, 0.0.47 and 0.0.48.
"""
import unittest

from sqlmodel import Session, select

from database import ClientProfile, Contact, Deal, Lead, Meeting, ScheduledCall, Tenant, User
from tests._support import ENGINE, main_client, reset_db, use_engine

ADMIN = 1


class DatetimeWriteTests(unittest.TestCase):
    def setUp(self):
        use_engine(self)
        reset_db()
        with Session(ENGINE) as s:
            s.add(Tenant(id=1, name="BPO", business_name="SCM BPO"))
            s.add(User(id=ADMIN, tenant_id=1, email="admin@scmbpo.test", password="x", name="Ada Admin", role="Admin"))
            s.add(Lead(id=1, tenant_id=1, company_name="Asha Freight", email="asha@example.test", owner_id=ADMIN))
            s.add(ClientProfile(id=1, tenant_id=1, companyName="XCo", assignedEmployeeId=ADMIN))
            s.add(Contact(id=1, tenant_id=1, first_name="Jane", full_name="Jane Doe", email="jane@xco.test"))
            s.commit()
        self.client = main_client(self)
        self.h = {"X-User-ID": str(ADMIN), "X-Tenant-ID": "1"}

    def ok(self, res):
        self.assertLess(res.status_code, 400, res.text)
        return res.json()

    def test_meeting_in_the_organisers_timezone_is_stored_as_utc(self):
        self.ok(self.client.post("/meetings", headers=self.h, json={
            "title": "Kickoff", "scheduled_at": "2026-10-20T10:00", "timezone": "Asia/Kolkata", "host_id": ADMIN, "lead_id": 1}))
        with Session(ENGINE) as s:
            m = s.exec(select(Meeting)).one()
            self.assertEqual(m.scheduled_at.replace(tzinfo=None).isoformat(), "2026-10-20T04:30:00")  # 10:00 IST
            mid = m.id
        self.ok(self.client.patch(f"/meetings/{mid}/status", headers=self.h, json={"status": "Completed"}))

    def test_scheduled_call_keeps_its_wall_clock_time(self):
        self.ok(self.client.post("/scheduled-calls", headers=self.h, json={"title": "Call back", "scheduled_at": "2026-10-20T11:30", "entity_id": 1}))
        with Session(ENGINE) as s:
            self.assertEqual(s.exec(select(ScheduledCall)).one().scheduled_at.replace(tzinfo=None).isoformat(), "2026-10-20T11:30:00")

    def test_work_queue_and_lead_note(self):
        self.ok(self.client.post("/leads/1/notes", headers=self.h, json={"content": "Asked for a freight quote"}))
        self.ok(self.client.get("/work-queue?date_filter=today", headers=self.h))

    def test_deal_closed_won_stamps_won_at(self):
        deal = self.ok(self.client.post("/deals", headers=self.h, json={"title": "Ocean freight", "client_id": 1, "value": 1000, "assigned_to": ADMIN}))
        did = (deal.get("deal") or deal)["id"]
        self.ok(self.client.put(f"/deals/{did}", headers=self.h, json={"stage": "Closed Won"}))
        with Session(ENGINE) as s:
            self.assertIsNotNone(s.get(Deal, did).won_at)

    def test_contact_links_and_ticket_notes_answer(self):
        self.ok(self.client.get("/clients/1/contacts", headers=self.h))
        self.ok(self.client.get("/leads/1/contacts", headers=self.h))
        self.ok(self.client.get("/projects/tickets/1/notes", headers=self.h))


if __name__ == "__main__":
    unittest.main()
