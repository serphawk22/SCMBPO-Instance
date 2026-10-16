from __future__ import annotations

import os
import json
import re
from typing import Optional, List, Dict, Any
from datetime import datetime, date, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Header
from pydantic import BaseModel
from sqlmodel import Session, select

from database import get_session, User, Lead, Deal, ClientProfile, Invoice, Meeting, CallLog, FollowUp, CRMQuote, Proposal

router = APIRouter(prefix="/reports/ai", tags=["AI Reports"])


class AIReportRequest(BaseModel):
    prompt: str
    time_range: Optional[str] = "12m"  # "all", "12m", "6m", "30d", "7d", "this_month", "custom"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    rep_id: Optional[int] = None
    currency: Optional[str] = "INR"


def _parse_iso(dt_val: Any) -> Optional[datetime]:
    if not dt_val:
        return None
    if isinstance(dt_val, datetime):
        return dt_val
    if isinstance(dt_val, date):
        return datetime.combine(dt_val, datetime.min.time())
    try:
        clean = str(dt_val).replace("Z", "+00:00")
        return datetime.fromisoformat(clean)
    except Exception:
        return None


def _format_money(amount: float, currency: str = "INR") -> str:
    amount = float(amount or 0.0)
    if currency == "USD":
        usd = amount / 83.5
        return f"${usd:,.0f}"
    return f"₹{amount:,.0f}"


