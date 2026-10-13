"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend
} from "recharts";
import { Zap, ArrowUpRight, TrendingUp, IndianRupee, Filter, RefreshCw, Calendar, Award, Flame, AlertCircle, CheckCircle2, ChevronRight, Layers, Target, Users, Briefcase, Activity, Clock, ShieldAlert, Sparkles, ExternalLink, Search, SlidersHorizontal, ArrowUpDown } from "lucide-react";
import { API_BASE_URL } from "@/config";
import { useRole } from "@/context/RoleContext";
import {
  Currency, useCurrency, money, num, pctf, PALETTE, TOOLTIP_STYLE, AXIS_TICK,
  Tile, Card, SectionTitle, Meter, Empty, Pill, Skeleton, CurrencyToggle, Segmented,
  relTime, statusColor
} from "@/components/analytics/kit";

export default function LeadSourceAnalyticsPage() {
  const { role, loading: roleLoading } = useRole();
  const router = useRouter();
  const [currency, setCurrency] = useCurrency();

  const [rangePreset, setRangePreset] = useState<string>("12m");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [showCustom, setShowCustom] = useState<boolean>(false);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState<boolean>(false);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);

  // Table state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [channelFilter, setChannelFilter] = useState<string>("ALL");
  const [tableTab, setTableTab] = useState<"overview" | "funnel" | "revenue" | "cost">("overview");
  const [sortBy, setSortBy] = useState<string>("leads");
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  // Check access
  const canAccess = useMemo(() => {
    if (!role) return false;
    const r = role.toLowerCase();
    return ["admin", "superadmin", "demo", "salesmanager", "employee"].includes(r);
  }, [role]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      let query = "";
      if (rangePreset === "custom" && customStart && customEnd) {
        query = `?start=${customStart}&end=${customEnd}`;
      } else if (rangePreset === "30d") {
        const d = new Date(); d.setDate(d.getDate() - 30);
        query = `?start=${d.toISOString().slice(0, 10)}`;
      } else if (rangePreset === "90d") {
        const d = new Date(); d.setDate(d.getDate() - 90);
        query = `?start=${d.toISOString().slice(0, 10)}`;
      } else if (rangePreset === "6m") {
        query = `?months=6`;
      } else if (rangePreset === "12m") {
        query = `?months=12`;
      } else if (rangePreset === "all") {
        query = `?months=36`;
      }

      const res = await fetch(`${API_BASE_URL}/analytics/lead-sources/full${query}`);
      if (!res.ok) {
        throw new Error(`Failed to load lead source analytics (${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to fetch analytics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!roleLoading && canAccess) {
      fetchData();
    }
  }, [roleLoading, canAccess, rangePreset, customStart, customEnd]);

  const handleBackfill = async () => {
    setBackfilling(true);
    setBackfillMsg(null);
    try {
      const res = await fetch(`${API_BASE_URL}/lead-sources/backfill`, { method: "POST" });
      if (res.ok) {
        const json = await res.json();
        setBackfillMsg(`Backfilled: ${json.updated_leads || 0} leads & ${json.updated_clients || 0} clients mapped.`);
        fetchData();
      } else {
        setBackfillMsg("Backfill failed or route unavailable.");
      }
    } catch (e: any) {
      setBackfillMsg("Backfill request error.");
    } finally {
      setBackfilling(false);
    }
  };

  const sourcesList = data?.sources || [];
  const totals = data?.totals || {};
  const highlights = data?.highlights || {};
  const momentum = data?.momentum || {};

  // Filtered & sorted sources for master table
  const filteredSources = useMemo(() => {
    let list = [...sourcesList];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((s: any) =>
        (s.source || "").toLowerCase().includes(q) ||
        (s.channel || "").toLowerCase().includes(q) ||
        (s.utm_key || "").toLowerCase().includes(q)
      );
    }
    if (channelFilter !== "ALL") {
      list = list.filter((s: any) => s.channel === channelFilter);
    }
    list.sort((a: any, b: any) => {
      let va = a[sortBy];
      let vb = b[sortBy];
      if (va === null || va === undefined) va = -Infinity;
      if (vb === null || vb === undefined) vb = -Infinity;
      if (typeof va === "string") {
        return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sortAsc ? va - vb : vb - va;
    });
    return list;
  }, [sourcesList, searchQuery, channelFilter, sortBy, sortAsc]);

  const channelsList = useMemo(() => {
    const set = new Set<string>();
    sourcesList.forEach((s: any) => {
      if (s.channel && s.channel !== "—") set.add(s.channel);
    });
    return ["ALL", ...Array.from(set)];
  }, [sourcesList]);

  if (roleLoading) {
    return (
      <div className="min-h-[500px] flex items-center justify-center p-8">
        <Skeleton className="w-64 h-12" />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="p-8 text-center max-w-md mx-auto mt-12 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-lg">
        <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-[var(--text-primary)]">Access Restricted</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-2">
          You need Sales Manager or Admin privileges to view Lead Source Analytics.
        </p>
        <Link href="/" className="inline-block mt-6 px-4 py-2 bg-[var(--primary)] text-white rounded-lg font-bold text-sm">
          Return to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16">
      {/* ── Top Bar & Filter Controls ───────────────────────────── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-[var(--border)] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500">
              <Zap className="h-6 w-6" />
            </span>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-[var(--text-primary)]">
                Lead Source Analytics & ROI
              </h1>
              <p className="text-xs font-semibold text-[var(--text-secondary)] mt-0.5">
                Every acquisition channel, conversion metrics, deal pipeline, revenue, and CAC in one command view
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Preset range */}
          <Segmented
            value={rangePreset}
            onChange={(v) => {
              setRangePreset(v);
              if (v !== "custom") setShowCustom(false);
              else setShowCustom(true);
            }}
            options={[
              { value: "30d", label: "30 Days" },
              { value: "90d", label: "90 Days" },
              { value: "6m", label: "6 Months" },
              { value: "12m", label: "12 Months" },
              { value: "all", label: "All Time" },
              { value: "custom", label: "Custom" },
            ]}
          />

          <CurrencyToggle value={currency} onChange={setCurrency} />

          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--sidebar-hover)] transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>

          <Link
            href="/lead-sources"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-xs font-bold shadow hover:opacity-90 transition-opacity"
          >
            Manage Sources
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Custom Date Inputs if selected */}
      {showCustom && (
        <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold">
          <Calendar className="h-4 w-4 text-[var(--primary)]" />
          <span className="text-[var(--text-secondary)]">Custom Range:</span>
          <label className="flex items-center gap-1">
            <span>From:</span>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-2 py-1 rounded border border-[var(--border)] bg-transparent text-[var(--text-primary)]"
            />
          </label>
          <label className="flex items-center gap-1">
            <span>To:</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-2 py-1 rounded border border-[var(--border)] bg-transparent text-[var(--text-primary)]"
            />
          </label>
          <button
            onClick={fetchData}
            className="px-3 py-1 rounded bg-[var(--primary)] text-white text-xs font-bold"
          >
            Apply
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-500 text-sm font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={fetchData} className="underline text-xs font-bold">Retry</button>
        </div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <>
          {/* ── HIGHLIGHT BEST STATS CARDS ───────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[11px] font-black uppercase tracking-wider text-[var(--text-secondary)]">
                Performance Hall of Fame
              </span>
              <span className="text-[10px] font-medium text-[var(--text-secondary)]">
                Auto-calculated leaderboards for this period
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
              {highlights.top_volume && (
                <Link
                  href={`/lead-source-analytics/${highlights.top_volume.source_id || 0}`}
                  className="group p-3 rounded-xl border border-indigo-500/20 bg-indigo-500/5 hover:border-indigo-500 transition-all shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-indigo-500">Top Lead Volume</span>
                    <Flame className="h-3.5 w-3.5 text-indigo-500" />
                  </div>
                  <p className="mt-1 text-sm font-extrabold text-[var(--text-primary)] truncate">{highlights.top_volume.source}</p>
                  <p className="text-xl font-black text-indigo-500 mt-0.5">{num(highlights.top_volume.value)} leads</p>
                </Link>
              )}

              {highlights.best_conversion && (
                <Link
                  href={`/lead-source-analytics/${highlights.best_conversion.source_id || 0}`}
                  className="group p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500 transition-all shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-500">Best Conversion</span>
                    <Award className="h-3.5 w-3.5 text-emerald-500" />
                  </div>
                  <p className="mt-1 text-sm font-extrabold text-[var(--text-primary)] truncate">{highlights.best_conversion.source}</p>
                  <p className="text-xl font-black text-emerald-500 mt-0.5">{pctf(highlights.best_conversion.value)}</p>
                </Link>
              )}

              {highlights.top_revenue && (
                <Link
                  href={`/lead-source-analytics/${highlights.top_revenue.source_id || 0}`}
                  className="group p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 hover:border-amber-500 transition-all shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-500">Top Won Revenue</span>
                    <IndianRupee className="h-3.5 w-3.5 text-amber-500" />
                  </div>
                  <p className="mt-1 text-sm font-extrabold text-[var(--text-primary)] truncate">{highlights.top_revenue.source}</p>
                  <p className="text-xl font-black text-amber-500 mt-0.5">{money(highlights.top_revenue.value, currency, true)}</p>
                </Link>
              )}

              {highlights.best_roi && data?.can_see_finance && (
                <Link
                  href={`/lead-source-analytics/${highlights.best_roi.source_id || 0}`}
                  className="group p-3 rounded-xl border border-teal-500/20 bg-teal-500/5 hover:border-teal-500 transition-all shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-teal-500">Highest ROI</span>
                    <TrendingUp className="h-3.5 w-3.5 text-teal-500" />
                  </div>
                  <p className="mt-1 text-sm font-extrabold text-[var(--text-primary)] truncate">{highlights.best_roi.source}</p>
                  <p className="text-xl font-black text-teal-500 mt-0.5">{pctf(highlights.best_roi.value)}</p>
                </Link>
              )}

              {highlights.fastest_closer && (
                <Link
                  href={`/lead-source-analytics/${highlights.fastest_closer.source_id || 0}`}
                  className="group p-3 rounded-xl border border-sky-500/20 bg-sky-500/5 hover:border-sky-500 transition-all shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-sky-500">Fastest Sales Cycle</span>
                    <Clock className="h-3.5 w-3.5 text-sky-500" />
                  </div>
                  <p className="mt-1 text-sm font-extrabold text-[var(--text-primary)] truncate">{highlights.fastest_closer.source}</p>
                  <p className="text-xl font-black text-sky-500 mt-0.5">{highlights.fastest_closer.value}d avg</p>
                </Link>
              )}

              {highlights.biggest_deals && (
                <Link
                  href={`/lead-source-analytics/${highlights.biggest_deals.source_id || 0}`}
                  className="group p-3 rounded-xl border border-violet-500/20 bg-violet-500/5 hover:border-violet-500 transition-all shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-violet-500">Biggest Deals</span>
                    <Briefcase className="h-3.5 w-3.5 text-violet-500" />
                  </div>
                  <p className="mt-1 text-sm font-extrabold text-[var(--text-primary)] truncate">{highlights.biggest_deals.source}</p>
                  <p className="text-xl font-black text-violet-500 mt-0.5">{money(highlights.biggest_deals.value, currency, true)}</p>
                </Link>
              )}

              {highlights.needs_attention && (
                <Link
                  href={`/lead-source-analytics/${highlights.needs_attention.source_id || 0}`}
                  className="group p-3 rounded-xl border border-rose-500/30 bg-rose-500/5 hover:border-rose-500 transition-all shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-rose-500">Needs Attention</span>
                    <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                  </div>
                  <p className="mt-1 text-sm font-extrabold text-[var(--text-primary)] truncate">{highlights.needs_attention.source}</p>
                  <p className="text-xl font-black text-rose-500 mt-0.5">
                    {pctf(highlights.needs_attention.value)} <span className="text-xs font-semibold text-[var(--text-secondary)]">({highlights.needs_attention.leads} leads)</span>
                  </p>
                </Link>
              )}
            </div>
          </div>

          {/* ── MACRO KPI TILES (Clickable to deeper pages) ─────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <Tile
              label="Total Inbound Leads"
              value={num(totals.leads)}
              delta={momentum.leads?.change_pct}
              icon={Users}
              tone="indigo"
              sub={`${totals.active_sources || 0} active sources`}
              href="/leads"
            />
            <Tile
              label="Contacted Leads"
              value={num(totals.contacted)}
              sub={`${pctf(totals.leads ? (totals.contacted / totals.leads) * 100 : 0)} outreach rate`}
              icon={Activity}
              tone="sky"
              href="/leads"
            />
            <Tile
              label="Total Converted"
              value={num(totals.converted)}
              delta={momentum.converted?.change_pct}
              sub={`${pctf(totals.conversion_rate)} conv rate`}
              icon={CheckCircle2}
              tone="emerald"
              href="/leads?status=Converted"
            />
            <Tile
              label="Won Revenue"
              value={money(totals.won_revenue, currency, true)}
              delta={momentum.won_revenue?.change_pct}
              sub={`${num(totals.won_deals)} won deals (${pctf(totals.win_rate)} win rate)`}
              icon={IndianRupee}
              tone="amber"
              href="/revenue"
            />
            <Tile
              label="Pipeline Value"
              value={money(totals.pipeline_value, currency, true)}
              sub={`${num(totals.open_deals)} active deals`}
              icon={Target}
              tone="violet"
              href="/pipeline"
            />
            <Tile
              label="Avg Deal Size"
              value={money(totals.avg_deal_size, currency, true)}
              sub={`Rev/Lead: ${money(totals.revenue_per_lead, currency, true)}`}
              icon={Briefcase}
              tone="teal"
              href="/pipeline"
            />

            {data?.can_see_finance && (
              <>
                <Tile
                  label="Marketing Cost"
                  value={money(totals.total_cost, currency, true)}
                  sub={`${totals.months}mo period`}
                  icon={IndianRupee}
                  tone="slate"
                  href="/business-costs"
                />
                <Tile
                  label="Cost Per Lead (CPL)"
                  value={money(totals.cost_per_lead, currency, true)}
                  sub="Blended acquisition"
                  icon={Target}
                  tone="orange"
                  href="/business-costs"
                />
                <Tile
                  label="Cost Per Converted (CAC)"
                  value={money(totals.cost_per_conversion, currency, true)}
                  sub="Per paying customer"
                  icon={Flame}
                  tone="rose"
                  href="/business-costs"
                />
                <Tile
                  label="Blended ROI"
                  value={pctf(totals.roi_pct)}
                  sub={`ROAS: ${totals.roas ? totals.roas + "x" : "—"}`}
                  icon={TrendingUp}
                  tone={totals.roi_pct && totals.roi_pct > 0 ? "emerald" : "rose"}
                  href="/revenue"
                />
                <Tile
                  label="Net Revenue Gain"
                  value={money(totals.net_after_cost, currency, true)}
                  sub="Won Rev minus ad spend"
                  icon={IndianRupee}
                  tone="emerald"
                  href="/revenue"
                />
              </>
            )}

            <Tile
              label="Avg Sales Cycle"
              value={totals.avg_cycle_days ? `${totals.avg_cycle_days}d` : "—"}
              sub="Lead created → Won deal"
              icon={Clock}
              tone="indigo"
              href="/pipeline"
            />
          </div>

          {/* ── CONVERSION FUNNEL OVERVIEW ─────────────────────────── */}
          <Card
            title="End-to-End Acquisition Funnel"
            icon={Filter}
            tone="indigo"
            href="/leads"
            linkLabel="View All Leads"
          >
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              {[
                { label: "1. Total Leads", count: totals.leads, pct: 100, color: "#6366f1" },
                { label: "2. Contacted", count: totals.contacted, pct: totals.leads ? (totals.contacted / totals.leads) * 100 : 0, color: "#0ea5e9" },
                { label: "3. Responded", count: totals.responded, pct: totals.leads ? (totals.responded / totals.leads) * 100 : 0, color: "#8b5cf6" },
                { label: "4. Positive", count: totals.positive, pct: totals.leads ? (totals.positive / totals.leads) * 100 : 0, color: "#f59e0b" },
                { label: "5. Converted", count: totals.converted, pct: totals.leads ? (totals.converted / totals.leads) * 100 : 0, color: "#10b981" },
                { label: "6. Closed Won", count: totals.won_deals, pct: totals.leads ? (totals.won_deals / totals.leads) * 100 : 0, color: "#14b8a6" },
              ].map((step, idx) => (
                <div key={idx} className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)]/50">
                  <div className="flex items-center justify-between text-[11px] font-bold text-[var(--text-secondary)]">
                    <span>{step.label}</span>
                    <span style={{ color: step.color }}>{step.pct.toFixed(0)}%</span>
                  </div>
                  <p className="text-xl font-black text-[var(--text-primary)] mt-1">{num(step.count)}</p>
                  <div className="mt-2">
                    <Meter value={step.pct} max={100} color={step.color} height={4} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* ── CHARTS ROW 1: LEADS BY SOURCE & REVENUE SHARE ──────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card
              title="Leads & Conversions by Source"
              icon={Layers}
              tone="indigo"
              right={
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                  Volume comparison
                </span>
              }
            >
              <div className="h-72 w-full">
                {sourcesList.length === 0 ? (
                  <Empty text="No source data recorded yet" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={sourcesList.filter((s: any) => s.leads > 0).slice(0, 10)}
                      margin={{ top: 10, right: 10, left: -20, bottom: 25 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                      <XAxis
                        dataKey="source"
                        tick={AXIS_TICK}
                        angle={-20}
                        textAnchor="end"
                        interval={0}
                      />
                      <YAxis tick={AXIS_TICK} />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(val: any, name: any) => [num(val), name === "leads" ? "Total Leads" : "Converted"]}
                      />
                      <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                      <Bar dataKey="leads" name="Total Leads" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="converted" name="Converted" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card
              title="Revenue Contribution by Source"
              icon={IndianRupee}
              tone="amber"
              href="/revenue"
              linkLabel="Revenue Deep Dive"
            >
              <div className="h-72 w-full flex items-center justify-center">
                {sourcesList.every((s: any) => !s.won_revenue) ? (
                  <Empty text="No won revenue recorded yet for sources in this range" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={sourcesList.filter((s: any) => s.won_revenue > 0)}
                        dataKey="won_revenue"
                        nameKey="source"
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={3}
                      >
                        {sourcesList.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={entry.color || PALETTE[index % PALETTE.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(val: any) => [money(val, currency), "Won Revenue"]}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
          </div>

          {/* ── CHARTS ROW 2: MONTHLY TREND & CONVERSION RATE ──────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card
              title="Monthly Lead Inflow Trend"
              icon={TrendingUp}
              tone="sky"
              right={
                <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
                  Cohort by creation month
                </span>
              }
            >
              <div className="h-72 w-full">
                {(data?.trend || []).length === 0 ? (
                  <Empty text="No monthly trend data" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                        </linearGradient>
                        <linearGradient id="colorConv" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                      <XAxis dataKey="label" tick={AXIS_TICK} />
                      <YAxis tick={AXIS_TICK} />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(val: any, name: any) => [num(val), name === "leads" ? "Leads" : "Converted"]}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="leads" name="Leads" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorLeads)" />
                      <Area type="monotone" dataKey="converted" name="Converted" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorConv)" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card
              title="Source Status Matrix"
              icon={Layers}
              tone="violet"
              right={
                <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
                  Lead stage distribution per source
                </span>
              }
            >
              <div className="h-72 w-full">
                {(data?.status_matrix || []).length === 0 ? (
                  <Empty text="No leads to display" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.status_matrix.slice(0, 8)}
                      margin={{ top: 10, right: 10, left: -20, bottom: 25 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                      <XAxis dataKey="source" tick={AXIS_TICK} angle={-20} textAnchor="end" interval={0} />
                      <YAxis tick={AXIS_TICK} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 10, paddingTop: 10 }} />
                      <Bar dataKey="New" stackId="a" fill="#3b82f6" />
                      <Bar dataKey="Contacted" stackId="a" fill="#0ea5e9" />
                      <Bar dataKey="Neutral" stackId="a" fill="#f59e0b" />
                      <Bar dataKey="Positive" stackId="a" fill="#14b8a6" />
                      <Bar dataKey="Converted" stackId="a" fill="#10b981" />
                      <Bar dataKey="Negative" stackId="a" fill="#ef4444" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
          </div>

          {/* ── CHANNEL & WEEKDAY BREAKDOWNS ──────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card title="Acquisition Channels" icon={Target} tone="indigo" className="md:col-span-1">
              <div className="space-y-2.5">
                {(data?.channels || []).map((ch: any) => (
                  <div key={ch.channel} className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]/50">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-[var(--text-primary)]">{ch.channel}</span>
                      <span className="text-indigo-500">{num(ch.leads)} leads</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)] mt-1">
                      <span>Conv: {pctf(ch.conversion_rate)}</span>
                      <span>Rev: {money(ch.won_revenue, currency, true)}</span>
                    </div>
                    <div className="mt-1.5">
                      <Meter value={ch.leads} max={totals.leads || 1} color="#6366f1" height={3} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Best Days of Week" icon={Calendar} tone="teal" className="md:col-span-1">
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data?.weekdays || []} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                    <XAxis dataKey="day" tick={AXIS_TICK} />
                    <YAxis tick={AXIS_TICK} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="leads" name="Leads" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="converted" name="Converted" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Industry Breakdown" icon={Briefcase} tone="amber" className="md:col-span-1">
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {(data?.industries || []).map((ind: any) => (
                  <div key={ind.industry} className="flex items-center justify-between text-xs py-1 border-b border-[var(--border)] last:border-0">
                    <span className="font-semibold text-[var(--text-primary)] truncate max-w-[140px]">
                      {ind.industry}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--text-secondary)]">{ind.leads} leads</span>
                      <span className="text-emerald-500 font-bold">{pctf(ind.conversion_rate)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* ── MASTER DATA TABLE: EVERY STAT FOR EVERY SOURCE ────── */}
          <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <header className="border-b border-[var(--border)] bg-[var(--sidebar-hover)]/30 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-base font-extrabold text-[var(--text-primary)] flex items-center gap-2">
                    <Layers className="h-4 w-4 text-indigo-500" />
                    Master Lead Sources Directory ({filteredSources.length})
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    Click any source row to drill down into its dedicated profile, lead contacts, deals and conversion history
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--text-secondary)]" />
                    <input
                      type="text"
                      placeholder="Search source / UTM..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 pr-3 py-1 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] w-44 focus:outline-none focus:border-[var(--primary)]"
                    />
                  </div>

                  {/* Channel select */}
                  <select
                    value={channelFilter}
                    onChange={(e) => setChannelFilter(e.target.value)}
                    className="px-2.5 py-1 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] font-semibold"
                  >
                    {channelsList.map((ch) => (
                      <option key={ch} value={ch}>{ch === "ALL" ? "All Channels" : ch}</option>
                    ))}
                  </select>

                  {/* Column tabs */}
                  <Segmented
                    value={tableTab}
                    onChange={(v) => setTableTab(v as any)}
                    options={[
                      { value: "overview", label: "Overview" },
                      { value: "funnel", label: "Funnel Stages" },
                      { value: "revenue", label: "Revenue & Deals" },
                      ...(data?.can_see_finance ? [{ value: "cost", label: "Cost & ROI" }] : []),
                    ]}
                  />
                </div>
              </div>
            </header>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--border)] bg-[var(--sidebar-hover)]/40 text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)]">
                  <tr>
                    <th className="py-3 px-4 cursor-pointer" onClick={() => { setSortBy("source"); setSortAsc(!sortAsc); }}>
                      <span className="flex items-center gap-1">Source <ArrowUpDown className="h-3 w-3" /></span>
                    </th>
                    <th className="py-3 px-3">Channel</th>

                    {tableTab === "overview" && (
                      <>
                        <th className="py-3 px-3 text-right cursor-pointer" onClick={() => { setSortBy("leads"); setSortAsc(!sortAsc); }}>
                          <span className="flex items-center justify-end gap-1">Leads <ArrowUpDown className="h-3 w-3" /></span>
                        </th>
                        <th className="py-3 px-3 text-right cursor-pointer" onClick={() => { setSortBy("converted"); setSortAsc(!sortAsc); }}>
                          <span className="flex items-center justify-end gap-1">Converted <ArrowUpDown className="h-3 w-3" /></span>
                        </th>
                        <th className="py-3 px-3 text-right cursor-pointer" onClick={() => { setSortBy("conversion_rate"); setSortAsc(!sortAsc); }}>
                          <span className="flex items-center justify-end gap-1">Conv % <ArrowUpDown className="h-3 w-3" /></span>
                        </th>
                        <th className="py-3 px-3 text-right">Won Deals</th>
                        <th className="py-3 px-3 text-right cursor-pointer" onClick={() => { setSortBy("won_revenue"); setSortAsc(!sortAsc); }}>
                          <span className="flex items-center justify-end gap-1">Won Rev <ArrowUpDown className="h-3 w-3" /></span>
                        </th>
                        <th className="py-3 px-3 text-right">Rev / Lead</th>
                        <th className="py-3 px-3 text-center cursor-pointer" onClick={() => { setSortBy("quality_score"); setSortAsc(!sortAsc); }}>
                          <span className="flex items-center justify-center gap-1">Score <ArrowUpDown className="h-3 w-3" /></span>
                        </th>
                      </>
                    )}

                    {tableTab === "funnel" && (
                      <>
                        <th className="py-3 px-3 text-right">Total Leads</th>
                        <th className="py-3 px-3 text-right">New</th>
                        <th className="py-3 px-3 text-right">Contacted</th>
                        <th className="py-3 px-3 text-right">Responded</th>
                        <th className="py-3 px-3 text-right">Positive</th>
                        <th className="py-3 px-3 text-right">Negative</th>
                        <th className="py-3 px-3 text-right">Converted</th>
                        <th className="py-3 px-3 text-right">Conv Rate</th>
                      </>
                    )}

                    {tableTab === "revenue" && (
                      <>
                        <th className="py-3 px-3 text-right">Clients</th>
                        <th className="py-3 px-3 text-right">Total Deals</th>
                        <th className="py-3 px-3 text-right">Won Deals</th>
                        <th className="py-3 px-3 text-right">Win Rate</th>
                        <th className="py-3 px-3 text-right">Won Revenue</th>
                        <th className="py-3 px-3 text-right">Avg Deal Size</th>
                        <th className="py-3 px-3 text-right">Pipeline Val</th>
                        <th className="py-3 px-3 text-right">Avg Cycle</th>
                      </>
                    )}

                    {tableTab === "cost" && (
                      <>
                        <th className="py-3 px-3 text-right">Monthly Spend</th>
                        <th className="py-3 px-3 text-right">Total Spend</th>
                        <th className="py-3 px-3 text-right">Cost / Lead (CPL)</th>
                        <th className="py-3 px-3 text-right">Cost / Conv (CAC)</th>
                        <th className="py-3 px-3 text-right">Won Rev</th>
                        <th className="py-3 px-3 text-right">ROI %</th>
                        <th className="py-3 px-3 text-right">ROAS</th>
                      </>
                    )}

                    <th className="py-3 px-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] font-medium">
                  {filteredSources.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-[var(--text-secondary)]">
                        No sources matched the criteria
                      </td>
                    </tr>
                  ) : (
                    filteredSources.map((s: any) => {
                      const detailUrl = `/lead-source-analytics/${s.source_id || 0}`;
                      return (
                        <tr
                          key={s.source_id || "unassigned"}
                          className="hover:bg-[var(--sidebar-hover)]/60 cursor-pointer transition-colors"
                          onClick={() => router.push(detailUrl)}
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span
                                className="h-3 w-3 rounded-full shrink-0"
                                style={{ backgroundColor: s.color || "#94a3b8" }}
                              />
                              <div>
                                <span className="font-extrabold text-[var(--text-primary)] block hover:text-[var(--primary)]">
                                  {s.source}
                                </span>
                                {s.utm_key && (
                                  <span className="text-[10px] text-[var(--text-secondary)] font-mono">
                                    utm: {s.utm_key}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <Pill color={s.color || "#6366f1"}>{s.channel}</Pill>
                          </td>

                          {tableTab === "overview" && (
                            <>
                              <td className="py-3 px-3 text-right font-extrabold text-[var(--text-primary)]">
                                {num(s.leads)}
                              </td>
                              <td className="py-3 px-3 text-right font-bold text-emerald-600">
                                {num(s.converted)}
                              </td>
                              <td className="py-3 px-3 text-right font-bold">
                                {pctf(s.conversion_rate)}
                              </td>
                              <td className="py-3 px-3 text-right">
                                {s.won_deals}
                              </td>
                              <td className="py-3 px-3 text-right font-extrabold text-amber-600">
                                {money(s.won_revenue, currency)}
                              </td>
                              <td className="py-3 px-3 text-right text-[var(--text-secondary)]">
                                {money(s.revenue_per_lead, currency)}
                              </td>
                              <td className="py-3 px-3 text-center">
                                <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-black ${
                                  s.quality_score >= 70 ? "bg-emerald-500/10 text-emerald-600" :
                                  s.quality_score >= 40 ? "bg-amber-500/10 text-amber-600" :
                                  "bg-slate-500/10 text-slate-500"
                                }`}>
                                  {s.quality_score}/100
                                </span>
                              </td>
                            </>
                          )}

                          {tableTab === "funnel" && (
                            <>
                              <td className="py-3 px-3 text-right font-bold">{num(s.leads)}</td>
                              <td className="py-3 px-3 text-right text-blue-500">{num(s.new)}</td>
                              <td className="py-3 px-3 text-right text-sky-500">{num(s.contacted)}</td>
                              <td className="py-3 px-3 text-right text-purple-500">{num(s.responded)}</td>
                              <td className="py-3 px-3 text-right text-amber-500">{num(s.positive_total)}</td>
                              <td className="py-3 px-3 text-right text-rose-500">{num(s.negative)}</td>
                              <td className="py-3 px-3 text-right font-bold text-emerald-500">{num(s.converted)}</td>
                              <td className="py-3 px-3 text-right font-bold">{pctf(s.conversion_rate)}</td>
                            </>
                          )}

                          {tableTab === "revenue" && (
                            <>
                              <td className="py-3 px-3 text-right">{num(s.clients)}</td>
                              <td className="py-3 px-3 text-right">{num(s.deals)}</td>
                              <td className="py-3 px-3 text-right font-bold text-emerald-600">{num(s.won_deals)}</td>
                              <td className="py-3 px-3 text-right">{pctf(s.win_rate)}</td>
                              <td className="py-3 px-3 text-right font-bold text-amber-600">{money(s.won_revenue, currency)}</td>
                              <td className="py-3 px-3 text-right">{money(s.avg_deal_size, currency)}</td>
                              <td className="py-3 px-3 text-right text-[var(--text-secondary)]">{money(s.pipeline_value, currency)}</td>
                              <td className="py-3 px-3 text-right">{s.avg_cycle_days ? `${s.avg_cycle_days}d` : "—"}</td>
                            </>
                          )}

                          {tableTab === "cost" && (
                            <>
                              <td className="py-3 px-3 text-right">{money(s.monthly_cost, currency)}</td>
                              <td className="py-3 px-3 text-right font-bold">{money(s.total_cost, currency)}</td>
                              <td className="py-3 px-3 text-right">{money(s.cost_per_lead, currency)}</td>
                              <td className="py-3 px-3 text-right font-bold text-rose-600">{money(s.cost_per_conversion, currency)}</td>
                              <td className="py-3 px-3 text-right font-bold text-emerald-600">{money(s.won_revenue, currency)}</td>
                              <td className="py-3 px-3 text-right">
                                {s.roi_pct !== null && s.roi_pct !== undefined ? (
                                  <span className={s.roi_pct >= 0 ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>
                                    {pctf(s.roi_pct)}
                                  </span>
                                ) : "—"}
                              </td>
                              <td className="py-3 px-3 text-right font-bold">{s.roAS ? `${s.roAS}x` : (s.roas ? `${s.roas}x` : "—")}</td>
                            </>
                          )}

                          <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <Link
                              href={detailUrl}
                              className="p-1 rounded hover:bg-[var(--primary)]/10 text-[var(--primary)] inline-flex items-center"
                              title="Open Detail View"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Link>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── DATA INTEGRITY & ATTRIBUTION PANEL ────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card
              title="Data Integrity & Source Attribution"
              icon={ShieldAlert}
              tone="amber"
              className="lg:col-span-1"
            >
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-secondary)]">Total leads in period:</span>
                  <span className="font-bold text-[var(--text-primary)]">{data?.data_quality?.total_leads || 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-secondary)]">Unassigned source:</span>
                  <span className="font-bold text-amber-500">
                    {data?.data_quality?.unassigned_source || 0} ({pctf(data?.data_quality?.unassigned_pct)})
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-secondary)]">Missing email address:</span>
                  <span className="font-bold text-slate-400">{data?.data_quality?.missing_email || 0} ({pctf(data?.data_quality?.missing_email_pct)})</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-secondary)]">Missing phone number:</span>
                  <span className="font-bold text-slate-400">{data?.data_quality?.missing_phone || 0} ({pctf(data?.data_quality?.missing_phone_pct)})</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-secondary)]">Missing owner/rep:</span>
                  <span className="font-bold text-slate-400">{data?.data_quality?.missing_owner || 0} ({pctf(data?.data_quality?.missing_owner_pct)})</span>
                </div>

                <div className="pt-2 border-t border-[var(--border)]">
                  <button
                    onClick={handleBackfill}
                    disabled={backfilling}
                    className="w-full py-2 px-3 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white text-xs font-bold transition-all disabled:opacity-50"
                  >
                    {backfilling ? "Running Backfill..." : "Auto-Map Existing Leads to Sources"}
                  </button>
                  {backfillMsg && (
                    <p className="text-[11px] text-emerald-600 mt-2 font-semibold text-center">{backfillMsg}</p>
                  )}
                </div>
              </div>
            </Card>

            {/* Sales Rep × Source Table (Admin only) */}
            {data?.can_see_finance && (data?.owners || []).length > 0 && (
              <Card
                title="Sales Rep Attribution"
                icon={Users}
                tone="teal"
                className="lg:col-span-1"
                href="/admin/sales-team"
                linkLabel="Team Directory"
              >
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1 text-xs">
                  {(data.owners || []).map((o: any) => (
                    <div key={o.user_id || o.owner} className="p-2 rounded-lg border border-[var(--border)] bg-[var(--surface)]/40 flex items-center justify-between">
                      <div>
                        <p className="font-bold text-[var(--text-primary)]">{o.owner}</p>
                        <p className="text-[10px] text-[var(--text-secondary)]">
                          Top: {o.top_source || "None"} • {o.leads} leads
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-emerald-600">{pctf(o.conversion_rate)} conv</p>
                        <p className="text-[10px] font-semibold text-amber-600">{money(o.won_revenue, currency, true)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Recent Leads Feed */}
            <Card
              title="Recent Inbound Leads"
              icon={Sparkles}
              tone="indigo"
              className={data?.can_see_finance && (data?.owners || []).length > 0 ? "lg:col-span-1" : "lg:col-span-2"}
              href="/leads"
              linkLabel="View All Leads"
            >
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1 text-xs">
                {(data?.recent_leads || []).slice(0, 7).map((l: any) => (
                  <Link
                    key={l.id}
                    href={`/leads/${l.id}`}
                    className="p-2 rounded-lg border border-[var(--border)] bg-[var(--surface)]/40 flex items-center justify-between hover:border-[var(--primary)] transition-all block"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="font-bold text-[var(--text-primary)] truncate">{l.company_name || `Lead #${l.id}`}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: l.color }} />
                        <span className="text-[10px] text-[var(--text-secondary)] truncate">{l.source}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <Pill color={statusColor(l.status)}>{l.status}</Pill>
                      <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">{relTime(l.created_at)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
