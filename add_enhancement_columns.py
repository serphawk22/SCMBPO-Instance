"""
Phase 1 -- Database Migrations for SCM BPO CRM Enhancements
Run: python add_enhancement_columns.py
"""

import os
import psycopg2
from urllib.parse import urlparse

DATABASE_URL = os.environ.get("DATABASE_URL", "")

def get_conn():
    result = urlparse(DATABASE_URL)
    return psycopg2.connect(
        dbname=result.path[1:],
        user=result.username,
        password=result.password,
        host=result.hostname,
        port=result.port or 5432,
        sslmode="require",
    )

def run():
    conn = get_conn()
    cur = conn.cursor()
    steps = []

    steps.append(("proposals.deal_id", """
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='proposals' AND column_name='deal_id'
          ) THEN
            ALTER TABLE proposals ADD COLUMN deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL;
          END IF;
        END $$;
    """))

    steps.append(("invoices.quote_id", """
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='invoices' AND column_name='quote_id'
          ) THEN
            ALTER TABLE invoices ADD COLUMN quote_id INTEGER REFERENCES crm_quotes(id) ON DELETE SET NULL;
          END IF;
        END $$;
    """))

    steps.append(("invoices.deal_id", """
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='invoices' AND column_name='deal_id'
          ) THEN
            ALTER TABLE invoices ADD COLUMN deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL;
          END IF;
        END $$;
    """))

    steps.append(("create dropped_clients", """
        CREATE TABLE IF NOT EXISTS dropped_clients (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            client_id INTEGER REFERENCES client_profiles(id) ON DELETE SET NULL,
            company_name TEXT NOT NULL,
            reason TEXT,
            reason_category TEXT DEFAULT 'Other',
            dropped_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            last_revenue NUMERIC(12,2) DEFAULT 0,
            relationship_months INTEGER DEFAULT 0,
            reactivation_potential TEXT DEFAULT 'Low',
            notes TEXT,
            dropped_at TIMESTAMPTZ DEFAULT NOW(),
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    """))

    steps.append(("create salesperson_history", """
        CREATE TABLE IF NOT EXISTS salesperson_history (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            client_id INTEGER NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
            from_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            from_user_name TEXT,
            to_user_name TEXT,
            reason TEXT,
            reassigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            reassigned_at TIMESTAMPTZ DEFAULT NOW(),
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    """))

    steps.append(("create excel_campaigns", """
        CREATE TABLE IF NOT EXISTS excel_campaigns (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            campaign_name TEXT NOT NULL,
            template_subject TEXT,
            template_body TEXT,
            total_records INTEGER DEFAULT 0,
            sent_count INTEGER DEFAULT 0,
            failed_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'Pending',
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            completed_at TIMESTAMPTZ
        );
    """))

    steps.append(("create excel_campaign_records", """
        CREATE TABLE IF NOT EXISTS excel_campaign_records (
            id SERIAL PRIMARY KEY,
            campaign_id INTEGER NOT NULL REFERENCES excel_campaigns(id) ON DELETE CASCADE,
            email TEXT NOT NULL,
            name TEXT,
            company TEXT,
            status TEXT DEFAULT 'Pending',
            error_message TEXT,
            sent_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    """))

    steps.append(("leads.lead_source", """
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='leads' AND column_name='lead_source'
          ) THEN
            ALTER TABLE leads ADD COLUMN lead_source TEXT DEFAULT 'Direct';
          END IF;
        END $$;
    """))

    steps.append(("leads.sentiment", """
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='leads' AND column_name='sentiment'
          ) THEN
            ALTER TABLE leads ADD COLUMN sentiment TEXT DEFAULT 'Neutral';
          END IF;
        END $$;
    """))

    for name, sql in steps:
        try:
            cur.execute(sql)
            conn.commit()
            print(f"  OK  {name}")
        except Exception as e:
            conn.rollback()
            print(f"  FAIL  {name}: {e}")

    cur.close()
    conn.close()
    print("Migration complete.")

if __name__ == "__main__":
    run()