def _get_crm_snapshot(session: Session, start_date_str: Optional[str] = None, end_date_str: Optional[str] = None):
    now = datetime.now()
    start_dt = None
    end_dt = None

    if start_date_str:
        try:
            start_dt = datetime.fromisoformat(start_date_str)
        except Exception:
            pass
    if end_date_str:
        try:
            end_dt = datetime.fromisoformat(end_date_str) + timedelta(days=1)
        except Exception:
            pass

    def in_range(dt: Any) -> bool:
        if not dt:
            return True
        p = _parse_iso(dt)
        if not p:
            return True
        if p.tzinfo is not None:
            p = p.astimezone(timezone.utc).replace(tzinfo=None)
        if start_dt and p < start_dt:
            return False
        if end_dt and p > end_dt:
            return False
        return True

    # Pull all CRM entities
    all_users = session.exec(select(User)).all()
    all_leads = session.exec(select(Lead)).all()
    all_deals = session.exec(select(Deal)).all()
    all_clients = session.exec(select(ClientProfile)).all()
    all_invoices = session.exec(select(Invoice)).all()
    all_meetings = session.exec(select(Meeting)).all()
    all_calls = session.exec(select(CallLog)).all()
    all_followups = session.exec(select(FollowUp)).all()

    staff_roles = {"Admin", "SuperAdmin", "SalesManager", "Employee", "Sales", "Demo"}
    staff_users = [u for u in all_users if u.role in staff_roles]

    # Map rep performance
    rep_stats: List[Dict[str, Any]] = []

    total_leads_all = len(all_leads)
    converted_leads_all = sum(1 for l in all_leads if getattr(l, "is_converted", False) or (l.status or "").lower() == "converted")
    
    macro_won_rev = 0.0
    macro_pipeline = 0.0
    macro_won_deals = 0
    macro_lost_deals = 0

    for u in staff_users:
        uid = u.id
        uname = u.name or u.email

        # Leads
        u_leads = [l for l in all_leads if l.owner_id == uid]
        u_leads_period = [l for l in u_leads if in_range(l.created_at)]
        u_converted = [l for l in u_leads_period if getattr(l, "is_converted", False) or (l.status or "").lower() == "converted"]
        conv_rate = round((len(u_converted) / len(u_leads_period) * 100), 1) if u_leads_period else 0.0

        # Deals
        u_deals = [d for d in all_deals if d.assigned_to == uid]
        u_won_deals = [d for d in u_deals if (d.stage or "").strip().lower() in ["closed won", "won"] and in_range(getattr(d, "won_at", None) or d.updated_at or d.created_at)]
        u_lost_deals = [d for d in u_deals if (d.stage or "").strip().lower() in ["closed lost", "lost"] and in_range(d.updated_at or d.created_at)]
        u_open_deals = [d for d in u_deals if (d.stage or "").strip().lower() not in ["closed won", "won", "closed lost", "lost"]]

        won_revenue = sum(float(getattr(d, "final_value", None) or d.value or 0.0) for d in u_won_deals)
        pipeline_value = sum(float(getattr(d, "final_value", None) or d.value or 0.0) for d in u_open_deals)
        closed_total = len(u_won_deals) + len(u_lost_deals)
        closure_rate = round((len(u_won_deals) / closed_total * 100), 1) if closed_total > 0 else 0.0
        avg_deal_size = round(won_revenue / len(u_won_deals), 1) if u_won_deals else 0.0

        macro_won_rev += won_revenue
        macro_pipeline += pipeline_value
        macro_won_deals += len(u_won_deals)
        macro_lost_deals += len(u_lost_deals)

        # Clients
        u_clients = [c for c in all_clients if c.assignedEmployeeId == uid]

        # Activity
        u_calls = [c for c in all_calls if (str(c.assigned_to) == str(uid) or c.assigned_to == uname) and in_range(getattr(c, "createdAt", None) or getattr(c, "received_at", None))]
        u_meetings = [m for m in all_meetings if m.host_id == uid and in_range(m.scheduled_at)]
        u_followups = [f for f in all_followups if (f.owner_id == uid or f.created_by == uid) and in_range(f.due_at or f.created_at)]

        rep_stats.append({
            "id": uid,
            "name": uname,
            "email": u.email,
            "role": u.role,
            "total_leads": len(u_leads_period) or len(u_leads),
            "converted_leads": len(u_converted),
            "lead_conversion_rate": conv_rate,
            "total_deals": len(u_deals),
            "won_deals": len(u_won_deals),
            "lost_deals": len(u_lost_deals),
            "open_deals": len(u_open_deals),
            "deal_closure_rate": closure_rate,
            "won_revenue": won_revenue,
            "pipeline_value": pipeline_value,
            "avg_deal_size": avg_deal_size,
            "clients_count": len(u_clients),
            "calls_count": len(u_calls),
            "meetings_count": len(u_meetings),
            "followups_count": len(u_followups),
        })

    # Sort reps by won revenue descending
    rep_stats.sort(key=lambda r: (r["won_revenue"], r["deal_closure_rate"]), reverse=True)

    macro_closed = macro_won_deals + macro_lost_deals
    overall_closure_rate = round((macro_won_deals / macro_closed * 100), 1) if macro_closed > 0 else 0.0
    overall_conv_rate = round((converted_leads_all / total_leads_all * 100), 1) if total_leads_all > 0 else 0.0

    macro_summary = {
        "total_reps": len(staff_users),
        "total_leads": total_leads_all,
        "converted_leads": converted_leads_all,
        "overall_lead_conversion_rate": overall_conv_rate,
        "total_won_revenue": macro_won_rev,
        "total_pipeline_value": macro_pipeline,
        "total_won_deals": macro_won_deals,
        "total_lost_deals": macro_lost_deals,
        "overall_deal_closure_rate": overall_closure_rate,
        "total_clients": len(all_clients),
        "total_meetings": len(all_meetings),
        "total_calls": len(all_calls),
        "total_followups": len(all_followups),
    }

    return {
        "macro": macro_summary,
        "reps": rep_stats,
        "all_users": [{"id": u.id, "name": u.name or u.email, "role": u.role} for u in staff_users],
    }


