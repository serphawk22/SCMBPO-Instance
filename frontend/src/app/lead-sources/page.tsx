"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Zap, Plus, Trash2, RefreshCw, Edit2, X, CheckCircle2, AlertCircle, BarChart2, TrendingUp, IndianRupee, Layers, PieChart as PieChartIcon, ArrowUpRight, Award, Flame, Filter, ChevronRight } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area
} from "recharts";
import { API_BASE_URL } from "@/config";
import { useRole } from "@/context/RoleContext";
import { useRouter } from "next/navigation";

const CHANNEL_OPTIONS = ["Social", "Paid", "Organic", "Referral", "Event", "Direct", "Outbound", "Website", "Other"];
const COLOR_OPTIONS = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6",
];

type Currency = "INR" | "USD";
const EXCHANGE = 83.5;

function fmt(amount: number, currency: Currency) {
  if (currency === "INR") return "\u20B9" + Math.round(amount).toLocaleString("en-IN");
  return "₹" + Math.round(amount / EXCHANGE).toLocaleString("en-US");
}

function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#111827] p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5">
          <X className="h-5 w-5" />
        </button>
        {children}
      </div>
    </div>
  );
}

const EMPTY_FORM = { name: "", channel: "Website", utm_key: "", color: "#6366f1", is_active: true };

