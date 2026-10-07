"""
SCM BPO CRM — Enhancements Data Seeder
Seeds demo data matching the database schema for:
- dropped_clients
- salesperson_history
- excel_campaigns & excel_campaign_records
- deal_id links on quotes & proposals
- invoice linked to quote
- lead sentiment & source
"""
import os
import sys
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv(override=True)

from database import engine, Session
from sqlalchemy import text

def seed_demo_data():
    with Session(engine) as session:
        # Get admin user and some clients/leads/deals/quotes
        admin = session.exec(text("SELECT id, name FROM users WHERE role='Admin' LIMIT 1")).first()
        admin_id = admin[0] if admin else 1

        clients = session.exec(text("SELECT id, \"companyName\" FROM client_profiles LIMIT 5")).all()
        leads = session.exec(text("SELECT id, company_name FROM leads LIMIT 5")).all()
        deals = session.exec(text("SELECT id, title, client_id FROM deals LIMIT 5")).all()
        quotes = session.exec(text("SELECT id, quote_number, grand_total, client_id FROM quotes LIMIT 5")).all()

        # ─── 1. Seed Dropped Clients ──────────────────────────────────────────
        drop_reasons = [
            ("Financial Constraints", "Pricing / Budget", "Client cited budget constraints during quarterly review.", "Medium"),
            ("Competitor Transition", "Competitor", "Client shifted to a regional competitor with lower hourly rates.", "Low"),
            ("Internal Logistics Restructure", "Operations", "Client built an internal team for freight coordination.", "Medium"),
            ("Fee / Payment Dispute", "Pricing / Budget", "Dispute over milestone invoice structure.", "High"),
            ("Operations Downsized", "Business Closure", "Client ceased overseas freight operations.", "Low"),
        ]

        existing_dropped = session.exec(text("SELECT COUNT(*) FROM dropped_clients")).scalar() or 0
        if existing_dropped == 0 and clients:
            for i, client in enumerate(clients[:min(5, len(clients))]):
                reason, cat, notes, pot = drop_reasons[i % len(drop_reasons)]
                c_name = (client[1] or f"Client {client[0]}").replace("'", "''")
                session.exec(text(f"""
                    INSERT INTO dropped_clients (
                        tenant_id, client_id, company_name, reason, reason_category,
                        dropped_by, last_revenue, relationship_months, reactivation_potential,
                        notes, dropped_at, created_at
                    ) VALUES (
                        1, {client[0]}, '{c_name}', '{reason}', '{cat}',
                        {admin_id}, {15000 + i * 3500}, {6 + i * 3}, '{pot}',
                        '{notes}', NOW() - INTERVAL '{i*15} days', NOW()
                    )
                """))
            session.commit()
            print("[OK] Seeded dropped clients records")

        # ─── 2. Seed Salesperson History ──────────────────────────────────────
        existing_history = session.exec(text("SELECT COUNT(*) FROM salesperson_history")).scalar() or 0
        sales_users = session.exec(text("SELECT id, name FROM users WHERE role IN ('Admin','SalesManager','Employee') LIMIT 4")).all()
        if existing_history == 0 and clients and len(sales_users) >= 1:
            reasons = [
                "Territory realignment for North America",
                "Senior account manager rebalance",
                "Account escalation handoff",
            ]
            for i, client in enumerate(clients[:min(3, len(clients))]):
                u1 = sales_users[0]
                u2 = sales_users[min(1, len(sales_users)-1)]
                session.exec(text(f"""
                    INSERT INTO salesperson_history (
                        tenant_id, client_id, from_user_id, to_user_id,
                        from_user_name, to_user_name, reason, reassigned_by,
                        reassigned_at, created_at
                    ) VALUES (
                        1, {client[0]}, {u1[0]}, {u2[0]},
                        '{u1[1]}', '{u2[1]}', '{reasons[i % len(reasons)]}', {admin_id},
                        NOW() - INTERVAL '{i*10} days', NOW()
                    )
                """))
            session.commit()
            print("[OK] Seeded salesperson reassignment history")

        # ─── 3. Seed Excel Campaigns & Records ────────────────────────────────
        existing_campaigns = session.exec(text("SELECT COUNT(*) FROM excel_campaigns")).scalar() or 0
        if existing_campaigns == 0:
            campaign_configs = [
                (
                    "Q4 Logistics BPO Outreach",
                    "Streamlining Logistics Operations for {{company}}",
                    "Hi {{name}},\n\nI noticed {{company}} has been expanding shipping routes. At SCM BPO, we handle end-to-end back-office logistics support.\n\nBest,\nNoushad C I",
                    35, 33, 2, "Completed"
                ),
                (
                    "North American Freight Forwarders",
                    "Partnership Opportunity with {{company}}",
                    "Hello {{name}},\n\nWe provide 24/7 dedicated dispatch and billing teams for logistics operators like {{company}}.\n\nRegards,\nSCM BPO Team",
                    24, 24, 0, "Completed"
                ),
                (
                    "Cold Outreach Batch 2",
                    "SCM BPO Back-Office Scalability",
                    "Hi {{name}},\n\nWould you be open to exploring dedicated outsourcing for {{company}}?",
                    50, 0, 0, "Pending"
                )
            ]

            sample_recipients = [
                ("Michael Chang", "mchang@pacificfreight.com", "Pacific Freight"),
                ("Elena Rostova", "erostova@globexshipping.com", "Globex Shipping"),
                ("Marcus Vance", "marcus@vancelogistics.io", "Vance Logistics"),
                ("Devin Taylor", "devin@apexsupply.com", "Apex Supply Co"),
            ]

            for name, subj, body, total, sent, failed, status in campaign_configs:
                res = session.exec(text(f"""
                    INSERT INTO excel_campaigns (
                        tenant_id, campaign_name, template_subject, template_body,
                        total_records, sent_count, failed_count, status, created_by,
                        created_at, completed_at
                    ) VALUES (
                        1, '{name}', '{subj.replace("'", "''")}', '{body.replace("'", "''")}',
                        {total}, {sent}, {failed}, '{status}', {admin_id},
                        NOW() - INTERVAL '3 days', {'NOW()' if status == 'Completed' else 'NULL'}
                    ) RETURNING id
                """)).first()
                if res and status == "Completed":
                    cam_id = res[0]
                    for r_name, r_email, r_comp in sample_recipients:
                        session.exec(text(f"""
                            INSERT INTO excel_campaign_records (
                                campaign_id, email, name, company, status, sent_at, created_at
                            ) VALUES (
                                {cam_id}, '{r_email}', '{r_name}', '{r_comp}', 'Sent', NOW() - INTERVAL '2 days', NOW()
                            )
                        """))
            session.commit()
            print("[OK] Seeded Excel email campaigns and contact records")

        # ─── 4. Link Deals to Proposals and Quotes ────────────────────────────
        if deals and quotes:
            for i, deal in enumerate(deals[:min(4, len(deals))]):
                try:
                    session.exec(text(f"""
                        UPDATE quotes SET deal_id={deal[0]}
                        WHERE id=(SELECT id FROM quotes ORDER BY id LIMIT 1 OFFSET {i})
                        AND deal_id IS NULL
                    """))
                except Exception:
                    pass
                try:
                    session.exec(text(f"""
                        UPDATE proposals SET deal_id={deal[0]}
                        WHERE id=(SELECT id FROM proposals ORDER BY id LIMIT 1 OFFSET {i})
                        AND deal_id IS NULL
                    """))
                except Exception:
                    pass
            session.commit()
            print("[OK] Linked proposals & quotes to pipeline deals")

        # ─── 5. Update Lead Source & Sentiment ────────────────────────────────
        sources = ['Website Form', 'LinkedIn Outreach', 'Referral', 'Trade Show', 'Cold Email', 'Google Search']
        sentiments = ['Positive', 'Positive', 'Neutral', 'Neutral', 'Negative']
        all_leads = session.exec(text("SELECT id FROM leads")).all()
        for i, (lead_id,) in enumerate(all_leads):
            src = sources[i % len(sources)]
            snt = sentiments[i % len(sentiments)]
            session.exec(text(f"""
                UPDATE leads
                SET lead_source='{src}', sentiment='{snt}'
                WHERE id={lead_id} AND (lead_source IS NULL OR lead_source='' OR sentiment IS NULL)
            """))
        session.commit()
        print("[OK] Enriched leads with sources and sentiment")

        # ─── 6. Link Invoices to Quotes ───────────────────────────────────────
        if quotes:
            for q in quotes[:min(2, len(quotes))]:
                q_id, q_num, q_total, q_client = q
                try:
                    inv_exists = session.exec(text(f"SELECT COUNT(*) FROM invoices WHERE quote_id={q_id}")).scalar() or 0
                    if inv_exists == 0:
                        inv_num = f"INV-QT-{q_num or q_id}"
                        amount = float(q_total or 5000.0)
                        session.exec(text(f"""
                            INSERT INTO invoices (
                                tenant_id, invoice_number, client_id, quote_id, amount,
                                tax, total, currency, status, due_date, notes, line_items,
                                created_at, updated_at
                            ) VALUES (
                                1, '{inv_num}', {q_client if q_client else 'NULL'}, {q_id},
                                {amount}, 0.0, {amount}, 'USD', 'Sent',
                                '{(datetime.utcnow() + timedelta(days=30)).strftime("%Y-%m-%d")}',
                                'Auto-generated from Quote {q_num or q_id}', '[]',
                                NOW(), NOW()
                            )
                        """))
                except Exception as e:
                    print(f"  Invoice link note: {e}")
            session.commit()
            print("[OK] Seeded invoices linked to quotes")

    print("\nAll demo data seeding completed successfully!")

if __name__ == "__main__":
    print("=" * 60)
    print("SCM BPO CRM - Seeding Enhancements Demo Data")
    print("=" * 60)
    seed_demo_data()
