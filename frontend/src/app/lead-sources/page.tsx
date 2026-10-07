"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Zap, Plus, Trash2, RefreshCw, Edit2, X,
  CheckCircle2, AlertCircle, BarChart2, TrendingUp, DollarSign, IndianRupee, Layers,
} from "lucide-react";
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
  return "$" + Math.round(amount / EXCHANGE).toLocaleString("en-US");
}

function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#111827] p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
        {children}
      </div>
    </div>
  );
}

const EMPTY_FORM = { name: "", channel: "Website", utm_key: "", color: "#6366f1", is_active: true };

export default function LeadSourcesPage() {
  const { role, loading: roleLoading } = useRole();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<"config" | "analytics">("config");
  const [sources, setSources] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any[]>([]);
  const [currency, setCurrency] = useState<Currency>("INR");
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
        setAnalytics(Array.isArray(json) ? json : json.sources || []);
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

      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Lead Sources</h1>
            <p className="mt-1 text-sm text-slate-400">Configure lead channels & track conversion ROI · Admin only</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Currency toggle */}
            <div className="flex overflow-hidden rounded-xl border border-white/10 bg-white/5">
              {(["INR", "USD"] as Currency[]).map(c => (
                <button key={c} onClick={() => setCurrency(c)}
                  className={"flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-all " + (currency === c ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white")}>
                  {c === "INR" ? <IndianRupee className="h-3.5 w-3.5" /> : <DollarSign className="h-3.5 w-3.5" />} {c}
                </button>
              ))}
            </div>

            <button onClick={() => { loadSources(); loadAnalytics(); }} disabled={loading}
              className="rounded-xl border border-white/10 bg-white/5 p-2 hover:bg-white/10">
              <RefreshCw className={"h-4 w-4 " + (loading ? "animate-spin text-indigo-400" : "text-slate-400")} />
            </button>
            <button onClick={openCreate}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500">
              <Plus className="h-4 w-4" /> Add Source
            </button>
          </div>
        </div>

        {/* Tab switch */}
        <div className="mb-8 flex gap-2 border-b border-white/10 pb-4">
          <button
            onClick={() => setActiveTab("config")}
            className={"flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all " +
              (activeTab === "config" ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20" : "text-slate-400 hover:text-white hover:bg-white/5")}>
            <Layers className="h-4 w-4" /> Source Configuration ({sources.length})
          </button>
          <button
            onClick={() => setActiveTab("analytics")}
            className={"flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all " +
              (activeTab === "analytics" ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20" : "text-slate-400 hover:text-white hover:bg-white/5")}>
            <BarChart2 className="h-4 w-4" /> Source Analytics & ROI
          </button>
        </div>

        {activeTab === "config" ? (
          <div>
            {/* Stats row */}
            <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ["Total Sources", sources.length, "bg-indigo-500/20 text-indigo-300 border-indigo-500/20"],
                ["Active", sources.filter(s => s.is_active !== false).length, "bg-emerald-500/20 text-emerald-300 border-emerald-500/20"],
                ["Inactive", sources.filter(s => s.is_active === false).length, "bg-slate-500/20 text-slate-300 border-slate-500/20"],
                ["Channels", new Set(sources.map(s => s.channel)).size, "bg-cyan-500/20 text-cyan-300 border-cyan-500/20"],
              ].map(([l, v, cls]) => (
                <div key={l as string} className={"rounded-2xl border px-5 py-4 backdrop-blur-sm " + (cls as string)}>
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{l as string}</p>
                  <p className="mt-1 text-2xl font-black">{v as number}</p>
                </div>
              ))}
            </div>

            {/* Source cards grid */}
            {loading ? (
              <div className="flex items-center justify-center py-24">
                <RefreshCw className="h-8 w-8 animate-spin text-indigo-400" />
              </div>
            ) : sources.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-white/10 bg-white/5 py-24">
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
                  <div key={src.id} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-5 transition-all hover:bg-white/8 hover:shadow-xl">
                    <div className="absolute left-0 top-0 h-full w-1 rounded-l-2xl" style={{ backgroundColor: src.color ?? "#6366f1" }} />

                    <div className="flex items-start justify-between pl-3">
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

                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={() => openEdit(src)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-indigo-400">
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        {deleteId === src.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => del(src.id)} className="rounded-lg bg-rose-600/30 px-2 py-1 text-[10px] font-bold text-rose-300 hover:bg-rose-600/50">OK</button>
                            <button onClick={() => setDeleteId(null)} className="text-slate-500 text-[10px] hover:text-white">No</button>
                          </div>
                        ) : (
                          <button onClick={() => setDeleteId(src.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-rose-400">
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
        ) : (
          <div>
            {/* Analytics Table */}
            <div className="overflow-x-auto rounded-2xl border border-white/10">
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
                  {analytics.length ? analytics.map((a: any, i: number) => {
                    const rate = a.leads > 0 ? ((a.converted / a.leads) * 100).toFixed(1) : "0.0";
                    return (
                      <tr key={i} className="hover:bg-white/5 transition-colors">
                        <td className="px-4 py-3 font-semibold text-white flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: a.color ?? "#6366f1" }} />
                          {a.source}
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs">{a.channel ?? "—"}</td>
                        <td className="px-4 py-3 font-bold">{a.leads ?? 0}</td>
                        <td className="px-4 py-3 text-emerald-400 font-bold">{a.converted ?? 0}</td>
                        <td className="px-4 py-3 font-mono text-cyan-400">{rate}%</td>
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
              placeholder="e.g. LinkedIn Organic"
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
                placeholder="linkedin_organic"
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
            className="rounded-xl bg-indigo-600 px-6 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
            {saving ? "Saving…" : editing ? "Update" : "Create"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