export default function LeadSourcesPage() {
  const { role, loading: roleLoading } = useRole();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<"config" | "analytics">("analytics");
  const [sources, setSources] = useState<any[]>([]);
  const [analyticsData, setAnalyticsData] = useState<{
    sources: any[];
    totals: any;
    trend: any[];
  }>({ sources: [], totals: null, trend: [] });
  const [currency, setCurrency] = useState<Currency>("INR");
  const [chartView, setChartView] = useState<"all" | "volume" | "revenue" | "trend">("all");
  const [loading, setLoading] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  useEffect(() => {
    if (!roleLoading && role !== "Admin" && role !== "SuperAdmin") router.replace("/");
  }, [role, roleLoading, router]);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const loadSources = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(API_BASE_URL + "/lead-sources", { headers: { Authorization: "Bearer " + token } });
      if (res.ok) {
        const json = await res.json();
        setSources(Array.isArray(json) ? json : json.sources || []);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(API_BASE_URL + "/analytics/lead-sources", { headers: { Authorization: "Bearer " + token } });
      if (res.ok) {
        const json = await res.json();
        setAnalyticsData({
          sources: json.sources || [],
          totals: json.totals || null,
          trend: json.trend || [],
        });
      }
    } catch { /* silent */ }
    setAnalyticsLoading(false);
  }, []);

  useEffect(() => {
    loadSources();
    loadAnalytics();
  }, [loadSources, loadAnalytics]);

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setModalOpen(true); };
  const openEdit = (src: any) => {
    setEditing(src);
    setForm({ name: src.name, channel: src.channel, utm_key: src.utm_key ?? "", color: src.color ?? "#6366f1", is_active: src.is_active ?? true });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name) return showToast("Name is required.", false);
    setSaving(true);
    try {
      const token = localStorage.getItem("token");
      const url = editing ? API_BASE_URL + "/lead-sources/" + editing.id : API_BASE_URL + "/lead-sources";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        showToast(editing ? "Updated!" : "Created!");
        setModalOpen(false);
        loadSources();
        loadAnalytics();
      } else {
        const e = await res.json();
        showToast(e.detail ?? "Error.", false);
      }
    } catch { showToast("Network error.", false); }
    setSaving(false);
  };

  const del = async (id: number) => {
    const token = localStorage.getItem("token");
    const res = await fetch(API_BASE_URL + "/lead-sources/" + id, {
      method: "DELETE", headers: { Authorization: "Bearer " + token },
    });
    if (res.ok) {
      showToast("Deleted.");
      loadSources();
      loadAnalytics();
    } else showToast("Delete failed.", false);
    setDeleteId(null);
  };

  // Process data for charts
  const volumeChartData = useMemo(() => {
    return analyticsData.sources.map(s => ({
      name: s.source,
      Leads: s.leads || 0,
      Converted: s.converted || 0,
      rate: s.conversion_rate || 0,
      color: s.color || "#6366f1",
    }));
  }, [analyticsData.sources]);

  const revenueChartData = useMemo(() => {
    return analyticsData.sources.map(s => ({
      name: s.source,
      WonRevenue: currency === "INR" ? (s.won_revenue || 0) : Math.round((s.won_revenue || 0) / EXCHANGE),
      PipelineValue: currency === "INR" ? (s.pipeline_value || 0) : Math.round((s.pipeline_value || 0) / EXCHANGE),
      color: s.color || "#10b981",
    }));
  }, [analyticsData.sources, currency]);

  const pieShareData = useMemo(() => {
    return analyticsData.sources
      .filter(s => (s.leads || 0) > 0)
      .map(s => ({
        name: s.source,
        value: s.leads || 0,
        color: s.color || "#6366f1",
      }));
  }, [analyticsData.sources]);

  // Sources present in trend keys
  const trendSources = useMemo(() => {
    const keys = new Set<string>();
    analyticsData.trend.forEach(item => {
      Object.keys(item).forEach(k => {
        if (k !== "month") keys.add(k);
      });
    });
    return Array.from(keys);
  }, [analyticsData.trend]);

  const topPerformingSource = useMemo(() => {
    if (!analyticsData.sources.length) return null;
    return [...analyticsData.sources].sort((a, b) => (b.won_revenue || 0) - (a.won_revenue || 0))[0];
  }, [analyticsData.sources]);

  const highestConvSource = useMemo(() => {
    const valid = analyticsData.sources.filter(s => (s.leads || 0) >= 2);
    if (!valid.length) return null;
    return [...valid].sort((a, b) => (b.conversion_rate || 0) - (a.conversion_rate || 0))[0];
  }, [analyticsData.sources]);

  if (roleLoading) return null;
  if (role !== "Admin" && role !== "SuperAdmin") return null;

  return (
    <div className="min-h-screen bg-[#0c0f1d] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_bottom_left,#0ea5e922_0%,transparent_60%)]" />

      {toast && (
        <div className={"fixed right-4 top-4 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-2xl " +
          (toast.ok ? "bg-emerald-600 text-white" : "bg-rose-600 text-white")}>
          {toast.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {toast.msg}
        </div>
      )}

      <div className="relative mx-auto max-w-7xl px-3 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 shadow-lg shadow-indigo-500/20">
                <BarChart2 className="h-5 w-5 text-white" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Lead Source Analytics</h1>
            </div>
            <p className="mt-1 text-xs sm:text-sm text-slate-400">
              Comparative performance, conversion ROI, and channel attribution reports
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Currency toggle */}
            <div className="flex overflow-hidden rounded-xl border border-white/10 bg-white/5">
              {(["INR"] as Currency[]).map(c => (
                <button key={c} onClick={() => setCurrency(c)}
                  className={"flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-all " + (currency === c ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-white")}>
                  {c === "INR" ? <IndianRupee className="h-3.5 w-3.5" /> : <IndianRupee className="h-3.5 w-3.5" />} {c}
                </button>
              ))}
            </div>

            <button onClick={() => { loadSources(); loadAnalytics(); }} disabled={loading || analyticsLoading}
              title="Refresh Analytics"
              className="rounded-xl border border-white/10 bg-white/5 p-2 hover:bg-white/10 active:scale-95 transition-all">
              <RefreshCw className={"h-4 w-4 " + ((loading || analyticsLoading) ? "animate-spin text-indigo-400" : "text-slate-400")} />
            </button>
            <button onClick={openCreate}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs sm:text-sm font-bold text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/30 active:scale-95 transition-all">
              <Plus className="h-4 w-4" /> Add Source
            </button>
          </div>
        </div>

        {/* Tab switch */}
        <div className="mb-6 flex flex-wrap gap-2 border-b border-white/10 pb-3">
          <button
            onClick={() => setActiveTab("analytics")}
            className={"flex items-center gap-2 rounded-xl px-4 py-2 text-xs sm:text-sm font-bold transition-all " +
              (activeTab === "analytics" ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20" : "text-slate-400 hover:text-white hover:bg-white/5")}>
            <BarChart2 className="h-4 w-4" /> Comparison Reports & ROI
          </button>
          <button
            onClick={() => setActiveTab("config")}
            className={"flex items-center gap-2 rounded-xl px-4 py-2 text-xs sm:text-sm font-bold transition-all " +
              (activeTab === "config" ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20" : "text-slate-400 hover:text-white hover:bg-white/5")}>
            <Layers className="h-4 w-4" /> Source Configuration ({sources.length})
          </button>
        </div>

        {activeTab === "analytics" ? (
          <div className="space-y-6">
            {/* KPI Summary Cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
              <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-4 sm:p-5 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-wider text-indigo-300">Total Leads</p>
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
                    <Layers className="h-3.5 w-3.5" />
                  </span>
                </div>
                <p className="mt-2 text-2xl sm:text-3xl font-black text-white">
                  {analyticsData.totals?.leads ?? analyticsData.sources.reduce((acc, s) => acc + (s.leads || 0), 0)}
                </p>
                <p className="mt-1 text-[11px] text-indigo-200/70">
                  Across {analyticsData.sources.length} active channels
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 sm:p-5 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-wider text-emerald-300">Converted Leads</p>
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <p className="text-2xl sm:text-3xl font-black text-white">
                    {analyticsData.totals?.converted ?? analyticsData.sources.reduce((acc, s) => acc + (s.converted || 0), 0)}
                  </p>
                  <span className="text-xs font-bold text-emerald-400">
                    {analyticsData.totals?.conversion_rate ?? 0}% conv.
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-emerald-200/70">
                  {highestConvSource ? `Top: ${highestConvSource.source} (${highestConvSource.conversion_rate}%)` : "Tracked conversions"}
                </p>
              </div>

              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 sm:p-5 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-wider text-amber-300">Won Revenue</p>
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
                    <Award className="h-3.5 w-3.5" />
                  </span>
                </div>
                <p className="mt-2 text-xl sm:text-2xl font-black text-white truncate">
                  {fmt(analyticsData.totals?.won_revenue ?? analyticsData.sources.reduce((acc, s) => acc + (s.won_revenue || 0), 0), currency)}
                </p>
                <p className="mt-1 text-[11px] text-amber-200/70 truncate">
                  {topPerformingSource ? `Leader: ${topPerformingSource.source}` : "Closed deals"}
                </p>
              </div>

              <div className="rounded-2xl border border-purple-500/20 bg-purple-500/10 p-4 sm:p-5 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-wider text-purple-300">Active Pipeline</p>
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-purple-500/20 text-purple-400">
                    <TrendingUp className="h-3.5 w-3.5" />
                  </span>
                </div>
                <p className="mt-2 text-xl sm:text-2xl font-black text-white truncate">
                  {fmt(analyticsData.sources.reduce((acc, s) => acc + (s.pipeline_value || 0), 0), currency)}
                </p>
                <p className="mt-1 text-[11px] text-purple-200/70">
                  In-flight potential deals
                </p>
              </div>
            </div>

            {/* Chart View Switcher Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
              <span className="text-xs font-bold text-slate-300">Visual Comparison View:</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: "all", label: "Overview Grids" },
                  { id: "volume", label: "Leads vs Conversion" },
                  { id: "revenue", label: "Revenue & Pipeline" },
                  { id: "trend", label: "6-Mo Trend" },
                ].map(v => (
                  <button
                    key={v.id}
                    onClick={() => setChartView(v.id as any)}
                    className={"rounded-lg px-3 py-1.5 text-xs font-bold transition-all " +
                      (chartView === v.id
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                        : "text-slate-400 hover:text-white hover:bg-white/10")}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Graphical Reports Section */}
            {(chartView === "all" || chartView === "volume") && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Leads vs Converted Comparison (Composed/Bar Chart) */}
                <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-6 backdrop-blur-sm shadow-xl">
                  <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <BarChart2 className="w-4 h-4 text-indigo-400" />
                        Lead Volume vs Converted Deals by Source
                      </h3>
                      <p className="text-xs text-slate-400">Comparing acquisition volume against successful customer conversions</p>
                    </div>
                    <span className="self-start sm:self-auto text-[11px] font-semibold px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                      Channel Efficiency
                    </span>
                  </div>

                  <div className="h-[280px] sm:h-[320px] w-full">
                    {volumeChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={volumeChartData} margin={{ top: 15, right: 15, left: -20, bottom: 25 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.08)" />
                          <XAxis
                            dataKey="name"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: 500 }}
                            interval={0}
                            angle={-25}
                            textAnchor="end"
                          />
                          <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                          <Tooltip
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null;
                              const leads = payload.find(p => p.dataKey === "Leads")?.value ?? 0;
                              const converted = payload.find(p => p.dataKey === "Converted")?.value ?? 0;
                              const rate = Number(leads) > 0 ? ((Number(converted) / Number(leads)) * 100).toFixed(1) : "0.0";
                              return (
                                <div className="rounded-xl border border-white/10 bg-[#0f172a] p-3 text-xs shadow-2xl">
                                  <p className="font-bold text-white mb-1.5 border-b border-white/10 pb-1">{label}</p>
                                  <div className="space-y-1 text-slate-300">
                                    <div className="flex items-center justify-between gap-4">
                                      <span className="flex items-center gap-1.5 text-indigo-400">
                                        <span className="h-2 w-2 rounded-full bg-indigo-500" /> Total Leads:
                                      </span>
                                      <span className="font-bold text-white">{leads}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-4">
                                      <span className="flex items-center gap-1.5 text-emerald-400">
                                        <span className="h-2 w-2 rounded-full bg-emerald-500" /> Converted:
                                      </span>
                                      <span className="font-bold text-white">{converted}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-4 pt-1 border-t border-white/5">
                                      <span className="text-cyan-300 font-semibold">Conversion Rate:</span>
                                      <span className="font-mono font-bold text-cyan-400">{rate}%</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="Leads" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={32} />
                          <Bar dataKey="Converted" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={32} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                        {analyticsLoading ? "Loading comparative chart..." : "No data available."}
                      </div>
                    )}
                  </div>
                </div>

                {/* Donut Chart: Lead Channel Share */}
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-6 backdrop-blur-sm shadow-xl flex flex-col">
                  <div className="mb-2">
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <PieChartIcon className="w-4 h-4 text-cyan-400" />
                      Lead Source Share
                    </h3>
                    <p className="text-xs text-slate-400">Proportional distribution of incoming leads</p>
                  </div>

                  <div className="h-[220px] w-full flex-1">
                    {pieShareData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieShareData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={80}
                            paddingAngle={3}
                          >
                            {pieShareData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color || COLOR_OPTIONS[index % COLOR_OPTIONS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const item = payload[0];
                              const total = pieShareData.reduce((a, b) => a + b.value, 0);
                              const pct = total > 0 ? ((Number(item.value) / total) * 100).toFixed(1) : "0";
                              return (
                                <div className="rounded-xl border border-white/10 bg-[#0f172a] p-2.5 text-xs shadow-xl">
                                  <p className="font-bold text-white">{item.name}</p>
                                  <p className="mt-0.5 text-slate-300">{item.value} leads ({pct}%)</p>
                                </div>
                              );
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                        No share data available
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 justify-center max-h-24 overflow-y-auto">
                    {pieShareData.slice(0, 6).map((item, idx) => (
                      <span key={idx} className="flex items-center gap-1.5 text-[11px] text-slate-300 bg-white/5 px-2 py-0.5 rounded-md">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                        {item.name}: {item.value}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {(chartView === "all" || chartView === "revenue") && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-6 backdrop-blur-sm shadow-xl">
                <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-emerald-400" />
                      Won Revenue vs Active Pipeline by Source ({currency})
                    </h3>
                    <p className="text-xs text-slate-400">Financial output comparison across all acquired lead channels</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                      <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Won Revenue
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-purple-400">
                      <span className="h-2.5 w-2.5 rounded-sm bg-purple-500" /> Active Pipeline
                    </span>
                  </div>
                </div>

                <div className="h-[280px] sm:h-[320px] w-full">
                  {revenueChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={revenueChartData} margin={{ top: 15, right: 15, left: 10, bottom: 25 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.08)" />
                        <XAxis
                          dataKey="name"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "#94a3b8", fontSize: 11 }}
                          interval={0}
                          angle={-20}
                          textAnchor="end"
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "#94a3b8", fontSize: 11 }}
                          tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                        />
                        <Tooltip
                          content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null;
                            const won = payload.find(p => p.dataKey === "WonRevenue")?.value ?? 0;
                            const pipe = payload.find(p => p.dataKey === "PipelineValue")?.value ?? 0;
                            return (
                              <div className="rounded-xl border border-white/10 bg-[#0f172a] p-3 text-xs shadow-2xl">
                                <p className="font-bold text-white mb-1.5 border-b border-white/10 pb-1">{label}</p>
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between gap-4">
                                    <span className="text-emerald-400">Won Revenue:</span>
                                    <span className="font-mono font-bold text-white">{fmt(currency === "INR" ? Number(won) : Number(won) * EXCHANGE, currency)}</span>
                                  </div>
                                  <div className="flex items-center justify-between gap-4">
                                    <span className="text-purple-400">Active Pipeline:</span>
                                    <span className="font-mono font-bold text-white">{fmt(currency === "INR" ? Number(pipe) : Number(pipe) * EXCHANGE, currency)}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="WonRevenue" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={36} />
                        <Bar dataKey="PipelineValue" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={36} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                      No financial data recorded yet
                    </div>
                  )}
                </div>
              </div>
            )}

            {(chartView === "all" || chartView === "trend") && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-6 backdrop-blur-sm shadow-xl">
                <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Flame className="w-4 h-4 text-amber-400" />
                      6-Month Lead Acquisition Trend by Channel
                    </h3>
                    <p className="text-xs text-slate-400">Monthly inflow trajectory showing channel momentum</p>
                  </div>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20">
                    Trailing 6 Months
                  </span>
                </div>

                <div className="h-[280px] sm:h-[320px] w-full">
                  {analyticsData.trend.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={analyticsData.trend} margin={{ top: 15, right: 15, left: -20, bottom: 5 }}>
                        <defs>
                          {trendSources.slice(0, 5).map((src, idx) => {
                            const color = COLOR_OPTIONS[idx % COLOR_OPTIONS.length];
                            return (
                              <linearGradient key={src} id={`colorGrad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={color} stopOpacity={0.6}/>
                                <stop offset="95%" stopColor={color} stopOpacity={0}/>
                              </linearGradient>
                            );
                          })}
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.08)" />
                        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#0f172a", borderColor: "rgba(255,255,255,0.1)", borderRadius: "12px", fontSize: "12px" }}
                        />
                        {trendSources.slice(0, 5).map((src, idx) => {
                          const color = COLOR_OPTIONS[idx % COLOR_OPTIONS.length];
                          return (
                            <Area
                              key={src}
                              type="monotone"
                              dataKey={src}
                              stroke={color}
                              fillOpacity={1}
                              fill={`url(#colorGrad-${idx})`}
                              strokeWidth={2}
                            />
                          );
                        })}
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                      No monthly trend data recorded yet
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Detailed Analytics Table & Mobile Card View */}
            <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white">Full Source Performance Breakdown</h3>
                  <p className="text-xs text-slate-400">Detailed metric attribution per acquisition source</p>
                </div>
                <span className="text-xs font-mono text-slate-400">
                  {analyticsData.sources.length} sources
                </span>
              </div>

              {/* Desktop / Tablet Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-white/5 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Source</th>
                      <th className="px-4 py-3">Channel</th>
                      <th className="px-4 py-3">Total Leads</th>
                      <th className="px-4 py-3">Converted</th>
                      <th className="px-4 py-3">Conv. Rate</th>
                      <th className="px-4 py-3">Won Deals</th>
                      <th className="px-4 py-3">Won Revenue</th>
                      <th className="px-4 py-3">Pipeline</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {analyticsData.sources.length ? analyticsData.sources.map((a: any, i: number) => {
                      const rate = a.leads > 0 ? ((a.converted / a.leads) * 100).toFixed(1) : "0.0";
                      const rateNum = Number(rate);
                      return (
                        <tr key={i} className="hover:bg-white/5 transition-colors">
                          <td className="px-4 py-3 font-semibold text-white flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: a.color ?? "#6366f1" }} />
                            {a.source}
                          </td>
                          <td className="px-4 py-3 text-slate-400 text-xs">{a.channel ?? "—"}</td>
                          <td className="px-4 py-3 font-bold">{a.leads ?? 0}</td>
                          <td className="px-4 py-3 text-emerald-400 font-bold">{a.converted ?? 0}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 rounded-full"
                                  style={{ width: `${Math.min(rateNum, 100)}%` }}
                                />
                              </div>
                              <span className="font-mono text-xs text-cyan-400 font-bold">{rate}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">{a.won_deals ?? 0}</td>
                          <td className="px-4 py-3 font-mono font-bold text-emerald-400">{fmt(a.won_revenue ?? 0, currency)}</td>
                          <td className="px-4 py-3 font-mono text-purple-400">{fmt(a.pipeline_value ?? 0, currency)}</td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={8} className="px-4 py-16 text-center text-sm text-slate-500">
                          {analyticsLoading ? "Loading analytics…" : "No source conversion data recorded yet."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden divide-y divide-white/5 p-2">
                {analyticsData.sources.map((a: any, i: number) => {
                  const rate = a.leads > 0 ? ((a.converted / a.leads) * 100).toFixed(1) : "0.0";
                  return (
                    <div key={i} className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: a.color ?? "#6366f1" }} />
                          <span className="font-bold text-white text-sm">{a.source}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 bg-white/5 px-2 py-0.5 rounded">
                          {a.channel ?? "Channel"}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                        <div className="rounded-lg bg-white/5 p-2">
                          <span className="text-[10px] text-slate-400 block">Leads / Converted</span>
                          <span className="font-bold text-white">{a.leads ?? 0} / <span className="text-emerald-400">{a.converted ?? 0}</span></span>
                          <span className="text-[10px] text-cyan-400 font-mono ml-1.5">({rate}%)</span>
                        </div>
                        <div className="rounded-lg bg-white/5 p-2">
                          <span className="text-[10px] text-slate-400 block">Won Deals / Revenue</span>
                          <span className="font-bold text-emerald-400">{fmt(a.won_revenue ?? 0, currency)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div>
            {/* Configuration stats row */}
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Total Sources", sources.length, "bg-indigo-500/20 text-indigo-300 border-indigo-500/20"],
                ["Active", sources.filter(s => s.is_active !== false).length, "bg-emerald-500/20 text-emerald-300 border-emerald-500/20"],
                ["Inactive", sources.filter(s => s.is_active === false).length, "bg-slate-500/20 text-slate-300 border-slate-500/20"],
                ["Channels", new Set(sources.map(s => s.channel)).size, "bg-cyan-500/20 text-cyan-300 border-cyan-500/20"],
              ].map(([l, v, cls]) => (
                <div key={l as string} className={"rounded-2xl border px-4 py-3 sm:px-5 sm:py-4 backdrop-blur-sm " + (cls as string)}>
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{l as string}</p>
                  <p className="mt-1 text-xl sm:text-2xl font-black">{v as number}</p>
                </div>
              ))}
            </div>

            {/* Source cards grid */}
            {loading ? (
              <div className="flex items-center justify-center py-24">
                <RefreshCw className="h-8 w-8 animate-spin text-indigo-400" />
              </div>
            ) : sources.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-white/10 bg-white/5 py-24 text-center px-4">
                <Zap className="h-12 w-12 text-slate-600" />
                <p className="text-slate-400">No lead sources configured yet.</p>
                <button onClick={openCreate}
                  className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500">
                  <Plus className="h-4 w-4" /> Add your first source
                </button>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sources.map((src: any) => (
                  <div key={src.id} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-5 transition-all hover:bg-white/8 hover:shadow-xl">
                    <div className="absolute left-0 top-0 h-full w-1.5 rounded-l-2xl" style={{ backgroundColor: src.color ?? "#6366f1" }} />

                    <div className="flex items-start justify-between pl-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: src.color ?? "#6366f1" }} />
                          <p className="font-bold text-white">{src.name}</p>
                          {src.is_active === false && (
                            <span className="rounded-full bg-slate-500/20 px-2 py-0.5 text-[9px] font-bold text-slate-400">INACTIVE</span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-slate-400">{src.channel}</p>
                        {src.utm_key && (
                          <p className="mt-1 font-mono text-[10px] text-slate-500">utm_source={src.utm_key}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(src)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-indigo-400 transition-colors">
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        {deleteId === src.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => del(src.id)} className="rounded-lg bg-rose-600/30 px-2 py-1 text-[10px] font-bold text-rose-300 hover:bg-rose-600/50">OK</button>
                            <button onClick={() => setDeleteId(null)} className="text-slate-500 text-[10px] hover:text-white">No</button>
                          </div>
                        ) : (
                          <button onClick={() => setDeleteId(src.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-rose-400 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}>
        <h2 className="mb-5 text-xl font-black text-white">{editing ? "Edit Lead Source" : "New Lead Source"}</h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase text-slate-400">Name *</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. LinkedIn Inbound"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500 placeholder:text-slate-500" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-slate-400">Channel</label>
              <select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })}
                className="w-full rounded-xl border border-white/10 bg-[#1a2235] px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500">
                {CHANNEL_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-slate-400">UTM Key</label>
              <input value={form.utm_key} onChange={e => setForm({ ...form, utm_key: e.target.value })}
                placeholder="linkedin_inbound"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500 placeholder:text-slate-500" />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-bold uppercase text-slate-400">Color</label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map(c => (
                <button key={c} onClick={() => setForm({ ...form, color: c })}
                  className={"h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 " +
                    (form.color === c ? "border-white scale-110" : "border-transparent")}>
                  <span className="block h-full w-full rounded-full" style={{ backgroundColor: c }} />
                </button>
              ))}
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-3">
            <div onClick={() => setForm({ ...form, is_active: !form.is_active })}
              className={"h-5 w-5 rounded border-2 flex items-center justify-center transition-all " +
                (form.is_active ? "border-indigo-500 bg-indigo-600" : "border-white/20 bg-white/5")}>
              {form.is_active && <CheckCircle2 className="h-3 w-3 text-white" />}
            </div>
            <span className="text-sm text-slate-300">Active (visible in lead forms)</span>
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => setModalOpen(false)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving}
            className="rounded-xl bg-indigo-600 px-6 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50 shadow-md shadow-indigo-600/30">
            {saving ? "Saving…" : editing ? "Update" : "Create"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
