"""
Sales-instance access rules, through the real main.app:

* Task sheet: any signed-in user can submit (always as themselves) but only admins can read, edit or
  summarise the entries.
* Meetings: a salesperson only sees / touches meetings they host (are assigned to) or created; admins see all.
* Sales Manager dashboard: returns that salesperson's own analytics, never anyone else's numbers.

    venv\\Scripts\\python -m unittest tests.test_sales_scoping -v

In-memory SQLite, no network, nothing is sent.
"""
import unittest
from datetime import datetime, timedelta

from sqlmodel import Session, select

from database import Lead, Meeting, TaskSheetEntry, Tenant, User
from tests._support import ENGINE, main_client, reset_db, use_engine

ADMIN, ANU, BEN = 1, 2, 3


def hdr(uid):
    return {"X-User-ID": str(uid), "X-Tenant-ID": "1"}


class SalesScopingTests(unittest.TestCase):
    def setUp(self):
        use_engine(self)
        reset_db()
        with Session(ENGINE) as s:
            s.add(Tenant(id=1, name="BPO", business_name="SCM BPO"))
            s.add(User(id=ADMIN, tenant_id=1, email="admin@scmbpo.test", password="x", name="Ada Admin", role="Admin"))
            s.add(User(id=ANU, tenant_id=1, email="anu@scmbpo.test", password="x", name="Anu Sales", role="SalesManager"))
            s.add(User(id=BEN, tenant_id=1, email="ben@scmbpo.test", password="x", name="Ben Sales", role="SalesManager"))
            s.add(Lead(id=1, tenant_id=1, company_name="Asha Freight", email="asha@example.test", owner_id=ANU))
            s.commit()
        self.client = main_client(self)

    # ── helpers ──────────────────────────────────────────────────────────────
    def meeting(self, uid, title, **extra):
        res = self.client.post("/meetings", headers=hdr(uid), json={
            "title": title, "scheduled_at": (datetime.utcnow() + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M"),
            "timezone": "UTC", **extra})
        self.assertLess(res.status_code, 400, res.text)
        return res.json()["meeting"]

    def sheet(self, uid, **extra):
        res = self.client.post("/task-sheet", headers=hdr(uid), json={
            "user_id": uid, "work_date": datetime.utcnow().date().isoformat(), "summary": f"work by {uid}",
            "outreaches_count": 10, "positives_count": 4, **extra})
        self.assertLess(res.status_code, 400, res.text)
        return res.json()["entry"]

    # ── task sheet ───────────────────────────────────────────────────────────
    def test_salesperson_can_submit_but_not_read_entries(self):
        entry = self.sheet(ANU)
        self.assertEqual(entry["user_id"], ANU)
        self.assertEqual(self.client.get("/task-sheet", headers=hdr(ANU)).status_code, 403)
        self.assertEqual(self.client.get(f"/task-sheet?user_id={ANU}", headers=hdr(ANU)).status_code, 403)
        self.assertEqual(self.client.get("/task-sheet?period=all").status_code, 401)

    def test_submission_is_always_attributed_to_the_caller(self):
        res = self.client.post("/task-sheet", headers=hdr(BEN), json={
            "user_id": ADMIN, "work_date": "2026-01-01", "summary": "pretending to be the admin"})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["entry"]["user_id"], BEN)
        with Session(ENGINE) as s:
            self.assertEqual(s.exec(select(TaskSheetEntry)).one().user_id, BEN)

    def test_salesperson_cannot_edit_or_summarise_entries(self):
        entry = self.sheet(ANU)
        body = {"user_id": ANU, "work_date": entry["work_date"], "summary": "tampered"}
        self.assertEqual(self.client.put(f"/task-sheet/{entry['id']}", headers=hdr(ANU), json=body).status_code, 403)
        self.assertEqual(self.client.post("/task-sheet/ai-summary", headers=hdr(ANU), json={"period": "today"}).status_code, 403)

    def test_admin_sees_every_entry(self):
        self.sheet(ANU)
        self.sheet(BEN)
        res = self.client.get("/task-sheet?period=today", headers=hdr(ADMIN))
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual({e["user_id"] for e in res.json()["entries"]}, {ANU, BEN})

    # ── meetings ─────────────────────────────────────────────────────────────
    def test_meeting_defaults_to_creator_as_host_and_stamps_created_by(self):
        m = self.meeting(ANU, "Anu demo")
        self.assertEqual((m["host_id"], m["created_by"]), (ANU, ANU))

    def test_each_salesperson_only_lists_their_assigned_or_created_meetings(self):
        mine = self.meeting(ANU, "Anu's own")
        bens = self.meeting(BEN, "Ben's own")
        assigned = self.meeting(ADMIN, "Admin booked it for Anu", host_id=ANU)

        def titles(uid):
            res = self.client.get("/meetings", headers=hdr(uid))
            self.assertEqual(res.status_code, 200, res.text)
            return {m["title"] for m in res.json()["meetings"]}

        self.assertEqual(titles(ANU), {mine["title"], assigned["title"]})   # created + assigned
        self.assertEqual(titles(BEN), {bens["title"]})
        self.assertEqual(titles(ADMIN), {mine["title"], bens["title"], assigned["title"]})

    def test_meeting_created_by_anu_but_assigned_to_ben_is_visible_to_both(self):
        m = self.meeting(ANU, "Handed over", host_id=BEN)
        for uid in (ANU, BEN):
            self.assertEqual(self.client.get(f"/meetings/{m['id']}", headers=hdr(uid)).status_code, 200)

    def test_cannot_open_edit_or_delete_someone_elses_meeting(self):
        bens = self.meeting(BEN, "Ben only")
        self.assertEqual(self.client.get(f"/meetings/{bens['id']}", headers=hdr(ANU)).status_code, 403)
        self.assertEqual(self.client.patch(f"/meetings/{bens['id']}", headers=hdr(ANU), json={"title": "hijack"}).status_code, 403)
        self.assertEqual(self.client.patch(f"/meetings/{bens['id']}/status", headers=hdr(ANU), json={"status": "Cancelled"}).status_code, 403)
        self.assertEqual(self.client.delete(f"/meetings/{bens['id']}", headers=hdr(ANU)).status_code, 403)
        with Session(ENGINE) as s:  # untouched
            row = s.get(Meeting, bens["id"])
            self.assertEqual((row.title, row.status), ("Ben only", "Scheduled"))
        # the owner and an admin can
        self.assertEqual(self.client.patch(f"/meetings/{bens['id']}", headers=hdr(BEN), json={"title": "Ben renamed"}).status_code, 200)
        self.assertEqual(self.client.delete(f"/meetings/{bens['id']}", headers=hdr(ADMIN)).status_code, 200)

    def test_meetings_require_sign_in(self):
        self.assertEqual(self.client.get("/meetings").status_code, 401)

    def test_meeting_history_on_a_shared_lead_is_scoped(self):
        self.meeting(ANU, "Anu on the lead", lead_id=1)
        self.meeting(BEN, "Ben on the lead", lead_id=1)

        def seen(uid):
            res = self.client.get("/meetings/history?entity_type=lead&entity_id=1", headers=hdr(uid))
            self.assertEqual(res.status_code, 200, res.text)
            body = res.json()
            return {m["title"] for m in body["upcoming"] + body["past"]}, body["stats"]["total"]

        self.assertEqual(seen(ANU), ({"Anu on the lead"}, 1))
        self.assertEqual(seen(BEN), ({"Ben on the lead"}, 1))
        self.assertEqual(seen(ADMIN)[1], 2)

    # ── dashboard ────────────────────────────────────────────────────────────
    def test_dashboard_analytics_are_personal(self):
        self.sheet(ANU, meetings_scheduled=2)
        self.sheet(BEN, outreaches_count=99, positives_count=50)
        self.meeting(ANU, "Anu demo")
        self.meeting(BEN, "Ben demo 1")
        self.meeting(BEN, "Ben demo 2")

        res = self.client.get("/dashboard-stats?role=SalesManager&email=anu@scmbpo.test", headers=hdr(ANU))
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertTrue(data["isSalesManager"])
        a = data["analytics"]
        self.assertIsNotNone(a)
        self.assertEqual(a["task_sheet"]["totals_7d"]["outreaches"], 10)      # not Ben's 99
        self.assertEqual(a["task_sheet"]["totals_7d"]["meetings"], 2)
        self.assertTrue(a["task_sheet"]["submitted_today"])
        self.assertEqual(a["task_sheet"]["positive_rate_7d"], 40.0)
        self.assertEqual(len(a["task_sheet"]["daily"]), 7)
        self.assertEqual(a["meetings"]["total"], 1)                           # not Ben's two
        self.assertEqual(a["meetings"]["upcoming"], 1)
        self.assertEqual(len(a["monthly"]), 6)
        self.assertEqual(sum(s["count"] for s in a["leads_by_status"]), 1)    # Anu owns the one lead


if __name__ == "__main__":
    unittest.main()
