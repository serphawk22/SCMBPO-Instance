"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserX, Plus, X, Loader2, Trash2, TrendingDown, AlertTriangle,
  Building2, Calendar, DollarSign, RefreshCw, BarChart2, ArrowUpRight
} from "lucide-react";
import { API_BASE_URL } from "@/config";
import { Sidebar } from "@/components/Sidebar";
import { useRole } from "@/context/RoleContext";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import Link from "next/link";

interface DroppedClient {
  id: number;
  client_id?: number;
  company_name: string;
  reason?: string;
  reason_category?: string;
  last_revenue?: number;
  relationship_months?: number;
  reactivation_potential?: string;
  notes?: string;
  dropped_at?: string;
}

const REASON_CATEGORIES = [
  "Price", "Service Quality", "Competition", "No Budget", "Merger/Acquisition",
  "Scope Change", "Project Completed", "Unresponsive", "Other"
];

const REACTIVATION_OPTIONS = ["Low", "Medium", "High"];

const CATEGORY_COLORS = [
  "#6366f1", "#f59e0b", "#ef4444", "#10b981", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"
];

const REACTIVATION_COLORS: Record<string, string> = {
  Low: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  Medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  High: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
};

export default function DroppedClientsPage() {
  const { role } = useRole();
  const [clients, setClients] = useState<DroppedClient[]>([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterCat, setFilterCat] = useState("All");
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const [form, setForm] = useState({
    company_name: "",
    reason: "",
    reason_category: "Other",
    last_revenue: "",
    relationship_months: "",
    reactivation_potential: "Low",
    notes: "",
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/dropped-clients`);
      const data = await res.json();
      setClients(data.dropped_clients || []);
      setCategoryBreakdown(data.category_breakdown || {});
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // Auto-hide toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const pieData = Object.entries(categoryBreakdown).map(([name, value]) => ({ name, value }));

  const filtered = filterCat === "All" ? clients : clients.filter(c => c.reason_category === filterCat);

  const totalRevenueLost = clients.reduce((s, c) => s + (c.last_revenue || 0), 0);
  const highPotential = clients.filter(c => c.reactivation_potential === "High").length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/dropped-clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: form.company_name,
          reason: form.reason || null,
          reason_category: form.reason_category,
          last_revenue: parseFloat(form.last_revenue) || 0,
          relationship_months: parseInt(form.relationship_months) || 0,
          reactivation_potential: form.reactivation_potential,
          notes: form.notes || null,
        }),
      });
      if (res.ok) {
        setToast({ ok: true, msg: "Dropped client recorded." });
        setShowModal(false);
        setForm({ company_name: "", reason: "", reason_category: "Other", last_revenue: "", relationship_months: "", reactivation_potential: "Low", notes: "" });
        loadData();
      } else {
        setToast({ ok: false, msg: "Failed to save." });
      }
    } catch {
      setToast({ ok: false, msg: "Error." });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this record?")) return;
    await fetch(`${API_BASE_URL}/dropped-clients/${id}`, { method: "DELETE" });
    setClients(prev => prev.filter(c => c.id !== id));
    setToast({ ok: true, msg: "Record deleted." });
  };

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-zinc-950 overflow-hidden">
      <Sidebar role={role} />
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">

          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 shadow-lg shadow-red-500/20">
                <UserX className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-zinc-100">Dropped Clients</h1>
                <p className="text-sm text-slate-500 dark:text-zinc-400">Track discontinued client relationships</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={loadData} className="p-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700">
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-white text-sm font-semibold hover:opacity-90 shadow-md transition-all active:scale-95"
              >
                <Plus className="w-4 h-4" /> Record Dropped Client
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total Dropped", value: clients.length, icon: UserX, color: "text-red-600", bg: "bg-red-50 dark:bg-red-900/20" },
              { label: "Revenue Lost", value: `$${totalRevenueLost.toLocaleString()}`, icon: DollarSign, color: "text-rose-600", bg: "bg-rose-50 dark:bg-rose-900/20" },
              { label: "High Reactivation", value: highPotential, icon: ArrowUpRight, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
              { label: "Categories", value: Object.keys(categoryBreakdown).length, icon: BarChart2, color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-900/20" },
            ].map(s => (
              <div key={s.label} className={`flex items-center gap-3 p-4 rounded-2xl ${s.bg} border border-white/60 dark:border-white/5 shadow-sm`}>
                <s.icon className={`w-5 h-5 ${s.color} shrink-0`} />
                <div>
                  <p className={`text-xl font-black ${s.color}`}>{loading ? "—" : s.value}</p>
                  <p className="text-xs font-medium text-slate-500 dark:text-zinc-400">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Chart */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-700 p-5 shadow-sm">
              <h3 className="font-bold text-slate-800 dark:text-zinc-100 mb-4 flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-red-500" /> Loss Reasons
              </h3>
              {pieData.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-slate-400">
                  <TrendingDown className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-sm">No data yet</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => [`${v} clients`, ""]} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: "11px" }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Table */}
            <div className="lg:col-span-2 bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-700 shadow-sm overflow-hidden">
              {/* Filter */}
              <div className="flex gap-2 p-4 border-b border-slate-100 dark:border-zinc-800 overflow-x-auto">
                {["All", ...REASON_CATEGORIES].map(cat => (
                  <button key={cat} onClick={() => setFilterCat(cat)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${filterCat === cat ? "bg-red-500 text-white" : "bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 hover:bg-slate-200"}`}>
                    {cat}
                  </button>
                ))}
              </div>

              {loading ? (
                <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-red-500" /></div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <UserX className="w-10 h-10 mb-3 opacity-30" />
                  <p className="font-medium">No dropped clients recorded</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-zinc-800">
                  {filtered.map((c, i) => (
                    <motion.div key={c.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                      className="flex items-start gap-4 p-4 hover:bg-slate-50 dark:hover:bg-zinc-800/40 group transition-colors">
                      <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center shrink-0">
                        <Building2 className="w-5 h-5 text-red-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            {c.client_id ? (
                              <Link
                                href={`/admin/clients/${c.client_id}`}
                                className="font-semibold text-slate-900 dark:text-zinc-100 hover:text-red-600 transition-colors flex items-center gap-1.5"
                              >
                                {c.company_name}
                                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
                              </Link>
                            ) : (
                              <p className="font-semibold text-slate-900 dark:text-zinc-100">{c.company_name}</p>
                            )}
                            {c.reason && <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5 line-clamp-1">{c.reason}</p>}
                          </div>
                          <div className="flex items-center gap-1">
                            {c.client_id && (
                              <Link
                                href={`/admin/clients/${c.client_id}`}
                                className="text-[11px] font-semibold text-slate-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 transition-all"
                              >
                                Overview →
                              </Link>
                            )}
                            <button onClick={() => handleDelete(c.id)}
                              className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-400 hover:text-red-600 transition-all shrink-0">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          {c.reason_category && (
                            <span className="text-[10px] bg-slate-100 dark:bg-zinc-800 text-slate-500 px-2 py-0.5 rounded-md font-medium">
                              {c.reason_category}
                            </span>
                          )}
                          {c.reactivation_potential && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${REACTIVATION_COLORS[c.reactivation_potential] || ""}`}>
                              {c.reactivation_potential} Reactivation
                            </span>
                          )}
                          {c.last_revenue && c.last_revenue > 0 && (
                            <span className="text-[10px] text-slate-500 flex items-center gap-1">
                              <DollarSign className="w-3 h-3" />${c.last_revenue.toLocaleString()} last revenue
                            </span>
                          )}
                          {c.relationship_months && c.relationship_months > 0 && (
                            <span className="text-[10px] text-slate-500 flex items-center gap-1">
                              <Calendar className="w-3 h-3" />{c.relationship_months}mo relationship
                            </span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
            <motion.div initial={{ scale: 0.95, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 16 }}
              className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-zinc-700">
                <h2 className="text-lg font-bold text-slate-800 dark:text-zinc-100 flex items-center gap-2">
                  <UserX className="w-5 h-5 text-red-500" /> Record Dropped Client
                </h2>
                <button onClick={() => setShowModal(false)} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800">
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1.5 block">Company Name *</label>
                  <input required value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))}
                    placeholder="Acme Corp" className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1.5 block">Reason</label>
                  <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                    placeholder="Why did they leave?" className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1.5 block">Category</label>
                    <select value={form.reason_category} onChange={e => setForm(f => ({ ...f, reason_category: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500">
                      {REASON_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1.5 block">Reactivation</label>
                    <select value={form.reactivation_potential} onChange={e => setForm(f => ({ ...f, reactivation_potential: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500">
                      {REACTIVATION_OPTIONS.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1.5 block">Last Revenue ($)</label>
                    <input type="number" value={form.last_revenue} onChange={e => setForm(f => ({ ...f, last_revenue: e.target.value }))}
                      placeholder="0" className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1.5 block">Relationship (months)</label>
                    <input type="number" value={form.relationship_months} onChange={e => setForm(f => ({ ...f, relationship_months: e.target.value }))}
                      placeholder="0" className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1.5 block">Notes</label>
                  <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                    placeholder="Additional context..." className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none" />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowModal(false)}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 text-sm font-semibold text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800">
                    Cancel
                  </button>
                  <button type="submit" disabled={saving}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 shadow-md">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}
                    Save Record
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
            className={`fixed bottom-6 right-6 z-[200] px-5 py-3 rounded-2xl shadow-xl text-sm font-bold text-white ${toast.ok ? "bg-emerald-600" : "bg-red-600"}`}>
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