def _detect_mentioned_reps(prompt: str, rep_id: Optional[int], reps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Detect all sales reps referenced in the prompt, or matching rep_id."""
    if rep_id:
        for r in reps:
            if r["id"] == rep_id:
                return [r]

    p_lower = prompt.lower()
    found: List[Dict[str, Any]] = []
    for r in reps:
        full_name = r["name"].lower()
        if full_name in p_lower:
            if r not in found:
                found.append(r)
            continue
        # Match by distinct first name / name tokens (>= 3 chars)
        tokens = [t for t in full_name.split() if len(t) >= 3]
        for t in tokens:
            if re.search(r'\b' + re.escape(t) + r'\b', p_lower):
                if r not in found:
                    found.append(r)
                break
    return found


def _generate_deterministic_report(prompt: str, snapshot: Dict[str, Any], target_reps: List[Dict[str, Any]], currency: str = "INR") -> Dict[str, Any]:
    all_reps = snapshot["reps"]
    macro = snapshot["macro"]
    p_lower = prompt.lower()

    # Determine cohort
    is_head_to_head = len(target_reps) >= 2
    is_single_rep_audit = len(target_reps) == 1 and not any(k in p_lower for k in ["compare", "vs", "versus", "benchmark", "ranking", "team"])
    
    if is_head_to_head or is_single_rep_audit:
        eval_reps = target_reps
    else:
        eval_reps = all_reps

    if not eval_reps:
        eval_reps = all_reps

    # Sort cohort by won revenue descending, then closure rate
    eval_reps = sorted(eval_reps, key=lambda r: (r["won_revenue"], r["deal_closure_rate"]), reverse=True)

    # Key benchmarks
    top_closer = max(eval_reps, key=lambda r: r["deal_closure_rate"]) if eval_reps else None
    top_revenue = max(eval_reps, key=lambda r: r["won_revenue"]) if eval_reps else None
    top_converter = max(eval_reps, key=lambda r: r["lead_conversion_rate"]) if eval_reps else None

    # Calculate business owner metrics
    cohort_won_rev = sum(r["won_revenue"] for r in eval_reps)
    cohort_pipeline = sum(r["pipeline_value"] for r in eval_reps)
    cohort_won_deals = sum(r["won_deals"] for r in eval_reps)
    cohort_lost_deals = sum(r["lost_deals"] for r in eval_reps)
    cohort_closed_deals = cohort_won_deals + cohort_lost_deals
    cohort_closure_rate = round((cohort_won_deals / cohort_closed_deals * 100), 1) if cohort_closed_deals > 0 else 0.0
    
    avg_team_deal_size = round(cohort_won_rev / cohort_won_deals, 1) if cohort_won_deals > 0 else 0.0
    est_lost_revenue = sum(r["lost_deals"] * (r["avg_deal_size"] or avg_team_deal_size) for r in eval_reps)

    top_rep_name = top_revenue["name"] if top_revenue else "N/A"
    top_rep_rev = top_revenue["won_revenue"] if top_revenue else 0.0
    rev_concentration_pct = round((top_rep_rev / cohort_won_rev * 100), 1) if cohort_won_rev > 0 else 0.0

    # Build comparison bars payload
    comparison_items = []
    for r in eval_reps:
        share_pct = round((r["won_revenue"] / cohort_won_rev * 100), 1) if cohort_won_rev > 0 else 0.0
        comparison_items.append({
            "id": r["id"],
            "name": r["name"],
            "role": r["role"],
            "won_revenue": r["won_revenue"],
            "won_revenue_formatted": _format_money(r["won_revenue"], currency),
            "pipeline_value": r["pipeline_value"],
            "pipeline_value_formatted": _format_money(r["pipeline_value"], currency),
            "revenue_share_pct": share_pct,
            "won_deals": r["won_deals"],
            "lost_deals": r["lost_deals"],
            "open_deals": r["open_deals"],
            "total_deals": r["won_deals"] + r["lost_deals"] + r["open_deals"],
            "closure_rate": r["deal_closure_rate"],
            "lead_conversion_rate": r["lead_conversion_rate"],
            "total_leads": r["total_leads"],
            "converted_leads": r["converted_leads"],
            "avg_deal_size": r["avg_deal_size"],
            "avg_deal_size_formatted": _format_money(r["avg_deal_size"], currency),
            "calls_count": r["calls_count"],
            "meetings_count": r["meetings_count"],
            "followups_count": r["followups_count"],
        })

    # Prepare report titles and summaries
    if is_single_rep_audit:
        rep = eval_reps[0]
        name = rep["name"]
        title = f"Business Owner Commercial Audit: {name} ({rep['role']})"
        summary = (
            f"Executive evaluation of {name} from a Business Owner & P&L perspective. "
            f"{name} has generated {_format_money(rep['won_revenue'], currency)} in booked revenue ({rep['won_deals']} deals) "
            f"with a {rep['deal_closure_rate']}% deal closure rate and {rep['lead_conversion_rate']}% lead conversion rate. "
            f"Currently maintains an active pipeline of {_format_money(rep['pipeline_value'], currency)} ({rep['open_deals']} opportunities). "
            f"Average deal size stands at {_format_money(rep['avg_deal_size'], currency)}."
        )
        report_type = "individual_rep"
    elif is_head_to_head:
        names_str = " vs ".join(r["name"] for r in eval_reps)
        title = f"Head-to-Head Sales Comparison: {names_str}"
        summary = (
            f"Comparative commercial evaluation between {names_str} for leadership decision-making. "
            f"Together they have delivered {_format_money(cohort_won_rev, currency)} in realized revenue across {cohort_won_deals} closed deals "
            f"and steward {_format_money(cohort_pipeline, currency)} in forward pipeline. "
            f"{top_rep_name} leads revenue production, while {top_closer['name'] if top_closer else 'N/A'} leads in closure efficiency ({top_closer['deal_closure_rate'] if top_closer else 0}%)."
        )
        report_type = "head_to_head"
    else:
        title = "Executive Sales Staff Commercial Performance & ROI Comparison"
        summary = (
            f"Comprehensive C-Suite audit across all {len(eval_reps)} sales representatives. "
            f"Total realized revenue stands at {_format_money(cohort_won_rev, currency)} with an active open pipeline of {_format_money(cohort_pipeline, currency)}. "
            f"Team average deal closure rate is {cohort_closure_rate}%, with {top_rep_name} contributing {rev_concentration_pct}% of total firm bookings. "
            f"Estimated lost opportunity cost across closed lost deals is {_format_money(est_lost_revenue, currency)}."
        )
        report_type = "team_comparison"

    # Business Owner KPI cards
    kpis = [
        {
            "label": "Total Booked Revenue",
            "value": _format_money(cohort_won_rev, currency),
            "sub": f"{cohort_won_deals} deals won across cohort",
            "trend": "up",
            "color": "emerald"
        },
        {
            "label": "Active Pipeline Value",
            "value": _format_money(cohort_pipeline, currency),
            "sub": f"{sum(r['open_deals'] for r in eval_reps)} open opportunities",
            "trend": "neutral",
            "color": "indigo"
        },
        {
            "label": "Deal Closure Rate (Win %)",
            "value": f"{cohort_closure_rate}%",
            "sub": f"{cohort_won_deals} won / {cohort_lost_deals} lost",
            "trend": "up" if cohort_closure_rate >= 35 else "neutral",
            "color": "blue"
        },
        {
            "label": "Avg Contract Value (ACV)",
            "value": _format_money(avg_team_deal_size, currency),
            "sub": "Average ticket per won client",
            "trend": "up",
            "color": "violet"
        },
        {
            "label": "Revenue Concentration",
            "value": f"{rev_concentration_pct}%",
            "sub": f"Attributable to {top_rep_name}",
            "trend": "neutral" if rev_concentration_pct < 50 else "down",
            "color": "amber"
        },
        {
            "label": "Lost Opportunity Cost",
            "value": _format_money(est_lost_revenue, currency),
            "sub": f"{cohort_lost_deals} lost deals leakage",
            "trend": "down",
            "color": "teal"
        },
    ]

    # Comparison Table Headers and Rows
    table_headers = [
        "Sales Representative", "Role", "Leads Assigned", "Conv. %", 
        "Won Deals", "Lost Deals", "Win Rate %", "Won Revenue", "% Rev Share", "Open Pipeline", "Avg Deal Size"
    ]
    table_rows = []
    for r in eval_reps:
        share = round((r["won_revenue"] / cohort_won_rev * 100), 1) if cohort_won_rev > 0 else 0.0
        table_rows.append([
            r["name"],
            r["role"],
            str(r["total_leads"]),
            f"{r['lead_conversion_rate']}%",
            str(r["won_deals"]),
            str(r["lost_deals"]),
            f"{r['deal_closure_rate']}%",
            _format_money(r["won_revenue"], currency),
            f"{share}%",
            _format_money(r["pipeline_value"], currency),
            _format_money(r["avg_deal_size"], currency),
        ])

    # Strategic Insights from Owner POV
    insights = [
        f"**Commercial Contribution:** {top_rep_name} is the primary commercial engine, accounting for **{_format_money(top_rep_rev, currency)} ({rev_concentration_pct}%)** of all realized sales.",
        f"**Negotiation & Win Rate:** {top_closer['name'] if top_closer else 'N/A'} holds the benchmark deal closure rate at **{top_closer['deal_closure_rate'] if top_closer else 0}%**, closing nearly 1 in every {max(1, round(100 / max(1, top_closer['deal_closure_rate'] if top_closer else 1)))} negotiated proposals.",
        f"**Sales Pipeline Reserve:** The active pipeline of **{_format_money(cohort_pipeline, currency)}** across {sum(r['open_deals'] for r in eval_reps)} in-flight deals represents a substantial revenue accelerator if closed at standard win rates.",
        f"**Funnel Leakage & Opportunity Cost:** An estimated **{_format_money(est_lost_revenue, currency)}** has leaked across {cohort_lost_deals} lost opportunities, highlighting an urgent need for executive intervention on stalled high-ticket deals.",
    ]

    # Actionable Recommendations for Business Owner
    recommendations = [
        f"Mitigate key-person dependency by pairing high-potential reps with {top_rep_name} and {top_closer['name'] if top_closer else 'senior closers'} during late-stage proposal presentations.",
        f"Prioritize the {_format_money(cohort_pipeline, currency)} open pipeline with weekly executive reviews focused on deals in 'Negotiation' and 'Proposal Sent'.",
        f"Route high-intent inbound marketing leads preferentially to reps with lead conversion rates exceeding {macro['overall_lead_conversion_rate']}%.",
        f"Conduct a post-mortem on the {_format_money(est_lost_revenue, currency)} in lost opportunities to identify pricing vs feature objections.",
    ]

    # Detailed Boardroom Markdown Report
    markdown_lines = [
        f"# 👔 Executive Commercial Performance & Sales Staff Audit",
        f"",
        f"**Document Type:** C-Suite Commercial Dossier | **Reporting Perspective:** Business Owner / P&L Leadership  ",
        f"**Generated:** {datetime.now().strftime('%B %d, %Y - %H:%M')} | **Currency:** {currency}  ",
        f"",
        f"---",
        f"",
        f"## 💼 1. Executive Summary & Bottom-Line Financial Impact",
        f"",
        f"{summary}",
        f"",
        f"- **Total Realized Cashflow / Revenue:** {_format_money(cohort_won_rev, currency)} ({cohort_won_deals} closed deals won)",
        f"- **Active Pipeline at Stake:** {_format_money(cohort_pipeline, currency)} ({sum(r['open_deals'] for r in eval_reps)} open opportunities)",
        f"- **Commercial Win Rate (Closed Deals):** {cohort_closure_rate}%",
        f"- **Average Contract Value (ACV):** {_format_money(avg_team_deal_size, currency)}",
        f"- **Revenue Concentration Index:** {rev_concentration_pct}% produced by top representative ({top_rep_name})",
        f"",
        f"---",
        f"",
        f"## 📊 2. Commercial Performance & Head-to-Head Comparison Matrix",
        f"",
        f"| Sales Representative | Role | Leads Assigned | Lead Conv. % | Deals Won | Deals Lost | Win Rate % | Won Revenue | Rev Share % | Active Pipeline | Avg Deal Size |",
        f"| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
    ]

    for r in eval_reps:
        share = round((r["won_revenue"] / cohort_won_rev * 100), 1) if cohort_won_rev > 0 else 0.0
        markdown_lines.append(
            f"| **{r['name']}** | {r['role']} | {r['total_leads']} | {r['lead_conversion_rate']}% | "
            f"{r['won_deals']} | {r['lost_deals']} | {r['deal_closure_rate']}% | "
            f"**{_format_money(r['won_revenue'], currency)}** | **{share}%** | "
            f"{_format_money(r['pipeline_value'], currency)} | {_format_money(r['avg_deal_size'], currency)} |"
        )

    markdown_lines.extend([
        f"",
        f"---",
        f"",
        f"## ⚖️ 3. Business Owner ROI & Revenue Concentration Audit",
        f"",
        f"A sustainable agency model avoids single-rep vulnerability. Key findings from an ownership standpoint:",
        f"",
        f"- **Key Person Risk:** {top_rep_name} currently generates **{rev_concentration_pct}%** of company sales. If this figure exceeds 45%, the business is vulnerable to salesperson turnover.",
        f"- **Capacity & Activity Velocity:** Representatives logged a total of {sum(r['calls_count'] for r in eval_reps)} calls, {sum(r['meetings_count'] for r in eval_reps)} meetings, and {sum(r['followups_count'] for r in eval_reps)} follow-up touches during this window.",
        f"- **Lead Progression Efficiency:** Lead-to-deal conversion ranges between {min(r['lead_conversion_rate'] for r in eval_reps)}% and {max(r['lead_conversion_rate'] for r in eval_reps)}%. High-performing reps convert at over 2x the velocity of lagging peers.",
        f"",
        f"---",
        f"",
        f"## 📉 4. Funnel Leakage & Lost Opportunity Analysis",
        f"",
        f"- **Lost Deals Count:** {cohort_lost_deals} opportunities closed as Lost.",
        f"- **Estimated Lost Revenue:** **{_format_money(est_lost_revenue, currency)}** in unrealized top-line bookings based on average deal sizing.",
        f"- **Remediation Priority:** Implementing standardized mid-funnel objection handling can recover an estimated 15-20% of lost deals, adding upwards of {_format_money(est_lost_revenue * 0.18, currency)} to annualized earnings.",
        f"",
        f"---",
        f"",
        f"## 🎯 5. Actionable Directives for Executive Leadership",
        f"",
        f"1. **Dynamic Lead Allocation:** Automatically assign highest-ticket inbound leads to closers with win rates above {cohort_closure_rate}%.",
        f"2. **Pipeline Unfreezing:** Mandate senior management check-ins on all proposals exceeding {_format_money(avg_team_deal_size * 1.5, currency)} that have been in 'Negotiation' for more than 14 days.",
        f"3. **Peer Mentorship & Playbook Distribution:** Codify the negotiation scripts and follow-up templates used by {top_closer['name'] if top_closer else 'top performers'} into a mandatory onboarding track.",
        f"4. **Quota Alignment:** Realign quarterly quotas to match active pipeline coverage (aiming for 3x pipeline-to-quota ratio per head).",
    ])

    detailed_md = "\n".join(markdown_lines)

    return {
        "report_type": report_type,
        "title": title,
        "summary": summary,
        "target_reps": [{"id": r["id"], "name": r["name"]} for r in eval_reps],
        "kpis": kpis,
        "comparison_table": {
            "headers": table_headers,
            "rows": table_rows,
        },
        "chart_data": {
            "type": "comparison_bars",
            "title": "Commercial Comparison Visuals",
            "items": comparison_items,
        },
        "insights": insights,
        "recommendations": recommendations,
        "detailed_markdown": detailed_md,
        "generated_at": datetime.now().isoformat(),
        "ai_engine": "crm-intelligence-v2",
    }


@router.post("/generate")
def generate_ai_report(payload: AIReportRequest, session: Session = Depends(get_session)):
    prompt = (payload.prompt or "").strip()
    if not prompt:
        prompt = "Compare sales staff performance including leads, conversions, revenue and deal closure rates"

    # Time range resolution
    start_date_str = payload.start_date
    end_date_str = payload.end_date

    now = datetime.now()
    if payload.time_range == "7d":
        start_date_str = (now - timedelta(days=7)).strftime("%Y-%m-%d")
        end_date_str = now.strftime("%Y-%m-%d")
    elif payload.time_range == "30d":
        start_date_str = (now - timedelta(days=30)).strftime("%Y-%m-%d")
        end_date_str = now.strftime("%Y-%m-%d")
    elif payload.time_range == "this_month":
        start_date_str = datetime(now.year, now.month, 1).strftime("%Y-%m-%d")
        end_date_str = now.strftime("%Y-%m-%d")
    elif payload.time_range == "6m":
        start_date_str = (now - timedelta(days=180)).strftime("%Y-%m-%d")
        end_date_str = now.strftime("%Y-%m-%d")
    elif payload.time_range == "12m":
        start_date_str = (now - timedelta(days=365)).strftime("%Y-%m-%d")
        end_date_str = now.strftime("%Y-%m-%d")

    # Fetch fresh CRM snapshot
    snapshot = _get_crm_snapshot(session, start_date_str, end_date_str)
    reps = snapshot["reps"]
    detected_reps = _detect_mentioned_reps(prompt, payload.rep_id, reps)
    currency = payload.currency or "INR"

    # Base report from CRM intelligence
    base_report = _generate_deterministic_report(prompt, snapshot, detected_reps, currency)

    # Check if OpenAI is available to enrich the narrative from Business Owner POV
    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key and len(openai_key.strip()) > 10:
        try:
            import openai
            client = openai.OpenAI(api_key=openai_key)
            
            system_prompt = (
                "You are an elite C-Suite Revenue Operations & Management Advisor presenting directly to the Business Owner / CEO. "
                "Analyze the provided factual CRM data to answer the user's specific reporting query. "
                "Always write strictly from a Business Owner perspective: emphasize profit realization, revenue concentration risk, "
                "sales rep ROI, deal win rates, funnel leakage, and high-impact leadership directives. "
                "Always adhere to the provided numbers — NEVER invent figures. Return a JSON object matching this schema:\n"
                "{\n"
                '  "title": "Clear concise executive report title",\n'
                '  "summary": "Executive summary paragraph explaining bottom-line findings and commercial impact",\n'
                '  "insights": ["Insight 1 with bold key figures and commercial meaning", "Insight 2", "Insight 3", "Insight 4"],\n'
                '  "recommendations": ["Actionable owner directive 1", "Actionable owner directive 2", "Actionable owner directive 3"],\n'
                '  "detailed_markdown": "Rich GitHub-flavored markdown report starting with # title, ## 1. Executive Summary, ## 2. Performance Matrix Table, ## 3. Owner ROI & Concentration, ## 4. Funnel Leakage, ## 5. Directives for Leadership"\n'
                "}"
            )

            data_context = {
                "user_prompt": prompt,
                "currency": currency,
                "macro_summary": snapshot["macro"],
                "cohort_evaluated": [
                    {
                        "name": r["name"],
                        "role": r["role"],
                        "leads": r["total_leads"],
                        "conversions": r["converted_leads"],
                        "conversion_rate_pct": r["lead_conversion_rate"],
                        "won_deals": r["won_deals"],
                        "lost_deals": r["lost_deals"],
                        "closure_rate_pct": r["deal_closure_rate"],
                        "won_revenue": r["won_revenue"],
                        "pipeline_value": r["pipeline_value"],
                        "avg_deal_size": r["avg_deal_size"],
                        "calls": r["calls_count"],
                        "meetings": r["meetings_count"],
                    }
                    for r in (detected_reps if detected_reps else reps)
                ],
            }

            completion = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"User Prompt: {prompt}\n\nCRM Data:\n{json.dumps(data_context, indent=2)}"}
                ],
                response_format={"type": "json_object"},
                temperature=0.2,
                timeout=12,
            )

            res_content = completion.choices[0].message.content
            parsed = json.loads(res_content)

            if parsed.get("title"):
                base_report["title"] = parsed["title"]
            if parsed.get("summary"):
                base_report["summary"] = parsed["summary"]
            if parsed.get("insights") and isinstance(parsed["insights"], list):
                base_report["insights"] = parsed["insights"]
            if parsed.get("recommendations") and isinstance(parsed["recommendations"], list):
                base_report["recommendations"] = parsed["recommendations"]
            if parsed.get("detailed_markdown"):
                base_report["detailed_markdown"] = parsed["detailed_markdown"]
            base_report["ai_engine"] = "gpt-4o-mini + crm-intelligence"

        except Exception as e:
            # Silently fall back to robust deterministic report
            base_report["ai_engine"] = "crm-intelligence-v2 (offline fallback)"
            print(f"[AI Reports] OpenAI enrichment skipped/fallback: {e}")

    return base_report


@router.get("/quick-prompts")
def get_quick_prompts(session: Session = Depends(get_session)):
    snapshot = _get_crm_snapshot(session)
    reps = snapshot["reps"]
    rep_names = [r["name"] for r in reps[:4]]

    prompts = [
        {
            "category": "Sales Staff Performance Comparisons",
            "icon": "Users",
            "prompt": "Compare all sales staff performance including leads, conversions, revenue and deal closure rates",
            "badge": "Popular",
        },
        {
            "category": "Revenue & Pipeline Audits",
            "icon": "IndianRupee",
            "prompt": "Analyze won revenue vs active open pipeline value across all sales representatives",
            "badge": "Financial",
        },
        {
            "category": "Deal Closure Rate Analysis",
            "icon": "Target",
            "prompt": "Which sales representative has the highest deal closure rate and who needs coaching?",
            "badge": "Win Rate",
        },
        {
            "category": "Lead-to-Client Conversion Funnel",
            "icon": "TrendingUp",
            "prompt": "Analyze lead conversion rates across the team and identify funnel drop-offs",
            "badge": "Funnel",
        },
        {
            "category": "Activity vs Closure Correlation",
            "icon": "PhoneCall",
            "prompt": "How do logged calls and meetings correlate with closed won deals for each rep?",
            "badge": "Productivity",
        },
    ]

    # Add dynamic rep-specific prompts
    for name in rep_names:
        prompts.append({
            "category": "Individual Rep Analysis",
            "icon": "UserCheck",
            "prompt": f"Sales conversion and performance analysis for {name}",
            "badge": "Rep Audit",
        })

    return {
        "prompts": prompts,
        "reps": [{"id": r["id"], "name": r["name"], "role": r["role"]} for r in reps],
    }
