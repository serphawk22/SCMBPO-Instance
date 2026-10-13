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
  ArrowUpRight, ArrowUpDown, Filter, Sparkles, Building2, Layers,
  CalendarDays, BarChart3, BriefcaseBusiness, FileSpreadsheet, ShieldCheck
} from "lucide-react";
import { jsPDF } from "jspdf";
import { API_BASE_URL } from "@/config";
import { useRole } from "@/context/RoleContext";
import {
  Currency, useCurrency, money, num, pctf, PALETTE, TOOLTIP_STYLE, AXIS_TICK,
  Tile, Card, Pill, Skeleton, CurrencyToggle, Segmented, relTime, statusColor, Meter
} from "@/components/analytics/kit";

// ─── CLASSIC REPORTS TABS & HELPERS ──────────────────────────────────────────
const classicTabs = [
  ["overview", "Overview"],
  ["sales", "Sales Report"],
  ["calls", "Calls"],
  ["meetings", "Meetings"],
  ["daily", "Daily Report"],
  ["monthly", "Monthly Report"],
  ["staff_performance", "Staff Performance"],
  ["lead_sources", "Lead Sources"],
  ["onboarding", "Client Onboarding"],
] as const;

const todayStr = new Date().toISOString().slice(0, 10);
const monthStartStr = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

