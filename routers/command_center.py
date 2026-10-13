"""
Command Center + Lead Source Analytics router
─────────────────────────────────────────────
GET /analytics/lead-sources/full            Full per-source analytics (funnel, revenue, cost, ROI, trends…)
GET /analytics/lead-sources/{id}/detail     Drill-down for one source (id 0 = "Unassigned")
GET /command-center/overview                Everything the admin dashboard needs, in one call

Scoping
  * Admin / SuperAdmin / Demo  -> every record in the tenant.
  * SalesManager / Employee    -> only records they own (leads, deals, their clients, …)
                                  and no finance (costs / ROI / salaries) data.
Tenant isolation is handled by the global `do_orm_execute` listener in main.py, exactly like the
other routers, so every aggregate here is computed in Python on already tenant-filtered rows.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, date, timedelta, timezone
from functools import cached_property
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from database import (
    engine, User, Lead, ClientProfile, Deal, Invoice, Proposal, CRMQuote, SalesOrder,
    PurchaseOrder, Task, Project, Meeting, CallLog, SentEmail, ActivityLog, InventoryItem,
    LeadSource, BusinessCost, DealNegotiation,
)
from routers.scm2_features import (
    _ensure_default_sources, _deal_amount, _deal_won_month, _month_key, _month_range,
    _cost_months, _me,
)

router = APIRouter(tags=["CommandCenter"])

LEAD_STATUSES = ["New", "Contacted", "Not Responded", "Neutral", "Positive", "Negative", "Converted"]
DEAL_STAGES = ["Lead", "Discovery", "Demo", "Negotiation", "Closed Won", "Closed Lost"]
STAGE_PROB = {"Lead": 0.10, "Discovery": 0.25, "Demo": 0.50, "Negotiation": 0.75}
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


# ─────────────────────────────────────────────────────────────────────────────
# Small helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_session():
    with Session(engine) as session:
        yield session


def _n(dt: Any) -> Optional[datetime]:
    """Normalise any datetime to naive UTC (Postgres TIMESTAMPTZ returns aware values)."""
    if dt is None or not isinstance(dt, datetime):
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _to_date(v: Any) -> Optional[date]:
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        n = _n(v)
        return n.date() if n else None
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except Exception:
        return None


def _iso(dt: Any) -> Optional[str]:
    n = _n(dt) if isinstance(dt, datetime) else None
    return n.isoformat() if n else (dt.isoformat() if isinstance(dt, date) else None)


def _pct(a: float, b: float) -> float:
    return round(a / b * 100, 1) if b else 0.0


def _chg(cur: float, prev: float) -> Optional[float]:
    if not prev:
        return None
    return round((cur - prev) / prev * 100, 1)


def _r(v: float, nd: int = 2) -> float:
    return round(float(v or 0), nd)


def _is_converted(l: Lead) -> bool:
    return bool(l.is_converted) or (l.status or "").strip().lower() in ("converted", "won")


class Scope:
    def __init__(self, user: User):
        self.user = user
        low = (user.role or "").strip().lower()
        self.role = user.role
        self.is_admin = low in ("admin", "superadmin", "demo") or (user.email or "").lower() == "admin@serphawk.com"
        self.uid: Optional[int] = None if self.is_admin else user.id


def _scope(session: Session) -> Scope:
    user = _me(session)
    if not user:
        tid = current_tenant_id.get()
        if tid and tid != -1:
            user = session.exec(select(User).where((User.tenant_id == tid) & (User.role.in_(["Admin", "SuperAdmin"])))).first()
        if not user:
            user = session.exec(select(User).where(User.role.in_(["Admin", "SuperAdmin"]))).first()
        if not user:
            user = session.exec(select(User)).first()
    if not user:
        user = User(id=1, email="admin@serphawk.com", name="System Admin", role="Admin", tenant_id=1)
    sc = Scope(user)
    return sc


# ─────────────────────────────────────────────────────────────────────────────
# Lazy, scoped data loader (each table is read at most once per request)
# ─────────────────────────────────────────────────────────────────────────────

class Data:
    def __init__(self, session: Session, scope: Scope):
        self.s = session
        self.sc = scope

    def _all(self, model):
        return list(self.s.exec(select(model)).all())

    @cached_property
    def users(self) -> Dict[int, User]:
        return {u.id: u for u in self._all(User)}

    def uname(self, uid: Optional[int]) -> str:
        u = self.users.get(uid) if uid else None
        return (u.name or u.email) if u else "Unassigned"

    @cached_property
    def sources(self) -> List[LeadSource]:
        return _ensure_default_sources(self.s)

    @cached_property
    def leads(self) -> List[Lead]:
        rows = self._all(Lead)
        uid = self.sc.uid
        return rows if uid is None else [l for l in rows if l.owner_id == uid]

    @cached_property
    def lead_ids(self) -> set:
        return {l.id for l in self.leads}

    @cached_property
    def deals(self) -> List[Deal]:
        rows = self._all(Deal)
        uid = self.sc.uid
        return rows if uid is None else [d for d in rows if d.assigned_to == uid]

    @cached_property
    def all_clients(self) -> List[ClientProfile]:
        return self._all(ClientProfile)

    @cached_property
    def own_client_ids(self) -> Optional[set]:
        if self.sc.uid is None:
            return None
        ids = {c.id for c in self.all_clients if c.assignedEmployeeId == self.sc.uid}
        ids |= {d.client_id for d in self.deals if d.client_id}
        ids |= {l.converted_client_id for l in self.leads if l.converted_client_id}
        return ids

    def own_client(self, cid: Optional[int]) -> bool:
        return self.own_client_ids is None or (cid in self.own_client_ids)

    @cached_property
    def clients(self) -> List[ClientProfile]:
        return self.all_clients if self.own_client_ids is None else [c for c in self.all_clients if c.id in self.own_client_ids]

    @cached_property
    def client_names(self) -> Dict[int, str]:
        return {c.id: c.companyName for c in self.all_clients}

    @cached_property
    def proposals(self) -> List[Proposal]:
        rows = self._all(Proposal)
        uid = self.sc.uid
        if uid is None:
            return rows
        return [
            p for p in rows
            if p.created_by == uid
            or (p.client_id is not None and self.own_client(p.client_id))
            or (p.lead_id is not None and p.lead_id in self.lead_ids)
        ]

    @cached_property
    def invoices(self) -> List[Invoice]:
        rows = self._all(Invoice)
        return rows if self.sc.uid is None else [i for i in rows if i.client_id in (self.own_client_ids or set())]

    @cached_property
    def quotes(self) -> List[CRMQuote]:
        rows = self._all(CRMQuote)
        uid = self.sc.uid
        return rows if uid is None else [q for q in rows if q.owner_id == uid or q.client_id in (self.own_client_ids or set())]

    @cached_property
    def sales_orders(self) -> List[SalesOrder]:
        rows = self._all(SalesOrder)
        uid = self.sc.uid
        return rows if uid is None else [o for o in rows if o.owner_id == uid or o.client_id in (self.own_client_ids or set())]

    @cached_property
    def purchase_orders(self) -> List[PurchaseOrder]:
        rows = self._all(PurchaseOrder)
        uid = self.sc.uid
        return rows if uid is None else [o for o in rows if o.owner_id == uid]

    @cached_property
    def tasks(self) -> List[Task]:
        rows = self._all(Task)
        uid = self.sc.uid
        return rows if uid is None else [t for t in rows if str(t.assigned_to) == str(uid) or str(t.created_by) == str(uid)]

    @cached_property
    def followups(self) -> list:
        try:
            from routers.followups import FollowUp
            rows = self._all(FollowUp)
        except Exception:
            return []
        uid = self.sc.uid
        return rows if uid is None else [f for f in rows if f.owner_id == uid]

    @cached_property
    def meetings(self) -> List[Meeting]:
        rows = self._all(Meeting)
        uid = self.sc.uid
        return rows if uid is None else [m for m in rows if m.host_id == uid]

    @cached_property
    def calls(self) -> List[CallLog]:
        rows = self._all(CallLog)
        uid = self.sc.uid
        return rows if uid is None else [c for c in rows if str(c.assigned_to) == str(uid)]

    @cached_property
    def emails(self) -> List[SentEmail]:
        rows = self._all(SentEmail)
        if self.sc.uid is None:
            return rows
        return [e for e in rows if e.lead_id in self.lead_ids or e.client_id in (self.own_client_ids or set())]

    @cached_property
    def activities(self) -> List[ActivityLog]:
        since = datetime.now(timezone.utc) - timedelta(days=14)
        try:
            rows = list(self.s.exec(select(ActivityLog).where(ActivityLog.createdAt >= since)).all())
        except Exception:
            try:
                since_naive = datetime.utcnow() - timedelta(days=14)
                rows = list(self.s.exec(select(ActivityLog).where(ActivityLog.createdAt >= since_naive)).all())
            except Exception:
                rows = self._all(ActivityLog)
        uid = self.sc.uid
        return rows if uid is None else [a for a in rows if a.userId == uid]

    @cached_property
    def projects(self) -> List[Project]:
        return self._all(Project) if self.sc.uid is None else []

    @cached_property
    def inventory(self) -> List[InventoryItem]:
        return self._all(InventoryItem)

    @cached_property
    def dropped(self) -> list:
        try:
            from database import DroppedClient
            rows = self._all(DroppedClient)
        except Exception:
            return []
        uid = self.sc.uid
        return rows if uid is None else [r for r in rows if r.dropped_by == uid]

    @cached_property
    def negotiations(self) -> List[DealNegotiation]:
        rows = self._all(DealNegotiation)
        if self.sc.uid is None:
            return rows
        ids = {d.id for d in self.deals}
        return [n for n in rows if n.deal_id in ids]

    @cached_property
    def costs(self) -> List[BusinessCost]:
        return self._all(BusinessCost) if self.sc.is_admin else []


# ─────────────────────────────────────────────────────────────────────────────
# Lead-source analytics engine
# ─────────────────────────────────────────────────────────────────────────────

ALIASES = {"fb": "facebook", "ig": "instagram", "lnkd": "linkedin", "li": "linkedin", "gads": "google", "adwords": "google"}


def _new_bucket(src: Optional[LeadSource]) -> Dict[str, Any]:
    return {
        "source_id": src.id if src else None,
        "source": src.name if src else "Unassigned",
        "channel": src.channel if src else "—",
        "color": (src.color if src and src.color else "#94a3b8"),
        "utm_key": src.utm_key if src else None,
        "monthly_cost": float(src.monthly_cost or 0) if src else 0.0,
        "is_active": bool(src.is_active) if src else True,
        "leads": 0, "statuses": Counter(), "converted": 0,
        "clients": 0, "deals": 0, "open_deals": 0, "won_deals": 0, "lost_deals": 0,
        "won_revenue": 0.0, "pipeline_value": 0.0, "negotiating": 0, "negotiating_value": 0.0,
        "proposals_sent": 0, "proposals_accepted": 0, "proposal_value": 0.0,
        "leads_30d": 0, "leads_prev_30d": 0, "_cycle": [], "last_lead_at": None,
    }


class SourceEngine:
    def __init__(self, d: Data, start: Optional[str] = None, end: Optional[str] = None, trend_months: int = 12):
        self.d = d
        self.start = _to_date(start)
        self.end = _to_date(end)
        self.trend_months = max(3, min(36, trend_months))
        self._rcache: Dict[str, Optional[LeadSource]] = {}
        self.by_id = {s.id: s for s in d.sources}
        self.buckets: Dict[int, Dict[str, Any]] = {}
        self.lead_bucket: Dict[int, int] = {}          # lead.id -> bucket key
        self.client_bucket: Dict[int, int] = {}        # client.id -> bucket key
        self._build()

    # --- source matching (no DB access; mirrors scm2.resolve_lead_source) ---
    def _resolve(self, text: Optional[str]) -> Optional[LeadSource]:
        if not text or not text.strip():
            return None
        v = text.strip().lower()
        if v in self._rcache:
            return self._rcache[v]
        res: Optional[LeadSource] = None
        for s in self.d.sources:
            if (s.utm_key and s.utm_key.lower() == v) or s.name.lower() == v:
                res = s
                break
        if res is None:
            for s in self.d.sources:
                key = (s.utm_key or s.name).lower()
                if key and (key in v or v in key):
                    res = s
                    break
        if res is None and v in ALIASES:
            res = self._resolve(ALIASES[v])
        self._rcache[v] = res
        return res

    def _match(self, source_id: Optional[int], text: Optional[str]) -> Optional[LeadSource]:
        if source_id and source_id in self.by_id:
            return self.by_id[source_id]
        return self._resolve(text)

    def _bucket(self, src: Optional[LeadSource]) -> Dict[str, Any]:
        key = src.id if src else 0
        if key not in self.buckets:
            self.buckets[key] = _new_bucket(src)
        return self.buckets[key]

    def _key(self, src: Optional[LeadSource]) -> int:
        return src.id if src else 0

    def in_range(self, dt: Any) -> bool:
        n = _n(dt) if isinstance(dt, datetime) else None
        if n is None:
            return not (self.start or self.end)
        d = n.date()
        return (not self.start or d >= self.start) and (not self.end or d <= self.end)

    # --- main aggregation ---
    def _build(self):
        d = self.d
        now = datetime.utcnow()
        for s in d.sources:
            if s.is_active:
                self._bucket(s)

        all_leads = d.leads
        lead_src: Dict[int, Optional[LeadSource]] = {}
        for l in all_leads:
            src = self._match(l.lead_source_id, l.source)
            lead_src[l.id] = src
            self.lead_bucket[l.id] = self._key(src)

        # client -> source (via converted lead, otherwise the client's own tag)
        client_src: Dict[int, Optional[LeadSource]] = {}
        for l in all_leads:
            if l.converted_client_id:
                client_src[l.converted_client_id] = lead_src.get(l.id)
        for c in d.clients:
            direct = self._match(c.lead_source_id, c.lead_source)
            if direct or c.id not in client_src:
                client_src[c.id] = direct
        for cid, src in client_src.items():
            self.client_bucket[cid] = self._key(src)
        for c in d.clients:
            self._bucket(client_src.get(c.id))["clients"] += 1

        # earliest won date per client (sales-cycle length)
        won_by_client: Dict[int, datetime] = {}
        for dl in d.deals:
            if dl.stage == "Closed Won" and dl.client_id:
                wd = _n(dl.won_at or dl.updated_at or dl.created_at)
                if wd and (dl.client_id not in won_by_client or wd < won_by_client[dl.client_id]):
                    won_by_client[dl.client_id] = wd

        # leads
        self.range_leads: List[Lead] = []
        c30, c60 = now - timedelta(days=30), now - timedelta(days=60)
        for l in all_leads:
            created = _n(l.created_at)
            b = self._bucket(lead_src.get(l.id))
            if created:
                if created >= c30:
                    b["leads_30d"] += 1
                elif created >= c60:
                    b["leads_prev_30d"] += 1
            if not self.in_range(l.created_at):
                continue
            self.range_leads.append(l)
            b["leads"] += 1
            st = (l.status or "New").strip()
            b["statuses"][st] += 1
            if _is_converted(l):
                b["converted"] += 1
                if l.converted_client_id and l.converted_client_id in won_by_client and created:
                    days = (won_by_client[l.converted_client_id] - created).total_seconds() / 86400
                    if days >= 0:
                        b["_cycle"].append(days)
            if created and (b["last_lead_at"] is None or created > b["last_lead_at"]):
                b["last_lead_at"] = created

        # deals
        for dl in d.deals:
            b = self._bucket(self._src_of_client(dl.client_id, client_src))
            if dl.stage == "Closed Won":
                if self.in_range(dl.won_at or dl.updated_at):
                    b["won_deals"] += 1
                    b["won_revenue"] += _deal_amount(dl)
                    b["deals"] += 1
            elif dl.stage == "Closed Lost":
                if self.in_range(dl.updated_at or dl.created_at):
                    b["lost_deals"] += 1
                    b["deals"] += 1
            else:
                b["open_deals"] += 1
                b["pipeline_value"] += float(dl.value or 0)
                if self.in_range(dl.created_at):
                    b["deals"] += 1
                if dl.stage == "Negotiation":
                    b["negotiating"] += 1
                    b["negotiating_value"] += float(dl.value or 0)

        # proposals
        for p in d.proposals:
            if not self.in_range(p.created_at):
                continue
            src = client_src.get(p.client_id) if p.client_id else lead_src.get(p.lead_id)
            if src is None and p.lead_id:
                src = lead_src.get(p.lead_id)
            b = self._bucket(src)
            st = (p.status or "Draft").strip().lower()
            if st != "draft":
                b["proposals_sent"] += 1
                b["proposal_value"] += float(p.total_value or 0)
            if st == "accepted":
                b["proposals_accepted"] += 1

    def _src_of_client(self, cid: Optional[int], client_src: Dict[int, Optional[LeadSource]]) -> Optional[LeadSource]:
        return client_src.get(cid) if cid else None

    # --- period length used for marketing cost ---
    def months_in_range(self) -> int:
        if self.start and self.end:
            return max(1, (self.end.year - self.start.year) * 12 + (self.end.month - self.start.month) + 1)
        today = datetime.utcnow().date()
        first = self.start
        if first is None:
            dates = [_n(l.created_at).date() for l in self.d.leads if _n(l.created_at)]
            first = min(dates) if dates else today
        last = self.end or today
        return max(1, min(120, (last.year - first.year) * 12 + (last.month - first.month) + 1))

    # --- finalised rows ---
    def rows(self) -> List[Dict[str, Any]]:
        months = self.months_in_range()
        show_cost = self.d.sc.is_admin
        out: List[Dict[str, Any]] = []
        tot_leads = sum(b["leads"] for b in self.buckets.values()) or 0
        tot_rev = sum(b["won_revenue"] for b in self.buckets.values()) or 0.0
        for b in self.buckets.values():
            if b["source_id"] is None and not b["leads"] and not b["won_revenue"] and not b["pipeline_value"] and not b["clients"]:
                continue
            st = b["statuses"]
            leads = b["leads"]
            new = st.get("New", 0)
            converted = b["converted"]
            responded = st.get("Neutral", 0) + st.get("Positive", 0) + st.get("Negative", 0) + converted
            positive = st.get("Positive", 0) + converted
            cost = b["monthly_cost"] * months if show_cost else 0.0
            cycle = b["_cycle"]
            closed = b["won_deals"] + b["lost_deals"]
            conv_rate = _pct(converted, leads)
            pos_rate = _pct(positive, leads)
            win_rate = _pct(b["won_deals"], closed)
            score = round(0.5 * min(conv_rate * 3, 100) + 0.3 * pos_rate + 0.2 * win_rate) if leads else 0
            row = {
                "source_id": b["source_id"], "source": b["source"], "channel": b["channel"],
                "color": b["color"], "utm_key": b["utm_key"], "is_active": b["is_active"],
                "monthly_cost": b["monthly_cost"] if show_cost else None,
                "leads": leads, "new": new, "contacted": leads - new,
                "not_responded": st.get("Not Responded", 0), "neutral": st.get("Neutral", 0),
                "positive": st.get("Positive", 0), "negative": st.get("Negative", 0),
                "responded": responded, "positive_total": positive, "converted": converted,
                "open_leads": max(0, leads - converted - st.get("Negative", 0)),
                "contact_rate": _pct(leads - new, leads), "response_rate": _pct(responded, leads),
                "positive_rate": pos_rate, "conversion_rate": conv_rate,
                "clients": b["clients"], "deals": b["deals"], "open_deals": b["open_deals"],
                "won_deals": b["won_deals"], "lost_deals": b["lost_deals"], "win_rate": win_rate,
                "won_revenue": _r(b["won_revenue"]), "pipeline_value": _r(b["pipeline_value"]),
                "avg_deal_size": _r(b["won_revenue"] / b["won_deals"]) if b["won_deals"] else 0.0,
                "revenue_per_lead": _r(b["won_revenue"] / leads) if leads else 0.0,
                "avg_cycle_days": round(sum(cycle) / len(cycle), 1) if cycle else None,
                "negotiating": b["negotiating"], "negotiating_value": _r(b["negotiating_value"]),
                "proposals_sent": b["proposals_sent"], "proposals_accepted": b["proposals_accepted"],
                "proposal_value": _r(b["proposal_value"]),
                "proposal_accept_rate": _pct(b["proposals_accepted"], b["proposals_sent"]),
                "total_cost": _r(cost) if show_cost else None,
                "cost_per_lead": _r(cost / leads) if (show_cost and leads and cost) else None,
                "cost_per_conversion": _r(cost / converted) if (show_cost and converted and cost) else None,
                "cost_per_won_deal": _r(cost / b["won_deals"]) if (show_cost and b["won_deals"] and cost) else None,
                "roi_pct": round((b["won_revenue"] - cost) / cost * 100, 1) if (show_cost and cost) else None,
                "roas": round(b["won_revenue"] / cost, 2) if (show_cost and cost) else None,
                "leads_30d": b["leads_30d"], "leads_prev_30d": b["leads_prev_30d"],
                "growth_pct": _chg(b["leads_30d"], b["leads_prev_30d"]),
                "share_of_leads": _pct(leads, tot_leads), "share_of_revenue": _pct(b["won_revenue"], tot_rev),
                "quality_score": score,
                "last_lead_at": b["last_lead_at"].isoformat() if b["last_lead_at"] else None,
            }
            out.append(row)
        out.sort(key=lambda r: (r["leads"], r["won_revenue"]), reverse=True)
        return out

    # --- trend (cohort by month) ---
    def trend(self) -> List[Dict[str, Any]]:
        keys = _month_range(self.trend_months)
        name_of = {k: self.buckets[k]["source"] for k in self.buckets}
        t = {k: {"month": k, "leads": 0, "converted": 0, "won_revenue": 0.0, "won_deals": 0,
                 "sources": defaultdict(int), "revenue_sources": defaultdict(float)} for k in keys}
        for l in self.d.leads:
            mk = _month_key(_n(l.created_at))
            if mk in t:
                t[mk]["leads"] += 1
                nm = name_of.get(self.lead_bucket.get(l.id, 0), "Unassigned")
                t[mk]["sources"][nm] += 1
                if _is_converted(l):
                    t[mk]["converted"] += 1
        for dl in self.d.deals:
            if dl.stage == "Closed Won":
                mk = _deal_won_month(dl)
                if mk in t:
                    amt = _deal_amount(dl)
                    t[mk]["won_revenue"] += amt
                    t[mk]["won_deals"] += 1
                    nm = name_of.get(self.client_bucket.get(dl.client_id, 0), "Unassigned")
                    t[mk]["revenue_sources"][nm] += amt
        out = []
        for k in keys:
            m = t[k]
            y, mo = int(k[:4]), int(k[5:7])
            out.append({
                "month": k, "label": datetime(y, mo, 1).strftime("%b %y"),
                "leads": m["leads"], "converted": m["converted"],
                "conversion_rate": _pct(m["converted"], m["leads"]),
                "won_revenue": _r(m["won_revenue"]), "won_deals": m["won_deals"],
                "sources": dict(m["sources"]),
                "revenue_sources": {a: _r(b) for a, b in m["revenue_sources"].items()},
            })
        return out

    # --- window stats for period-over-period comparison ---
    def momentum(self) -> Dict[str, Any]:
        today = datetime.utcnow().date()
        if self.start and self.end:
            span = (self.end - self.start).days + 1
            a0, a1 = self.start, self.end
        else:
            span = 30
            a1 = today
            a0 = today - timedelta(days=span - 1)
        b1 = a0 - timedelta(days=1)
        b0 = b1 - timedelta(days=span - 1)

        def window(w0: date, w1: date) -> Dict[str, float]:
            leads = [l for l in self.d.leads if (_to_date(l.created_at) and w0 <= _to_date(l.created_at) <= w1)]
            conv = sum(1 for l in leads if _is_converted(l))
            wins = [x for x in self.d.deals if x.stage == "Closed Won" and _to_date(x.won_at or x.updated_at) and w0 <= _to_date(x.won_at or x.updated_at) <= w1]
            return {"leads": len(leads), "converted": conv, "won_revenue": sum(_deal_amount(x) for x in wins), "won_deals": len(wins)}

        cur, prev = window(a0, a1), window(b0, b1)
        out = {k: {"current": _r(cur[k]), "previous": _r(prev[k]), "change_pct": _chg(cur[k], prev[k])} for k in cur}
        out["window"] = {"days": span, "current": [a0.isoformat(), a1.isoformat()], "previous": [b0.isoformat(), b1.isoformat()]}
        return out

    # --- breakdowns ---
    def channels(self, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        agg: Dict[str, Dict[str, Any]] = {}
        for r in rows:
            c = agg.setdefault(r["channel"], {"channel": r["channel"], "sources": 0, "leads": 0, "converted": 0, "won_revenue": 0.0, "pipeline_value": 0.0, "total_cost": 0.0})
            c["sources"] += 1
            c["leads"] += r["leads"]
            c["converted"] += r["converted"]
            c["won_revenue"] += r["won_revenue"]
            c["pipeline_value"] += r["pipeline_value"]
            c["total_cost"] += r["total_cost"] or 0
        res = []
        for c in agg.values():
            c["conversion_rate"] = _pct(c["converted"], c["leads"])
            c["roi_pct"] = round((c["won_revenue"] - c["total_cost"]) / c["total_cost"] * 100, 1) if c["total_cost"] else None
            c["won_revenue"], c["pipeline_value"], c["total_cost"] = _r(c["won_revenue"]), _r(c["pipeline_value"]), _r(c["total_cost"])
            res.append(c)
        res.sort(key=lambda c: -c["leads"])
        return res

    def owners(self) -> List[Dict[str, Any]]:
        names = {k: b["source"] for k, b in self.buckets.items()}
        agg: Dict[Any, Dict[str, Any]] = {}
        for l in self.range_leads:
            o = agg.setdefault(l.owner_id or 0, {"user_id": l.owner_id, "owner": self.d.uname(l.owner_id), "leads": 0, "converted": 0, "positive": 0, "src": Counter()})
            o["leads"] += 1
            o["src"][names.get(self.lead_bucket.get(l.id, 0), "Unassigned")] += 1
            st = (l.status or "").lower()
            if _is_converted(l):
                o["converted"] += 1
            if st in ("positive", "converted"):
                o["positive"] += 1
        rev: Dict[Any, float] = defaultdict(float)
        wins: Dict[Any, int] = defaultdict(int)
        for dl in self.d.deals:
            if dl.stage == "Closed Won" and self.in_range(dl.won_at or dl.updated_at):
                rev[dl.assigned_to or 0] += _deal_amount(dl)
                wins[dl.assigned_to or 0] += 1
        res = []
        for k, o in agg.items():
            top = o["src"].most_common(1)
            res.append({
                "user_id": o["user_id"], "owner": o["owner"], "leads": o["leads"], "converted": o["converted"],
                "conversion_rate": _pct(o["converted"], o["leads"]), "positive_rate": _pct(o["positive"], o["leads"]),
                "won_deals": wins.get(k, 0), "won_revenue": _r(rev.get(k, 0)),
                "top_source": top[0][0] if top else None,
            })
        res.sort(key=lambda r: (-r["leads"], -r["won_revenue"]))
        return res

    def industries(self) -> List[Dict[str, Any]]:
        agg: Dict[str, Dict[str, int]] = defaultdict(lambda: {"leads": 0, "converted": 0})
        for l in self.range_leads:
            k = (l.industry or "Unknown").strip() or "Unknown"
            agg[k]["leads"] += 1
            if _is_converted(l):
                agg[k]["converted"] += 1
        res = [{"industry": k, **v, "conversion_rate": _pct(v["converted"], v["leads"])} for k, v in agg.items()]
        res.sort(key=lambda r: -r["leads"])
        return res[:12]

    def weekdays(self) -> List[Dict[str, Any]]:
        leads = [0] * 7
        conv = [0] * 7
        for l in self.range_leads:
            n = _n(l.created_at)
            if n:
                leads[n.weekday()] += 1
                if _is_converted(l):
                    conv[n.weekday()] += 1
        return [{"day": WEEKDAYS[i], "leads": leads[i], "converted": conv[i]} for i in range(7)]

    def statuses(self) -> List[Dict[str, Any]]:
        c = Counter((l.status or "New").strip() for l in self.range_leads)
        order = LEAD_STATUSES + [s for s in c if s not in LEAD_STATUSES]
        return [{"status": s, "count": c.get(s, 0)} for s in order if c.get(s, 0) or s in LEAD_STATUSES]

    def status_matrix(self, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [{"source": r["source"], "color": r["color"], "New": r["new"], "Contacted": max(0, r["contacted"] - r["not_responded"] - r["neutral"] - r["positive"] - r["negative"] - r["converted"]),
                 "Not Responded": r["not_responded"], "Neutral": r["neutral"], "Positive": r["positive"], "Negative": r["negative"], "Converted": r["converted"]} for r in rows if r["leads"]]

    def data_quality(self) -> Dict[str, Any]:
        n = len(self.range_leads) or 1
        un = self.buckets.get(0, {}).get("leads", 0)
        return {
            "total_leads": len(self.range_leads), "unassigned_source": un, "unassigned_pct": _pct(un, len(self.range_leads)),
            "missing_email": sum(1 for l in self.range_leads if not (l.email or "").strip()),
            "missing_phone": sum(1 for l in self.range_leads if not (l.phone or "").strip()),
            "missing_owner": sum(1 for l in self.range_leads if not l.owner_id),
            "missing_email_pct": _pct(sum(1 for l in self.range_leads if not (l.email or "").strip()), n),
            "missing_phone_pct": _pct(sum(1 for l in self.range_leads if not (l.phone or "").strip()), n),
            "missing_owner_pct": _pct(sum(1 for l in self.range_leads if not l.owner_id), n),
        }

    def recent_leads(self, limit: int = 12) -> List[Dict[str, Any]]:
        names = {k: b["source"] for k, b in self.buckets.items()}
        colors = {k: b["color"] for k, b in self.buckets.items()}
        rows = sorted(self.range_leads, key=lambda l: _n(l.created_at) or datetime.min, reverse=True)[:limit]
        return [{
            "id": l.id, "company_name": l.company_name, "status": l.status, "converted": _is_converted(l),
            "source": names.get(self.lead_bucket.get(l.id, 0), "Unassigned"),
            "color": colors.get(self.lead_bucket.get(l.id, 0), "#94a3b8"),
            "owner": self.d.uname(l.owner_id), "created_at": _iso(l.created_at),
        } for l in rows]

    @staticmethod
    def highlights(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
        live = [r for r in rows if r["leads"] > 0]
        qual = [r for r in live if r["leads"] >= 3]

        def pick(items, key, reverse=True, min_val=None):
            items = [r for r in items if r.get(key) is not None and (min_val is None or r[key] > min_val)]
            if not items:
                return None
            r = sorted(items, key=lambda x: x[key], reverse=reverse)[0]
            return {"source": r["source"], "color": r["color"], "value": r[key], "source_id": r["source_id"]}

        worst = None
        cands = [r for r in qual if r["conversion_rate"] < 10]
        if cands:
            r = sorted(cands, key=lambda x: (x["conversion_rate"], -x["leads"]))[0]
            worst = {"source": r["source"], "color": r["color"], "value": r["conversion_rate"], "leads": r["leads"], "source_id": r["source_id"]}
        return {
            "top_volume": pick(live, "leads"),
            "best_conversion": pick(qual, "conversion_rate"),
            "top_revenue": pick(live, "won_revenue", min_val=0),
            "best_roi": pick(live, "roi_pct"),
            "cheapest_lead": pick(live, "cost_per_lead", reverse=False),
            "fastest_growing": pick(live, "growth_pct", min_val=0),
            "fastest_closer": pick(live, "avg_cycle_days", reverse=False),
            "biggest_deals": pick(live, "avg_deal_size", min_val=0),
            "best_quality": pick(qual, "quality_score"),
            "needs_attention": worst,
        }

    def summary(self) -> Dict[str, Any]:
        rows = self.rows()
        leads = sum(r["leads"] for r in rows)
        conv = sum(r["converted"] for r in rows)
        rev = sum(r["won_revenue"] for r in rows)
        cost = sum((r["total_cost"] or 0) for r in rows)
        won = sum(r["won_deals"] for r in rows)
        lost = sum(r["lost_deals"] for r in rows)
        cycles = [r["avg_cycle_days"] for r in rows if r["avg_cycle_days"] is not None]
        show_cost = self.d.sc.is_admin
        totals = {
            "leads": leads, "contacted": sum(r["contacted"] for r in rows), "responded": sum(r["responded"] for r in rows),
            "positive": sum(r["positive_total"] for r in rows), "converted": conv, "conversion_rate": _pct(conv, leads),
            "clients": sum(r["clients"] for r in rows), "deals": sum(r["deals"] for r in rows),
            "won_deals": won, "lost_deals": lost, "open_deals": sum(r["open_deals"] for r in rows), "win_rate": _pct(won, won + lost),
            "won_revenue": _r(rev), "pipeline_value": _r(sum(r["pipeline_value"] for r in rows)),
            "avg_deal_size": _r(rev / won) if won else 0.0,
            "negotiating": sum(r["negotiating"] for r in rows), "negotiating_value": _r(sum(r["negotiating_value"] for r in rows)),
            "proposals_sent": sum(r["proposals_sent"] for r in rows), "proposals_accepted": sum(r["proposals_accepted"] for r in rows),
            "total_cost": _r(cost) if show_cost else None,
            "cost_per_lead": _r(cost / leads) if (show_cost and leads and cost) else None,
            "cost_per_conversion": _r(cost / conv) if (show_cost and conv and cost) else None,
            "cost_per_won_deal": _r(cost / won) if (show_cost and won and cost) else None,
            "roi_pct": round((rev - cost) / cost * 100, 1) if (show_cost and cost) else None,
            "roas": round(rev / cost, 2) if (show_cost and cost) else None,
            "net_after_cost": _r(rev - cost) if show_cost else None,
            "revenue_per_lead": _r(rev / leads) if leads else 0.0,
            "avg_cycle_days": round(sum(cycles) / len(cycles), 1) if cycles else None,
            "active_sources": sum(1 for r in rows if r["is_active"] and r["source_id"] is not None),
            "sources_with_leads": sum(1 for r in rows if r["leads"] > 0),
            "months": self.months_in_range(),
        }
        return {
            "sources": rows,
            "totals": totals,
            "highlights": self.highlights(rows),
            "momentum": self.momentum(),
            "trend": self.trend(),
            "channels": self.channels(rows),
            "owners": self.owners() if self.d.sc.is_admin else [],
            "industries": self.industries(),
            "weekdays": self.weekdays(),
            "statuses": self.statuses(),
            "status_matrix": self.status_matrix(rows),
            "data_quality": self.data_quality(),
            "recent_leads": self.recent_leads(),
            "range": {"start": self.start.isoformat() if self.start else None, "end": self.end.isoformat() if self.end else None, "months": self.months_in_range()},
            "can_see_finance": self.d.sc.is_admin,
        }

    # --- drill-down ---
    def detail(self, key: int) -> Dict[str, Any]:
        d = self.d
        row = next((r for r in self.rows() if (r["source_id"] or 0) == key), None)
        if row is None:
            raise HTTPException(status_code=404, detail="Source not found")
        leads = [l for l in self.range_leads if self.lead_bucket.get(l.id, 0) == key]
        leads.sort(key=lambda l: _n(l.created_at) or datetime.min, reverse=True)
        deals_by_client: Dict[int, List[Deal]] = defaultdict(list)
        for dl in d.deals:
            if dl.client_id:
                deals_by_client[dl.client_id].append(dl)
        lead_rows = []
        for l in leads[:300]:
            ds = deals_by_client.get(l.converted_client_id, []) if l.converted_client_id else []
            lead_rows.append({
                "id": l.id, "company_name": l.company_name, "email": l.email, "phone": l.phone, "industry": l.industry,
                "status": l.status, "converted": _is_converted(l), "client_id": l.converted_client_id,
                "owner": d.uname(l.owner_id), "created_at": _iso(l.created_at),
                "deal_value": _r(sum(_deal_amount(x) for x in ds if x.stage == "Closed Won")),
                "open_value": _r(sum(float(x.value or 0) for x in ds if x.stage not in ("Closed Won", "Closed Lost"))),
            })
        client_ids = {cid for cid, b in self.client_bucket.items() if b == key}
        deal_rows = [{
            "id": x.id, "title": x.title, "stage": x.stage, "amount": _r(_deal_amount(x) if x.stage == "Closed Won" else float(x.value or 0)),
            "client_id": x.client_id, "client": d.client_names.get(x.client_id), "owner": d.uname(x.assigned_to),
        } for x in d.deals if x.client_id in client_ids or (key == 0 and not x.client_id)]
        deal_rows.sort(key=lambda r: -r["amount"])
        prop_rows = [{
            "id": p.id, "title": p.title, "status": p.status, "value": _r(p.total_value or 0), "client": d.client_names.get(p.client_id),
            "created_at": _iso(p.created_at),
        } for p in d.proposals if (p.client_id in client_ids) or (p.lead_id and self.lead_bucket.get(p.lead_id) == key)]
        prop_rows.sort(key=lambda r: r["created_at"] or "", reverse=True)

        # per-source trend
        keys = _month_range(self.trend_months)
        trend = {k: {"month": k, "leads": 0, "converted": 0, "won_revenue": 0.0} for k in keys}
        for l in d.leads:
            if self.lead_bucket.get(l.id, 0) == key:
                mk = _month_key(_n(l.created_at))
                if mk in trend:
                    trend[mk]["leads"] += 1
                    if _is_converted(l):
                        trend[mk]["converted"] += 1
        for x in d.deals:
            if x.stage == "Closed Won" and x.client_id in client_ids:
                mk = _deal_won_month(x)
                if mk in trend:
                    trend[mk]["won_revenue"] += _deal_amount(x)
        tr = [{**v, "label": datetime(int(k[:4]), int(k[5:7]), 1).strftime("%b %y"), "won_revenue": _r(v["won_revenue"])} for k, v in trend.items()]

        owners = Counter(l.owner_id for l in leads)
        inds = Counter((l.industry or "Unknown") for l in leads)
        stat = Counter((l.status or "New") for l in leads)
        return {
            "source": row,
            "leads": lead_rows,
            "leads_total": len(leads),
            "deals": deal_rows[:25],
            "proposals": prop_rows[:25],
            "trend": tr,
            "owners": [{"owner": d.uname(o), "leads": n} for o, n in owners.most_common(8)],
            "industries": [{"industry": i, "leads": n} for i, n in inds.most_common(8)],
            "statuses": [{"status": s, "count": stat.get(s, 0)} for s in LEAD_STATUSES if stat.get(s, 0)],
        }


@router.get("/analytics/lead-sources/full")
def lead_sources_full(
    start: Optional[str] = None,
    end: Optional[str] = None,
    months: int = Query(12, ge=3, le=36),
    session: Session = Depends(get_session),
):
    sc = _scope(session)
    return SourceEngine(Data(session, sc), start, end, months).summary()


@router.get("/analytics/lead-sources/{source_id}/detail")
def lead_source_detail(
    source_id: int,
    start: Optional[str] = None,
    end: Optional[str] = None,
    session: Session = Depends(get_session),
):
    sc = _scope(session)
    return SourceEngine(Data(session, sc), start, end, 12).detail(source_id)


# ─────────────────────────────────────────────────────────────────────────────
# Command center (dashboard) overview
# ─────────────────────────────────────────────────────────────────────────────

def _group(rows, key_fn, val_fn=None) -> Dict[str, Dict[str, float]]:
    out: Dict[str, Dict[str, float]] = {}
    for r in rows:
        k = (key_fn(r) or "Unknown").strip() or "Unknown"
        g = out.setdefault(k, {"count": 0, "value": 0.0})
        g["count"] += 1
        g["value"] += float(val_fn(r) or 0) if val_fn else 0.0
    return out


def _as_list(g: Dict[str, Dict[str, float]], order: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    keys = list(order or []) + [k for k in g if k not in (order or [])]
    return [{"name": k, "count": int(g.get(k, {}).get("count", 0)), "value": _r(g.get(k, {}).get("value", 0))} for k in keys if k in g or (order and k in order)]


def build_overview(d: Data, months: int) -> Dict[str, Any]:
    now = datetime.utcnow()
    today = now.date()
    mkeys = _month_range(months)
    cur_mk = mkeys[-1]
    prev_mk = mkeys[-2] if len(mkeys) > 1 else None
    is_admin = d.sc.is_admin

    # ── deals / pipeline ────────────────────────────────────────────────────
    deals = d.deals
    won = [x for x in deals if x.stage == "Closed Won"]
    lost = [x for x in deals if x.stage == "Closed Lost"]
    open_deals = [x for x in deals if x.stage not in ("Closed Won", "Closed Lost")]
    stage_g = _group(deals, lambda x: x.stage, lambda x: _deal_amount(x) if x.stage == "Closed Won" else x.value)
    by_stage = _as_list(stage_g, DEAL_STAGES)
    for s in by_stage:
        s["probability"] = int(STAGE_PROB.get(s["name"], 0) * 100)
    pipeline_value = sum(float(x.value or 0) for x in open_deals)
    weighted = sum(float(x.value or 0) * STAGE_PROB.get(x.stage, 0.2) for x in open_deals)
    won_rev = sum(_deal_amount(x) for x in won)
    cycles = []
    for x in won:
        a, b = _n(x.created_at), _n(x.won_at or x.updated_at)
        if a and b and b >= a:
            cycles.append((b - a).total_seconds() / 86400)

    closing_soon = []
    for x in open_deals:
        cd = _to_date(x.expected_close_date)
        if cd and today - timedelta(days=30) <= cd <= today + timedelta(days=14):
            closing_soon.append({"id": x.id, "title": x.title, "stage": x.stage, "value": _r(x.value or 0), "close_date": cd.isoformat(),
                                 "days": (cd - today).days, "client": d.client_names.get(x.client_id), "client_id": x.client_id, "owner": d.uname(x.assigned_to)})
    closing_soon.sort(key=lambda r: r["days"])
    top_open = sorted(open_deals, key=lambda x: -(x.value or 0))[:6]
    top_open_rows = [{"id": x.id, "title": x.title, "stage": x.stage, "value": _r(x.value or 0), "client": d.client_names.get(x.client_id),
                      "client_id": x.client_id, "owner": d.uname(x.assigned_to)} for x in top_open]

    # ── monthly series (revenue, costs, leads, deals, proposals) ────────────
    series = {k: {"month": k, "label": datetime(int(k[:4]), int(k[5:7]), 1).strftime("%b %y"), "won_revenue": 0.0, "won_deals": 0,
                  "paid_invoices": 0.0, "costs": 0.0, "leads": 0, "converted": 0, "new_deals": 0, "proposals_sent": 0, "emails": 0} for k in mkeys}
    for x in won:
        mk = _deal_won_month(x)
        if mk in series:
            series[mk]["won_revenue"] += _deal_amount(x)
            series[mk]["won_deals"] += 1
    for x in deals:
        mk = _month_key(_n(x.created_at))
        if mk in series:
            series[mk]["new_deals"] += 1
    for i in d.invoices:
        if (i.status or "").lower() == "paid":
            mk = _month_key(_n(i.paid_at or i.updated_at))
            if mk in series:
                series[mk]["paid_invoices"] += float(i.total or 0)
    for l in d.leads:
        mk = _month_key(_n(l.created_at))
        if mk in series:
            series[mk]["leads"] += 1
            if _is_converted(l):
                series[mk]["converted"] += 1
    for p in d.proposals:
        if (p.status or "Draft").lower() != "draft":
            mk = _month_key(_n(p.created_at))
            if mk in series:
                series[mk]["proposals_sent"] += 1
    for e in d.emails:
        mk = _month_key(_n(e.sent_at))
        if mk in series:
            series[mk]["emails"] += 1
    cost_by_cat: Dict[str, float] = defaultdict(float)
    for c in d.costs:
        for mk in _cost_months(c, mkeys):
            series[mk]["costs"] += c.amount or 0
            cost_by_cat[c.category] += c.amount or 0
    ser = []
    for k in mkeys:
        m = series[k]
        m["net_profit"] = m["won_revenue"] - m["costs"]
        for f in ("won_revenue", "paid_invoices", "costs", "net_profit"):
            m[f] = _r(m[f])
        ser.append(m)
    period_rev = sum(m["won_revenue"] for m in ser)
    period_cost = sum(m["costs"] for m in ser)
    cur, prev = series[cur_mk], (series[prev_mk] if prev_mk else None)

    # ── leads ───────────────────────────────────────────────────────────────
    leads = d.leads
    converted_leads = [l for l in leads if _is_converted(l)]
    lead_status = Counter((l.status or "New").strip() for l in leads)
    stale_cut = now - timedelta(days=14)
    stale = [l for l in leads if not _is_converted(l) and (l.status or "New") in ("New", "Not Responded") and (_n(l.created_at) or now) < stale_cut]
    unassigned_owner = [l for l in leads if not l.owner_id]
    recent_leads = sorted(leads, key=lambda l: _n(l.created_at) or datetime.min, reverse=True)[:6]
    lead_block = {
        "total": len(leads), "converted": len(converted_leads), "conversion_rate": _pct(len(converted_leads), len(leads)),
        "new_this_month": cur["leads"], "new_last_month": prev["leads"] if prev else 0,
        "change_pct": _chg(cur["leads"], prev["leads"]) if prev else None,
        "by_status": [{"name": s, "count": lead_status.get(s, 0)} for s in LEAD_STATUSES] + [{"name": s, "count": n} for s, n in lead_status.items() if s not in LEAD_STATUSES],
        "stale": len(stale), "unassigned_owner": len(unassigned_owner),
        "recent": [{"id": l.id, "company_name": l.company_name, "status": l.status, "source": l.source, "owner": d.uname(l.owner_id), "created_at": _iso(l.created_at)} for l in recent_leads],
    }

    # ── lead sources (trimmed engine output) ────────────────────────────────
    eng = SourceEngine(d, None, None, months)
    s_rows = eng.rows()
    sources_block = {
        "rows": [{k: r[k] for k in ("source_id", "source", "color", "channel", "leads", "converted", "conversion_rate", "won_revenue", "pipeline_value", "roi_pct", "quality_score", "growth_pct")} for r in s_rows if r["leads"] or r["won_revenue"]][:8],
        "highlights": eng.highlights(s_rows),
        "total_sources": len([r for r in s_rows if r["source_id"] is not None]),
    }

    # ── clients ─────────────────────────────────────────────────────────────
    clients = d.clients
    rev_by_client: Dict[int, float] = defaultdict(float)
    for x in won:
        if x.client_id:
            rev_by_client[x.client_id] += _deal_amount(x)
    open_by_client: Dict[int, float] = defaultdict(float)
    for x in open_deals:
        if x.client_id:
            open_by_client[x.client_id] += float(x.value or 0)
    top_clients = sorted(rev_by_client.items(), key=lambda kv: -kv[1])[:6]
    client_block = {
        "total": len(clients),
        "active": sum(1 for c in clients if (c.status or "").lower() == "active"),
        "by_status": _as_list(_group(clients, lambda c: c.status), ["Active", "Pending", "Hold"]),
        "by_payment": _as_list(_group(clients, lambda c: c.payment_status), ["Paid", "Pending", "Failed"]),
        "with_open_deals": len([c for c in clients if open_by_client.get(c.id)]),
        "top": [{"id": cid, "name": d.client_names.get(cid), "revenue": _r(v), "open_value": _r(open_by_client.get(cid, 0))} for cid, v in top_clients],
        "dropped": len(d.dropped), "dropped_revenue": _r(sum(float(r.last_revenue or 0) for r in d.dropped)),
        "avg_revenue_per_client": _r(won_rev / max(1, len(rev_by_client))),
        "no_followup": sum(1 for c in clients if (c.status or "").lower() == "active" and not c.next_followup_date),
    }

    # ── proposals / negotiations ────────────────────────────────────────────
    props = d.proposals
    prop_g = _group(props, lambda p: p.status or "Draft", lambda p: p.total_value)
    sent_props = [p for p in props if (p.status or "Draft").lower() != "draft"]
    acc_props = [p for p in props if (p.status or "").lower() == "accepted"]
    rej_props = [p for p in props if (p.status or "").lower() == "rejected"]
    awaiting = [p for p in props if (p.status or "").lower() in ("sent", "demo requested")]
    neg_by_deal: Dict[int, List[DealNegotiation]] = defaultdict(list)
    for n in d.negotiations:
        neg_by_deal[n.deal_id].append(n)
    deal_by_id = {x.id: x for x in deals}
    active_neg = []
    for x in open_deals:
        rounds = sorted(neg_by_deal.get(x.id, []), key=lambda n: n.round_no)
        if rounds and (rounds[-1].status or "") in ("Proposed", "Countered"):
            active_neg.append((x, rounds))
    negotiating_stage = [x for x in open_deals if x.stage == "Negotiation"]
    disc = [n.discount_pct for n in d.negotiations if n.discount_pct]
    recent_neg = sorted(d.negotiations, key=lambda n: _n(n.created_at) or datetime.min, reverse=True)[:6]
    proposal_block = {
        "total": len(props), "sent": len(sent_props), "accepted": len(acc_props), "rejected": len(rej_props), "awaiting": len(awaiting),
        "draft": len(props) - len(sent_props), "acceptance_rate": _pct(len(acc_props), len(sent_props)),
        "total_value": _r(sum(float(p.total_value or 0) for p in sent_props)), "accepted_value": _r(sum(float(p.total_value or 0) for p in acc_props)),
        "awaiting_value": _r(sum(float(p.total_value or 0) for p in awaiting)),
        "by_status": _as_list(prop_g, ["Draft", "Sent", "Demo Requested", "Accepted", "Rejected"]),
        "sent_this_month": cur["proposals_sent"],
        "recent": [{"id": p.id, "title": p.title, "status": p.status, "value": _r(p.total_value or 0), "client": d.client_names.get(p.client_id), "created_at": _iso(p.created_at)}
                   for p in sorted(props, key=lambda p: _n(p.created_at) or datetime.min, reverse=True)[:6]],
    }
    negotiation_block = {
        "in_negotiation_stage": len(negotiating_stage), "in_negotiation_value": _r(sum(float(x.value or 0) for x in negotiating_stage)),
        "active_rounds": len(active_neg), "total_rounds": len(d.negotiations),
        "avg_rounds_per_deal": round(len(d.negotiations) / max(1, len(neg_by_deal)), 1) if neg_by_deal else 0,
        "avg_discount_pct": round(sum(disc) / len(disc), 1) if disc else 0,
        "accepted": sum(1 for n in d.negotiations if (n.status or "") == "Accepted"),
        "rejected": sum(1 for n in d.negotiations if (n.status or "") == "Rejected"),
        "deals": [{"id": x.id, "title": x.title, "value": _r(x.value or 0), "rounds": len(r), "last_price": _r(r[-1].price), "last_status": r[-1].status,
                   "client": d.client_names.get(x.client_id)} for x, r in active_neg[:6]],
        "recent": [{"deal_id": n.deal_id, "deal": deal_by_id[n.deal_id].title if n.deal_id in deal_by_id else f"Deal #{n.deal_id}", "round": n.round_no, "party": n.party,
                    "price": _r(n.price), "discount_pct": n.discount_pct, "status": n.status, "author": n.author_name, "created_at": _iso(n.created_at)} for n in recent_neg],
    }

    # ── quotes / orders / invoices ──────────────────────────────────────────
    inv_g = _group(d.invoices, lambda i: i.status or "Draft", lambda i: i.total)
    overdue_inv = []
    for i in d.invoices:
        st = (i.status or "").lower()
        dd = _to_date(i.due_date)
        if st == "overdue" or (st in ("sent", "partial") and dd and dd < today):
            overdue_inv.append(i)
    outstanding = [i for i in d.invoices if (i.status or "").lower() not in ("paid", "draft", "cancelled", "void")]
    billing_block = {
        "quotes": {"total": len(d.quotes), "value": _r(sum(q.grand_total or 0 for q in d.quotes)), "by_status": _as_list(_group(d.quotes, lambda q: q.status, lambda q: q.grand_total), ["Draft", "Sent", "Accepted", "Rejected", "Expired"])},
        "sales_orders": {"total": len(d.sales_orders), "value": _r(sum(o.grand_total or 0 for o in d.sales_orders)), "by_status": _as_list(_group(d.sales_orders, lambda o: o.status, lambda o: o.grand_total))},
        "purchase_orders": {"total": len(d.purchase_orders), "value": _r(sum(o.grand_total or 0 for o in d.purchase_orders)), "by_status": _as_list(_group(d.purchase_orders, lambda o: o.status, lambda o: o.grand_total))},
        "invoices": {
            "total": len(d.invoices), "value": _r(sum(i.total or 0 for i in d.invoices)),
            "paid_value": _r(sum(i.total or 0 for i in d.invoices if (i.status or "").lower() == "paid")),
            "outstanding_value": _r(sum(i.total or 0 for i in outstanding)), "outstanding_count": len(outstanding),
            "overdue_value": _r(sum(i.total or 0 for i in overdue_inv)), "overdue_count": len(overdue_inv),
            "by_status": _as_list(inv_g, ["Draft", "Sent", "Partial", "Paid", "Overdue"]),
            "collection_rate": _pct(sum(i.total or 0 for i in d.invoices if (i.status or "").lower() == "paid"), sum(i.total or 0 for i in d.invoices if (i.status or "").lower() != "draft")),
        },
    }

    # ── tasks / follow-ups / meetings / calls / emails ──────────────────────
    t_open = [t for t in d.tasks if (t.status or "").lower() not in ("done", "completed")]
    t_over = [t for t in t_open if _to_date(t.due_date) and _to_date(t.due_date) < today]
    t_today = [t for t in t_open if _to_date(t.due_date) == today]
    tasks_block = {
        "total": len(d.tasks), "open": len(t_open), "overdue": len(t_over), "due_today": len(t_today),
        "high_priority_open": sum(1 for t in t_open if (t.priority or "").lower() in ("high", "urgent")),
        "by_status": _as_list(_group(d.tasks, lambda t: t.status), ["Todo", "InProgress", "Done"]),
        "by_priority": _as_list(_group(t_open, lambda t: t.priority), ["Urgent", "High", "Medium", "Low"]),
        "completion_rate": _pct(len(d.tasks) - len(t_open), len(d.tasks)),
        "next": [{"id": t.id, "title": t.title, "priority": t.priority, "status": t.status, "due_date": _to_date(t.due_date).isoformat() if _to_date(t.due_date) else None,
                  "assignee": d.uname(int(t.assigned_to)) if str(t.assigned_to).isdigit() else None}
                 for t in sorted(t_open, key=lambda t: (_to_date(t.due_date) or date.max))[:6]],
    }
    f_pending = [f for f in d.followups if (f.status or "") == "Pending"]
    f_over = [f for f in f_pending if f.due_at and _n(f.due_at) < now]
    f_today = [f for f in f_pending if f.due_at and _n(f.due_at).date() == today and _n(f.due_at) >= now]
    followup_block = {
        "pending": len(f_pending), "overdue": len(f_over), "due_today": len(f_today),
        "completed": sum(1 for f in d.followups if (f.status or "") == "Completed"), "total": len(d.followups),
        "by_channel": _as_list(_group(f_pending, lambda f: f.channel)),
        "next": [{"id": f.id, "title": f.title, "channel": f.channel, "priority": f.priority, "due_at": _iso(f.due_at), "overdue": bool(f.due_at and _n(f.due_at) < now)}
                 for f in sorted(f_pending, key=lambda f: _n(f.due_at) or datetime.max)[:6]],
    }
    soon = now + timedelta(days=7)
    m_up = [m for m in d.meetings if (m.status or "") == "Scheduled" and m.scheduled_at and now <= _n(m.scheduled_at) <= soon]
    meeting_block = {
        "total": len(d.meetings), "upcoming_7d": len(m_up),
        "today": sum(1 for m in d.meetings if (m.status or "") == "Scheduled" and m.scheduled_at and _n(m.scheduled_at).date() == today),
        "completed": sum(1 for m in d.meetings if (m.status or "") == "Completed"),
        "cancelled": sum(1 for m in d.meetings if (m.status or "") == "Cancelled"),
        "no_show": sum(1 for m in d.meetings if (m.status or "") == "No-show"),
        "next": [{"id": m.id, "title": m.title, "type": m.meeting_type, "scheduled_at": _iso(m.scheduled_at), "location": m.location}
                 for m in sorted(m_up, key=lambda m: _n(m.scheduled_at))[:6]],
    }
    labels, act_s, mail_s, call_s, meet_s = [], [], [], [], []
    for i in range(6, -1, -1):
        day = (now - timedelta(days=i)).date()
        labels.append(day.strftime("%a %d"))
        act_s.append(sum(1 for a in d.activities if a.createdAt and _n(a.createdAt).date() == day))
        mail_s.append(sum(1 for e in d.emails if e.sent_at and _n(e.sent_at).date() == day))
        call_s.append(sum(1 for c in d.calls if c.createdAt and _n(c.createdAt).date() == day))
        meet_s.append(sum(1 for m in d.meetings if m.scheduled_at and _n(m.scheduled_at).date() == day))
    cut30 = now - timedelta(days=30)
    comms_block = {
        "labels": labels, "activities": act_s, "emails": mail_s, "calls": call_s, "meetings": meet_s,
        "emails_total": len(d.emails), "emails_30d": sum(1 for e in d.emails if e.sent_at and _n(e.sent_at) >= cut30),
        "emails_manual": sum(1 for e in d.emails if e.manual), "emails_auto": sum(1 for e in d.emails if not e.manual),
        "calls_total": len(d.calls), "calls_30d": sum(1 for c in d.calls if c.createdAt and _n(c.createdAt) >= cut30),
        "calls_followup_needed": sum(1 for c in d.calls if c.followup_needed),
        "avg_call_minutes": round(sum((c.duration_seconds or 0) for c in d.calls) / max(1, len(d.calls)) / 60, 1),
    }

    # ── projects / inventory ────────────────────────────────────────────────
    proj_g = _group(d.projects, lambda p: p.status)
    project_block = {
        "total": len(d.projects), "avg_progress": round(sum(p.progress or 0 for p in d.projects) / max(1, len(d.projects))),
        "by_status": _as_list(proj_g, ["Planning", "Active", "Completed", "Hold"]),
        "active": [{"id": p.id, "name": p.name, "status": p.status, "progress": p.progress or 0} for p in sorted([p for p in d.projects if (p.status or "").lower() in ("active", "in progress")], key=lambda p: p.progress or 0)[:6]],
    }
    low_stock = [i for i in d.inventory if (i.min_stock or 0) > 0 and (i.current_stock or 0) <= (i.min_stock or 0)]
    inventory_block = {
        "total": len(d.inventory), "low_stock": len(low_stock),
        "items": [{"id": i.id, "name": i.name, "code": i.code, "stock": i.current_stock, "min": i.min_stock} for i in sorted(low_stock, key=lambda i: (i.current_stock or 0))[:6]],
    }

    # ── team performance ────────────────────────────────────────────────────
    uids = {l.owner_id for l in leads if l.owner_id} | {x.assigned_to for x in deals if x.assigned_to}
    team = []
    for uid in uids:
        ul = [l for l in leads if l.owner_id == uid]
        ud = [x for x in deals if x.assigned_to == uid]
        uw = [x for x in ud if x.stage == "Closed Won"]
        ulost = [x for x in ud if x.stage == "Closed Lost"]
        uo = [x for x in ud if x.stage not in ("Closed Won", "Closed Lost")]
        team.append({
            "user_id": uid, "name": d.uname(uid), "leads": len(ul), "converted": sum(1 for l in ul if _is_converted(l)),
            "conversion_rate": _pct(sum(1 for l in ul if _is_converted(l)), len(ul)),
            "open_deals": len(uo), "pipeline_value": _r(sum(float(x.value or 0) for x in uo)),
            "won_deals": len(uw), "won_revenue": _r(sum(_deal_amount(x) for x in uw)), "win_rate": _pct(len(uw), len(uw) + len(ulost)),
            "overdue_followups": sum(1 for f in f_over if f.owner_id == uid),
            "open_tasks": sum(1 for t in t_open if str(t.assigned_to) == str(uid)),
        })
    team.sort(key=lambda r: (-r["won_revenue"], -r["pipeline_value"]))

    # ── costs (admin only) ──────────────────────────────────────────────────
    cost_block = None
    if is_admin:
        recurring = [c for c in d.costs if c.is_recurring]
        cost_block = {
            "period_total": _r(period_cost), "this_month": _r(cur["costs"]), "last_month": _r(prev["costs"]) if prev else 0,
            "monthly_burn": _r(sum(c.amount or 0 for c in recurring)),
            "salary_total": _r(cost_by_cat.get("Salary", 0)),
            "by_category": [{"name": k, "value": _r(v)} for k, v in sorted(cost_by_cat.items(), key=lambda kv: -kv[1])],
            "net_profit": _r(period_rev - period_cost), "margin_pct": round((period_rev - period_cost) / period_rev * 100, 1) if period_rev else None,
        }

    # ── attention list ──────────────────────────────────────────────────────
    attention: List[Dict[str, Any]] = []

    def alert(key, label, count, severity, href, detail=""):
        if count:
            attention.append({"key": key, "label": label, "count": count, "severity": severity, "href": href, "detail": detail})

    alert("overdue_invoices", "Overdue invoices", billing_block["invoices"]["overdue_count"], "high", "/billing", f"{_r(billing_block['invoices']['overdue_value'], 0):,.0f} outstanding")
    alert("overdue_followups", "Overdue follow-ups", followup_block["overdue"], "high", "/follow-ups")
    alert("overdue_tasks", "Overdue tasks", tasks_block["overdue"], "high", "/tasks")
    alert("deals_closing", "Deals closing ≤ 14 days", len([c for c in closing_soon if c["days"] >= 0]), "medium", "/pipeline")
    alert("stale_leads", "Stale leads (14d+ no progress)", len(stale), "medium", "/leads")
    alert("unassigned_leads", "Leads with no owner", len(unassigned_owner), "medium", "/leads")
    alert("awaiting_proposals", "Proposals awaiting reply", len(awaiting), "medium", "/proposals")
    alert("active_negotiations", "Negotiations in progress", len(active_neg), "info", "/pipeline")
    alert("low_stock", "Low-stock items", len(low_stock), "medium", "/inventory")
    alert("meetings_today", "Meetings today", meeting_block["today"], "info", "/meetings")

    kpis = {
        "won_revenue": _r(won_rev), "period_revenue": _r(period_rev), "period_costs": _r(period_cost) if is_admin else None,
        "net_profit": _r(period_rev - period_cost) if is_admin else None,
        "margin_pct": round((period_rev - period_cost) / period_rev * 100, 1) if (is_admin and period_rev) else None,
        "revenue_this_month": cur["won_revenue"], "revenue_last_month": prev["won_revenue"] if prev else 0,
        "revenue_change_pct": _chg(cur["won_revenue"], prev["won_revenue"]) if prev else None,
        "pipeline_value": _r(pipeline_value), "weighted_forecast": _r(weighted),
        "open_deals": len(open_deals), "won_deals": len(won), "lost_deals": len(lost), "total_deals": len(deals),
        "win_rate": _pct(len(won), len(won) + len(lost)), "avg_deal_size": _r(won_rev / len(won)) if won else 0.0,
        "avg_sales_cycle_days": round(sum(cycles) / len(cycles), 1) if cycles else None,
        "total_leads": len(leads), "lead_conversion_rate": lead_block["conversion_rate"],
        "leads_this_month": cur["leads"], "leads_change_pct": lead_block["change_pct"],
        "total_clients": len(clients), "active_clients": client_block["active"],
        "proposals_sent": len(sent_props), "proposals_accepted": len(acc_props), "proposal_acceptance_rate": proposal_block["acceptance_rate"],
        "in_negotiation": len(negotiating_stage), "in_negotiation_value": negotiation_block["in_negotiation_value"],
        "outstanding_invoices": billing_block["invoices"]["outstanding_value"], "overdue_invoices": billing_block["invoices"]["overdue_value"],
        "open_tasks": len(t_open), "overdue_tasks": len(t_over),
        "pending_followups": len(f_pending), "overdue_followups": len(f_over),
        "meetings_upcoming": len(m_up), "emails_30d": comms_block["emails_30d"], "calls_30d": comms_block["calls_30d"],
    }

    return {
        "generated_at": now.isoformat(), "months": months, "scope": "all" if is_admin else "mine",
        "role": d.sc.role, "can_see_finance": is_admin,
        "kpis": kpis, "attention": attention, "series": ser,
        "pipeline": {"by_stage": by_stage, "closing_soon": closing_soon[:6], "top_open": top_open_rows, "open_value": _r(pipeline_value), "weighted": _r(weighted)},
        "leads": lead_block, "lead_sources": sources_block, "clients": client_block,
        "proposals": proposal_block, "negotiations": negotiation_block, "billing": billing_block,
        "tasks": tasks_block, "followups": followup_block, "meetings": meeting_block, "comms": comms_block,
        "projects": project_block, "inventory": inventory_block, "team": team, "costs": cost_block,
    }


@router.get("/command-center/overview")
def command_center_overview(months: int = Query(6, ge=3, le=24), session: Session = Depends(get_session)):
    sc = _scope(session)
    return build_overview(Data(session, sc), months)


def build_executive_dossier(d: Data, start_str: Optional[str] = None, end_str: Optional[str] = None, months: int = 12) -> Dict[str, Any]:
    now = datetime.utcnow()
    today = now.date()
    is_admin = d.sc.is_admin

    start = _to_date(start_str)
    end = _to_date(end_str)

    def in_range(dt: Any) -> bool:
        if not dt:
            return not (start or end)
        n = _n(dt)
        if not n:
            return not (start or end)
        return (not start or n.date() >= start) and (not end or n.date() <= end)

    users_list = list(d.users.values())
    staff_users = [u for u in users_list if (u.role or "").strip().lower() in ("admin", "superadmin", "salesmanager", "employee", "intern")]
    if not staff_users:
        staff_users = users_list

    leads = d.leads
    deals = d.deals
    clients = d.all_clients
    tasks = d.tasks
    followups = d.followups
    meetings = d.meetings
    calls = d.calls
    emails = d.emails
    activities = d.activities

    in_14_days = today + timedelta(days=14)

    reps_data = []
    for u in staff_users:
        uid = u.id
        uname = u.name or u.email

        rep_leads_all = [l for l in leads if l.owner_id == uid]
        rep_leads_period = [l for l in rep_leads_all if in_range(l.created_at)]
        rep_leads_active = [l for l in rep_leads_all if not _is_converted(l) and (l.status or "").lower() not in ("negative", "lost", "archived")]
        rep_converted_period = [l for l in rep_leads_period if _is_converted(l)]

        rep_clients_all = [c for c in clients if c.assignedEmployeeId == uid or any(l.converted_client_id == c.id for l in rep_leads_all if l.converted_client_id)]
        rep_clients_active = [c for c in rep_clients_all if (c.status or "").lower() == "active"]

        rep_deals_all = [x for x in deals if x.assigned_to == uid]
        rep_deals_period = [x for x in rep_deals_all if in_range(x.created_at or x.won_at)]
        rep_won_period = [x for x in rep_deals_period if x.stage == "Closed Won"]
        rep_lost_period = [x for x in rep_deals_period if x.stage == "Closed Lost"]
        rep_open_deals = [x for x in rep_deals_all if x.stage not in ("Closed Won", "Closed Lost")]
        rep_pipeline_val = sum(float(x.value or 0) for x in rep_open_deals)
        rep_won_rev = sum(_deal_amount(x) for x in rep_won_period)

        rep_open_tasks = [t for t in tasks if str(t.assigned_to) == str(uid) and (t.status or "").lower() not in ("done", "completed")]
        rep_overdue_tasks = [t for t in rep_open_tasks if _to_date(t.due_date) and _to_date(t.due_date) < today]
        
        rep_pending_followups = [f for f in followups if f.owner_id == uid and (f.status or "") == "Pending"]
        rep_overdue_followups = [f for f in rep_pending_followups if f.due_at and _n(f.due_at) < now]
        
        rep_acts = [a for a in activities if a.userId == uid]
        last_act = sorted(rep_acts, key=lambda a: _n(a.createdAt) or datetime.min, reverse=True)[0] if rep_acts else None

        rep_meetings_up = [
            {"id": m.id, "title": m.title, "type": m.meeting_type, "scheduled_at": _iso(m.scheduled_at), "location": m.location}
            for m in sorted([m for m in meetings if m.host_id == uid and (m.status or "") == "Scheduled" and m.scheduled_at and _n(m.scheduled_at) >= now and _n(m.scheduled_at).date() <= in_14_days], key=lambda m: _n(m.scheduled_at))[:5]
        ]
        sorted_next_fu = sorted([f for f in rep_pending_followups if f.due_at and _n(f.due_at) >= now], key=lambda f: _n(f.due_at))
        next_fu_item = {
            "id": sorted_next_fu[0].id, "title": sorted_next_fu[0].title, "due_at": _iso(sorted_next_fu[0].due_at), "channel": sorted_next_fu[0].channel, "priority": sorted_next_fu[0].priority,
        } if sorted_next_fu else None

        rep_closing_soon = [
            {"id": x.id, "title": x.title, "stage": x.stage, "value": _r(x.value or 0), "close_date": _to_date(x.expected_close_date).isoformat() if _to_date(x.expected_close_date) else None, "client": d.client_names.get(x.client_id)}
            for x in rep_open_deals if _to_date(x.expected_close_date) and today <= _to_date(x.expected_close_date) <= in_14_days
        ]

        rep_negotiating = [
            {"id": x.id, "title": x.title, "value": _r(x.value or 0), "client": d.client_names.get(x.client_id)}
            for x in rep_open_deals if x.stage == "Negotiation"
        ]

        calls_cnt = sum(1 for c in calls if str(c.assigned_to) == str(uid) or c.assigned_to == uname)
        emails_cnt = sum(1 for e in emails if e.lead_id in {l.id for l in rep_leads_all})

        closed_cnt = len(rep_won_period) + len(rep_lost_period)
        win_rate = _pct(len(rep_won_period), closed_cnt) if closed_cnt else 0.0
        leads_total_eval = len(rep_leads_period) or len(rep_leads_all)
        conv_eval = len(rep_converted_period) or sum(1 for l in rep_leads_all if _is_converted(l))
        conv_rate = _pct(conv_eval, leads_total_eval) if leads_total_eval else 0.0

        reps_data.append({
            "id": uid,
            "user_id": uid,
            "name": uname,
            "email": u.email,
            "role": u.role,
            "active_leads": len(rep_leads_active),
            "active_clients": len(rep_clients_active),
            "open_deals": len(rep_open_deals),
            "open_pipeline_value": _r(rep_pipeline_val),
            "open_tasks": len(rep_open_tasks),
            "overdue_tasks": len(rep_overdue_tasks),
            "pending_followups": len(rep_pending_followups),
            "overdue_followups": len(rep_overdue_followups),
            "last_active_at": _iso(last_act.createdAt) if last_act else None,
            "last_action": last_act.action if last_act else None,
            "upcoming_meetings": rep_meetings_up,
            "next_followup": next_fu_item,
            "closing_soon_deals": rep_closing_soon,
            "in_negotiation_deals": rep_negotiating,
            "total_leads_handled": len(rep_leads_all),
            "converted_leads": conv_eval,
            "conversion_rate": conv_rate,
            "total_clients_handled": len(rep_clients_all),
            "total_deals_handled": len(rep_deals_all),
            "won_deals": len(rep_won_period),
            "won_revenue": _r(rep_won_rev),
            "lost_deals": len(rep_lost_period),
            "win_rate": win_rate,
            "avg_deal_size": _r(rep_won_rev / len(rep_won_period)) if rep_won_period else 0.0,
            "activities_count": len(rep_acts),
            "calls_count": calls_cnt,
            "emails_count": emails_cnt,
            "live": {
                "active_leads_count": len(rep_leads_active),
                "active_clients_count": len(rep_clients_active),
                "open_deals_count": len(rep_open_deals),
                "open_pipeline_value": _r(rep_pipeline_val),
                "pending_followups_count": len(rep_pending_followups),
                "open_tasks_count": len(rep_open_tasks),
                "overdue_tasks_count": len(rep_overdue_tasks),
                "overdue_followups_count": len(rep_overdue_followups),
            },
            "future": {
                "upcoming_meetings_count": len(rep_meetings_up),
                "next_actions_queued": 1 if next_fu_item else 0,
                "deals_closing_soon_value": sum(x["value"] for x in rep_closing_soon),
                "deals_closing_soon_count": len(rep_closing_soon),
                "in_negotiation_count": len(rep_negotiating),
            },
            "results": {
                "won_revenue": _r(rep_won_rev),
                "win_rate": win_rate,
                "lead_conversion_rate": conv_rate,
                "won_deals_count": len(rep_won_period),
                "deals_closed_total": closed_cnt,
                "total_leads_handled": len(rep_leads_all),
                "total_clients_handled": len(rep_clients_all),
                "total_deals_handled": len(rep_deals_all),
                "avg_deal_size": _r(rep_won_rev / len(rep_won_period)) if rep_won_period else 0.0,
            },
        })

    reps_data.sort(key=lambda r: (-r["won_revenue"], -r["open_pipeline_value"]))

    engine = SourceEngine(d, start_str, end_str, months)
    src_summary = engine.summary()

    mkeys = _month_range(months)
    costs_by_cat: Dict[str, float] = defaultdict(float)
    total_costs_val = 0.0
    for c in d.costs:
        for mk in _cost_months(c, mkeys):
            costs_by_cat[c.category] += c.amount or 0
            total_costs_val += c.amount or 0

    won_deals_all = [x for x in deals if x.stage == "Closed Won"]
    tot_won_rev = sum(_deal_amount(x) for x in won_deals_all)
    tot_pipeline_val = sum(float(x.value or 0) for x in deals if x.stage not in ("Closed Won", "Closed Lost"))

    stage_map = defaultdict(lambda: {"count": 0, "value": 0.0})
    for x in deals:
        stage_map[x.stage]["count"] += 1
        stage_map[x.stage]["value"] += _deal_amount(x) if x.stage == "Closed Won" else float(x.value or 0)

    stages_report = [
        {"stage": s, "count": stage_map[s]["count"], "value": _r(stage_map[s]["value"]), "probability": int(STAGE_PROB.get(s, 0.2) * 100), "weighted": _r(stage_map[s]["value"] * STAGE_PROB.get(s, 0.2))}
        for s in DEAL_STAGES
    ]

    exec_kpis = {
        "won_revenue": _r(tot_won_rev),
        "pipeline_value": _r(tot_pipeline_val),
        "total_costs": _r(total_costs_val) if is_admin else 0.0,
        "net_profit": _r(tot_won_rev - total_costs_val) if is_admin else 0.0,
        "margin_pct": round((tot_won_rev - total_costs_val) / tot_won_rev * 100, 1) if (is_admin and tot_won_rev) else 0.0,
        "total_leads": len(leads),
        "converted_leads": sum(1 for l in leads if _is_converted(l)),
        "conversion_rate": _pct(sum(1 for l in leads if _is_converted(l)), len(leads)),
        "total_clients": len(clients),
        "active_clients": sum(1 for c in clients if (c.status or "").lower() == "active"),
        "total_deals": len(deals),
        "won_deals": len(won_deals_all),
        "won_deals_count": len(won_deals_all),
        "open_deals_count": len([x for x in deals if x.stage not in ("Closed Won", "Closed Lost")]),
        "win_rate": _pct(len(won_deals_all), len(won_deals_all) + sum(1 for x in deals if x.stage == "Closed Lost")),
        "avg_deal_size": _r(tot_won_rev / len(won_deals_all)) if won_deals_all else 0.0,
        "active_reps": len([r for r in reps_data if r["active_leads"] > 0 or r["open_deals"] > 0 or r["won_deals"] > 0]) or len(staff_users),
        "active_sales_reps": len([r for r in reps_data if r["active_leads"] > 0 or r["open_deals"] > 0 or r["won_deals"] > 0]) or len(staff_users),
        "total_staff": len(staff_users),
    }

    return {
        "generated_at": now.isoformat(),
        "range": {"start": start_str, "end": end_str, "months": months},
        "kpis": exec_kpis,
        "summary": exec_kpis,
        "reps": reps_data,
        "sales_reps": reps_data,
        "deal_stages": stages_report,
        "lead_sources": src_summary["sources"],
        "lead_source_totals": src_summary["totals"],
        "lead_source_highlights": src_summary["highlights"],
        "cost_categories": [{"name": k, "value": _r(v), "pct": _pct(v, total_costs_val)} for k, v in sorted(costs_by_cat.items(), key=lambda kv: -kv[1])] if is_admin else [],
        "financials": {
            "won_revenue": _r(tot_won_rev),
            "pipeline_value": _r(tot_pipeline_val),
            "total_costs": _r(total_costs_val) if is_admin else 0.0,
            "net_profit": _r(tot_won_rev - total_costs_val) if is_admin else 0.0,
            "margin_pct": round((tot_won_rev - total_costs_val) / tot_won_rev * 100, 1) if (is_admin and tot_won_rev) else 0.0,
            "cost_breakdown": [{"name": k, "value": _r(v), "pct": _pct(v, total_costs_val)} for k, v in sorted(costs_by_cat.items(), key=lambda kv: -kv[1])] if is_admin else [],
            "monthly_trend": src_summary["trend"],
        },
        "monthly_trend": src_summary["trend"],
        "can_see_finance": is_admin,
    }


@router.get("/reports/executive-dossier")
def get_executive_dossier(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    months: int = Query(12, ge=1, le=36),
    session: Session = Depends(get_session),
):
    sc = _scope(session)
    return build_executive_dossier(Data(session, sc), start_date, end_date, months)

