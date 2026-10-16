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


def _detect_target_rep(prompt: str, rep_id: Optional[int], reps: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if rep_id:
        for r in reps:
            if r["id"] == rep_id:
                return r

    p_lower = prompt.lower()
    for r in reps:
        name_parts = r["name"].lower().split()
        for part in name_parts:
            if len(part) >= 3 and part in p_lower:
                return r
        if r["email"].lower() in p_lower:
            return r
    return None


def _generate_deterministic_report(prompt: str, snapshot: Dict[str, Any], target_rep: Optional[Dict[str, Any]], currency: str = "INR") -> Dict[str, Any]:
    reps = snapshot["reps"]
    macro = snapshot["macro"]
    p_lower = prompt.lower()

    # Determine report type
    is_individual = target_rep is not None
    is_comparison = any(k in p_lower for k in ["compare", "comparison", "vs", "rank", "ranking", "who", "all staff", "closure rate", "leaderboard"]) or not is_individual
    is_activity = any(k in p_lower for k in ["call", "meeting", "activity", "followup", "productivity", "effort"])
    is_revenue = any(k in p_lower for k in ["revenue", "financial", "pipeline", "money", "deal size", "quota", "earnings"])

    top_closer = max(reps, key=lambda r: r["deal_closure_rate"]) if reps else None
    top_revenue = max(reps, key=lambda r: r["won_revenue"]) if reps else None
    top_converter = max(reps, key=lambda r: r["lead_conversion_rate"]) if reps else None

    if is_individual and target_rep:
        # Individual Rep Analysis
        rep = target_rep
        name = rep["name"]
        won_str = _format_money(rep["won_revenue"], currency)
        pipe_str = _format_money(rep["pipeline_value"], currency)
        avg_str = _format_money(rep["avg_deal_size"], currency)

        title = f"Sales Conversion & Performance Audit: {name}"
        summary = (
            f"Comprehensive analysis for {name} ({rep['role']}): Generated {won_str} in won revenue across "
            f"{rep['won_deals']} closed deals with an impressive deal closure rate of {rep['deal_closure_rate']}%. "
            f"{name} currently manages {rep['total_leads']} leads with a {rep['lead_conversion_rate']}% lead conversion rate "
            f"and has an active open pipeline valued at {pipe_str}."
        )

        kpis = [
            {"label": "Won Revenue", "value": won_str, "sub": f"{rep['won_deals']} deals won", "trend": "up", "color": "emerald"},
            {"label": "Deal Closure Rate", "value": f"{rep['deal_closure_rate']}%", "sub": f"{rep['won_deals']} won / {rep['won_deals'] + rep['lost_deals']} closed", "trend": "up" if rep['deal_closure_rate'] >= 40 else "neutral", "color": "indigo"},
            {"label": "Lead Conversion Rate", "value": f"{rep['lead_conversion_rate']}%", "sub": f"{rep['converted_leads']} of {rep['total_leads']} leads", "trend": "up" if rep['lead_conversion_rate'] >= 25 else "neutral", "color": "blue"},
            {"label": "Open Pipeline", "value": pipe_str, "sub": f"{rep['open_deals']} active opportunities", "trend": "neutral", "color": "amber"},
            {"label": "Avg Deal Size", "value": avg_str, "sub": "Per won contract", "trend": "up", "color": "violet"},
            {"label": "Client Accounts", "value": str(rep['clients_count']), "sub": "Active managed clients", "trend": "neutral", "color": "teal"},
        ]

        table_headers = ["Metric", "Representative Metric", "Team Benchmark Average", "Status / Variance"]
        team_avg_closure = macro["overall_deal_closure_rate"]
        team_avg_conv = macro["overall_lead_conversion_rate"]
        team_avg_won = macro["total_won_revenue"] / len(reps) if reps else 0

        table_rows = [
            ["Deal Closure Rate (Win %)", f"{rep['deal_closure_rate']}%", f"{team_avg_closure}%", "Above Benchmark" if rep['deal_closure_rate'] >= team_avg_closure else "Below Benchmark"],
            ["Lead Conversion Rate (%)", f"{rep['lead_conversion_rate']}%", f"{team_avg_conv}%", "Above Benchmark" if rep['lead_conversion_rate'] >= team_avg_conv else "Needs Attention"],
            ["Total Won Revenue", won_str, _format_money(team_avg_won, currency), "Top Tier" if rep['won_revenue'] >= team_avg_won else "Standard"],
            ["Active Open Pipeline", pipe_str, "–", f"{rep['open_deals']} open deals"],
            ["Logged Calls & Follow-ups", f"{rep['calls_count']} calls / {rep['followups_count']} followups", "–", "Active Engagement" if rep['calls_count'] + rep['followups_count'] > 0 else "Low Activity"],
            ["Scheduled & Held Meetings", f"{rep['meetings_count']} meetings", "–", "High Touch" if rep['meetings_count'] > 0 else "Standard"],
        ]

        chart_items = [
            {"name": "Won Deals", "value": rep["won_deals"]},
            {"name": "Lost Deals", "value": rep["lost_deals"]},
            {"name": "In Negotiation / Open", "value": rep["open_deals"]},
            {"name": "Converted Leads", "value": rep["converted_leads"]},
        ]

        insights = [
            f"**Conversion Efficiency:** {name} closes {rep['deal_closure_rate']}% of all negotiated opportunities, with an average deal size of {avg_str}.",
            f"**Pipeline Health:** Currently holds {pipe_str} across {rep['open_deals']} open opportunities. Nurturing these could yield an estimated {won_str} in incremental bookings.",
            f"**Activity Cadence:** Recorded {rep['calls_count']} calls, {rep['meetings_count']} client meetings, and {rep['followups_count']} follow-up touches.",
            f"**Conversion Funnel:** Out of {rep['total_leads']} assigned leads, {rep['converted_leads']} have officially progressed to clients/deals ({rep['lead_conversion_rate']}% conversion rate).",
        ]

        recommendations = [
            f"Prioritize closing high-value deals currently in negotiation ({pipe_str} total pipeline value).",
            f"Streamline response time on new lead assignments to further elevate lead conversion rate past {min(rep['lead_conversion_rate'] + 10, 100)}%.",
            f"Leverage {name}'s sales methodology across team coaching sessions, specifically on negotiation tactics.",
        ]

        detailed_md = f"""### Executive Sales Rep Audit: {name}

#### Performance Synthesis
{name} ({rep['role']}) currently accounts for **{won_str}** in closed won revenue. The representative has closed **{rep['won_deals']} deals** successfully with a **{rep['deal_closure_rate']}% closure rate**, outperforming general CRM baseline levels.

#### Lead-to-Deal Conversion Funnel
- **Total Leads Handled:** {rep['total_leads']}
- **Converted Leads:** {rep['converted_leads']} ({rep['lead_conversion_rate']}%)
- **Active Pipeline:** {pipe_str} ({rep['open_deals']} open opportunities)
- **Average Deal Value:** {avg_str}

#### Engagement & Touchpoint Velocity
- **Phone Calls Logged:** {rep['calls_count']}
- **Client Meetings Scheduled:** {rep['meetings_count']}
- **Follow-up Tasks Executed:** {rep['followups_count']}

#### Strategic Verdict
{name} demonstrates solid pipeline hygiene. Closing the active opportunities in their pipeline will guarantee quarter-end quota achievement.
"""

    else:
        # Staff Comparison & Whole Team Analysis
        title = "Sales Staff Performance & Conversion Comparison Report"
        won_total_str = _format_money(macro["total_won_revenue"], currency)
        pipe_total_str = _format_money(macro["total_pipeline_value"], currency)

        top_closer_name = top_closer["name"] if top_closer else "N/A"
        top_closer_rate = top_closer["deal_closure_rate"] if top_closer else 0
        top_rev_name = top_revenue["name"] if top_revenue else "N/A"
        top_rev_amt = _format_money(top_revenue["won_revenue"], currency) if top_revenue else "₹0"

        summary = (
            f"Across {len(reps)} active sales staff members, the team has accumulated {won_total_str} in won revenue "
            f"and maintains an active pipeline of {pipe_total_str}. The team average deal closure rate stands at "
            f"{macro['overall_deal_closure_rate']}%, with {top_closer_name} leading in closure efficiency at {top_closer_rate}% "
            f"and {top_rev_name} leading in total won revenue at {top_rev_amt}."
        )

        kpis = [
            {"label": "Total Won Revenue", "value": won_total_str, "sub": f"{macro['total_won_deals']} deals won", "trend": "up", "color": "emerald"},
            {"label": "Team Deal Closure Rate", "value": f"{macro['overall_deal_closure_rate']}%", "sub": f"{macro['total_won_deals']} won / {macro['total_lost_deals']} lost", "trend": "up", "color": "indigo"},
            {"label": "Overall Lead Conversion", "value": f"{macro['overall_lead_conversion_rate']}%", "sub": f"{macro['converted_leads']} of {macro['total_leads']} leads", "trend": "up", "color": "blue"},
            {"label": "Total Open Pipeline", "value": pipe_total_str, "sub": "Active deals in pipeline", "trend": "neutral", "color": "amber"},
            {"label": "Top Closer", "value": f"{top_closer_rate}%", "sub": top_closer_name, "trend": "up", "color": "violet"},
            {"label": "Top Revenue Rep", "value": top_rev_amt, "sub": top_rev_name, "trend": "up", "color": "teal"},
        ]

        table_headers = [
            "Representative", "Role", "Leads", "Conversions", "Conv. %", 
            "Won Deals", "Closure Rate %", "Won Revenue", "Pipeline Value", "Avg Deal"
        ]

        table_rows = []
        for r in reps:
            table_rows.append([
                r["name"],
                r["role"],
                str(r["total_leads"]),
                str(r["converted_leads"]),
                f"{r['lead_conversion_rate']}%",
                str(r["won_deals"]),
                f"{r['deal_closure_rate']}%",
                _format_money(r["won_revenue"], currency),
                _format_money(r["pipeline_value"], currency),
                _format_money(r["avg_deal_size"], currency),
            ])

        chart_items = [
            {
                "name": r["name"],
                "won_revenue": r["won_revenue"],
                "pipeline_value": r["pipeline_value"],
                "closure_rate": r["deal_closure_rate"],
                "conv_rate": r["lead_conversion_rate"],
            }
            for r in reps[:8]
        ]

        insights = [
            f"**Closure Leader:** {top_closer_name} exhibits the highest deal closure rate at **{top_closer_rate}%**, demonstrating superior late-stage negotiation ability.",
            f"**Revenue Leader:** {top_rev_name} leads total revenue generated at **{top_rev_amt}**.",
            f"**Conversion Disparity:** Lead conversion rates range from {min(r['lead_conversion_rate'] for r in reps)}% to {max(r['lead_conversion_rate'] for r in reps)}%, indicating an opportunity to redistribute high-intent inbound leads to top converters.",
            f"**Active Pipeline Reserves:** The team is carrying {pipe_total_str} in active opportunities, representing substantial near-term revenue potential.",
        ]

        recommendations = [
            "Pair representatives with closure rates below team average with top closers for high-stakes proposal calls.",
            "Implement standardized follow-up cadence rules to decrease lead-to-opportunity cycle times.",
            "Focus management review on deals in 'Negotiation' stage to accelerate conversion to Closed Won.",
        ]

        detailed_md = f"""### Comprehensive Sales Staff Performance Matrix

#### Macro Overview
The organization currently fields **{len(reps)} active sales staff members**, tracking a cumulative pipeline of **{pipe_total_str}** and having secured **{won_total_str}** in closed business.

| Sales Representative | Role | Leads Handled | Conv. % | Deals Won | Closure Rate % | Won Revenue | Open Pipeline |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
""" + "\n".join([f"| **{r['name']}** | {r['role']} | {r['total_leads']} | {r['lead_conversion_rate']}% | {r['won_deals']} | {r['deal_closure_rate']}% | {_format_money(r['won_revenue'], currency)} | {_format_money(r['pipeline_value'], currency)} |" for r in reps]) + f"""

#### Key Conversion Observations
1. **Deal Closure Dominance:** Staff members maintaining active meeting touchpoints achieve up to **{top_closer_rate}%** win rates.
2. **Pipeline Concentration:** Substantial revenue is concentrated in top-tier proposals; accelerating sign-offs will significantly boost quarter results.
3. **Actionable Step:** Maintain weekly pipeline reviews focused on moving deals from 'Proposal Sent' to 'Closed Won'.
"""

    return {
        "report_type": "individual_rep" if is_individual else "comparison",
        "title": title,
        "summary": summary,
        "target_rep": {"id": target_rep["id"], "name": target_rep["name"]} if target_rep else None,
        "kpis": kpis,
        "comparison_table": {
            "headers": table_headers,
            "rows": table_rows,
        },
        "chart_data": {
            "type": "pie" if is_individual else "bar",
            "title": "Stage Distribution" if is_individual else "Won Revenue vs Pipeline Value by Representative",
            "items": chart_items,
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
    target_rep = _detect_target_rep(prompt, payload.rep_id, reps)
    currency = payload.currency or "INR"

    # Base report from CRM intelligence
    base_report = _generate_deterministic_report(prompt, snapshot, target_rep, currency)

    # Check if OpenAI is available to enrich the narrative
    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key and len(openai_key.strip()) > 10:
        try:
            import openai
            client = openai.OpenAI(api_key=openai_key)
            
            system_prompt = (
                "You are an elite C-Suite Revenue Operations & Sales Intelligence Analyst. "
                "Analyze the provided factual CRM data to answer the user's specific reporting query. "
                "Always adhere to the provided numbers — NEVER invent figures. Return a JSON object matching this schema:\n"
                "{\n"
                '  "title": "Clear concise report title",\n'
                '  "summary": "Executive summary paragraph explaining the findings",\n'
                '  "insights": ["Insight 1 with bold key figures", "Insight 2", "Insight 3"],\n'
                '  "recommendations": ["Actionable recommendation 1", "Actionable recommendation 2"],\n'
                '  "detailed_markdown": "Rich detailed markdown report with headings, bullet points, and analysis"\n'
                "}"
            )

            data_context = {
                "user_prompt": prompt,
                "currency": currency,
                "macro_summary": snapshot["macro"],
                "staff_members": [
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
                    for r in reps
                ],
                "target_rep": target_rep["name"] if target_rep else None,
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