function ClassicStat({ label, value, icon, tone }: { label: string; value: string | number; icon: React.ReactNode; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl text-white ${tone}`}>{icon}</div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

function ClassicTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-100 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400 dark:border-zinc-800 dark:bg-zinc-950">
          <tr>{headers.map(header => <th key={header} className="whitespace-nowrap px-4 py-3">{header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
          {rows.length ? rows.map((row, index) => (
            <tr key={index} className="hover:bg-slate-50/80 dark:hover:bg-zinc-800/40">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-zinc-300">{cell}</td>
              ))}
            </tr>
          )) : (
            <tr><td colSpan={headers.length} className="px-4 py-12 text-center text-sm text-slate-400">No records found in this range.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function drawPdfTable(pdf: jsPDF, headers: string[], rows: string[][], startY: number) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const left = 14;
  const tableWidth = pageWidth - 28;
  const columnWidth = tableWidth / headers.length;
  const lineHeight = 4.5;
  let y = startY;

  const drawHeader = () => {
    pdf.setFillColor(30, 64, 175);
    pdf.setTextColor(255, 255, 255);
    pdf.rect(left, y, tableWidth, 9, "F");
    headers.forEach((header, index) => pdf.text(header, left + index * columnWidth + 2, y + 6));
    pdf.setTextColor(30, 41, 59);
    y += 9;
  };

  drawHeader();
  rows.forEach((row, rowIndex) => {
    const wrappedCells = row.map(cell => pdf.splitTextToSize(cell || "–", columnWidth - 4));
    const rowHeight = Math.max(...wrappedCells.map(lines => lines.length), 1) * lineHeight + 4;
    if (y + rowHeight > pageHeight - 18) {
      pdf.addPage();
      y = 18;
      drawHeader();
    }
    if (rowIndex % 2 === 0) {
      pdf.setFillColor(241, 245, 249);
      pdf.rect(left, y, tableWidth, rowHeight, "F");
    }
    wrappedCells.forEach((lines, index) => pdf.text(lines, left + index * columnWidth + 2, y + 5));
    pdf.setDrawColor(226, 232, 240);
    pdf.line(left, y + rowHeight, left + tableWidth, y + rowHeight);
    y += rowHeight;
  });
  return y;
}

// ─── MAIN REPORTS COMPONENT ──────────────────────────────────────────────────
export default function ReportsPage() {
  const { role, loading: roleLoading } = useRole();
  const [currency, setCurrency] = useCurrency();

  // Mode: "executive" (Owner Dossier) vs "classic" (Original Operations & Activity Reports)
  const [viewMode, setViewMode] = useState<"executive" | "classic">("executive");

  // ── Executive State ──
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

  // ── Classic State ──
  const [classicTab, setClassicTab] = useState<string>("overview");
  const [classicStart, setClassicStart] = useState<string>(monthStartStr);
  const [classicEnd, setClassicEnd] = useState<string>(todayStr);
  const [classicData, setClassicData] = useState<any>(null);
  const [classicLoading, setClassicLoading] = useState<boolean>(false);
  const [classicError, setClassicError] = useState<string>("");

  // Load Executive Data
  const loadExecutiveData = async () => {
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
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || "Failed to load executive dossier");
      setData(json);
    } catch (err: any) {
      setError(err.message || "Failed to load executive dossier");
    } finally {
      setLoading(false);
    }
  };

  // Load Classic Data
  const loadClassicData = async () => {
    setClassicLoading(true);
    setClassicError("");
    try {
      const params = new URLSearchParams({ start_date: classicStart, end_date: classicEnd });
      const response = await fetch(`${API_BASE_URL}/reports/summary?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Unable to load reports");
      setClassicData(payload);
    } catch (err: any) {
      setClassicError(err.message || "Unable to load reports");
    } finally {
      setClassicLoading(false);
    }
  };

  useEffect(() => {
    if (role && !roleLoading) {
      loadExecutiveData();
      loadClassicData();
    }
  }, [role, roleLoading, rangePreset]);

  // Classic PDF Single Tab
  const downloadClassicTabPdf = () => {
    if (!classicData) return;
    const pdf = new jsPDF();
    const reportNames: Record<string, string> = Object.fromEntries(classicTabs);
    const format = (value: unknown) => value == null ? "-" : typeof value === "object" ? JSON.stringify(value) : String(value);
    let headers: string[] = [];
    let rows: string[][] = [];

    if (classicTab === "overview") {
      headers = ["Metric", "Value"];
      rows = Object.entries(classicData.summary || {}).map(([key, value]) => [key.replaceAll("_", " "), format(value)]);
    } else if (classicTab === "sales") {
      headers = ["Deal", "Stage", "Value", "Owner"];
      rows = (classicData.sales?.deals || []).map((deal: any) => [format(deal.title), format(deal.stage), format(deal.value), format(deal.assigned_to)]);
    } else if (classicTab === "calls") {
      headers = ["Date", "Phone", "Agent", "Duration", "Follow-up", "Notes"];
      rows = (classicData.calls || []).map((call: any) => [
        call.date ? new Date(call.date).toLocaleDateString() : "–",
        format(call.phone_number),
        format(call.assigned_to),
        call.duration_seconds ? `${Math.round(call.duration_seconds / 60)}m` : "–",
        call.followup_needed ? (call.followup_date || "Yes") : "No",
        format(call.summary)
      ]);
    } else if (classicTab === "meetings") {
      headers = ["When", "Title", "Type", "Status", "Host", "Duration", "Location", "Outcome"];
      rows = (classicData.meetings || []).map((m: any) => [
        m.scheduled_at ? new Date(m.scheduled_at).toLocaleDateString() : "–",
        format(m.title), format(m.meeting_type), format(m.status), format(m.host),
        m.duration_minutes ? `${m.duration_minutes}m` : "–",
        format(m.location), format(m.outcome)
      ]);
    } else if (classicTab === "daily") {
      headers = ["Date", "Leads", "Onboarded", "Deals won", "Emails", "Activities", "Calls", "Meetings", "Tasks", "Tickets", "Cases resolved"];
      rows = (classicData.daily || []).map((d: any) => [
        format(d.date), format(d.leads), format(d.clients_onboarded), format(d.deals_won), format(d.emails), format(d.activities),
        format(d.calls), format(d.meetings), format(d.task_entries), format(d.tickets), format(d.cases_resolved)
      ]);
    } else if (classicTab === "monthly") {
      headers = ["Month", "Leads", "Clients onboarded", "Deals won", "Emails", "Calls", "Meetings"];
      rows = (classicData.monthly || []).map((m: any) => [
        format(m.month), format(m.leads), format(m.clients_onboarded), format(m.deals_won), format(m.emails), format(m.calls), format(m.meetings)
      ]);
    } else if (classicTab === "staff_performance") {
      headers = ["Staff member", "Role", "Total work", "Calls", "Meetings", "Completed tasks", "Tickets", "Cases"];
      rows = (classicData.staff_performance || []).map((s: any) => [
        format(s.name), format(s.role), format(s.total_work), format(s.calls), format(s.meetings), format(s.completed_tasks), format(s.tickets), format(s.cases)
      ]);
    } else if (classicTab === "lead_sources") {
      headers = ["Lead source", "Leads", "Converted", "Conversion %"];
      rows = (classicData.lead_sources || []).map((ls: any) => [format(ls.source), format(ls.leads), format(ls.converted), `${ls.conversion_percentage}%`]);
    } else if (classicTab === "onboarding") {
      headers = ["Metric", "Count"];
      rows = Object.entries(classicData.onboarding || {}).map(([key, value]) => [key.replaceAll("_", " "), format(value)]);
    }

    pdf.setFont("helvetica", "bold"); pdf.setFontSize(16); pdf.setTextColor(15, 23, 42);
    pdf.text(reportNames[classicTab] || "Report", 14, 18);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.setTextColor(71, 85, 105);
    pdf.text(`Period: ${classicStart} to ${classicEnd}`, 14, 26);
    drawPdfTable(pdf, headers, rows, 34);
    pdf.save(`${classicTab}-report-${classicStart}-to-${classicEnd}.pdf`);
  };

  // Classic PDF Full Sales Report
  const downloadClassicFullReportPdf = () => {
    if (!classicData) return;
    const pdf = new jsPDF();
    const format = (v: unknown) => v == null ? "-" : String(v);
    const sections = [
      {
        title: "Executive Summary",
        headers: ["Metric", "Value"],
        rows: Object.entries(classicData.summary || {}).map(([k, v]) => [k.replaceAll("_", " "), format(v)])
      },
      {
        title: "Sales Deals Pipeline",
        headers: ["Deal", "Stage", "Value", "Owner"],
        rows: (classicData.sales?.deals || []).map((d: any) => [format(d.title), format(d.stage), format(d.value), format(d.assigned_to)])
      },
      {
        title: "Staff Performance",
        headers: ["Staff member", "Role", "Total work", "Calls", "Meetings", "Completed tasks"],
        rows: (classicData.staff_performance || []).map((s: any) => [format(s.name), format(s.role), format(s.total_work), format(s.calls), format(s.meetings), format(s.completed_tasks)])
      },
      {
        title: "Lead Sources Performance",
        headers: ["Lead source", "Leads", "Converted", "Conversion %"],
        rows: (classicData.lead_sources || []).map((ls: any) => [format(ls.source), format(ls.leads), format(ls.converted), `${ls.conversion_percentage}%`])
      }
    ];

    sections.forEach((section, idx) => {
      if (idx > 0) pdf.addPage();
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(16); pdf.setTextColor(15, 23, 42);
      pdf.text(section.title, 14, 18);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.setTextColor(71, 85, 105);
      pdf.text(`Reporting period: ${classicStart} to ${classicEnd}`, 14, 26);
      drawPdfTable(pdf, section.headers, section.rows, 36);
    });

    const pageCount = pdf.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      pdf.setPage(page); pdf.setFontSize(8); pdf.setTextColor(100, 116, 139);
      pdf.text(`Page ${page} of ${pageCount}`, 14, pdf.internal.pageSize.getHeight() - 8);
    }
    pdf.save(`complete-sales-report-${classicStart}-to-${classicEnd}.pdf`);
  };

  // Executive PDF
  const downloadExecutivePdf = () => {
    if (!data) return;
    const doc = new jsPDF();
    doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(15, 23, 42);
    doc.text("Executive Business Intelligence Dossier", 14, 18);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(100, 116, 139);
    doc.text(`Generated: ${new Date().toLocaleString()} | Currency: ${currency}`, 14, 26);

    const macro = [
      ["Won Revenue", money(data.summary?.won_revenue, currency)],
      ["Pipeline Value", money(data.summary?.pipeline_value, currency)],
      ["Operating Costs", money(data.summary?.total_costs, currency)],
      ["Net Operating Profit", money(data.summary?.net_profit, currency)],
      ["Operating Margin %", `${data.summary?.net_margin_pct || 0}%`],
      ["Lead Conversion %", `${data.summary?.conversion_rate || 0}%`],
      ["Active Clients", String(data.summary?.active_clients || 0)],
      ["Sales Representatives", String(data.summary?.active_sales_reps || 0)],
    ];
    let y = drawPdfTable(doc, ["Macro KPI", "Value"], macro, 34);

    doc.addPage();
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(15, 23, 42);
    doc.text("Sales Team Workload & Production Dossier", 14, 18);
    const repRows = (data.sales_reps || []).map((r: any) => [
      r.name,
      String(r.live?.active_leads_count || 0),
      String(r.live?.active_clients_count || 0),
      money(r.live?.open_pipeline_value, currency),
      money(r.results?.won_revenue, currency),
      `${r.results?.win_rate || 0}%`,
      `${r.results?.lead_conversion_rate || 0}%`,
    ]);
    drawPdfTable(doc, ["Rep", "Active Leads", "Active Clients", "Open Pipeline", "Won Rev", "Win %", "Conv %"], repRows, 28);
    doc.save(`executive-dossier-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const filteredReps = useMemo(() => {
    if (!data?.sales_reps) return [];
    if (!repSearch) return data.sales_reps;
    const q = repSearch.toLowerCase();
    return data.sales_reps.filter((r: any) =>
      r.name?.toLowerCase().includes(q) || r.email?.toLowerCase().includes(q)
    );
  }, [data?.sales_reps, repSearch]);

  const summary = data?.summary || {};
  const financials = data?.financials || {};
  const leadSources = data?.lead_sources || [];
  const stages = data?.deal_stages || [];
  const classicSummary = classicData?.summary || {};
  const staffRows = useMemo(() => (classicData?.staff_performance || []).map((item: any) => [
    item.name, item.role, item.total_work, item.calls, item.meetings, item.completed_tasks, item.tickets, item.cases
  ]), [classicData]);

  if (role !== "Admin" && role !== "SuperAdmin") {
    return (
      <div className="p-12 text-center font-bold text-slate-500">
        Executive reports and decision centers are restricted to administrators.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1550px] space-y-6 pb-16">
      {/* ── TOP HEADER & VIEW MODE SELECTOR ───────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 pb-5 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
              <Sparkles size={12} /> C-Suite Decision Intelligence
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs font-semibold text-slate-500">Live CRM & P&L Feed</span>
          </div>
          <h1 className="mt-1.5 text-3xl font-black tracking-tight text-slate-900 dark:text-white">
            Reports & Business Operations
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-zinc-400">
            End-to-end operational visibility: sales rep dossiers, financials vs operating costs, lead attribution, and classic activity logs.
          </p>
        </div>

        {/* Global Controls & Mode Switcher */}
        <div className="flex flex-wrap items-center gap-3">
          {/* VIEW MODE TOGGLE */}
          <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-slate-100 p-1 dark:border-zinc-800 dark:bg-zinc-900">
            <button
              onClick={() => setViewMode("executive")}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition-all ${
                viewMode === "executive"
                  ? "bg-white text-indigo-600 shadow-sm dark:bg-zinc-800 dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
              }`}
            >
              <ShieldCheck size={15} /> Executive Owner Dossier
            </button>
            <button
              onClick={() => setViewMode("classic")}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition-all ${
                viewMode === "classic"
                  ? "bg-white text-indigo-600 shadow-sm dark:bg-zinc-800 dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
              }`}
            >
              <FileSpreadsheet size={15} /> Classic Operations & Activity
            </button>
          </div>

          <CurrencyToggle value={currency} onChange={setCurrency} />

          {viewMode === "executive" ? (
            <button
              onClick={downloadExecutivePdf}
              disabled={!data || loading}
              className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white shadow-sm hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
            >
              <Download size={14} /> Export Dossier PDF
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={downloadClassicTabPdf}
                disabled={!classicData || classicLoading}
                className="flex items-center gap-2 rounded-xl bg-slate-900 px-3.5 py-2.5 text-xs font-black text-white shadow-sm hover:bg-slate-800 disabled:opacity-50 dark:bg-zinc-800 dark:text-white"
              >
                <Download size={14} /> Tab PDF
              </button>
              <button
                onClick={downloadClassicFullReportPdf}
                disabled={!classicData || classicLoading}
                className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-black text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
              >
                <Download size={14} /> Full Sales Report
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ── VIEW MODE 1: EXECUTIVE OWNER DOSSIER ─────────────────────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {viewMode === "executive" && (
        <div className="space-y-6">
          {/* Executive Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-2 text-xs font-black uppercase tracking-wider text-slate-400">Window:</span>
              {[
                { id: "30d", label: "30 Days" },
                { id: "90d", label: "90 Days" },
                { id: "6m", label: "6 Months" },
                { id: "12m", label: "12 Months" },
                { id: "all", label: "All Time" },
              ].map(p => (
                <button
                  key={p.id}
                  onClick={() => { setRangePreset(p.id); setShowCustom(false); }}
                  className={`rounded-xl px-3.5 py-1.5 text-xs font-black transition-all ${
                    rangePreset === p.id && !showCustom
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <button
                onClick={() => setShowCustom(!showCustom)}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-black transition-all ${
                  showCustom
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                Custom Range
              </button>
            </div>

            {showCustom && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={e => setCustomStart(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold dark:border-zinc-700 dark:bg-zinc-800"
                />
                <span className="text-xs text-slate-400">to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={e => setCustomEnd(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold dark:border-zinc-700 dark:bg-zinc-800"
                />
                <button
                  onClick={() => { setRangePreset("custom"); loadExecutiveData(); }}
                  className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-black text-white hover:bg-indigo-700"
                >
                  Apply
                </button>
              </div>
            )}

            <button
              onClick={loadExecutiveData}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
          </div>

          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          )}

          {/* Macro Scorecard Grid */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8">
            <Tile
              label="Won Revenue"
              value={money(summary.won_revenue, currency)}
              sub={`${summary.won_deals_count || 0} deals closed`}
              trend="up"
              accent="#10b981"
            />
            <Tile
              label="Pipeline Value"
              value={money(summary.pipeline_value, currency)}
              sub={`${summary.open_deals_count || 0} active deals`}
              accent="#6366f1"
            />
            <Tile
              label="Operating Costs"
              value={money(summary.total_costs, currency)}
              sub="Payroll, tools & ops"
              accent="#f43f5e"
            />
            <Tile
              label="Net Operating Profit"
              value={money(summary.net_profit, currency)}
              sub={`${summary.net_margin_pct || 0}% margin`}
              trend={summary.net_profit >= 0 ? "up" : "down"}
              accent={summary.net_profit >= 0 ? "#10b981" : "#f43f5e"}
            />
            <Tile
              label="Conversion Rate"
              value={`${summary.conversion_rate || 0}%`}
              sub={`${summary.active_clients || 0} of ${summary.total_leads || 0} leads`}
              accent="#8b5cf6"
            />
            <Tile
              label="Deal Win Rate"
              value={`${summary.win_rate || 0}%`}
              sub="Won vs handled"
              accent="#06b6d4"
            />
            <Tile
              label="Active Clients"
              value={num(summary.active_clients)}
              sub="Paying accounts"
              accent="#3b82f6"
            />
            <Tile
              label="Sales Reps"
              value={num(summary.active_sales_reps)}
              sub="On the front line"
              accent="#f59e0b"
            />
          </div>

          {/* Executive Sub-Tabs */}
          <div className="flex gap-2 border-b border-slate-200 pb-2 dark:border-zinc-800">
            {[
              { id: "reps", label: "👥 Sales Team Dossier", desc: "Live workload, future queue & results" },
              { id: "financials", label: "💰 Financials & Profitability", desc: "Revenue vs operating costs & margin" },
              { id: "sources", label: "🎯 Lead Sources & ROI", desc: "CAC, CPL & channel conversion" },
              { id: "pipeline", label: "⚡ Pipeline & Deal Stages", desc: "Velocity, probability & weighted pipeline" },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id as any)}
                className={`flex flex-col items-start rounded-2xl px-5 py-3 text-left transition-all ${
                  activeTab === t.id
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/20"
                    : "text-slate-600 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                <span className="text-xs font-black uppercase tracking-wider">{t.label}</span>
                <span className={`text-[11px] ${activeTab === t.id ? "text-indigo-100" : "text-slate-400 dark:text-zinc-500"}`}>
                  {t.desc}
                </span>
              </button>
            ))}
          </div>

          {/* TAB 1: SALES TEAM DOSSIER */}
          {activeTab === "reps" && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">
                    Sales Representatives Operational Dossier
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-zinc-400">
                    Full micro-management visibility into what each representative is actively doing, what they are queued to do, and their commercial results.
                  </p>
                </div>
                <div className="relative w-72">
                  <Search size={15} className="absolute left-3.5 top-3 text-slate-400" />
                  <input
                    type="text"
                    value={repSearch}
                    onChange={e => setRepSearch(e.target.value)}
                    placeholder="Filter by representative..."
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-4 text-xs font-bold outline-none focus:border-indigo-500 dark:border-zinc-800 dark:bg-zinc-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6">
                {filteredReps.map((rep: any) => (
                  <div
                    key={rep.id}
                    className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-slate-50/70 p-5 dark:border-zinc-800/80 dark:bg-zinc-950/40">
                      <div className="flex items-center gap-3.5">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-base font-black text-white shadow-sm">
                          {rep.name?.charAt(0) || "U"}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-base font-black text-slate-900 dark:text-white">{rep.name}</h4>
                            <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-black uppercase text-slate-700 dark:bg-zinc-800 dark:text-zinc-300">
                              {rep.role}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-zinc-400">{rep.email}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-6">
                        <div className="text-right">
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Won</p>
                          <p className="text-lg font-black text-emerald-600 dark:text-emerald-400">
                            {money(rep.results?.won_revenue, currency)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Win Rate</p>
                          <p className="text-lg font-black text-slate-900 dark:text-white">
                            {rep.results?.win_rate || 0}%
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Lead Conv %</p>
                          <p className="text-lg font-black text-indigo-600 dark:text-indigo-400">
                            {rep.results?.lead_conversion_rate || 0}%
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 divide-y divide-slate-100 lg:grid-cols-3 lg:divide-x lg:divide-y-0 dark:divide-zinc-800">
                      {/* Pillar 1: Doing Right Now */}
                      <div className="p-5">
                        <div className="mb-3 flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                            <Flame size={14} className="text-amber-500" /> Doing Right Now (Live Load)
                          </span>
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                            Active
                          </span>
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 dark:bg-zinc-800/50">
                            <span className="text-xs font-medium text-slate-600 dark:text-zinc-400">Active Leads Handling:</span>
                            <span className="text-sm font-black text-slate-900 dark:text-white">{rep.live?.active_leads_count || 0}</span>
                          </div>
                          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 dark:bg-zinc-800/50">
                            <span className="text-xs font-medium text-slate-600 dark:text-zinc-400">Active Clients Managing:</span>
                            <span className="text-sm font-black text-slate-900 dark:text-white">{rep.live?.active_clients_count || 0}</span>
                          </div>
                          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 dark:bg-zinc-800/50">
                            <span className="text-xs font-medium text-slate-600 dark:text-zinc-400">Open Deals in Play:</span>
                            <span className="text-sm font-black text-indigo-600 dark:text-indigo-400">
                              {money(rep.live?.open_pipeline_value, currency)} ({rep.live?.open_deals_count || 0})
                            </span>
                          </div>
                          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 dark:bg-zinc-800/50">
                            <span className="text-xs font-medium text-slate-600 dark:text-zinc-400">Pending Follow-ups / Tasks:</span>
                            <span className="text-sm font-black text-rose-600 dark:text-rose-400">
                              {rep.live?.pending_followups_count || 0} / {rep.live?.open_tasks_count || 0}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Pillar 2: Going to Do */}
                      <div className="p-5">
                        <div className="mb-3 flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                            <Calendar size={14} className="text-indigo-500" /> Going to Do (Future Queue)
                          </span>
                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-black text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400">
                            Next 30 Days
                          </span>
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 dark:bg-zinc-800/50">
                            <span className="text-xs font-medium text-slate-600 dark:text-zinc-400">Scheduled Meetings:</span>
                            <span className="text-sm font-black text-slate-900 dark:text-white">{rep.future?.upcoming_meetings_count || 0}</span>
                          </div>
                          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 dark:bg-zinc-800/50">
                            <span className="text-xs font-medium text-slate-600 dark:text-zinc-400">Upcoming Follow-up Actions:</span>
                            <span className="text-sm font-black text-slate-900 dark:text-white">{rep.future?.next_actions_queued || 0}</span>
                          </div>
                          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 dark:bg-zinc-800/50">
                            <span className="text-xs font-medium text-slate-600 dark:text-zinc-400">Deals Expected to Close:</span>
                            <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                              {money(rep.future?.deals_closing_soon_value, currency)} ({rep.future?.deals_closing_soon_count || 0})
                            </span>
                          </div>
                          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 dark:bg-zinc-800/50">
                            <span className="text-xs font-medium text-slate-600 dark:text-zinc-400">Active Proposals Under Review:</span>
                            <span className="text-sm font-black text-slate-900 dark:text-white">{rep.future?.in_negotiation_count || 0}</span>
                          </div>
                        </div>
                      </div>

                      {/* Pillar 3: Results Achieved */}
                      <div className="p-5">
                        <div className="mb-3 flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                            <Award size={14} className="text-emerald-500" /> Commercial Results Achieved
                          </span>
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                            Track Record
                          </span>
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 dark:bg-zinc-800/50">
                            <span className="text-xs font-medium text-slate-600 dark:text-zinc-400">Won Revenue / Deals Won:</span>
                            <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                              {money(rep.results?.won_revenue, currency)} ({rep.results?.won_deals_count || 0})
                            </span>
                          </div>
                          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 dark:bg-zinc-800/50">
                            <span className="text-xs font-medium text-slate-600 dark:text-zinc-400">Total Deals Handled:</span>
                            <span className="text-sm font-black text-slate-900 dark:text-white">{rep.results?.total_deals_handled || 0}</span>
                          </div>
                          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 dark:bg-zinc-800/50">
                            <span className="text-xs font-medium text-slate-600 dark:text-zinc-400">Average Deal Size:</span>
                            <span className="text-sm font-black text-slate-900 dark:text-white">
                              {money(rep.results?.avg_deal_size, currency)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 dark:bg-zinc-800/50">
                            <span className="text-xs font-medium text-slate-600 dark:text-zinc-400">Total Outreach Touchpoints:</span>
                            <span className="text-sm font-black text-indigo-600 dark:text-indigo-400">{rep.results?.outreach_activity_count || 0}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: FINANCIALS & PROFITABILITY */}
          {activeTab === "financials" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2 dark:border-zinc-800 dark:bg-zinc-900">
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    Monthly Revenue vs Operating Costs
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-zinc-400">
                    Net cash flow analysis comparing closed commercial revenue against operating burn.
                  </p>
                  <div className="mt-6 h-72 w-full min-w-0 min-h-[288px]">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={250}>
                      <AreaChart data={financials.monthly_trend || []}>
                        <defs>
                          <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.6} />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Area type="monotone" dataKey="revenue" stroke="#10b981" fillOpacity={1} fill="url(#colorRev)" name="Revenue" />
                        <Area type="monotone" dataKey="cost" stroke="#f43f5e" fillOpacity={1} fill="url(#colorCost)" name="Operating Costs" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    Operating Cost Distribution
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-zinc-400">
                    Breakdown of business expenses across departments and software.
                  </p>
                  <div className="mt-5 space-y-3">
                    {(financials.cost_categories || []).map((c: any) => (
                      <div key={c.category} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-extrabold text-slate-800 dark:text-zinc-200">{c.category}</span>
                          <span className="font-black text-slate-900 dark:text-white">{money(c.amount, currency)}</span>
                        </div>
                        <div className="mt-2">
                          <Meter value={c.pct} max={100} color="#6366f1" height={4} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: LEAD SOURCES & ROI */}
          {activeTab === "sources" && (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400 dark:border-zinc-800 dark:bg-zinc-950">
                    <tr>
                      <th className="px-5 py-3.5">Acquisition Channel</th>
                      <th className="px-5 py-3.5">Total Leads</th>
                      <th className="px-5 py-3.5">Clients Converted</th>
                      <th className="px-5 py-3.5">Conv %</th>
                      <th className="px-5 py-3.5">Spend</th>
                      <th className="px-5 py-3.5">CPL</th>
                      <th className="px-5 py-3.5">CAC</th>
                      <th className="px-5 py-3.5">Attributed Rev</th>
                      <th className="px-5 py-3.5">ROI %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                    {leadSources.map((ls: any) => (
                      <tr key={ls.source} className="hover:bg-slate-50/60 dark:hover:bg-zinc-800/40">
                        <td className="px-5 py-4 font-black text-slate-900 dark:text-white">{ls.source}</td>
                        <td className="px-5 py-4 font-bold text-slate-700 dark:text-zinc-300">{ls.leads}</td>
                        <td className="px-5 py-4 font-bold text-emerald-600 dark:text-emerald-400">{ls.converted}</td>
                        <td className="px-5 py-4 font-extrabold text-slate-900 dark:text-white">{ls.conversion_rate}%</td>
                        <td className="px-5 py-4 text-slate-600 dark:text-zinc-400">{money(ls.cost, currency)}</td>
                        <td className="px-5 py-4 text-slate-600 dark:text-zinc-400">{money(ls.cpl, currency)}</td>
                        <td className="px-5 py-4 text-slate-600 dark:text-zinc-400">{money(ls.cac, currency)}</td>
                        <td className="px-5 py-4 font-black text-indigo-600 dark:text-indigo-400">{money(ls.won_revenue, currency)}</td>
                        <td className="px-5 py-4 font-black text-emerald-600 dark:text-emerald-400">{ls.roi_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: PIPELINE & DEALS VELOCITY */}
          {activeTab === "pipeline" && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {stages.map((st: any) => (
                <div key={st.stage} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: statusColor(st.stage) }} />
                      {st.stage}
                    </span>
                    <Pill color={statusColor(st.stage)}>{st.probability}% win prob</Pill>
                  </div>
                  <p className="mt-3 text-xl font-black text-slate-900 dark:text-white">
                    {money(st.value, currency)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
                    {st.count} active opportunities
                  </p>
                  <div className="mt-3">
                    <Meter value={st.probability} max={100} color={statusColor(st.stage)} height={4} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ── VIEW MODE 2: CLASSIC OPERATIONS & ACTIVITY REPORTS ───────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {viewMode === "classic" && (
        <div className="space-y-6">
          {/* Classic Filter & Actions Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold dark:border-zinc-800 dark:bg-zinc-900">
                <CalendarDays size={15} className="text-indigo-500" />
                <input
                  type="date"
                  value={classicStart}
                  onChange={e => setClassicStart(e.target.value)}
                  className="bg-transparent outline-none"
                />
              </label>
              <span className="text-xs font-bold text-slate-400">to</span>
              <input
                type="date"
                value={classicEnd}
                onChange={e => setClassicEnd(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold dark:border-zinc-800 dark:bg-zinc-900"
              />
              <button
                onClick={loadClassicData}
                className="rounded-xl bg-indigo-600 p-2.5 text-white hover:bg-indigo-700"
                title="Refresh Classic Reports"
              >
                <RefreshCw size={15} className={classicLoading ? "animate-spin" : ""} />
              </button>
            </div>

            <div className="text-xs text-slate-500 dark:text-zinc-400">
              Showing records from <strong>{classicStart}</strong> to <strong>{classicEnd}</strong>
            </div>
          </div>

          {classicError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
              {classicError}
            </div>
          )}

          {/* Classic 10 KPI Stat Bar */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5 xl:grid-cols-10">
            <ClassicStat label="Leads" value={classicSummary.leads || 0} icon={<TrendingUp size={16} />} tone="bg-indigo-600" />
            <ClassicStat label="Onboarded" value={classicSummary.clients_onboarded || 0} icon={<Users size={16} />} tone="bg-emerald-600" />
            <ClassicStat label="Total clients" value={classicSummary.total_clients || 0} icon={<Users size={16} />} tone="bg-sky-600" />
            <ClassicStat label="Won revenue" value={money(classicSummary.won_value || 0, currency)} icon={<BriefcaseBusiness size={16} />} tone="bg-amber-600" />
            <ClassicStat label="Deals won" value={classicSummary.deals_won || 0} icon={<CheckCircle2 size={16} />} tone="bg-teal-600" />
            <ClassicStat label="Conversion" value={`${classicSummary.conversion_percentage || 0}%`} icon={<Target size={16} />} tone="bg-rose-600" />
            <ClassicStat label="Win rate" value={`${classicSummary.deal_win_rate || 0}%`} icon={<BarChart3 size={16} />} tone="bg-violet-600" />
            <ClassicStat label="Calls" value={classicSummary.calls || 0} icon={<Phone size={16} />} tone="bg-cyan-600" />
            <ClassicStat label="Meetings" value={classicSummary.meetings || 0} icon={<CalendarDays size={16} />} tone="bg-fuchsia-600" />
            <ClassicStat
              label="Work items"
              value={(classicSummary.activities || 0) + (classicSummary.tickets || 0) + (classicSummary.task_entries || 0)}
              icon={<BarChart3 size={16} />}
              tone="bg-slate-700"
            />
          </div>

          {/* Classic 9 Tabs Navigation */}
          <div className="flex gap-1 overflow-x-auto rounded-2xl bg-slate-100 p-1.5 dark:bg-zinc-900">
            {classicTabs.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setClassicTab(key)}
                className={`whitespace-nowrap rounded-xl px-4 py-2 text-xs font-black transition-all ${
                  classicTab === key
                    ? "bg-white text-indigo-600 shadow-sm dark:bg-zinc-800 dark:text-white"
                    : "text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Classic Tab Contents */}
          {classicLoading ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[1, 2, 3, 4].map(item => (
                <div key={item} className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-zinc-900" />
              ))}
            </div>
          ) : classicData && (
            <div className="space-y-4">
              {classicTab === "overview" && (
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    <h2 className="mb-3 text-base font-black text-slate-900 dark:text-white">Report Coverage & Rules</h2>
                    <p className="text-xs leading-relaxed text-slate-500 dark:text-zinc-400">
                      The selected reporting period is <strong>{classicData.range?.start_date}</strong> through{" "}
                      <strong>{classicData.range?.end_date}</strong>. Lead conversion is computed from all tenant leads marked converted; activity KPIs track records logged inside this date range.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    <h2 className="mb-3 text-base font-black text-slate-900 dark:text-white">Client Onboarding Summary</h2>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <p className="text-slate-600 dark:text-zinc-300">Active: <strong className="text-slate-900 dark:text-white">{classicData.onboarding?.active || 0}</strong></p>
                      <p className="text-slate-600 dark:text-zinc-300">Pending: <strong className="text-slate-900 dark:text-white">{classicData.onboarding?.pending || 0}</strong></p>
                      <p className="text-slate-600 dark:text-zinc-300">On Hold: <strong className="text-slate-900 dark:text-white">{classicData.onboarding?.hold || 0}</strong></p>
                      <p className="text-slate-600 dark:text-zinc-300">New in Range: <strong className="text-slate-900 dark:text-white">{classicData.onboarding?.new_in_range || 0}</strong></p>
                    </div>
                  </div>
                </div>
              )}

              {classicTab === "sales" && (
                <ClassicTable
                  headers={["Deal Title", "Stage", "Value", "Owner"]}
                  rows={(classicData.sales?.deals || []).map((deal: any) => [
                    deal.title,
                    <span key="st" className="inline-block rounded-md px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: `${statusColor(deal.stage)}20`, color: statusColor(deal.stage) }}>{deal.stage}</span>,
                    money(deal.value, currency),
                    deal.assigned_to || "–"
                  ])}
                />
              )}

              {classicTab === "calls" && (
                <ClassicTable
                  headers={["Date", "Phone", "Agent", "Duration", "Follow-up", "Notes"]}
                  rows={(classicData.calls || []).map((call: any) => [
                    call.date ? new Date(call.date).toLocaleDateString() : "–",
                    call.phone_number || "–",
                    call.assigned_to || "–",
                    call.duration_seconds ? `${Math.round(call.duration_seconds / 60)}m` : "–",
                    call.followup_needed ? (call.followup_date || "Yes") : "No",
                    call.summary || "–"
                  ])}
                />
              )}

              {classicTab === "meetings" && (
                <ClassicTable
                  headers={["When", "Title", "Type", "Status", "Host", "Duration", "Location", "Outcome"]}
                  rows={(classicData.meetings || []).map((m: any) => [
                    m.scheduled_at ? new Date(m.scheduled_at).toLocaleDateString() : "–",
                    m.title || "–",
                    m.meeting_type || "–",
                    m.status || "–",
                    m.host || "–",
                    m.duration_minutes ? `${m.duration_minutes}m` : "–",
                    m.location || "–",
                    m.outcome || "–"
                  ])}
                />
              )}

              {classicTab === "daily" && (
                <ClassicTable
                  headers={["Date", "Leads", "Onboarded", "Deals won", "Emails", "Activities", "Calls", "Meetings", "Tasks", "Tickets", "Cases resolved"]}
                  rows={(classicData.daily || []).map((d: any) => [
                    d.date, d.leads, d.clients_onboarded, d.deals_won, d.emails, d.activities, d.calls, d.meetings, d.task_entries, d.tickets, d.cases_resolved
                  ])}
                />
              )}

              {classicTab === "monthly" && (
                <ClassicTable
                  headers={["Month", "Leads", "Clients onboarded", "Deals won", "Emails", "Calls", "Meetings"]}
                  rows={(classicData.monthly || []).map((m: any) => [
                    m.month, m.leads, m.clients_onboarded, m.deals_won, m.emails, m.calls, m.meetings
                  ])}
                />
              )}

              {classicTab === "staff_performance" && (
                <ClassicTable
                  headers={["Staff member", "Role", "Total work", "Calls", "Meetings", "Completed tasks", "Tickets", "Cases"]}
                  rows={staffRows}
                />
              )}

              {classicTab === "lead_sources" && (
                <ClassicTable
                  headers={["Lead source", "Leads", "Converted", "Conversion %"]}
                  rows={(classicData.lead_sources || []).map((ls: any) => [
                    ls.source, ls.leads, ls.converted, `${ls.conversion_percentage}%`
                  ])}
                />
              )}

              {classicTab === "onboarding" && (
                <ClassicTable
                  headers={["Metric", "Count"]}
                  rows={Object.entries(classicData.onboarding || {}).map(([key, value]) => [
                    key.replaceAll("_", " "), value as any
                  ])}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
