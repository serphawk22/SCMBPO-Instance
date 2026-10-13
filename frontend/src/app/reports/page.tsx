"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Legend, PieChart, Pie, Cell
} from "recharts";
import {
  FileText, Users, DollarSign, TrendingUp, Target, Clock, Calendar, CheckCircle2,
  AlertCircle, AlertTriangle, Briefcase, Zap, Phone, Mail, Award, Flame,
  Download, RefreshCw, Search, ChevronRight, UserCheck, ShieldAlert,
  ArrowUpRight, ArrowUpDown, Filter, Sparkles, Building2, Layers
} from "lucide-react";
import { jsPDF } from "jspdf";
import { API_BASE_URL } from "@/config";
import { useRole } from "@/context/RoleContext";
import {
  Currency, useCurrency, money, num, pctf, PALETTE, TOOLTIP_STYLE, AXIS_TICK,
  Tile, Card, Pill, Skeleton, CurrencyToggle, Segmented, relTime, statusColor, Meter
} from "@/components/analytics/kit";

export default function ReportsPage() {
  const { role, loading: roleLoading } = useRole();
  const [currency, setCurrency] = useCurrency();

  const [rangePreset, setRangePreset] = useState<string>("12m");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [showCustom, setShowCustom] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<"reps" | "financials" | "sources" | "pipeline">("reps");
  const [repSearch, setRepSearch] = useState<string>("");
  const [selectedRepId, setSelectedRepId] = useState<number | null>(null);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      let query = "";
      if (rangePreset === "custom" && customStart && customEnd) {
        query = `?start_date=${customStart}&end_date=${customEnd}`;
      } else if (rangePreset === "30d") {
        const d = new Date(); d.setDate(d.getDate() - 30);
        query = `?start_date=${d.toISOString().slice(0, 10)}`;
      } else if (rangePreset === "90d") {
        const d = new Date(); d.setDate(d.getDate() - 90);
        query = `?start_date=${d.toISOString().slice(0, 10)}`;
      } else if (rangePreset === "6m") {
        query = `?months=6`;
      } else if (rangePreset === "12m") {
        query = `?months=12`;
      } else if (rangePreset === "all") {
        query = `?months=36`;
      }

      const res = await fetch(`${API_BASE_URL}/reports/executive-dossier${query}`);
      if (!res.ok) {
        throw new Error(`Failed to load executive report (${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load report data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!roleLoading) {
      loadData();
    }
  }, [roleLoading, rangePreset, customStart, customEnd]);

  const kpis = data?.kpis || {};
  const reps = data?.reps || [];
  const sources = data?.lead_sources || [];
  const stages = data?.deal_stages || [];
  const costs = data?.cost_categories || [];
  const trend = data?.monthly_trend || [];

  // Filtered reps
  const filteredReps = useMemo(() => {
    if (!repSearch.trim()) return reps;
    const q = repSearch.toLowerCase();
    return reps.filter((r: any) =>
      (r.name || "").toLowerCase().includes(q) ||
      (r.email || "").toLowerCase().includes(q) ||
      (r.role || "").toLowerCase().includes(q)
    );
  }, [reps, repSearch]);

  const selectedRep = useMemo(() => {
    if (selectedRepId === null) return null;
    return reps.find((r: any) => r.user_id === selectedRepId) || null;
  }, [reps, selectedRepId]);

  // Export to PDF
  const exportPDF = () => {
    const doc = new jsPDF("p", "mm", "a4");
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Header
    doc.setFillColor(30, 41, 59);
    doc.rect(0, 0, pageWidth, 28, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("SerpHawk Executive CRM Dossier", 14, 14);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(148, 163, 184);
    doc.text(`Generated: ${new Date().toLocaleDateString()} | Range: ${rangePreset.toUpperCase()}`, 14, 22);

    y = 38;
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Executive Summary KPIs", 14, y);
    y += 8;

    // KPI Summary table
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    const kpiLines = [
      `Total Won Revenue: ${money(kpis.won_revenue, currency)} | Pipeline Value: ${money(kpis.pipeline_value, currency)}`,
      `Total Leads: ${num(kpis.total_leads)} | Converted: ${num(kpis.converted_leads)} (${pctf(kpis.conversion_rate)})`,
      `Total Deals: ${num(kpis.total_deals)} | Won Deals: ${num(kpis.won_deals)} (Win Rate: ${pctf(kpis.win_rate)})`,
      `Active Clients: ${num(kpis.active_clients)} | Active Reps: ${num(kpis.active_reps)} / ${num(kpis.total_staff)} staff`,
    ];
    if (kpis.total_costs !== null) {
      kpiLines.push(`Total Operating Spend: ${money(kpis.total_costs, currency)} | Net Profit: ${money(kpis.net_profit, currency)} (Margin: ${pctf(kpis.margin_pct)})`);
    }

    kpiLines.forEach((line) => {
      doc.text(line, 14, y);
      y += 6;
    });

    y += 6;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Salesperson Performance & Live Workload", 14, y);
    y += 8;

    // Reps list
    reps.forEach((r: any, idx: number) => {
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(`${idx + 1}. ${r.name} (${r.role || "Sales Rep"})`, 14, y);
      y += 5;
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.text(
        `Current: Handling ${r.active_leads} active leads, ${r.active_clients} active clients, ${r.open_deals} deals (${money(r.open_pipeline_value, currency)} pipeline)`,
        18, y
      );
      y += 4.5;
      doc.text(
        `Results: Won ${r.won_deals} deals (${money(r.won_revenue, currency)}) | Win Rate: ${pctf(r.win_rate)} | Conversion: ${pctf(r.conversion_rate)}`,
        18, y
      );
      y += 4.5;
      doc.text(
        `Workload: ${r.open_tasks} open tasks (${r.overdue_tasks} overdue) | ${r.pending_followups} follow-ups (${r.overdue_followups} overdue)`,
        18, y
      );
      y += 7;
    });

    doc.save(`SerpHawk_Executive_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div className="space-y-6 pb-20">
      {/* ── TOP HEADER & CONTROLS ─────────────────────────────────── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-[var(--border)] pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2.5 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 text-white shadow-md">
              <FileText className="h-6 w-6" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black tracking-tight text-[var(--text-primary)]">
                  Executive Business Intelligence & Reports
                </h1>
                <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 text-[10px] font-extrabold uppercase tracking-wider">
                  Owner Suite
                </span>
              </div>
              <p className="text-xs font-semibold text-[var(--text-secondary)] mt-0.5">
                Complete transparency for business owners: what each rep is doing, what they will do, won revenue, deals, lead sources, and profitability.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
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
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--sidebar-hover)] transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>

          <button
            onClick={exportPDF}
            disabled={loading || !data}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--primary)] text-white text-xs font-bold shadow hover:opacity-95 transition-all disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            Export Dossier (PDF)
          </button>
        </div>
      </div>

      {/* Custom Date Inputs if selected */}
      {showCustom && (
        <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold">
          <Calendar className="h-4 w-4 text-[var(--primary)]" />
          <span className="text-[var(--text-secondary)]">Custom Period:</span>
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
            onClick={loadData}
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
          <button onClick={loadData} className="underline text-xs font-bold">Retry</button>
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
          {/* ── MACRO SCORECARD FOR BUSINESS OWNER ─────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <Tile
              label="Total Won Revenue"
              value={money(kpis.won_revenue, currency, true)}
              sub={`${num(kpis.won_deals)} won deals (${pctf(kpis.win_rate)} win)`}
              icon={DollarSign}
              tone="emerald"
              href="/revenue"
            />
            <Tile
              label="Pipeline in Flight"
              value={money(kpis.pipeline_value, currency, true)}
              sub={`${num(kpis.total_deals)} total deals`}
              icon={Target}
              tone="indigo"
              href="/pipeline"
            />
            {data?.can_see_finance && kpis.total_costs !== null && (
              <>
                <Tile
                  label="Business Costs"
                  value={money(kpis.total_costs, currency, true)}
                  sub="Operating expenses"
                  icon={Briefcase}
                  tone="slate"
                  href="/business-costs"
                />
                <Tile
                  label="Net Operating Profit"
                  value={money(kpis.net_profit, currency, true)}
                  sub={`Margin: ${pctf(kpis.margin_pct)}`}
                  icon={TrendingUp}
                  tone={kpis.net_profit >= 0 ? "emerald" : "rose"}
                  href="/revenue"
                />
              </>
            )}
            <Tile
              label="Lead Conversion"
              value={pctf(kpis.conversion_rate)}
              sub={`${num(kpis.converted_leads)} of ${num(kpis.total_leads)} leads`}
              icon={CheckCircle2}
              tone="teal"
              href="/leads"
            />
            <Tile
              label="Active Accounts"
              value={num(kpis.active_clients)}
              sub={`${num(kpis.total_clients)} total clients`}
              icon={UserCheck}
              tone="sky"
              href="/clients"
            />
            <Tile
              label="Active Sales Team"
              value={`${num(kpis.active_reps)} / ${num(kpis.total_staff)}`}
              sub="Reps with live volume"
              icon={Users}
              tone="amber"
              href="/admin/sales-team"
            />
          </div>

          {/* ── REPORT NAVIGATION TABS ─────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
            <Segmented
              value={activeTab}
              onChange={(v) => setActiveTab(v as any)}
              options={[
                { value: "reps", label: `Sales Team Dossier (${reps.length} Reps)` },
                { value: "financials", label: "Financials & Profits" },
                { value: "sources", label: `Lead Sources & CAC (${sources.length})` },
                { value: "pipeline", label: "Pipeline & Deals" },
              ]}
            />

            {activeTab === "reps" && (
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--text-secondary)]" />
                <input
                  type="text"
                  placeholder="Filter rep name or role..."
                  value={repSearch}
                  onChange={(e) => setRepSearch(e.target.value)}
                  className="pl-8 pr-3 py-1 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] w-56 focus:outline-none focus:border-[var(--primary)]"
                />
              </div>
            )}
          </div>

          {/* ── TAB 1: SALES REPS DOSSIER (THE BUSINESS OWNER'S DEEP-DIVE) ── */}
          {activeTab === "reps" && (
            <div className="space-y-4">
              <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-3 text-xs text-[var(--text-secondary)] flex items-center justify-between">
                <span className="font-semibold text-indigo-500">
                  Business Owner View: Transparent breakdown of what each salesperson is doing right now, what commitments they have coming up, and what revenue/conversions they have produced.
                </span>
                <span className="text-[11px] font-bold text-[var(--text-primary)]">
                  {filteredReps.length} Sales Staff Evaluated
                </span>
              </div>

              {/* Master Reps Table & Dossier Cards */}
              <div className="grid grid-cols-1 gap-4">
                {filteredReps.map((rep: any) => (
                  <div
                    key={rep.user_id}
                    className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm hover:shadow-md transition-all"
                  >
                    {/* Header bar for rep */}
                    <header className="p-4 bg-[var(--sidebar-hover)]/40 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 text-white font-black flex items-center justify-center text-sm shadow">
                          {rep.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-extrabold text-[var(--text-primary)]">{rep.name}</h3>
                            <Pill color="#6366f1">{rep.role || "Sales Rep"}</Pill>
                          </div>
                          <p className="text-xs text-[var(--text-secondary)]">{rep.email}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-xs font-semibold">
                        <div className="text-right">
                          <span className="text-[10px] text-[var(--text-secondary)] uppercase block">Won Revenue</span>
                          <span className="text-base font-black text-amber-600">{money(rep.won_revenue, currency)}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-[var(--text-secondary)] uppercase block">Win Rate</span>
                          <span className="text-sm font-extrabold text-emerald-600">{pctf(rep.win_rate)}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-[var(--text-secondary)] uppercase block">Conv Rate</span>
                          <span className="text-sm font-extrabold text-blue-600">{pctf(rep.conversion_rate)}</span>
                        </div>
                      </div>
                    </header>

                    {/* Body: 3 Pillars: Currently Doing, Going to Do, Results Achieved */}
                    <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                      {/* Column 1: What is he doing RIGHT NOW? */}
                      <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)]/40 space-y-2.5">
                        <div className="flex items-center justify-between pb-1.5 border-b border-[var(--border)]">
                          <span className="font-extrabold text-[var(--text-primary)] flex items-center gap-1.5 text-xs text-sky-500">
                            <Clock className="h-3.5 w-3.5" /> What He Is Doing Right Now
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[var(--text-secondary)]">Active Leads Handling:</span>
                          <span className="font-bold text-[var(--text-primary)]">{rep.active_leads} leads</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[var(--text-secondary)]">Active Clients Assigned:</span>
                          <span className="font-bold text-[var(--text-primary)]">{rep.active_clients} accounts</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[var(--text-secondary)]">Open Deals in Flight:</span>
                          <span className="font-bold text-indigo-500">{rep.open_deals} deals ({money(rep.open_pipeline_value, currency, true)})</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[var(--text-secondary)]">Pending Tasks:</span>
                          <span className={`font-bold ${rep.overdue_tasks > 0 ? "text-rose-500" : "text-[var(--text-primary)]"}`}>
                            {rep.open_tasks} ({rep.overdue_tasks} overdue)
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[var(--text-secondary)]">Pending Follow-ups:</span>
                          <span className={`font-bold ${rep.overdue_followups > 0 ? "text-rose-500" : "text-[var(--text-primary)]"}`}>
                            {rep.pending_followups} ({rep.overdue_followups} overdue)
                          </span>
                        </div>
                        {rep.last_active_at && (
                          <div className="pt-1.5 border-t border-[var(--border)] flex items-center justify-between text-[11px]">
                            <span className="text-[var(--text-secondary)]">Last Active:</span>
                            <span className="text-emerald-600 font-semibold">{relTime(rep.last_active_at)}</span>
                          </div>
                        )}
                      </div>

                      {/* Column 2: What is he GOING TO DO? */}
                      <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)]/40 space-y-2.5">
                        <div className="flex items-center justify-between pb-1.5 border-b border-[var(--border)]">
                          <span className="font-extrabold text-[var(--text-primary)] flex items-center gap-1.5 text-xs text-purple-500">
                            <Calendar className="h-3.5 w-3.5" /> What He Is Going To Do
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[var(--text-secondary)]">Upcoming Meetings (≤14d):</span>
                          <span className="font-bold text-indigo-500">{(rep.upcoming_meetings || []).length} scheduled</span>
                        </div>
                        {(rep.upcoming_meetings || []).length > 0 && (
                          <div className="space-y-1">
                            {rep.upcoming_meetings.slice(0, 2).map((m: any) => (
                              <div key={m.id} className="p-1.5 rounded bg-[var(--sidebar-hover)]/60 text-[10px]">
                                <p className="font-bold text-[var(--text-primary)] truncate">{m.title}</p>
                                <p className="text-[var(--text-secondary)]">{relTime(m.scheduled_at)}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]">
                          <span className="text-[var(--text-secondary)]">Next Due Action:</span>
                          <span className="font-bold text-[var(--text-primary)]">
                            {rep.next_followup ? relTime(rep.next_followup.due_at) : "None scheduled"}
                          </span>
                        </div>
                        {rep.next_followup && (
                          <div className="p-1.5 rounded bg-[var(--sidebar-hover)]/60 text-[10px]">
                            <p className="font-bold text-[var(--text-primary)] truncate">{rep.next_followup.title}</p>
                            <p className="text-[var(--text-secondary)]">Via {rep.next_followup.channel}</p>
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]">
                          <span className="text-[var(--text-secondary)]">Deals Closing Soon:</span>
                          <span className="font-bold text-amber-500">{(rep.closing_soon_deals || []).length} deals</span>
                        </div>
                      </div>

                      {/* Column 3: Results & Track Record */}
                      <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)]/40 space-y-2.5">
                        <div className="flex items-center justify-between pb-1.5 border-b border-[var(--border)]">
                          <span className="font-extrabold text-[var(--text-primary)] flex items-center gap-1.5 text-xs text-emerald-500">
                            <Award className="h-3.5 w-3.5" /> Performance & Won Results
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[var(--text-secondary)]">Won Revenue:</span>
                          <span className="font-black text-amber-600">{money(rep.won_revenue, currency)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[var(--text-secondary)]">Won Deals:</span>
                          <span className="font-bold text-emerald-600">{rep.won_deals} closed won</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[var(--text-secondary)]">Deal Win Rate:</span>
                          <span className="font-bold text-[var(--text-primary)]">{pctf(rep.win_rate)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[var(--text-secondary)]">Lead Conversion Rate:</span>
                          <span className="font-bold text-blue-600">{pctf(rep.conversion_rate)} ({rep.converted_leads} / {rep.total_leads_handled})</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[var(--text-secondary)]">Avg Deal Size:</span>
                          <span className="font-bold text-[var(--text-primary)]">{money(rep.avg_deal_size, currency)}</span>
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-[var(--border)] text-[11px]">
                          <span className="text-[var(--text-secondary)]">Outreach Volume:</span>
                          <span className="font-semibold text-[var(--text-primary)]">{rep.calls_count} calls • {rep.emails_count} emails</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── TAB 2: FINANCIALS & PROFITABILITY ──────────────────── */}
          {activeTab === "financials" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Revenue vs Costs Trajectory */}
                <Card title="Revenue vs Operating Costs Trajectory" icon={TrendingUp} tone="emerald">
                  <div className="h-72 w-full">
                    {trend.length === 0 ? (
                      <p className="text-xs text-[var(--text-secondary)] text-center py-20">No monthly financial records</p>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="finWon" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                          <XAxis dataKey="label" tick={AXIS_TICK} />
                          <YAxis tick={AXIS_TICK} />
                          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [money(v, currency), "Won Revenue"]} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Area type="monotone" dataKey="won_revenue" name="Won Revenue" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#finWon)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </Card>

                {/* Cost Categories Breakdown */}
                {data?.can_see_finance && (
                  <Card title="Operating Spend by Category" icon={Briefcase} tone="slate">
                    <div className="space-y-3 max-h-72 overflow-y-auto pr-1 text-xs">
                      {costs.length === 0 ? (
                        <p className="text-xs text-[var(--text-secondary)] text-center py-20">No cost categories recorded</p>
                      ) : (
                        costs.map((c: any) => (
                          <div key={c.name} className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]/50">
                            <div className="flex items-center justify-between font-bold">
                              <span className="text-[var(--text-primary)]">{c.name}</span>
                              <span className="text-rose-500 font-black">{money(c.value, currency)}</span>
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                              <div className="flex-1">
                                <Meter value={c.pct} max={100} color="#ef4444" height={4} />
                              </div>
                              <span className="text-[10px] text-[var(--text-secondary)] font-bold">{c.pct}% of spend</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </Card>
                )}
              </div>
            </div>
          )}

          {/* ── TAB 3: LEAD SOURCES & CAC ATTRIBUTION ──────────────── */}
          {activeTab === "sources" && (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--sidebar-hover)]/40 border-b border-[var(--border)] text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)]">
                    <tr>
                      <th className="py-3 px-4">Lead Source</th>
                      <th className="py-3 px-3">Channel</th>
                      <th className="py-3 px-3 text-right">Inbound Leads</th>
                      <th className="py-3 px-3 text-right">Converted</th>
                      <th className="py-3 px-3 text-right">Conv %</th>
                      <th className="py-3 px-3 text-right">Won Deals</th>
                      <th className="py-3 px-3 text-right">Won Revenue</th>
                      {data?.can_see_finance && (
                        <>
                          <th className="py-3 px-3 text-right">Spend</th>
                          <th className="py-3 px-3 text-right">CPL</th>
                          <th className="py-3 px-3 text-right">CAC</th>
                          <th className="py-3 px-3 text-right">ROI %</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-medium">
                    {sources.map((s: any) => (
                      <tr key={s.source_id || "unassigned"} className="hover:bg-[var(--sidebar-hover)]/50">
                        <td className="py-3 px-4 font-bold text-[var(--text-primary)]">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color || "#94a3b8" }} />
                            <span>{s.source}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3"><Pill color={s.color || "#6366f1"}>{s.channel}</Pill></td>
                        <td className="py-3 px-3 text-right font-extrabold text-[var(--text-primary)]">{num(s.leads)}</td>
                        <td className="py-3 px-3 text-right font-bold text-emerald-600">{num(s.converted)}</td>
                        <td className="py-3 px-3 text-right font-bold">{pctf(s.conversion_rate)}</td>
                        <td className="py-3 px-3 text-right">{s.won_deals}</td>
                        <td className="py-3 px-3 text-right font-extrabold text-amber-600">{money(s.won_revenue, currency)}</td>
                        {data?.can_see_finance && (
                          <>
                            <td className="py-3 px-3 text-right">{money(s.total_cost, currency)}</td>
                            <td className="py-3 px-3 text-right">{money(s.cost_per_lead, currency)}</td>
                            <td className="py-3 px-3 text-right text-rose-600 font-bold">{money(s.cost_per_conversion, currency)}</td>
                            <td className="py-3 px-3 text-right font-bold text-emerald-600">{pctf(s.roi_pct)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── TAB 4: PIPELINE & DEALS VELOCITY ──────────────────── */}
          {activeTab === "pipeline" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {stages.map((st: any) => (
                  <div key={st.stage} className="p-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-sm text-[var(--text-primary)] flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: statusColor(st.stage) }} />
                        {st.stage}
                      </span>
                      <Pill color={statusColor(st.stage)}>{st.probability}% win</Pill>
                    </div>
                    <p className="text-xl font-black text-[var(--text-primary)] mt-3">
                      {money(st.value, currency)}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      {st.count} active opportunities
                    </p>
                    <div className="mt-3">
                      <Meter value={st.probability} max={100} color={statusColor(st.stage)} height={4} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
