"""
SCM2 feature router
───────────────────
SCM2-52/53  Ownership reassignment + current/historical owner reporting
SCM2-54     Inventory stock movements + low-stock alerts
SCM2-56     Deal negotiation / pricing / deal-value tracking
SCM2-57..60 Won-deal revenue, business costs (incl. salaries), revenue-after-cost
SCM2-61..64 Lead-source configuration, assignment, UTM tracking and analytics
SCM2-73/74  Meeting history per lead/client/contact + user timezone preference

Tenant scoping: SELECTs of ORM entities are auto-filtered by the global
`do_orm_execute` listener in main.py, and inserts are auto-stamped with the
tenant by `before_flush`. Aggregates are done in Python on entity rows so they
stay tenant-safe.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, date
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select, SQLModel
from sqlalchemy import text

from database import (
    engine, User, Lead, ClientProfile, Contact, Deal, Meeting, Invoice,
    InventoryItem, LeadSource, BusinessCost, DealNegotiation, OwnershipHistory,
    StockMovement, SalespersonHistory,
)
from modules.api_tracker import current_salesperson_id

router = APIRouter(tags=["SCM2"])

FINANCE_ROLES = {"Admin"}  # SCM2: finance / salary / cost pages are Admin-only

CURRENCIES = ["INR", "USD"]  # supported currencies


DEFAULT_SOURCES = [
    # name, channel, utm_key, color
    ("Facebook", "Social", "facebook", "#1877F2"),
    ("Instagram", "Social", "instagram", "#E1306C"),
    ("Meta Ads", "Paid", "meta", "#0866FF"),
    ("Google Ads", "Paid", "google", "#EA4335"),
    ("Google Organic", "Organic", "google_organic", "#34A853"),
    ("LinkedIn", "Social", "linkedin", "#0A66C2"),
    ("Reference", "Referral", "referral", "#F59E0B"),
    ("Conference", "Event", "conference", "#8B5CF6"),
    ("Website", "Direct", "website", "#14B8A6"),
    ("Cold Email", "Outbound", "email", "#64748B"),
    ("Other", "Other", None, "#94A3B8"),
]

COST_CATEGORIES = ["Salary", "Rent", "Software", "Marketing", "Utilities", "Travel", "Other"]


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_session():
    with Session(engine) as session:
        yield session


def _tid() -> Optional[int]:
    """Current tenant id from main's context var (lazy import avoids a cycle)."""
    try:
        import main  # noqa: WPS433
        t = main.current_tenant_id.get()
        return t if (t and t > 0) else None
    except Exception:
        return None


def _me(session: Session) -> Optional[User]:
    uid = current_salesperson_id.get()
    return session.get(User, uid) if uid else None


def _require(session: Session, roles: set) -> User:
    user = _me(session)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    role = (user.role or "").strip()
    role_norm = {"admin": "Admin", "employee": "Employee"}.get(role.lower(), role)
    if role_norm == "SuperAdmin" or (user.email or "").lower() == "admin@serphawk.com" or role_norm in roles:
        return user
    raise HTTPException(status_code=403, detail="You do not have access to this section")


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _month_key(d: Any) -> Optional[str]:
    if not d:
        return None
    if isinstance(d, datetime):
        return d.strftime("%Y-%m")
    if isinstance(d, date):
        return d.strftime("%Y-%m")
    s = str(d)
    return s[:7] if len(s) >= 7 else None


def _month_range(months: int, end: Optional[str] = None) -> List[str]:
    """Return the last `months` month keys (YYYY-MM) ending at `end` (default: current month)."""
    if end:
        y, m = int(end[:4]), int(end[5:7])
    else:
        now = datetime.utcnow()
        y, m = now.year, now.month
    keys = []
    for _ in range(max(1, months)):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return list(reversed(keys))


def _deal_amount(d: Deal) -> float:
    return float(d.final_value if d.final_value is not None else (d.value or 0))


def _deal_won_month(d: Deal) -> Optional[str]:
    return _month_key(d.won_at or d.updated_at or d.created_at)


# ─────────────────────────────────────────────────────────────────────────────
# Schema bootstrap (idempotent; runs on every startup)
# ─────────────────────────────────────────────────────────────────────────────

def ensure_scm2_schema() -> None:
    SQLModel.metadata.create_all(
        engine,
        tables=[
            LeadSource.__table__, BusinessCost.__table__, DealNegotiation.__table__,
            OwnershipHistory.__table__, StockMovement.__table__,
        ],
    )
    stmts = [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone VARCHAR(64);",
        "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS meeting_link VARCHAR(1000);",
        "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS timezone VARCHAR(64);",
        "ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_source_id INTEGER;",
        "ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS lead_source_id INTEGER;",
        "ALTER TABLE deals ADD COLUMN IF NOT EXISTS final_value DOUBLE PRECISION;",
        "ALTER TABLE deals ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'USD';",
        "ALTER TABLE deals ADD COLUMN IF NOT EXISTS won_at TIMESTAMP;",
        # back-fill won_at for already-won deals so they appear in revenue history
        "UPDATE deals SET won_at = updated_at WHERE stage = 'Closed Won' AND won_at IS NULL;",
    ]
    with engine.connect() as conn:
        for s in stmts:
            try:
                conn.execute(text(s))
            except Exception as e:  # pragma: no cover
                print(f"[scm2] migration skipped: {s} -> {e}")
        conn.commit()
    print("[scm2] schema verified")


