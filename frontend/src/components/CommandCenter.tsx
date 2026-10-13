"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DollarSign, TrendingUp, Users, Target, Briefcase, Clock, CheckCircle2,
  AlertCircle, AlertTriangle, ShieldAlert, Sparkles, RefreshCw, ArrowUpRight,
  ChevronRight, Calendar, Phone, Mail, FileText, ShoppingCart, Package,
  Layers, Trophy, Flame, Zap, BarChart2, CheckSquare, Activity, FileEdit,
  FolderOpen, UserCheck, MessageSquare, ArrowRight, TrendingDown
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, LineChart, Line
} from "recharts";
import { API_BASE_URL } from "@/config";
import { useRole } from "@/context/RoleContext";
import {
  Currency, useCurrency, money, num, pctf, PALETTE, TOOLTIP_STYLE, AXIS_TICK,
  Tile, Card, Pill, Skeleton, CurrencyToggle, Segmented, relTime, statusColor, Meter
} from "@/components/analytics/kit";
import { CallPitchWidget } from "@/components/AdminDashboard";

export default function CommandCenter() {
  const { role, user } = useRole();
  const router = useRouter();
  const [currency, setCurrency] = useCurrency();
  const [months, setMonths] = useState<number>(6);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/command-center/overview?months=${months}`);
      if (!res.ok) {
        throw new Error(`Failed to load command center overview (${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Failed to load command center");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, [months]);

  const kpis = data?.kpis || {};
  const attention = data?.attention || [];
  const pipeline = data?.pipeline || {};
  const leads = data?.leads || {};
  const sources = data?.lead_sources || {};
  const clients = data?.clients || {};
  const proposals = data?.proposals || {};
  const negotiations = data?.negotiations || {};
  const billing = data?.billing || {};
  const tasks = data?.tasks || {};
  const followups = data?.followups || {};
  const meetings = data?.meetings || {};
  const comms = data?.comms || {};
  const projects = data?.projects || {};
  const inventory = data?.inventory || {};
  const team = data?.team || [];
  const costs = data?.costs || null;
  const series = data?.series || [];

  return (
    <div className="space-y-6 pb-20">
      {/* ── TOP HEADER & CONTROLS ─────────────────────────────────── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-[var(--border)] pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2.5 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white shadow-md">
              <Zap className="h-6 w-6" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black tracking-tight text-[var(--text-primary)]">
                  Enterprise Command Center
                </h1>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-extrabold uppercase tracking-wider">
                  Live Operations
                </span>
              </div>
              <p className="text-xs font-semibold text-[var(--text-secondary)] mt-0.5">
                Full-suite CRM control panel • Micromanage leads, deals, revenue, costs, team & pipelines
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented
            value={months}
            onChange={(v) => setMonths(Number(v))}
            options={[
              { value: 3, label: "3 Mo" },
              { value: 6, label: "6 Mo" },
              { value: 12, label: "12 Mo" },
              { value: 24, label: "24 Mo" },
            ]}
          />

          <CurrencyToggle value={currency} onChange={setCurrency} />

          <button
            onClick={fetchOverview}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--sidebar-hover)] transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-500 text-sm font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={fetchOverview} className="underline text-xs font-bold">Retry</button>
        </div>
      )}

      {/* ── ATTENTION REQUIRED STRIP ──────────────────────────────── */}
      {attention.length > 0 && (
        <div className="p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 shadow-sm">
          <div className="flex items-center gap-2 mb-2 text-xs font-black text-amber-500 uppercase tracking-wider">
            <AlertTriangle className="h-4 w-4" />
            Requires Immediate Attention ({attention.length} items)
          </div>
          <div className="flex flex-wrap gap-2">
            {attention.map((item: any) => (
              <Link
                key={item.key}
                href={item.href}
                className={`group inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                  item.severity === "high"
                    ? "border-rose-500/30 bg-rose-500/10 text-rose-500 hover:border-rose-500 hover:bg-rose-500/20"
                    : item.severity === "medium"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-500 hover:border-amber-500 hover:bg-amber-500/20"
                    : "border-indigo-500/30 bg-indigo-500/10 text-indigo-500 hover:border-indigo-500 hover:bg-indigo-500/20"
                }`}
              >
                <span>{item.label}:</span>
                <span className="font-black px-1.5 py-0.2 rounded bg-black/20">{item.count}</span>
                {item.detail && <span className="text-[10px] opacity-80">({item.detail})</span>}
                <ArrowUpRight className="h-3 w-3 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── CALL PITCH WIDGET ─────────────────────────────────────── */}
      <CallPitchWidget />

      {/* ── ROW 1: PRIMARY FINANCIAL & GROWTH KPIS ───────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Tile
          label="Total Won Revenue"
          value={money(kpis.won_revenue, currency, true)}
          delta={kpis.revenue_change_pct}
          sub={`${num(kpis.won_deals)} closed won deals`}
          icon={DollarSign}
          tone="emerald"
          href="/revenue"
        />
        <Tile
          label="Pipeline Value"
          value={money(kpis.pipeline_value, currency, true)}
          sub={`Weighted: ${money(kpis.weighted_forecast, currency, true)}`}
          icon={Target}
          tone="indigo"
          href="/pipeline"
        />
        <Tile
          label="Active Deals"
          value={num(kpis.open_deals)}
          sub={`${num(kpis.total_deals)} total deals (${pctf(kpis.win_rate)} win)`}
          icon={Briefcase}
          tone="sky"
          href="/pipeline"
        />
        <Tile
          label="Average Deal Size"
          value={money(kpis.avg_deal_size, currency, true)}
          sub={`Avg cycle: ${kpis.avg_sales_cycle_days ? `${kpis.avg_sales_cycle_days}d` : "—"}`}
          icon={Clock}
          tone="violet"
          href="/pipeline"
        />

        {data?.can_see_finance && costs && (
          <>
            <Tile
              label="Operating Costs"
              value={money(costs.period_total, currency, true)}
              sub={`Burn: ${money(costs.monthly_burn, currency, true)}/mo`}
              icon={TrendingDown}
              tone="slate"
              href="/business-costs"
            />
            <Tile
              label="Net Operating Profit"
              value={money(costs.net_profit, currency, true)}
              sub={`Margin: ${pctf(costs.margin_pct)}`}
              icon={TrendingUp}
              tone={costs.net_profit >= 0 ? "emerald" : "rose"}
              href="/revenue"
            />
          </>
        )}

        <Tile
          label="Total Leads"
          value={num(kpis.total_leads)}
          delta={kpis.leads_change_pct}
          sub={`${pctf(kpis.lead_conversion_rate)} conversion rate`}
          icon={Users}
          tone="amber"
          href="/leads"
        />
        <Tile
          label="In Negotiation"
          value={money(kpis.in_negotiation_value, currency, true)}
          sub={`${num(kpis.in_negotiation)} deals negotiating`}
          icon={Flame}
          tone="orange"
          href="/pipeline"
        />
        <Tile
          label="Proposals Sent"
          value={num(kpis.proposals_sent)}
          sub={`${pctf(kpis.proposal_acceptance_rate)} accepted`}
          icon={FileEdit}
          tone="teal"
          href="/proposals"
        />
        <Tile
          label="Active Clients"
          value={num(kpis.active_clients)}
          sub={`${num(kpis.total_clients)} registered accounts`}
          icon={UserCheck}
          tone="indigo"
          href="/clients"
        />
        <Tile
          label="Overdue Invoices"
          value={money(kpis.overdue_invoices, currency, true)}
          sub={`Outstanding: ${money(kpis.outstanding_invoices, currency, true)}`}
          icon={AlertCircle}
          tone="rose"
          href="/billing"
        />
        <Tile
          label="Pending Follow-ups"
          value={num(kpis.pending_followups)}
          sub={`${num(kpis.overdue_followups)} overdue`}
          icon={Calendar}
          tone={kpis.overdue_followups > 0 ? "rose" : "emerald"}
          href="/follow-ups"
        />
      </div>

      {/* ── CHARTS: REVENUE VS COSTS & PIPELINE BY STAGE ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue, Costs & Net Profit Chart */}
        <Card
          title="Revenue & Profit Trajectory"
          icon={TrendingUp}
          tone="emerald"
          href="/revenue"
          linkLabel="Full Financials"
          right={
            <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
              Last {months} months
            </span>
          }
        >
          <div className="h-72 w-full">
            {series.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)] text-center py-20">No monthly financial records</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorWon" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="colorCosts" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} />
                  <YAxis tick={AXIS_TICK} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [money(v, currency), ""]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="won_revenue" name="Won Revenue" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorWon)" />
                  {data?.can_see_finance && (
                    <Area type="monotone" dataKey="costs" name="Costs" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#colorCosts)" />
                  )}
                  {data?.can_see_finance && (
                    <Line type="monotone" dataKey="net_profit" name="Net Profit" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Pipeline Distribution by Stage */}
        <Card
          title="Pipeline Stage Breakdown"
          icon={Target}
          tone="indigo"
          href="/pipeline"
          linkLabel="Interactive Kanban"
        >
          <div className="space-y-3">
            {(pipeline.by_stage || []).map((st: any) => {
              const maxVal = Math.max(...(pipeline.by_stage || []).map((s: any) => s.value || 1));
              return (
                <Link
                  key={st.name}
                  href={`/pipeline?stage=${encodeURIComponent(st.name)}`}
                  className="block p-2 rounded-lg border border-[var(--border)] bg-[var(--surface)]/50 hover:bg-[var(--sidebar-hover)] transition-all group"
                >
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="flex items-center gap-1.5 text-[var(--text-primary)] group-hover:text-[var(--primary)]">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusColor(st.name) }} />
                      {st.name} ({st.count})
                    </span>
                    <span className="text-[var(--text-primary)]">{money(st.value, currency)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1">
                      <Meter value={st.value} max={maxVal} color={statusColor(st.name)} height={4} />
                    </div>
                    <span className="text-[10px] text-[var(--text-secondary)] font-semibold shrink-0">
                      {st.probability}% win prob
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ── MICROMANAGEMENT HUB: DEALS CLOSING & TOP OPEN DEALS ───── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Closing Soon (<= 14 days) */}
        <Card
          title={`Deals Closing Soon (${(pipeline.closing_soon || []).length})`}
          icon={Clock}
          tone="amber"
          href="/pipeline"
          linkLabel="View Pipeline"
        >
          <div className="space-y-2">
            {(pipeline.closing_soon || []).length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)] py-6 text-center">No deals closing within next 14 days</p>
            ) : (
              (pipeline.closing_soon || []).map((d: any) => (
                <Link
                  key={d.id}
                  href={`/pipeline`}
                  className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]/50 hover:border-amber-500 transition-all flex items-center justify-between block text-xs"
                >
                  <div className="min-w-0 pr-2">
                    <p className="font-bold text-[var(--text-primary)] truncate">{d.title}</p>
                    <p className="text-[10px] text-[var(--text-secondary)]">
                      {d.client || "No Client"} • Rep: {d.owner}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-extrabold text-amber-600">{money(d.value, currency)}</p>
                    <p className={`text-[10px] font-bold ${d.days < 0 ? "text-rose-500" : "text-amber-500"}`}>
                      {d.days < 0 ? `${Math.abs(d.days)}d overdue` : `in ${d.days}d`}
                    </p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>

        {/* Top High-Value Open Opportunities */}
        <Card
          title="Top High-Value Open Deals"
          icon={Briefcase}
          tone="teal"
          href="/pipeline"
          linkLabel="All Deals"
        >
          <div className="space-y-2">
            {(pipeline.top_open || []).length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)] py-6 text-center">No open deals</p>
            ) : (
              (pipeline.top_open || []).map((d: any) => (
                <Link
                  key={d.id}
                  href={d.client_id ? `/clients/${d.client_id}` : `/pipeline`}
                  className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]/50 hover:border-teal-500 transition-all flex items-center justify-between block text-xs"
                >
                  <div className="min-w-0 pr-2">
                    <p className="font-bold text-[var(--text-primary)] truncate">{d.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Pill color={statusColor(d.stage)}>{d.stage}</Pill>
                      <span className="text-[10px] text-[var(--text-secondary)] truncate">{d.client || "Direct"}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-extrabold text-emerald-600">{money(d.value, currency)}</p>
                    <p className="text-[10px] text-[var(--text-secondary)]">Rep: {d.owner}</p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* ── LEAD SOURCES COMMAND MODULE ─────────────────────────── */}
      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--sidebar-hover)]/30 px-4 py-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-indigo-500" />
            <h3 className="text-sm font-extrabold text-[var(--text-primary)]">
              Lead Sources & Acquisition Channels ({sources.total_sources || 0} active)
            </h3>
          </div>
          <Link
            href="/lead-source-analytics"
            className="flex items-center gap-1 text-xs font-bold text-[var(--primary)] hover:underline"
          >
            Open Dedicated Lead Source Analytics
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </header>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {(sources.rows || []).slice(0, 4).map((s: any) => (
            <Link
              key={s.source_id || "unassigned"}
              href={`/lead-source-analytics/${s.source_id || 0}`}
              className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)]/50 hover:border-[var(--primary)] transition-all block group"
            >
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-xs text-[var(--text-primary)] group-hover:text-[var(--primary)] truncate">
                  {s.source}
                </span>
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color || "#94a3b8" }} />
              </div>
              <p className="text-lg font-black text-[var(--text-primary)] mt-1.5">
                {num(s.leads)} <span className="text-xs font-semibold text-[var(--text-secondary)]">leads</span>
              </p>
              <div className="flex items-center justify-between text-[11px] font-semibold mt-1">
                <span className="text-emerald-500">{pctf(s.conversion_rate)} conv</span>
                <span className="text-amber-500">{money(s.won_revenue, currency, true)}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── ROW: PROPOSALS, NEGOTIATIONS & BILLING ───────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Proposals Hub */}
        <Card
          title={`Proposals & Quotes (${proposals.total || 0})`}
          icon={FileEdit}
          tone="indigo"
          href="/proposals"
          linkLabel="Manage Proposals"
        >
          <div className="space-y-2.5 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 rounded-lg bg-[var(--surface)]/60 border border-[var(--border)]">
                <p className="text-[10px] text-[var(--text-secondary)] font-semibold uppercase">Sent Value</p>
                <p className="text-base font-extrabold text-[var(--text-primary)] mt-0.5">{money(proposals.total_value, currency, true)}</p>
              </div>
              <div className="p-2 rounded-lg bg-[var(--surface)]/60 border border-[var(--border)]">
                <p className="text-[10px] text-[var(--text-secondary)] font-semibold uppercase">Accepted Value</p>
                <p className="text-base font-extrabold text-emerald-600 mt-0.5">{money(proposals.accepted_value, currency, true)}</p>
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              {(proposals.recent || []).slice(0, 4).map((p: any) => (
                <Link
                  key={p.id}
                  href="/proposals"
                  className="flex items-center justify-between p-1.5 rounded hover:bg-[var(--sidebar-hover)] transition-all block"
                >
                  <span className="font-semibold text-[var(--text-primary)] truncate max-w-[130px]">{p.title}</span>
                  <div className="flex items-center gap-1.5">
                    <Pill color={statusColor(p.status)}>{p.status}</Pill>
                    <span className="font-bold text-amber-600">{money(p.value, currency, true)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </Card>

        {/* Negotiations Hub */}
        <Card
          title={`Deal Negotiations (${negotiations.in_negotiation_stage || 0})`}
          icon={Flame}
          tone="orange"
          href="/pipeline"
          linkLabel="Pipeline Negotiations"
        >
          <div className="space-y-2.5 text-xs">
            <div className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]/60 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-[var(--text-secondary)] font-semibold uppercase">Negotiating Volume</span>
                <p className="text-base font-black text-amber-600 mt-0.5">{money(negotiations.in_negotiation_value, currency, true)}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-[var(--text-secondary)] font-semibold uppercase">Avg Discount</span>
                <p className="text-base font-black text-rose-500 mt-0.5">{negotiations.avg_discount_pct || 0}%</p>
              </div>
            </div>

            <div className="space-y-1.5">
              {(negotiations.deals || []).slice(0, 4).map((d: any) => (
                <Link
                  key={d.id}
                  href="/pipeline"
                  className="p-1.5 rounded hover:bg-[var(--sidebar-hover)] flex items-center justify-between block transition-all"
                >
                  <span className="font-bold text-[var(--text-primary)] truncate max-w-[130px]">{d.title}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-[var(--text-secondary)]">{d.rounds} rounds</span>
                    <span className="font-bold text-emerald-600">{money(d.last_price || d.value, currency, true)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </Card>

        {/* Invoices & Collections */}
        <Card
          title="Billing & Invoicing"
          icon={FileText}
          tone="teal"
          href="/billing"
          linkLabel="Billing Desk"
        >
          <div className="space-y-2.5 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 rounded-lg bg-[var(--surface)]/60 border border-[var(--border)]">
                <p className="text-[10px] text-[var(--text-secondary)] font-semibold uppercase">Paid Invoices</p>
                <p className="text-base font-extrabold text-emerald-600 mt-0.5">
                  {money(billing.invoices?.paid_value, currency, true)}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-[var(--surface)]/60 border border-[var(--border)]">
                <p className="text-[10px] text-[var(--text-secondary)] font-semibold uppercase">Collection Rate</p>
                <p className="text-base font-extrabold text-indigo-500 mt-0.5">
                  {pctf(billing.invoices?.collection_rate)}
                </p>
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between p-1.5 rounded bg-[var(--surface)]/40 border border-[var(--border)]">
                <span className="text-[var(--text-secondary)]">Overdue Invoices:</span>
                <span className="font-extrabold text-rose-500">{money(billing.invoices?.overdue_value, currency, true)} ({billing.invoices?.overdue_count || 0})</span>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-[var(--surface)]/40 border border-[var(--border)]">
                <span className="text-[var(--text-secondary)]">Sales Orders:</span>
                <span className="font-extrabold text-[var(--text-primary)]">{money(billing.sales_orders?.value, currency, true)} ({billing.sales_orders?.total || 0})</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* ── CLIENTS & TEAM LEADERBOARD ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Clients Directory Overview */}
        <Card
          title={`Top Generating Clients (${clients.total || 0})`}
          icon={Users}
          tone="indigo"
          href="/clients"
          linkLabel="Clients Directory"
        >
          <div className="space-y-2">
            {(clients.top || []).length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)] text-center py-6">No client revenue recorded</p>
            ) : (
              (clients.top || []).map((c: any) => (
                <Link
                  key={c.id}
                  href={`/clients/${c.id}`}
                  className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]/50 hover:border-indigo-500 transition-all flex items-center justify-between block text-xs"
                >
                  <span className="font-bold text-[var(--text-primary)] truncate max-w-[180px]">{c.name || `Client #${c.id}`}</span>
                  <div className="text-right">
                    <p className="font-extrabold text-emerald-600">{money(c.revenue, currency)}</p>
                    {c.open_value > 0 && (
                      <p className="text-[10px] text-indigo-500 font-semibold">{money(c.open_value, currency)} open</p>
                    )}
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>

        {/* Team Leaderboard */}
        <Card
          title={`Sales Team Performance (${team.length} Reps)`}
          icon={Trophy}
          tone="amber"
          href="/admin/leaderboard"
          linkLabel="Full Leaderboard"
        >
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {team.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)] text-center py-6">No team members active</p>
            ) : (
              team.map((rep: any) => (
                <div
                  key={rep.user_id}
                  className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]/50 flex items-center justify-between text-xs"
                >
                  <div>
                    <p className="font-bold text-[var(--text-primary)]">{rep.name}</p>
                    <p className="text-[10px] text-[var(--text-secondary)]">
                      {rep.leads} leads • {rep.won_deals} won deals ({pctf(rep.win_rate)} win)
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-extrabold text-amber-600">{money(rep.won_revenue, currency)}</p>
                    <p className="text-[10px] text-indigo-500 font-semibold">{money(rep.pipeline_value, currency)} pipeline</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* ── ROW: TASKS, FOLLOW-UPS & MEETINGS ─────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Tasks */}
        <Card
          title={`Action Tasks (${tasks.open || 0} Open)`}
          icon={CheckSquare}
          tone="sky"
          href="/tasks"
          linkLabel="Task Board"
        >
          <div className="space-y-2 text-xs">
            {(tasks.next || []).length === 0 ? (
              <p className="text-[var(--text-secondary)] text-center py-6">All tasks completed!</p>
            ) : (
              (tasks.next || []).map((t: any) => (
                <Link
                  key={t.id}
                  href="/tasks"
                  className="p-2 rounded border border-[var(--border)] bg-[var(--surface)]/50 flex items-center justify-between block hover:border-[var(--primary)] transition-all"
                >
                  <span className="font-bold text-[var(--text-primary)] truncate max-w-[130px]">{t.title}</span>
                  <div className="flex items-center gap-1.5">
                    <Pill color={statusColor(t.priority)}>{t.priority || "Normal"}</Pill>
                    <span className="text-[10px] text-[var(--text-secondary)]">{t.due_date || "—"}</span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>

        {/* Follow-ups */}
        <Card
          title={`Pending Follow-ups (${followups.pending || 0})`}
          icon={Calendar}
          tone="teal"
          href="/follow-ups"
          linkLabel="Follow-up Queue"
        >
          <div className="space-y-2 text-xs">
            {(followups.next || []).length === 0 ? (
              <p className="text-[var(--text-secondary)] text-center py-6">No pending follow-ups</p>
            ) : (
              (followups.next || []).map((f: any) => (
                <Link
                  key={f.id}
                  href="/follow-ups"
                  className="p-2 rounded border border-[var(--border)] bg-[var(--surface)]/50 flex items-center justify-between block hover:border-teal-500 transition-all"
                >
                  <span className="font-bold text-[var(--text-primary)] truncate max-w-[130px]">{f.title}</span>
                  <div className="flex items-center gap-1.5">
                    <Pill color={f.overdue ? "#ef4444" : "#10b981"}>{f.channel || "Call"}</Pill>
                    <span className={`text-[10px] ${f.overdue ? "text-rose-500 font-bold" : "text-[var(--text-secondary)]"}`}>
                      {relTime(f.due_at)}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>

        {/* Meetings */}
        <Card
          title={`Upcoming Meetings (${meetings.upcoming_7d || 0})`}
          icon={Clock}
          tone="indigo"
          href="/meetings"
          linkLabel="Calendar"
        >
          <div className="space-y-2 text-xs">
            {(meetings.next || []).length === 0 ? (
              <p className="text-[var(--text-secondary)] text-center py-6">No meetings scheduled for next 7 days</p>
            ) : (
              (meetings.next || []).map((m: any) => (
                <Link
                  key={m.id}
                  href="/meetings"
                  className="p-2 rounded border border-[var(--border)] bg-[var(--surface)]/50 flex items-center justify-between block hover:border-indigo-500 transition-all"
                >
                  <span className="font-bold text-[var(--text-primary)] truncate max-w-[130px]">{m.title}</span>
                  <div className="text-right">
                    <span className="text-[10px] text-indigo-500 font-semibold block">{m.type || "Online"}</span>
                    <span className="text-[10px] text-[var(--text-secondary)]">{relTime(m.scheduled_at)}</span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* ── PROJECTS & INVENTORY (IF PERMITTED) ───────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Projects */}
        <Card
          title={`Operations Projects (${projects.total || 0})`}
          icon={FolderOpen}
          tone="indigo"
          href="/projects"
          linkLabel="Project Board"
        >
          <div className="space-y-2 text-xs">
            {(projects.active || []).length === 0 ? (
              <p className="text-[var(--text-secondary)] text-center py-6">No active ongoing projects</p>
            ) : (
              (projects.active || []).map((p: any) => (
                <Link
                  key={p.id}
                  href={`/projects`}
                  className="p-2 rounded border border-[var(--border)] bg-[var(--surface)]/50 flex items-center justify-between block hover:border-indigo-500 transition-all"
                >
                  <span className="font-bold text-[var(--text-primary)]">{p.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-indigo-500 font-bold">{p.progress}%</span>
                    <div className="w-16">
                      <Meter value={p.progress} max={100} color="#6366f1" height={4} />
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>

        {/* Low Stock Alert */}
        <Card
          title={`Inventory & Low Stock Alerts (${inventory.low_stock || 0})`}
          icon={Package}
          tone="amber"
          href="/inventory"
          linkLabel="Inventory Catalog"
        >
          <div className="space-y-2 text-xs">
            {(inventory.items || []).length === 0 ? (
              <p className="text-emerald-500 text-center py-6 font-semibold">All inventory levels are healthy!</p>
            ) : (
              (inventory.items || []).map((i: any) => (
                <Link
                  key={i.id}
                  href="/inventory"
                  className="p-2 rounded border border-rose-500/20 bg-rose-500/5 flex items-center justify-between block hover:border-rose-500 transition-all"
                >
                  <span className="font-bold text-[var(--text-primary)]">{i.name} ({i.code})</span>
                  <div className="text-right">
                    <span className="text-rose-500 font-extrabold">{i.stock} in stock</span>
                    <span className="text-[10px] text-[var(--text-secondary)] block">Min: {i.min}</span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
