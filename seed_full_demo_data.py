import os
import sys
import hashlib
from datetime import datetime, date, timedelta, timezone
import bcrypt
from dotenv import load_dotenv

load_dotenv(override=True)

from sqlmodel import Session, select
from database import (
    engine, User, Tenant, Lead, ClientProfile, LeadSource, Meeting, TaskSheetEntry,
    Deal, Proposal, BusinessCost, CallLog, Contact, Invoice
)
from routers.followups import FollowUp

# Precompute standard password hashes once
DEMO_SHA = hashlib.sha256("Password@123".encode()).hexdigest()
DEMO_BC = "$2b$12$K1m/rG3i5C/0QkUe5jQx.ODa1fFvEwE6r1Gq7b8WbM6qUuR9l6YKm"  # valid bcrypt string for quick startup

def seed() -> dict:
    print("Starting rapid enterprise demo data seed...", flush=True)
    now_utc = datetime.now(timezone.utc)
    summary_counts = {}

    with Session(engine) as s:
        # 1. Tenant
        tenant = s.exec(select(Tenant).where(Tenant.id == 1)).first()
        if not tenant:
            tenant = Tenant(
                id=1,
                name="Corporate HQ",
                business_name="SCMBPO Solutions Inc.",
                email="admin@scmbpo.com",
                is_trial=False
            )
            s.add(tenant)
            s.commit()

        # 2. Users (Batch loaded)
        existing_users = {u.email: u for u in s.exec(select(User)).all()}
        users_info = [
            ("System Admin", "admin@example.com", "Admin"),
            ("Varshith Rallabandi", "varshith@serphawk.com", "Admin"),
            ("Brajesh Kumar", "brajesh@serphawk.com", "SalesManager"),
            ("Gaurav Mehta", "gaurav@serphawk.com", "SalesManager"),
            ("V K Anjul", "anjul@serphawk.com", "SalesManager"),
            ("Rahul Sharma", "rahul@serphawk.com", "SalesManager"),
            ("Priya Patel", "priya@serphawk.com", "SalesManager"),
        ]

        user_map = {}
        for name, email, role in users_info:
            u = existing_users.get(email)
            if not u:
                u = User(
                    name=name,
                    email=email,
                    password=DEMO_SHA,
                    hashed_password=DEMO_BC,
                    role=role,
                    is_active=True,
                    status="APPROVED"
                )
                s.add(u)
                existing_users[email] = u
            else:
                u.name = name
                u.role = role
                u.is_active = True
                s.add(u)
            user_map[name] = u
        s.commit()

        # Re-query users to get actual IDs
        all_users = {u.name: u for u in s.exec(select(User)).all()}
        sales_users = [
            all_users.get("Brajesh Kumar", user_map["Brajesh Kumar"]),
            all_users.get("Gaurav Mehta", user_map["Gaurav Mehta"]),
            all_users.get("V K Anjul", user_map["V K Anjul"]),
            all_users.get("Rahul Sharma", user_map["Rahul Sharma"]),
            all_users.get("Priya Patel", user_map["Priya Patel"])
        ]

        # 3. Lead Sources
        existing_sources = {ls.name for ls in s.exec(select(LeadSource)).all()}
        for src in ["Website", "LinkedIn", "Referral", "Cold Outreach", "Google Ads", "Partner Network", "Meta Ads"]:
            if src not in existing_sources:
                s.add(LeadSource(name=src, is_active=True))
        s.commit()

        # 4. Leads across all stages
        existing_leads = {l.email: l for l in s.exec(select(Lead)).all()}
        lead_templates = [
            ("Apex Global Logistics", "arun@apexlogistics.com", "+91 9876543210", "New", "Website", None, "Freight & Supply Chain", 45),
            ("Nexus Freight Systems", "vikram@nexusfreight.io", "+91 9811223344", "New", "Google Ads", None, "Warehousing Automation", 50),
            ("BlueWave Shipping", "anita@bluewaveship.com", "+91 9822334455", "New", "LinkedIn", None, "Ocean Freight Management", 40),
            ("Zenith Cold Storage", "karan@zenithcold.com", "+91 9833445566", "New", "Referral", None, "Cold Chain Logistics", 60),
            ("SwiftCargo Solutions", "contact@swiftcargo.in", "+91 9844556677", "Contacted", "Website", sales_users[0], "Express Logistics", 65),
            ("TransWorld Express", "ops@transworld.org", "+91 9855667788", "Contacted", "Cold Outreach", sales_users[1], "3PL Distribution", 55),
            ("Maritime Hub Ltd", "info@maritimehub.co", "+91 9866778899", "Contacted", "LinkedIn", sales_users[2], "Port Operations", 70),
            ("Pinnacle Fleet", "fleet@pinnacle.com", "+91 9877889900", "Not Responded", "Website", sales_users[3], "Fleet Tracking", 35),
            ("Skyline Express Cargo", "support@skylinecargo.net", "+91 9888990011", "Not Responded", "Google Ads", sales_users[4], "Air Cargo", 30),
            ("SilverLine Transport", "silverline@transport.in", "+91 9899001122", "Neutral", "Partner Network", sales_users[0], "Interstate Freight", 60),
            ("Vanguard Logistics", "hello@vanguardlog.com", "+91 9900112233", "Neutral", "Referral", sales_users[1], "Contract Logistics", 62),
            ("Hyperion Supply Hub", "rohit@hyperionsupply.com", "+91 9911223344", "Positive", "LinkedIn", sales_users[2], "Supply Chain Consulting", 85),
            ("Orbital Warehousing", "deepak@orbitalwh.com", "+91 9922334455", "Positive", "Website", sales_users[3], "Smart Warehousing", 88),
            ("Metro Logistics Corp", "sales@metrolog.in", "+91 9933445566", "Positive", "Google Ads", sales_users[4], "Last-mile Delivery", 82),
            ("Alpha Haulage", "ops@alphahaulage.com", "+91 9944556677", "Negative", "Cold Outreach", sales_users[0], "Heavy Haulage", 25),
            ("Delta Route Logistics", "delta@deltaroute.net", "+91 9955667788", "Negative", "Website", sales_users[1], "Local Courier", 20),
            ("AeroTrans Worldwide", "amit@aerotrans.com", "+91 9966778899", "Converted", "Referral", sales_users[2], "Cross-border Logistics", 95),
            ("Global Distribution Pro", "sanjay@globaldist.in", "+91 9977889900", "Converted", "LinkedIn", sales_users[3], "Omnichannel Fulfillment", 98),
        ]

        for company, email, phone, stage, src, assigned_u, ind, score in lead_templates:
            if email not in existing_leads:
                lead = Lead(
                    company_name=company,
                    email=email,
                    phone=phone,
                    status=stage,
                    source=src,
                    owner_id=assigned_u.id if assigned_u else None,
                    industry=ind,
                    is_converted=(stage == "Converted"),
                    notes=f"Initial outreach for {company}. Requirements in {ind}.",
                    tenant_id=1,
                    created_at=now_utc - timedelta(days=8)
                )
                s.add(lead)
        s.commit()
        summary_counts["leads"] = len(s.exec(select(Lead)).all())

        # 5. Clients across all 7 stages
        existing_clients = {c.companyName: c for c in s.exec(select(ClientProfile)).all()}
        client_templates = [
            ("AeroTrans Worldwide", "amit@aerotrans.com", "+91 9966778899", "https://aerotrans.com", "Product Demo Scheduled", sales_users[2], "Cross-border Logistics", 25000),
            ("Global Distribution Pro", "sanjay@globaldist.in", "+91 9977889900", "https://globaldist.in", "Product Demo Scheduled", sales_users[3], "Omnichannel Fulfillment", 32000),
            ("FreightLink Systems", "director@freightlink.io", "+91 9123456780", "https://freightlink.io", "Attended", sales_users[0], "Freight Tech", 18500),
            ("NorthStar Maritime", "maritime@northstar.org", "+91 9123456781", "https://northstar.org", "Attended", sales_users[1], "Shipping Lines", 28000),
            ("Echo Logistics", "echo@echologistics.in", "+91 9123456782", "https://echologistics.in", "Not Attended", sales_users[4], "Road Freight", 12000),
            ("Titan Cargo Carriers", "titan@titancargo.com", "+91 9123456783", "https://titancargo.com", "Proposal Sent", sales_users[0], "Heavy Machinery Cargo", 45000),
            ("Zenith Logistics Hub", "zenith@hublogistics.co", "+91 9123456784", "https://hublogistics.co", "Proposal Sent", sales_users[2], "Contract Logistics", 52000),
            ("Pacific Overland Lines", "pacific@overland.net", "+91 9123456785", "https://overland.net", "Negotiation", sales_users[3], "Intermodal Transport", 68000),
            ("Crown Air Freight", "crown@crownair.com", "+91 9123456786", "https://crownair.com", "Negotiation", sales_users[1], "Air Freight Express", 54000),
            ("Prime Route Delivery", "prime@primeroute.in", "+91 9123456787", "https://primeroute.in", "Won", sales_users[2], "E-Commerce Courier", 85000),
            ("Allied Fleet Services", "allied@alliedfleet.com", "+91 9123456788", "https://alliedfleet.com", "Won", sales_users[0], "Fleet Management", 92000),
            ("RedRock Transport", "info@redrocktransport.com", "+91 9123456789", "https://redrocktransport.com", "Lost", sales_users[4], "Dry Bulk Transport", 22000),
        ]

        for comp, em, ph, web, st, sales_u, ind, val in client_templates:
            if comp not in existing_clients:
                c = ClientProfile(
                    companyName=comp,
                    projectName=comp,
                    phone=ph,
                    websiteUrl=web,
                    status=st,
                    assignedEmployeeId=sales_u.id,
                    industry=ind,
                    deal_value=val,
                    lead_score=85,
                    tenant_id=1,
                    contact_person=comp.split()[0] + " Director"
                )
                s.add(c)
        s.commit()
        all_clients = {c.companyName: c for c in s.exec(select(ClientProfile)).all()}
        summary_counts["clients"] = len(all_clients)

        # 6. Contacts
        existing_contacts = {ct.email for ct in s.exec(select(Contact)).all()}
        contact_templates = [
            ("Arun", "Sharma", "VP Operations", "arun.sharma@apexlogistics.com", "+91 9876500111", all_clients.get("AeroTrans Worldwide")),
            ("Vikram", "Malhotra", "Procurement Lead", "vikram.m@nexusfreight.io", "+91 9811200222", all_clients.get("Global Distribution Pro")),
            ("Anita", "Deshmukh", "Supply Chain Head", "anita.d@bluewaveship.com", "+91 9822300333", all_clients.get("FreightLink Systems")),
            ("Karan", "Singhania", "Managing Director", "karan.s@zenithcold.com", "+91 9833400444", all_clients.get("NorthStar Maritime")),
            ("Amit", "Verma", "COO", "amit.v@aerotrans.com", "+91 9966700555", all_clients.get("Titan Cargo Carriers")),
            ("Sanjay", "Gupta", "Logistics Director", "sanjay.g@globaldist.in", "+91 9977800666", all_clients.get("Prime Route Delivery")),
        ]
        for fn, ln, desig, em, ph, cl in contact_templates:
            if em not in existing_contacts:
                ct = Contact(
                    first_name=fn,
                    last_name=ln,
                    full_name=f"{fn} {ln}",
                    designation=desig,
                    email=em,
                    mobile_number=ph,
                    client_id=cl.id if cl else None,
                    tenant_id=1
                )
                s.add(ct)
        s.commit()

        # 7. Deals Pipeline
        existing_deals = {d.title for d in s.exec(select(Deal)).all()}
        deal_templates = [
            ("Titan Cargo Carriers - Enterprise Fleet BPO", 45000.0, "Proposal Sent", all_clients.get("Titan Cargo Carriers"), sales_users[0].id),
            ("Zenith Logistics Hub - Warehouse Automation", 52000.0, "Proposal Sent", all_clients.get("Zenith Logistics Hub"), sales_users[2].id),
            ("Pacific Overland Lines - Intermodal Operations", 68000.0, "Negotiation", all_clients.get("Pacific Overland Lines"), sales_users[3].id),
            ("Crown Air Freight - Cross-Border Express", 54000.0, "Negotiation", all_clients.get("Crown Air Freight"), sales_users[1].id),
            ("Prime Route Delivery - E-Commerce Courier Network", 85000.0, "Closed Won", all_clients.get("Prime Route Delivery"), sales_users[2].id),
            ("Allied Fleet Services - Fleet Management System", 92000.0, "Closed Won", all_clients.get("Allied Fleet Services"), sales_users[0].id),
            ("FreightLink Systems - Dispatch Tracking Solution", 18500.0, "Discovery", all_clients.get("FreightLink Systems"), sales_users[0].id),
            ("NorthStar Maritime - Port Handling BPO", 28000.0, "Discovery", all_clients.get("NorthStar Maritime"), sales_users[1].id),
            ("RedRock Transport - Bulk Distribution Contract", 22000.0, "Closed Lost", all_clients.get("RedRock Transport"), sales_users[4].id),
        ]

        for title, val, stage, cl, uid in deal_templates:
            if title not in existing_deals and cl:
                d = Deal(
                    title=title,
                    value=val,
                    final_value=val if stage == "Closed Won" else None,
                    stage=stage,
                    client_id=cl.id,
                    assigned_to=uid,
                    currency="USD",
                    won_at=now_utc - timedelta(days=12) if stage == "Closed Won" else None,
                    created_at=now_utc - timedelta(days=25),
                    updated_at=now_utc - timedelta(days=2),
                    tenant_id=1
                )
                s.add(d)
        s.commit()
        summary_counts["deals"] = len(s.exec(select(Deal)).all())

        # 8. Proposals
        existing_props = {p.title for p in s.exec(select(Proposal)).all()}
        proposal_templates = [
            ("Titan Cargo Carriers - Full Operations Proposal", all_clients.get("Titan Cargo Carriers"), 45000.0, "Sent", [
                {"product_name": "Dedicated Fleet Dispatchers (x4)", "quantity": 4, "unit_price": 5000.0, "unit": "month"},
                {"product_name": "24/7 Driver Support Desk", "quantity": 1, "unit_price": 15000.0, "unit": "package"},
                {"product_name": "Telematics Tracking & Fuel Audit", "quantity": 1, "unit_price": 10000.0, "unit": "license"},
            ], sales_users[0].id),
            ("Prime Route Delivery - E-Commerce Fulfillment Agreement", all_clients.get("Prime Route Delivery"), 85000.0, "Accepted", [
                {"product_name": "Hub Sorting & Scanning Automation", "quantity": 1, "unit_price": 45000.0, "unit": "annual"},
                {"product_name": "Customer Experience Support Reps (x6)", "quantity": 6, "unit_price": 4000.0, "unit": "month"},
                {"product_name": "Custom Integration Middleware", "quantity": 1, "unit_price": 16000.0, "unit": "onetime"},
            ], sales_users[2].id),
            ("Pacific Overland Lines - Commercial Terms", all_clients.get("Pacific Overland Lines"), 68000.0, "Draft", [
                {"product_name": "Intermodal Yard BPO Service", "quantity": 1, "unit_price": 50000.0, "unit": "annual"},
                {"product_name": "EDI Billing Automation", "quantity": 1, "unit_price": 18000.0, "unit": "license"},
            ], sales_users[3].id),
        ]

        for p_title, cl, p_val, p_st, line_items, uid in proposal_templates:
            if p_title not in existing_props and cl:
                prop = Proposal(
                    title=p_title,
                    client_id=cl.id,
                    total_value=p_val,
                    currency="USD",
                    status=p_st,
                    line_items=line_items,
                    signed_at=now_utc - timedelta(days=10) if p_st == "Accepted" else None,
                    valid_until=(date.today() + timedelta(days=30)).isoformat(),
                    created_by=uid,
                    created_at=now_utc - timedelta(days=15),
                    updated_at=now_utc - timedelta(days=3),
                    tenant_id=1
                )
                s.add(prop)
        s.commit()
        summary_counts["proposals"] = len(s.exec(select(Proposal)).all())

        # 9. Business Costs
        existing_costs = {bc.title for bc in s.exec(select(BusinessCost)).all()}
        cost_templates = [
            ("Sales Team Payroll & Commissions", "Salary", 18500.0, "USD", "2026-10-01", True),
            ("AWS Cloud Infrastructure & Database", "Software", 3200.0, "USD", "2026-10-01", True),
            ("HubSpot & Dialing VoIP Subscriptions", "Software", 1800.0, "USD", "2026-10-01", True),
            ("Google Ads & LinkedIn B2B Campaigns", "Marketing", 5400.0, "USD", "2026-10-01", True),
            ("Corporate Office Lease & Utilities", "Rent", 4200.0, "USD", "2026-10-01", True),
            ("Legal & Accounting Professional Services", "Other", 1500.0, "USD", "2026-10-01", False),
        ]
        for c_title, cat, c_amt, curr, c_date, recur in cost_templates:
            if c_title not in existing_costs:
                bc = BusinessCost(
                    title=c_title,
                    category=cat,
                    amount=c_amt,
                    currency=curr,
                    cost_date=c_date,
                    is_recurring=recur,
                    created_at=now_utc - timedelta(days=12),
                    tenant_id=1
                )
                s.add(bc)
        s.commit()
        summary_counts["business_costs"] = len(s.exec(select(BusinessCost)).all())

        # 10. Call Logs
        existing_calls = {cl.summary for cl in s.exec(select(CallLog)).all()}
        call_templates = [
            ("+91 9876543210", 720, "Discovery call discussing supply chain integration roadmap with Arun", "Brajesh Kumar", all_clients.get("AeroTrans Worldwide"), True, "2026-10-16"),
            ("+91 9811223344", 450, "Followed up on warehouse automation demo feedback with Vikram", "Gaurav Mehta", all_clients.get("Global Distribution Pro"), False, None),
            ("+91 9123456783", 980, "In-depth review of RFP commercial terms with Titan Cargo team", "Brajesh Kumar", all_clients.get("Titan Cargo Carriers"), True, "2026-10-15"),
            ("+91 9123456785", 860, "Volume tier discounting and SLA review with Pacific Overland", "Rahul Sharma", all_clients.get("Pacific Overland Lines"), True, "2026-10-17"),
            ("+91 9123456787", 1250, "Kickoff milestone validation with Prime Route operations leadership", "V K Anjul", all_clients.get("Prime Route Delivery"), False, None),
        ]
        for ph, dur, summ, rep_name, cl, fn, fd in call_templates:
            if summ not in existing_calls:
                clog = CallLog(
                    phone_number=ph,
                    duration_seconds=dur,
                    summary=summ,
                    assigned_to=rep_name,
                    client_id=cl.id if cl else None,
                    followup_needed=fn,
                    followup_date=fd,
                    received_at=now_utc - timedelta(days=2),
                    createdAt=now_utc - timedelta(days=2),
                    tenant_id=1
                )
                s.add(clog)
        s.commit()
        summary_counts["call_logs"] = len(s.exec(select(CallLog)).all())

        # 11. Meetings
        existing_meetings = {m.title for m in s.exec(select(Meeting)).all()}
        today_str = now_utc.strftime("%Y-%m-%d")
        tomorrow_str = (now_utc + timedelta(days=1)).strftime("%Y-%m-%d")
        yesterday_str = (now_utc - timedelta(days=1)).strftime("%Y-%m-%d")

        meeting_samples = [
            ("Apex Logistics Product Demo", "Demo on supply chain automation platform", f"{today_str}T11:00:00", 45, "Scheduled", "https://meet.google.com/xyz-demo-crm", sales_users[0].id),
            ("FreightLink Review Meeting", "Review submitted proposal and answer technical questions", f"{today_str}T15:30:00", 30, "Scheduled", "https://meet.google.com/abc-rev-crm", sales_users[1].id),
            ("Pacific Overland Negotiation Call", "Contract terms and volume discount discussion", f"{tomorrow_str}T10:00:00", 60, "Scheduled", "https://zoom.us/j/9988776655", sales_users[2].id),
            ("Echo Logistics Catchup", "Rescheduling missed demo call", f"{tomorrow_str}T14:00:00", 30, "Scheduled", "https://meet.google.com/ech-meet-up", sales_users[3].id),
            ("Maritime Hub Scope Alignment", "Client did not join scheduled bridge", f"{yesterday_str}T11:00:00", 45, "Missed", "https://meet.google.com/mis-sed-call", sales_users[2].id),
            ("Titan Cargo Technical Deepdive", "Completed deep dive with logistics architecture team", f"{yesterday_str}T16:00:00", 45, "Completed", "https://meet.google.com/comp-leted-call", sales_users[0].id),
        ]
        for m_title, desc, dt_str, dur, st, link, uid in meeting_samples:
            if m_title not in existing_meetings:
                m = Meeting(
                    title=m_title,
                    description=desc,
                    scheduled_at=datetime.fromisoformat(dt_str).replace(tzinfo=timezone.utc),
                    duration_minutes=dur,
                    status=st,
                    meeting_link=link,
                    created_by=uid,
                    tenant_id=1,
                    meeting_type="online",
                    timezone="Asia/Kolkata"
                )
                s.add(m)
        s.commit()
        summary_counts["meetings"] = len(s.exec(select(Meeting)).all())

        # 12. Follow-ups
        existing_fus = {fu.title for fu in s.exec(select(FollowUp)).all()}
        followup_samples = [
            ("Apex Global Logistics", "Confirm participation in product demo presentation", now_utc + timedelta(hours=3), "Pending", "Call", sales_users[0]),
            ("Titan Cargo Carriers", "Send revised pricing schedule after proposal review", now_utc + timedelta(hours=6), "Pending", "Email", sales_users[0]),
            ("Pacific Overland Lines", "Prepare final contract agreement draft for negotiation", now_utc + timedelta(days=2), "Pending", "Email", sales_users[3]),
            ("SwiftCargo Solutions", "Check if procurement received introductory catalog", now_utc - timedelta(days=1), "Pending", "Call", sales_users[1]),
            ("Prime Route Delivery", "Confirmed pilot onboard kickoff completed smoothly", now_utc - timedelta(days=3), "Completed", "Call", sales_users[2]),
        ]
        for ent_name, reason, due, st, channel, sales_u in followup_samples:
            fu_title = f"{ent_name}: {reason[:35]}"
            if fu_title not in existing_fus:
                fu = FollowUp(
                    title=fu_title,
                    notes=reason,
                    due_at=due,
                    status=st,
                    channel=channel,
                    priority="High" if "contract" in reason.lower() else "Medium",
                    timezone="Asia/Kolkata",
                    reminder_minutes=60,
                    owner_id=sales_u.id,
                    created_by=sales_u.id,
                    created_at=now_utc - timedelta(days=2),
                    updated_at=now_utc - timedelta(days=1),
                    tenant_id=1
                )
                s.add(fu)
        s.commit()
        summary_counts["follow_ups"] = len(s.exec(select(FollowUp)).all())

        # 13. TaskSheet Daily Work Logs
        existing_ts = {(ts.user_id, ts.work_date) for ts in s.exec(select(TaskSheetEntry)).all()}
        today_date_str = date.today().isoformat()
        yesterday_date_str = (date.today() - timedelta(days=1)).isoformat()
        task_sheet_samples = [
            (sales_users[0].id, today_date_str, "Sales", "Cold outreach to 25 manufacturing leads. 2 product demos conducted. Titan Cargo proposal review locked.", "Completed", 360),
            (sales_users[1].id, today_date_str, "Sales", "Outreach to 30 freight forwarders. Demo with TransWorld Express. Prepared 2 custom pricing proposals.", "Completed", 340),
            (sales_users[2].id, today_date_str, "Sales", "Followed up with 20 enterprise leads. Closed Prime Route contract ($85k). Deep discovery with Hyperion.", "Completed", 380),
            (sales_users[3].id, today_date_str, "Sales", "Email followups and contract adjustments for Pacific Overland ($68k). Scheduled 3 demos for tomorrow.", "Completed", 350),
            (sales_users[0].id, yesterday_date_str, "Sales", "Outreach in North India logistics cluster. 22 calls made. Verified decision-makers.", "Completed", 300),
            (sales_users[2].id, yesterday_date_str, "Sales", "Conducted discovery call with Zenith Logistics. Sent standard SLA documentation.", "Completed", 320),
        ]
        for uid, wdate, area, summ, st, mins in task_sheet_samples:
            if (uid, wdate) not in existing_ts:
                ts = TaskSheetEntry(
                    user_id=uid,
                    work_date=wdate,
                    area=area,
                    summary=summ,
                    status=st,
                    time_spent_minutes=mins,
                    tenant_id=1
                )
                s.add(ts)
        s.commit()
        summary_counts["task_sheet"] = len(s.exec(select(TaskSheetEntry)).all())

    print("RAPID ENTERPRISE DEMO DATA SEED COMPLETE!", flush=True)
    return summary_counts

if __name__ == "__main__":
    res = seed()
    print("Seed results:", res)