# ─────────────────────────────────────────────────────────────────────────────
# SCM2-62/63  Lead sources
# ─────────────────────────────────────────────────────────────────────────────

class LeadSourceBody(BaseModel):
    name: str
    channel: Optional[str] = "Other"
    utm_key: Optional[str] = None
    color: Optional[str] = "#6366f1"
    monthly_cost: Optional[float] = 0.0
    is_active: Optional[bool] = True


class AssignSourceBody(BaseModel):
    entity_type: str  # lead | client
    entity_id: int
    source_id: Optional[int] = None


def _source_dict(s: LeadSource) -> dict:
    return {
        "id": s.id, "name": s.name, "channel": s.channel, "utm_key": s.utm_key,
        "color": s.color, "monthly_cost": s.monthly_cost or 0, "is_active": s.is_active,
        "created_at": _iso(s.created_at),
    }


def _ensure_default_sources(session: Session) -> List[LeadSource]:
    rows = session.exec(select(LeadSource).order_by(LeadSource.id)).all()
    if rows or not _tid():
        return list(rows)
    for name, channel, utm, color in DEFAULT_SOURCES:
        session.add(LeadSource(name=name, channel=channel, utm_key=utm, color=color, tenant_id=_tid()))
    session.commit()
    return list(session.exec(select(LeadSource).order_by(LeadSource.id)).all())


def resolve_lead_source(session: Session, value: Optional[str]) -> Optional[LeadSource]:
    """Match a utm_source / free-text source to a configured LeadSource (case-insensitive)."""
    if not value:
        return None
    v = value.strip().lower()
    sources = _ensure_default_sources(session)
    for s in sources:
        if (s.utm_key and s.utm_key.lower() == v) or s.name.lower() == v:
            return s
    for s in sources:  # fuzzy: 'fb', 'facebook.com', 'lnkd.in' etc.
        key = (s.utm_key or s.name).lower()
        if key and (key in v or v in key):
            return s
    aliases = {"fb": "facebook", "ig": "instagram", "lnkd": "linkedin", "li": "linkedin", "gads": "google", "adwords": "google"}
    if v in aliases:
        return resolve_lead_source(session, aliases[v])
    return None


@router.get("/lead-sources")
def list_lead_sources(session: Session = Depends(get_session)):
    rows = _ensure_default_sources(session)
    return {"sources": [_source_dict(s) for s in rows], "channels": ["Social", "Paid", "Organic", "Referral", "Event", "Direct", "Outbound", "Other"]}


@router.post("/lead-sources")
def create_lead_source(body: LeadSourceBody, session: Session = Depends(get_session)):
    _require(session, FINANCE_ROLES)
    s = LeadSource(**body.model_dump(), tenant_id=_tid())
    if s.utm_key:
        s.utm_key = s.utm_key.strip().lower()
    session.add(s)
    session.commit()
    session.refresh(s)
    return {"source": _source_dict(s)}


