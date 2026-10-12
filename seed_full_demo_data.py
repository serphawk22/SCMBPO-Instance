import os
import sys
import hashlib
from datetime import datetime, date, timedelta, timezone
import bcrypt
from dotenv import load_dotenv

load_dotenv(override=True)

from sqlmodel import Session, select, SQLModel
from database import engine, User, Tenant, Lead, ClientProfile, LeadSource, Meeting, TaskSheetEntry
from routers.followups import FollowUp

def hash_pw(pw: str) -> tuple[str, str]:
    sha = hashlib.sha256(pw.encode()).hexdigest()
    bc = bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    return sha, bc

def seed():
    print("Starting full demo data seed...", flush=True)
    SQLModel.metadata.create_all(engine)
    print("Verified all tables including follow_ups exist.", flush=True)
    with Session(engine) as s:
        # 1. Tenant
        tenant = s.exec(select(Tenant).where(Tenant.id == 1)).first()
        if not tenant:
            tenant = Tenant(
                id=1,
                name="Default Tenant",
                business_name="SCMBPO Solutions",
                email="admin@scmbpo.com",
                is_trial=False
            )
            s.add(tenant)
            s.commit()
            print("Created Tenant 1", flush=True)

        # 2. Users (Admin + Salespeople)
        users_info = [
            ("System Admin", "admin@example.com", "Admin@123", "Admin"),
            ("Varshith Rallabandi", "varshith@serphawk.com", "varshith_admin", "Admin"),
            ("Brajesh Kumar", "brajesh@serphawk.com", "password123", "SalesManager"),
            ("Gaurav Mehta", "gaurav@serphawk.com", "password123", "SalesManager"),
            ("V K Anjul", "anjul@serphawk.com", "password123", "SalesManager"),
            ("Rahul Sharma", "rahul@serphawk.com", "password123", "SalesManager"),
            ("Priya Patel", "priya@serphawk.com", "password123", "SalesManager"),
        ]

        user_map = {}
        for name, email, pw, role in users_info:
            u = s.exec(select(User).where(User.email == email)).first()
            sha, bc = hash_pw(pw)
            if not u:
                u = User(
                    name=name,
                    email=email,
                    password=sha,
                    hashed_password=bc,
                    role=role,
                    is_active=True,
                    status="APPROVED"
                )
                s.add(u)
                s.commit()
                s.refresh(u)
                print(f"Created user: {name} ({role})", flush=True)
            else:
                u.name = name
                u.role = role
                u.is_active = True
                s.add(u)
                s.commit()
                s.refresh(u)
            user_map[name] = u

        sales_users = [user_map["Brajesh Kumar"], user_map["Gaurav Mehta"], user_map["V K Anjul"], user_map["Rahul Sharma"], user_map["Priya Patel"]]

        # 3. Lead Sources
        sources = ["Website", "LinkedIn", "Referral", "Cold Outreach", "Google Ads", "Partner Network"]
        for src in sources:
            existing_src = s.exec(select(LeadSource).where(LeadSource.name == src)).first()
            if not existing_src:
                s.add(LeadSource(name=src, is_active=True))
        s.commit()

        # 4. Leads across all 7 stages:
        # Stages: New, Contacted, Not Responded, Neutral, Positive, Negative, Converted
        lead_templates = [
            # Unassigned New Leads (to test Auto Assign)
            ("Apex Global Logistics", "arun@apexlogistics.com", "+91 9876543210", "New", "Website", None, "Freight & Supply Chain", 45),
            ("Nexus Freight Systems", "vikram@nexusfreight.io", "+91 9811223344", "New", "Google Ads", None, "Warehousing Automation", 50),
            ("BlueWave Shipping", "anita@bluewaveship.com", "+91 9822334455", "New", "LinkedIn", None, "Ocean Freight Management", 40),
            ("Zenith Cold Storage", "karan@zenithcold.com", "+91 9833445566", "New", "Referral", None, "Cold Chain Logistics", 60),

            # Contacted
            ("SwiftCargo Solutions", "contact@swiftcargo.in", "+91 9844556677", "Contacted", "Website", sales_users[0], "Express Logistics", 65),
            ("TransWorld Express", "ops@transworld.org", "+91 9855667788", "Contacted", "Cold Outreach", sales_users[1], "3PL Distribution", 55),
            ("Maritime Hub Ltd", "info@maritimehub.co", "+91 9866778899", "Contacted", "LinkedIn", sales_users[2], "Port Operations", 70),

            # Not Responded
            ("Pinnacle Fleet", "fleet@pinnacle.com", "+91 9877889900", "Not Responded", "Website", sales_users[3], "Fleet Tracking", 35),
            ("Skyline Express Cargo", "support@skylinecargo.net", "+91 9888990011", "Not Responded", "Google Ads", sales_users[4], "Air Cargo", 30),

            # Neutral
            ("SilverLine Transport", "silverline@transport.in", "+91 9899001122", "Neutral", "Partner Network", sales_users[0], "Interstate Freight", 60),
            ("Vanguard Logistics", "hello@vanguardlog.com", "+91 9900112233", "Neutral", "Referral", sales_users[1], "Contract Logistics", 62),

            # Positive
            ("Hyperion Supply Hub", "rohit@hyperionsupply.com", "+91 9911223344", "Positive", "LinkedIn", sales_users[2], "Supply Chain Consulting", 85),
            ("Orbital Warehousing", "deepak@orbitalwh.com", "+91 9922334455", "Positive", "Website", sales_users[3], "Smart Warehousing", 88),
            ("Metro Logistics Corp", "sales@metrolog.in", "+91 9933445566", "Positive", "Google Ads", sales_users[4], "Last-mile Delivery", 82),

            # Negative
            ("Alpha Haulage", "ops@alphahaulage.com", "+91 9944556677", "Negative", "Cold Outreach", sales_users[0], "Heavy Haulage", 25),
            ("Delta Route Logistics", "delta@deltaroute.net", "+91 9955667788", "Negative", "Website", sales_users[1], "Local Courier", 20),

            # Converted
            ("AeroTrans Worldwide", "amit@aerotrans.com", "+91 9966778899", "Converted", "Referral", sales_users[2], "Cross-border Logistics", 95),
            ("Global Distribution Pro", "sanjay@globaldist.in", "+91 9977889900", "Converted", "LinkedIn", sales_users[3], "Omnichannel Fulfillment", 98),
        ]

        lead_objs = []
        for company, email, phone, stage, src, assigned_u, ind, score in lead_templates:
            existing_lead = s.exec(select(Lead).where(Lead.email == email)).first()
            if not existing_lead:
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
                    created_at=datetime.now(timezone.utc) - timedelta(days=2)
                )
                s.add(lead)
                lead_objs.append(lead)
        s.commit()
        print(f"Seeded {len(lead_objs)} leads across all stages", flush=True)

        # 5. Clients across all 7 stages:
        # Stages: Product Demo Scheduled, Attended, Not Attended, Proposal Sent, Negotiation, Won, Lost
        client_templates = [
            ("AeroTrans Worldwide", "amit@aerotrans.com", "+91 9966778899", "https://aerotrans.com", "Product Demo Scheduled", sales_users[2], "Cross-border Logistics", 15000),
            ("Global Distribution Pro", "sanjay@globaldist.in", "+91 9977889900", "https://globaldist.in", "Product Demo Scheduled", sales_users[3], "Omnichannel Fulfillment", 22000),
            ("FreightLink Systems", "director@freightlink.io", "+91 9123456780", "https://freightlink.io", "Attended", sales_users[0], "Freight Tech", 18500),
            ("NorthStar Maritime", "maritime@northstar.org", "+91 9123456781", "https://northstar.org", "Attended", sales_users[1], "Shipping Lines", 28000),
            ("Echo Logistics", "echo@echologistics.in", "+91 9123456782", "https://echologistics.in", "Not Attended", sales_users[4], "Road Freight", 12000),
            ("Titan Cargo Carriers", "titan@titancargo.com", "+91 9123456783", "https://titancargo.com", "Proposal Sent", sales_users[0], "Heavy Machinery Cargo", 35000),
            ("Zenith Logistics Hub", "zenith@hublogistics.co", "+91 9123456784", "https://hublogistics.co", "Proposal Sent", sales_users[2], "Contract Logistics", 42000),
            ("Pacific Overland Lines", "pacific@overland.net", "+91 9123456785", "https://overland.net", "Negotiation", sales_users[3], "Intermodal Transport", 55000),
            ("Crown Air Freight", "crown@crownair.com", "+91 9123456786", "https://crownair.com", "Negotiation", sales_users[1], "Air Freight Express", 48000),
            ("Prime Route Delivery", "prime@primeroute.in", "+91 9123456787", "https://primeroute.in", "Won", sales_users[2], "E-Commerce Courier", 65000),
            ("Allied Fleet Services", "allied@alliedfleet.com", "+91 9123456788", "https://alliedfleet.com", "Won", sales_users[0], "Fleet Management", 72000),
            ("RedRock Transport", "info@redrocktransport.com", "+91 9123456789", "https://redrocktransport.com", "Lost", sales_users[4], "Dry Bulk Transport", 16000),
        ]

        client_objs = []
        for comp, em, ph, web, st, sales_u, ind, val in client_templates:
            existing_c = s.exec(select(ClientProfile).where(ClientProfile.companyName == comp)).first()
            if not existing_c:
                # create client user for email lookup
                client_user = s.exec(select(User).where(User.email == em)).first()
                if not client_user:
                    sha, bc = hash_pw("Client@123")
                    client_user = User(
                        name=comp,
                        email=em,
                        password=sha,
                        hashed_password=bc,
                        role="Client",
                        is_active=True,
                        status="APPROVED"
                    )
                    s.add(client_user)
                    s.commit()
                    s.refresh(client_user)

                c = ClientProfile(
                    companyName=comp,
                    projectName=comp,
                    userId=client_user.id,
                    phone=ph,
                    websiteUrl=web,
                    status=st,
                    assignedEmployeeId=sales_u.id,
                    industry=ind,
                    deal_value=val,
                    lead_score=85,
                    tenant_id=1,
                    contact_person=comp.split()[0] + " Rep"
                )
                s.add(c)
                client_objs.append(c)
        s.commit()
        print(f"Seeded {len(client_objs)} clients across all stages", flush=True)

        # 6. Meetings: Today, Tomorrow, Missed, Scheduled, Completed
        today_dt = datetime.now(timezone.utc)
        today_str = today_dt.strftime("%Y-%m-%d")
        tomorrow_str = (today_dt + timedelta(days=1)).strftime("%Y-%m-%d")
        yesterday_str = (today_dt - timedelta(days=1)).strftime("%Y-%m-%d")

        meeting_samples = [
            ("Apex Logistics Product Demo", "Demo on supply chain automation platform", f"{today_str}T11:00:00", 45, "Scheduled", "https://meet.google.com/xyz-demo-crm", sales_users[0].id),
            ("FreightLink Review Meeting", "Review submitted proposal and answer technical questions", f"{today_str}T15:30:00", 30, "Scheduled", "https://meet.google.com/abc-rev-crm", sales_users[1].id),
            ("Pacific Overland Negotiation Call", "Contract terms and volume discount discussion", f"{tomorrow_str}T10:00:00", 60, "Scheduled", "https://zoom.us/j/9988776655", sales_users[2].id),
            ("Echo Logistics Catchup", "Rescheduling missed demo call", f"{tomorrow_str}T14:00:00", 30, "Scheduled", "https://meet.google.com/ech-meet-up", sales_users[3].id),
            ("Maritime Hub Scope Alignment", "Client did not join scheduled bridge", f"{yesterday_str}T11:00:00", 45, "Missed", "https://meet.google.com/mis-sed-call", sales_users[2].id),
            ("Titan Cargo Technical Deepdive", "Completed deep dive with logistics architecture team", f"{yesterday_str}T16:00:00", 45, "Completed", "https://meet.google.com/comp-leted-call", sales_users[0].id),
        ]

        for title, desc, dt_str, dur, st, link, uid in meeting_samples:
            existing_m = s.exec(select(Meeting).where(Meeting.title == title)).first()
            if not existing_m:
                m = Meeting(
                    title=title,
                    description=desc,
                    scheduled_at=datetime.fromisoformat(dt_str),
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
        print("Seeded Meetings (Today, Tomorrow, Missed, Completed)", flush=True)

        # 7. Follow-ups: Upcoming, Pending, Completed, Overdue
        followup_samples = [
            ("Apex Global Logistics", "lead", "Call CEO to confirm participation in today's demo", today_dt + timedelta(hours=2), "pending", "call", sales_users[0]),
            ("Titan Cargo Carriers", "client", "Send revised pricing schedule after proposal review", today_dt + timedelta(hours=4), "pending", "email", sales_users[0]),
            ("Pacific Overland Lines", "client", "Prepare final contract agreement draft for tomorrow's call", today_dt + timedelta(days=1), "pending", "task", sales_users[3]),
            ("SwiftCargo Solutions", "lead", "Check if procurement team received introductory catalog", today_dt - timedelta(days=1), "overdue", "call", sales_users[1]),
            ("AeroTrans Worldwide", "client", "Confirmed pilot onboard kickoff completed smoothly", today_dt - timedelta(days=2), "completed", "meeting", sales_users[2]),
        ]

        for ent_name, ent_type, reason, due, st, ftype, sales_u in followup_samples:
            title_str = f"Follow-up: {ent_name} - {reason[:30]}"
            existing_f = s.exec(select(FollowUp).where(FollowUp.title == title_str)).first()
            if not existing_f:
                fu = FollowUp(
                    title=title_str,
                    notes=reason,
                    due_at=due,
                    status="Completed" if st == "completed" else "Pending",
                    channel="Call" if ftype == "call" else "Email",
                    owner_id=sales_u.id,
                    tenant_id=1
                )
                s.add(fu)
        s.commit()
        print("Seeded Follow-ups (Pending, Overdue, Completed)", flush=True)

        # 8. Task Sheet entries for Today and Yesterday
        today_date_str = date.today().isoformat()
        yesterday_date_str = (date.today() - timedelta(days=1)).isoformat()

        task_sheet_samples = [
            # Today's submissions
            (sales_users[0].id, today_date_str, "Sales", "Cold outreach to 25 manufacturing leads in Gujarat cluster. Completed 2 live demo presentations. Locked in Titan Cargo proposal review.", "Completed", 360, 25, 6, 2, 4, 2, "Titan Cargo Carriers - $35k contract pending final approval"),
            (sales_users[1].id, today_date_str, "Sales", "Outreach to 30 freight forwarders. Held 1 demo with TransWorld Express. Prepared 2 custom pricing quotes.", "Completed", 340, 30, 8, 3, 5, 1, "Crown Air Freight - Final discount negotiation round"),
            (sales_users[2].id, today_date_str, "Sales", "Followed up with 20 high-value leads. Closed AeroTrans Worldwide ($15k). Conducted scope call with Hyperion.", "Completed", 380, 20, 9, 1, 3, 2, "Hyperion Supply Hub - Excellent buying intent, converting this week"),
            (sales_users[3].id, today_date_str, "Sales", "Cold email campaign followups. Handled contract terms for Pacific Overland ($55k). Scheduled 3 demos for tomorrow.", "Completed", 350, 28, 7, 2, 6, 3, "Pacific Overland Lines - High ticket enterprise deal ($55k)"),
            
            # Yesterday's submissions
            (sales_users[0].id, yesterday_date_str, "Sales", "Initial prospecting in North India retail supply chain. 22 calls made. Verified contact decision-makers.", "Completed", 300, 22, 5, 4, 3, 1, "SwiftCargo Solutions - Awaiting management review"),
            (sales_users[2].id, yesterday_date_str, "Sales", "Conducted deep discovery call with Zenith Logistics. Sent standard SLA documentation.", "Completed", 320, 18, 6, 1, 4, 1, "Zenith Logistics Hub - Proposal sent, review on Thursday"),
        ]

        for uid, wdate, area, summ, st, mins, outreaches, pos, neg, fol, meet, focus in task_sheet_samples:
            existing_ts = s.exec(select(TaskSheetEntry).where(TaskSheetEntry.user_id == uid, TaskSheetEntry.work_date == wdate)).first()
            if not existing_ts:
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
        print("Seeded TaskSheet work logs", flush=True)

    print("ALL DEMO DATA SEEDED SUCCESSFULLY!", flush=True)

if __name__ == "__main__":
    seed()