@router.put("/lead-sources/{source_id}")
def update_lead_source(source_id: int, body: LeadSourceBody, session: Session = Depends(get_session)):
    _require(session, FINANCE_ROLES)
    s = session.get(LeadSource, source_id)
    if not s:
        raise HTTPException(status_code=404, detail="Source not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(s, k, v.strip().lower() if (k == "utm_key" and v) else v)
    session.add(s)
    session.commit()
    session.refresh(s)
    return {"source": _source_dict(s)}


@router.delete("/lead-sources/{source_id}")
def delete_lead_source(source_id: int, session: Session = Depends(get_session)):
    _require(session, FINANCE_ROLES)
    s = session.get(LeadSource, source_id)
    if not s:
        raise HTTPException(status_code=404, detail="Source not found")
    # detach instead of leaving dangling ids
    for l in session.exec(select(Lead).where(Lead.lead_source_id == source_id)).all():
        l.lead_source_id = None
        session.add(l)
    for c in session.exec(select(ClientProfile).where(ClientProfile.lead_source_id == source_id)).all():
        c.lead_source_id = None
        session.add(c)
    session.delete(s)
    session.commit()
    return {"ok": True}


@router.post("/lead-sources/assign")
def assign_lead_source(body: AssignSourceBody, session: Session = Depends(get_session)):
    src = session.get(LeadSource, body.source_id) if body.source_id else None
    if body.source_id and not src:
        raise HTTPException(status_code=404, detail="Source not found")
    if body.entity_type == "lead":
        ent = session.get(Lead, body.entity_id)
        if not ent:
            raise HTTPException(status_code=404, detail="Lead not found")
        ent.lead_source_id = src.id if src else None
        ent.source = src.name if src else None
    elif body.entity_type == "client":
        ent = session.get(ClientProfile, body.entity_id)
        if not ent:
            raise HTTPException(status_code=404, detail="Client not found")
        ent.lead_source_id = src.id if src else None
        ent.lead_source = src.name if src else None
    else:
        raise HTTPException(status_code=400, detail="entity_type must be 'lead' or 'client'")
    session.add(ent)
    session.commit()
    return {"ok": True, "source": _source_dict(src) if src else None}


@router.get("/lead-sources/resolve")
def resolve_source_endpoint(value: str, session: Session = Depends(get_session)):
    s = resolve_lead_source(session, value)
    return {"source": _source_dict(s) if s else None}


@router.post("/lead-sources/backfill")
def backfill_lead_sources(session: Session = Depends(get_session)):
    """Link existing leads/clients whose free-text source matches a configured source."""
    _require(session, FINANCE_ROLES)
    linked = 0
    for l in session.exec(select(Lead).where(Lead.lead_source_id.is_(None))).all():
        s = resolve_lead_source(session, l.source)
        if s:
            l.lead_source_id = s.id
            session.add(l)
            linked += 1
    for c in session.exec(select(ClientProfile).where(ClientProfile.lead_source_id.is_(None))).all():
        s = resolve_lead_source(session, c.lead_source)
        if s:
            c.lead_source_id = s.id
            session.add(c)
            linked += 1
    session.commit()
    return {"ok": True, "linked": linked}


# ─────────────────────────────────────────────────────────────────────────────
# SCM2-64  Source-wise lead / conversion / revenue analytics
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/analytics/lead-sources")
def lead_source_analytics(
    start: Optional[str] = None,  # YYYY-MM-DD
    end: Optional[str] = None,
    session: Session = Depends(get_session),
):
    sources = _ensure_default_sources(session)
    by_id = {s.id: s for s in sources}
    by_name = {s.name.lower(): s for s in sources}

    def match(source_id: Optional[int], text_value: Optional[str]) -> Optional[LeadSource]:
        if source_id and source_id in by_id:
            return by_id[source_id]
        if text_value:
            return by_name.get(text_value.strip().lower()) or resolve_lead_source(session, text_value)
        return None

    def in_range(dt: Optional[datetime]) -> bool:
        if not dt:
            return not (start or end)
        d = dt.strftime("%Y-%m-%d")
        return (not start or d >= start) and (not end or d <= end)

    leads = [l for l in session.exec(select(Lead)).all() if in_range(l.created_at)]
    clients = session.exec(select(ClientProfile)).all()
    client_by_id = {c.id: c for c in clients}
    deals = session.exec(select(Deal)).all()

    stats: Dict[Any, Dict[str, Any]] = {}

    def bucket(src: Optional[LeadSource]):
        key = src.id if src else 0
        if key not in stats:
            stats[key] = {
                "source_id": src.id if src else None,
                "source": src.name if src else "Unassigned",
                "channel": src.channel if src else "—",
                "color": src.color if src else "#cbd5e1",
                "monthly_cost": float(src.monthly_cost or 0) if src else 0.0,
                "leads": 0, "converted": 0, "clients": 0,
                "won_deals": 0, "won_revenue": 0.0, "pipeline_value": 0.0,
            }
        return stats[key]

    for s in sources:
        if s.is_active:
            bucket(s)

    # client -> source (direct, or via the lead it was converted from)
    client_source: Dict[int, Optional[LeadSource]] = {}
    for l in session.exec(select(Lead)).all():
        if l.converted_client_id:
            client_source[l.converted_client_id] = match(l.lead_source_id, l.source)
    for c in clients:
        direct = match(c.lead_source_id, c.lead_source)
        if direct or c.id not in client_source:
            client_source[c.id] = direct

    for l in leads:
        b = bucket(match(l.lead_source_id, l.source))
        b["leads"] += 1
        if l.is_converted or (l.status or "").lower() in ("converted", "won"):
            b["converted"] += 1

    for c in clients:
        if client_by_id.get(c.id) and in_range(getattr(c, "created_at", None) if hasattr(c, "created_at") else None):
            bucket(client_source.get(c.id))["clients"] += 1

    for d in deals:
        src = client_source.get(d.client_id)
        b = bucket(src)
        if d.stage == "Closed Won":
            won_dt = d.won_at or d.updated_at
            if in_range(won_dt):
                b["won_deals"] += 1
                b["won_revenue"] += _deal_amount(d)
        elif d.stage != "Closed Lost":
            b["pipeline_value"] += float(d.value or 0)

    # months covered by range (for cost)
    if start and end:
        sy, sm = int(start[:4]), int(start[5:7])
        ey, em = int(end[:4]), int(end[5:7])
        months = max(1, (ey - sy) * 12 + (em - sm) + 1)
    else:
        months = 1

    rows = []
    for b in stats.values():
        cost = b["monthly_cost"] * months
        b["conversion_rate"] = round(b["converted"] / b["leads"] * 100, 1) if b["leads"] else 0.0
        b["total_cost"] = round(cost, 2)
        b["cost_per_lead"] = round(cost / b["leads"], 2) if b["leads"] and cost else None
        b["roi_pct"] = round((b["won_revenue"] - cost) / cost * 100, 1) if cost else None
        b["won_revenue"] = round(b["won_revenue"], 2)
        b["pipeline_value"] = round(b["pipeline_value"], 2)
        rows.append(b)
    rows.sort(key=lambda r: (r["leads"], r["won_revenue"]), reverse=True)

    # monthly trend (last 6 months) of leads per source
    month_keys = _month_range(6)
    trend = {k: defaultdict(int) for k in month_keys}
    for l in session.exec(select(Lead)).all():
        mk = _month_key(l.created_at)
        if mk in trend:
            src = match(l.lead_source_id, l.source)
            trend[mk][src.name if src else "Unassigned"] += 1

    total_leads = sum(r["leads"] for r in rows)
    total_conv = sum(r["converted"] for r in rows)
    return {
        "sources": rows,
        "totals": {
            "leads": total_leads,
            "converted": total_conv,
            "conversion_rate": round(total_conv / total_leads * 100, 1) if total_leads else 0.0,
            "won_revenue": round(sum(r["won_revenue"] for r in rows), 2),
            "total_cost": round(sum(r["total_cost"] for r in rows), 2),
        },
        "trend": [{"month": k, **dict(v)} for k, v in trend.items()],
        "range": {"start": start, "end": end, "months": months},
    }


# ─────────────────────────────────────────────────────────────────────────────
# SCM2-59  Business costs (salaries + other)
# ─────────────────────────────────────────────────────────────────────────────

class CostBody(BaseModel):
    title: str
    category: Optional[str] = "Other"
    amount: float
    currency: Optional[str] = "INR"
    cost_date: str  # YYYY-MM-DD
    is_recurring: Optional[bool] = False
    end_date: Optional[str] = None
    employee_id: Optional[int] = None
    notes: Optional[str] = None


def _cost_dict(c: BusinessCost, session: Session) -> dict:
    emp = session.get(User, c.employee_id) if c.employee_id else None
    return {
        "id": c.id, "title": c.title, "category": c.category, "amount": c.amount,
        "currency": c.currency, "cost_date": c.cost_date, "is_recurring": c.is_recurring,
        "end_date": c.end_date, "employee_id": c.employee_id,
        "employee_name": emp.name if emp else None, "notes": c.notes,
        "created_at": _iso(c.created_at),
    }


def _cost_months(c: BusinessCost, month_keys: List[str]) -> List[str]:
    """Months (from month_keys) in which this cost applies."""
    start_m = _month_key(c.cost_date)
    if not start_m:
        return []
    if not c.is_recurring:
        return [start_m] if start_m in month_keys else []
    end_m = _month_key(c.end_date) if c.end_date else "9999-12"
    return [k for k in month_keys if start_m <= k <= end_m]


@router.get("/business-costs")
def list_costs(month: Optional[str] = None, category: Optional[str] = None, session: Session = Depends(get_session)):
    _require(session, FINANCE_ROLES)
    rows = session.exec(select(BusinessCost).order_by(BusinessCost.cost_date.desc())).all()
    if category:
        rows = [r for r in rows if r.category == category]
    if month:
        rows = [r for r in rows if _cost_months(r, [month])]
    by_cat: Dict[str, float] = defaultdict(float)
    for r in rows:
        by_cat[r.category] += r.amount or 0
    return {
        "costs": [_cost_dict(r, session) for r in rows],
        "categories": COST_CATEGORIES,
        "by_category": [{"category": k, "amount": round(v, 2)} for k, v in sorted(by_cat.items(), key=lambda x: -x[1])],
        "total": round(sum(r.amount or 0 for r in rows), 2),
    }


@router.post("/business-costs")
def create_cost(body: CostBody, session: Session = Depends(get_session)):
    me = _require(session, FINANCE_ROLES)
    if body.amount < 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    c = BusinessCost(**body.model_dump(), created_by=me.id, tenant_id=_tid())
    session.add(c)
    session.commit()
    session.refresh(c)
    return {"cost": _cost_dict(c, session)}


@router.put("/business-costs/{cost_id}")
def update_cost(cost_id: int, body: CostBody, session: Session = Depends(get_session)):
    _require(session, FINANCE_ROLES)
    c = session.get(BusinessCost, cost_id)
    if not c:
        raise HTTPException(status_code=404, detail="Cost not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    session.add(c)
    session.commit()
    session.refresh(c)
    return {"cost": _cost_dict(c, session)}


@router.delete("/business-costs/{cost_id}")
def delete_cost(cost_id: int, session: Session = Depends(get_session)):
    _require(session, FINANCE_ROLES)
    c = session.get(BusinessCost, cost_id)
    if not c:
        raise HTTPException(status_code=404, detail="Cost not found")
    session.delete(c)
    session.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# SCM2-57/58/60  Revenue dashboard + revenue after cost
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/revenue/summary")
def revenue_summary(months: int = Query(12, ge=1, le=36), session: Session = Depends(get_session)):
    _require(session, FINANCE_ROLES)
    month_keys = _month_range(months)
    monthly = {k: {"month": k, "won_revenue": 0.0, "won_deals": 0, "invoiced_paid": 0.0, "costs": 0.0, "salary_costs": 0.0} for k in month_keys}

    deals = session.exec(select(Deal)).all()
    users = {u.id: u for u in session.exec(select(User)).all()}
    clients = {c.id: c for c in session.exec(select(ClientProfile)).all()}

    won = [d for d in deals if d.stage == "Closed Won"]
    by_sp: Dict[Any, Dict[str, Any]] = {}
    for d in won:
        mk = _deal_won_month(d)
        amt = _deal_amount(d)
        if mk in monthly:
            monthly[mk]["won_revenue"] += amt
            monthly[mk]["won_deals"] += 1
            u = users.get(d.assigned_to)
            sp = by_sp.setdefault(d.assigned_to or 0, {"user_id": d.assigned_to, "salesperson": u.name if u else "Unassigned", "won_deals": 0, "won_revenue": 0.0})
            sp["won_deals"] += 1
            sp["won_revenue"] += amt

    for inv in session.exec(select(Invoice)).all():
        if (inv.status or "").lower() == "paid":
            mk = _month_key(inv.paid_at or inv.updated_at)
            if mk in monthly:
                monthly[mk]["invoiced_paid"] += float(inv.total or 0)

    cost_by_cat: Dict[str, float] = defaultdict(float)
    for c in session.exec(select(BusinessCost)).all():
        for mk in _cost_months(c, month_keys):
            monthly[mk]["costs"] += c.amount or 0
            cost_by_cat[c.category] += c.amount or 0
            if c.category == "Salary":
                monthly[mk]["salary_costs"] += c.amount or 0

    series = []
    for k in month_keys:
        m = monthly[k]
        m["net_profit"] = round(m["won_revenue"] - m["costs"], 2)
        m["margin_pct"] = round(m["net_profit"] / m["won_revenue"] * 100, 1) if m["won_revenue"] else None
        for f in ("won_revenue", "invoiced_paid", "costs", "salary_costs"):
            m[f] = round(m[f], 2)
        series.append(m)

    total_rev = sum(m["won_revenue"] for m in series)
    total_cost = sum(m["costs"] for m in series)
    open_pipeline = sum(float(d.value or 0) for d in deals if d.stage not in ("Closed Won", "Closed Lost"))
    lost = [d for d in deals if d.stage == "Closed Lost"]

    top_deals = sorted(won, key=_deal_amount, reverse=True)[:8]
    return {
        "months": series,
        "totals": {
            "won_revenue": round(total_rev, 2),
            "costs": round(total_cost, 2),
            "net_profit": round(total_rev - total_cost, 2),
            "margin_pct": round((total_rev - total_cost) / total_rev * 100, 1) if total_rev else None,
            "won_deals": sum(m["won_deals"] for m in series),
            "avg_deal_size": round(total_rev / max(1, sum(m["won_deals"] for m in series)), 2),
            "open_pipeline": round(open_pipeline, 2),
            "win_rate": round(len(won) / (len(won) + len(lost)) * 100, 1) if (won or lost) else None,
            "invoiced_paid": round(sum(m["invoiced_paid"] for m in series), 2),
        },
        "by_salesperson": sorted(
            [{**v, "won_revenue": round(v["won_revenue"], 2)} for v in by_sp.values()],
            key=lambda r: -r["won_revenue"],
        ),
        "cost_by_category": [{"category": k, "amount": round(v, 2)} for k, v in sorted(cost_by_cat.items(), key=lambda x: -x[1])],
        "top_deals": [{
            "id": d.id, "title": d.title, "amount": _deal_amount(d), "list_value": d.value,
            "client_name": (clients.get(d.client_id).companyName if clients.get(d.client_id) else None),
            "salesperson": users.get(d.assigned_to).name if users.get(d.assigned_to) else None,
            "won_at": _iso(d.won_at or d.updated_at),
        } for d in top_deals],
    }


# ─────────────────────────────────────────────────────────────────────────────
# SCM2-56  Negotiation, pricing & deal-value tracking
# ─────────────────────────────────────────────────────────────────────────────

class NegotiationBody(BaseModel):
    party: Optional[str] = "us"
    price: float
    discount_pct: Optional[float] = 0.0
    notes: Optional[str] = None


def _neg_dict(n: DealNegotiation) -> dict:
    return {
        "id": n.id, "deal_id": n.deal_id, "round_no": n.round_no, "party": n.party,
        "price": n.price, "discount_pct": n.discount_pct, "status": n.status,
        "notes": n.notes, "author_name": n.author_name, "created_at": _iso(n.created_at),
    }


def _deal_value_summary(deal: Deal, rounds: List[DealNegotiation]) -> dict:
    list_value = float(deal.value or 0)
    current = _deal_amount(deal) if deal.final_value is not None else (rounds[-1].price if rounds else list_value)
    return {
        "deal_id": deal.id, "title": deal.title, "stage": deal.stage,
        "list_value": list_value,
        "final_value": deal.final_value,
        "current_value": current,
        "discount_amount": round(list_value - current, 2) if list_value else 0,
        "discount_pct": round((list_value - current) / list_value * 100, 1) if list_value else 0,
        "rounds": len(rounds),
        "currency": deal.currency or "USD",
        "won_at": _iso(deal.won_at),
    }


@router.get("/deals/{deal_id}/negotiations")
def list_negotiations(deal_id: int, session: Session = Depends(get_session)):
    deal = session.get(Deal, deal_id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    rounds = session.exec(select(DealNegotiation).where(DealNegotiation.deal_id == deal_id).order_by(DealNegotiation.created_at)).all()
    return {"negotiations": [_neg_dict(r) for r in rounds], "summary": _deal_value_summary(deal, list(rounds))}


@router.post("/deals/{deal_id}/negotiations")
def add_negotiation(deal_id: int, body: NegotiationBody, session: Session = Depends(get_session)):
    deal = session.get(Deal, deal_id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    me = _me(session)
    prev = session.exec(select(DealNegotiation).where(DealNegotiation.deal_id == deal_id).order_by(DealNegotiation.created_at)).all()
    # mark previous open round as countered
    for p in prev:
        if p.status == "Proposed":
            p.status = "Countered"
            session.add(p)
    n = DealNegotiation(
        deal_id=deal_id, round_no=len(prev) + 1, party=body.party or "us",
        price=body.price, discount_pct=body.discount_pct or 0, notes=body.notes,
        author_id=me.id if me else None, author_name=me.name if me else None,
        tenant_id=_tid() or deal.tenant_id,
    )
    session.add(n)
    if deal.stage in ("Lead", "Discovery", "Demo"):
        deal.stage = "Negotiation"
    deal.updated_at = datetime.utcnow()
    session.add(deal)
    session.commit()
    session.refresh(n)
    rounds = list(prev) + [n]
    return {"negotiation": _neg_dict(n), "summary": _deal_value_summary(deal, rounds)}


@router.post("/deals/{deal_id}/negotiations/{neg_id}/{action}")
def resolve_negotiation(deal_id: int, neg_id: int, action: str, session: Session = Depends(get_session)):
    if action not in ("accept", "reject"):
        raise HTTPException(status_code=400, detail="action must be accept or reject")
    deal = session.get(Deal, deal_id)
    n = session.get(DealNegotiation, neg_id)
    if not deal or not n or n.deal_id != deal_id:
        raise HTTPException(status_code=404, detail="Not found")
    n.status = "Accepted" if action == "accept" else "Rejected"
    session.add(n)
    if action == "accept":
        deal.final_value = n.price
        deal.updated_at = datetime.utcnow()
        session.add(deal)
    session.commit()
    rounds = session.exec(select(DealNegotiation).where(DealNegotiation.deal_id == deal_id).order_by(DealNegotiation.created_at)).all()
    return {"ok": True, "summary": _deal_value_summary(deal, list(rounds))}


@router.get("/deals-value-tracking")
def deal_value_tracking(session: Session = Depends(get_session)):
    """Pipeline-wide view of list vs negotiated value per deal."""
    deals = session.exec(select(Deal).order_by(Deal.updated_at.desc())).all()
    negs = session.exec(select(DealNegotiation).order_by(DealNegotiation.created_at)).all()
    by_deal: Dict[int, List[DealNegotiation]] = defaultdict(list)
    for n in negs:
        by_deal[n.deal_id].append(n)
    rows = [_deal_value_summary(d, by_deal.get(d.id, [])) for d in deals]
    return {
        "deals": rows,
        "totals": {
            "list_value": round(sum(r["list_value"] for r in rows), 2),
            "current_value": round(sum(r["current_value"] for r in rows), 2),
            "in_negotiation": sum(1 for r in rows if r["stage"] == "Negotiation"),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# SCM2-52/53  Ownership reassignment & reporting
# ─────────────────────────────────────────────────────────────────────────────

class ReassignBody(BaseModel):
    entity_type: str  # lead | client
    entity_id: int
    to_user_id: int
    reason: Optional[str] = None


def _hist_dict(h: OwnershipHistory) -> dict:
    return {
        "id": h.id, "entity_type": h.entity_type, "entity_id": h.entity_id, "entity_name": h.entity_name,
        "from_user_id": h.from_user_id, "from_user_name": h.from_user_name,
        "to_user_id": h.to_user_id, "to_user_name": h.to_user_name,
        "reason": h.reason, "changed_by_name": h.changed_by_name, "changed_at": _iso(h.changed_at),
    }


def reassign_owner(session: Session, entity_type: str, entity_id: int, to_user_id: int, reason: Optional[str]) -> OwnershipHistory:
    to_user = session.get(User, to_user_id)
    if not to_user:
        raise HTTPException(status_code=404, detail="Target user not found")
    me = _me(session)

    if entity_type == "lead":
        ent = session.get(Lead, entity_id)
        if not ent:
            raise HTTPException(status_code=404, detail="Lead not found")
        from_id, name = ent.owner_id, ent.company_name
        ent.owner_id = to_user_id
    elif entity_type == "client":
        ent = session.get(ClientProfile, entity_id)
        if not ent:
            raise HTTPException(status_code=404, detail="Client not found")
        from_id, name = ent.assignedEmployeeId, ent.companyName
        ent.assignedEmployeeId = to_user_id
    else:
        raise HTTPException(status_code=400, detail="entity_type must be 'lead' or 'client'")

    if from_id == to_user_id:
        raise HTTPException(status_code=400, detail=f"Already owned by {to_user.name}")

    from_user = session.get(User, from_id) if from_id else None
    tid = _tid() or getattr(ent, "tenant_id", None)
    h = OwnershipHistory(
        entity_type=entity_type, entity_id=entity_id, entity_name=name,
        from_user_id=from_id, from_user_name=from_user.name if from_user else None,
        to_user_id=to_user_id, to_user_name=to_user.name, reason=reason,
        changed_by=me.id if me else None, changed_by_name=me.name if me else None,
        tenant_id=tid,
    )
    session.add(ent)
    session.add(h)
    if entity_type == "client" and tid:
        # keep legacy table in sync for older screens
        session.add(SalespersonHistory(
            tenant_id=tid, client_id=entity_id, from_user_id=from_id, to_user_id=to_user_id,
            from_user_name=h.from_user_name, to_user_name=h.to_user_name, reason=reason,
            reassigned_by=me.id if me else None,
        ))
    session.commit()
    session.refresh(h)
    return h


@router.post("/ownership/reassign")
def ownership_reassign(body: ReassignBody, session: Session = Depends(get_session)):
    h = reassign_owner(session, body.entity_type, body.entity_id, body.to_user_id, body.reason)
    return {"message": f"Reassigned to {h.to_user_name}", "history": _hist_dict(h)}


@router.get("/ownership/history")
def ownership_history(entity_type: str, entity_id: int, session: Session = Depends(get_session)):
    rows = session.exec(
        select(OwnershipHistory)
        .where(OwnershipHistory.entity_type == entity_type, OwnershipHistory.entity_id == entity_id)
        .order_by(OwnershipHistory.changed_at.desc())
    ).all()
    result = [_hist_dict(r) for r in rows]
    if entity_type == "client":  # include legacy rows not mirrored in ownership_history
        seen = {(r["from_user_id"], r["to_user_id"], (r["changed_at"] or "")[:16]) for r in result}
        for s in session.exec(select(SalespersonHistory).where(SalespersonHistory.client_id == entity_id)).all():
            key = (s.from_user_id, s.to_user_id, (_iso(s.reassigned_at) or "")[:16])
            if key not in seen:
                result.append({
                    "id": f"legacy-{s.id}", "entity_type": "client", "entity_id": entity_id, "entity_name": None,
                    "from_user_id": s.from_user_id, "from_user_name": s.from_user_name,
                    "to_user_id": s.to_user_id, "to_user_name": s.to_user_name,
                    "reason": s.reason, "changed_by_name": None, "changed_at": _iso(s.reassigned_at),
                })
        result.sort(key=lambda r: r["changed_at"] or "", reverse=True)

    current = None
    if entity_type == "lead":
        ent = session.get(Lead, entity_id)
        uid = ent.owner_id if ent else None
    else:
        ent = session.get(ClientProfile, entity_id)
        uid = ent.assignedEmployeeId if ent else None
    if uid:
        u = session.get(User, uid)
        current = {"user_id": uid, "name": u.name if u else None}
    return {"current_owner": current, "history": result}


@router.get("/ownership/report")
def ownership_report(session: Session = Depends(get_session)):
    users = [u for u in session.exec(select(User)).all() if u.role not in ("Client", "SuperAdmin", "Supplier")]
    leads = session.exec(select(Lead)).all()
    clients = session.exec(select(ClientProfile)).all()
    hist = session.exec(select(OwnershipHistory).order_by(OwnershipHistory.changed_at.desc())).all()
    deals = session.exec(select(Deal)).all()

    report: Dict[int, Dict[str, Any]] = {}
    for u in users:
        report[u.id] = {
            "user_id": u.id, "name": u.name or u.email, "role": u.role,
            "current_leads": 0, "current_clients": 0,
            "historical_leads": set(), "historical_clients": set(),
            "transferred_in": 0, "transferred_out": 0, "won_revenue": 0.0,
        }

    for l in leads:
        if l.owner_id in report:
            report[l.owner_id]["current_leads"] += 1
            report[l.owner_id]["historical_leads"].add(l.id)
    for c in clients:
        if c.assignedEmployeeId in report:
            report[c.assignedEmployeeId]["current_clients"] += 1
            report[c.assignedEmployeeId]["historical_clients"].add(c.id)
    for h in hist:
        key = "historical_leads" if h.entity_type == "lead" else "historical_clients"
        if h.from_user_id in report:
            report[h.from_user_id]["transferred_out"] += 1
            report[h.from_user_id][key].add(h.entity_id)
        if h.to_user_id in report:
            report[h.to_user_id]["transferred_in"] += 1
            report[h.to_user_id][key].add(h.entity_id)
    for d in deals:
        if d.stage == "Closed Won" and d.assigned_to in report:
            report[d.assigned_to]["won_revenue"] += _deal_amount(d)

    rows = []
    for r in report.values():
        r["historical_leads"] = len(r["historical_leads"])
        r["historical_clients"] = len(r["historical_clients"])
        r["won_revenue"] = round(r["won_revenue"], 2)
        rows.append(r)
    rows.sort(key=lambda r: (r["current_clients"] + r["current_leads"]), reverse=True)

    users_by_id = {u.id: u for u in users}
    entities = []
    prev_owners: Dict[tuple, List[str]] = defaultdict(list)
    for h in reversed(hist):
        if h.from_user_name:
            lst = prev_owners[(h.entity_type, h.entity_id)]
            if h.from_user_name not in lst:
                lst.append(h.from_user_name)
    for l in leads:
        u = users_by_id.get(l.owner_id)
        entities.append({"entity_type": "lead", "entity_id": l.id, "name": l.company_name,
                         "current_owner": u.name if u else None, "current_owner_id": l.owner_id,
                         "previous_owners": prev_owners.get(("lead", l.id), [])})
    for c in clients:
        u = users_by_id.get(c.assignedEmployeeId)
        entities.append({"entity_type": "client", "entity_id": c.id, "name": c.companyName,
                         "current_owner": u.name if u else None, "current_owner_id": c.assignedEmployeeId,
                         "previous_owners": prev_owners.get(("client", c.id), [])})

    return {
        "owners": rows,
        "entities": entities,
        "recent_changes": [_hist_dict(h) for h in hist[:50]],
        "totals": {
            "unassigned_leads": sum(1 for l in leads if not l.owner_id),
            "unassigned_clients": sum(1 for c in clients if not c.assignedEmployeeId),
            "reassignments": len(hist),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# SCM2-73  Meeting history per lead / client / contact
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/meetings/history")
def meeting_history(entity_type: str, entity_id: int, session: Session = Depends(get_session)):
    from sqlalchemy import or_
    conds = []
    if entity_type == "lead":
        conds.append(Meeting.lead_id == entity_id)
        contact_ids = [c.id for c in session.exec(select(Contact).where(Contact.lead_id == entity_id)).all()]
        lead = session.get(Lead, entity_id)
        if lead and lead.converted_client_id:
            conds.append(Meeting.client_id == lead.converted_client_id)
    elif entity_type == "client":
        conds.append(Meeting.client_id == entity_id)
        contact_ids = [c.id for c in session.exec(select(Contact).where(Contact.client_id == entity_id)).all()]
        lead_ids = [l.id for l in session.exec(select(Lead).where(Lead.converted_client_id == entity_id)).all()]
        if lead_ids:
            conds.append(Meeting.lead_id.in_(lead_ids))
    elif entity_type == "contact":
        conds.append(Meeting.contact_id == entity_id)
        contact_ids = []
    else:
        raise HTTPException(status_code=400, detail="entity_type must be lead, client or contact")
    if contact_ids:
        conds.append(Meeting.contact_id.in_(contact_ids))

    rows = session.exec(select(Meeting).where(or_(*conds)).order_by(Meeting.scheduled_at.desc())).all()
    import main
    items = [main._meeting_dict(m, session) for m in rows]
    now = datetime.utcnow()

    def is_upcoming(m: Meeting) -> bool:
        return bool(m.scheduled_at and m.scheduled_at >= now and m.status == "Scheduled")

    upcoming = [d for m, d in zip(rows, items) if is_upcoming(m)]
    past = [d for m, d in zip(rows, items) if not is_upcoming(m)]
    upcoming.reverse()  # soonest first
    return {
        "upcoming": upcoming,
        "past": past,
        "stats": {
            "total": len(rows),
            "completed": sum(1 for m in rows if m.status == "Completed"),
            "no_show": sum(1 for m in rows if m.status == "No-show"),
            "cancelled": sum(1 for m in rows if m.status == "Cancelled"),
            "total_minutes": sum(m.duration_minutes or 0 for m in rows if m.status == "Completed"),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# SCM2-74  User timezone preference
# ─────────────────────────────────────────────────────────────────────────────

class TimezoneBody(BaseModel):
    timezone: str
    only_if_empty: Optional[bool] = False  # used by auto-detect so it never overrides a manual choice


@router.get("/me/timezone")
def get_my_timezone(session: Session = Depends(get_session)):
    me = _me(session)
    return {"timezone": me.timezone if me else None}


@router.put("/me/timezone")
def set_my_timezone(body: TimezoneBody, session: Session = Depends(get_session)):
    from zoneinfo import ZoneInfo
    try:
        ZoneInfo(body.timezone)
    except Exception:
        raise HTTPException(status_code=400, detail="Unknown timezone")
    me = _me(session)
    if not me:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if body.only_if_empty and me.timezone:
        return {"timezone": me.timezone, "updated": False}
    me.timezone = body.timezone
    session.add(me)
    session.commit()
    return {"timezone": me.timezone, "updated": True}


# ─────────────────────────────────────────────────────────────────────────────
# SCM2-54  Inventory stock movements & low-stock
# ─────────────────────────────────────────────────────────────────────────────

class StockBody(BaseModel):
    change: float
    reason: Optional[str] = "Adjustment"
    reference: Optional[str] = None


@router.get("/inventory-stock/low")
def low_stock(session: Session = Depends(get_session)):
    items = session.exec(select(InventoryItem)).all()
    low = [i for i in items if (i.min_stock or 0) > 0 and (i.current_stock or 0) <= (i.min_stock or 0)]
    return {"items": [{"id": i.id, "code": i.code, "name": i.name, "current_stock": i.current_stock,
                       "min_stock": i.min_stock, "unit": i.unit} for i in low], "count": len(low)}


@router.get("/inventory-stock/{item_id}/movements")
def list_movements(item_id: int, session: Session = Depends(get_session)):
    item = session.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    rows = session.exec(select(StockMovement).where(StockMovement.item_id == item_id).order_by(StockMovement.created_at.desc())).all()
    return {"current_stock": item.current_stock, "movements": [{
        "id": r.id, "change": r.change, "reason": r.reason, "reference": r.reference,
        "balance_after": r.balance_after, "created_at": _iso(r.created_at),
    } for r in rows]}


@router.post("/inventory-stock/{item_id}/movements")
def add_movement(item_id: int, body: StockBody, session: Session = Depends(get_session)):
    item = session.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    new_bal = (item.current_stock or 0) + body.change
    if new_bal < 0:
        raise HTTPException(status_code=400, detail=f"Insufficient stock (available {item.current_stock or 0})")
    me = _me(session)
    item.current_stock = new_bal
    item.updated_at = datetime.utcnow()
    mv = StockMovement(item_id=item_id, change=body.change, reason=body.reason or "Adjustment",
                       reference=body.reference, balance_after=new_bal,
                       author_id=me.id if me else None, tenant_id=_tid() or item.tenant_id)
    session.add(item)
    session.add(mv)
    session.commit()
    low = (item.min_stock or 0) > 0 and new_bal <= (item.min_stock or 0)
    return {"ok": True, "current_stock": new_bal, "low_stock": low}
