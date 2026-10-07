"use client";

import { useEffect, useState, useCallback } from "react";
import {
  DollarSign, IndianRupee, Plus, Trash2, RefreshCw, Search,
  SlidersHorizontal, CheckCircle2, X, AlertCircle,
} from "lucide-react";
import { API_BASE_URL } from "@/config";
import { useRole } from "@/context/RoleContext";
import { useRouter } from "next/navigation";

type Currency = "INR" | "USD";
const EXCHANGE = 83.5;
const CATEGORIES = ["Salary", "Rent", "Marketing", "Software", "Operations", "Logistics", "Tax", "Misc", "Other"];

function fmt(amount: number, currency: Currency) {
  if (currency === "INR") return "\u20B9" + amount.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return "$" + (amount / EXCHANGE).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#111827] p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
        {children}
      </div>
    </div>
  );
}

const EMPTY_FORM = {
  title: "", category: "Other", amount: "", currency: "INR",
  cost_date: new Date().toISOString().slice(0, 7) + "-01",
  is_recurring: false, notes: "",
};

export default function BusinessCostsPage() {
  const { role, loading: roleLoading } = useRole();
  const router = useRouter();

  const [costs, setCosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [currency, setCurrency] = useState<Currency>("INR");
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(API_BASE_URL + "/business-costs", { headers: { Authorization: "Bearer " + token } });
      if (res.ok) {
        const json = await res.json();
        setCosts(Array.isArray(json) ? json : json.costs || []);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.title || !form.amount) return showToast("Title and amount are required.", false);
    setSaving(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(API_BASE_URL + "/business-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
      });
      if (res.ok) { showToast("Cost saved!"); setModalOpen(false); setForm(EMPTY_FORM); load(); }
      else { const e = await res.json(); showToast(e.detail ?? "Error saving.", false); }
    } catch { showToast("Network error.", false); }
    setSaving(false);
  };

  const del = async (id: number) => {
    const token = localStorage.getItem("token");
    const res = await fetch(API_BASE_URL + "/business-costs/" + id, {
      method: "DELETE", headers: { Authorization: "Bearer " + token },
    });
    if (res.ok) { showToast("Cost deleted."); load(); } else showToast("Delete failed.", false);
    setDeleteId(null);
  };

  const filtered = costs.filter(c =>
    (!search || c.title?.toLowerCase().includes(search.toLowerCase())) &&
    (!catFilter || c.category === catFilter)
  );

  const total = filtered.reduce((s, c) => s + (c.amount || 0), 0);

  if (roleLoading) return null;
  if (role !== "Admin" && role !== "SuperAdmin") return null;

  return (
    <div className="min-h-screen bg-[#0c0f1d] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,#7c3aed22_0%,transparent_60%)]" />

      {/* Toast */}
      {toast && (
        <div className={"fixed right-4 top-4 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-2xl transition-all " +
          (toast.ok ? "bg-emerald-600 text-white" : "bg-rose-600 text-white")}>
          {toast.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {toast.msg}
        </div>
      )}

      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Business Costs</h1>
            <p className="mt-1 text-sm text-slate-400">Track salaries, rent, software, and operational expenses · Admin only</p>
          </div>
          <button onClick={() => { setForm(EMPTY_FORM); setModalOpen(true); }}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500">
            <Plus className="h-4 w-4" /> Add Cost
          </button>
        </div>

        {/* Controls */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          {/* Currency */}
          <div className="flex overflow-hidden rounded-xl border border-white/10 bg-white/5">
            {(["INR", "USD"] as Currency[]).map(c => (
              <button key={c} onClick={() => setCurrency(c)}
                className={"flex items-center gap-1.5 px-3 py-2 text-sm font-bold transition-all " + (currency === c ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white")}>
                {c === "INR" ? <IndianRupee className="h-3.5 w-3.5" /> : <DollarSign className="h-3.5 w-3.5" />} {c}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 min-w-[180px]">
            <Search className="h-4 w-4 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search costs..."
              className="flex-1 bg-transparent text-sm text-slate-300 outline-none placeholder:text-slate-500" />
          </div>

          {/* Category filter */}
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <SlidersHorizontal className="h-4 w-4 text-slate-400" />
            <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
              className="bg-transparent text-sm text-slate-300 outline-none">
              <option value="">All Categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <button onClick={load} disabled={loading}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 hover:bg-white/10">
            <RefreshCw className={"h-4 w-4 " + (loading ? "animate-spin text-indigo-400" : "text-slate-400")} />
          </button>
        </div>

        {/* Summary */}
        <div className="mb-6 flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-600 text-white">
            {currency === "INR" ? <IndianRupee className="h-5 w-5" /> : <DollarSign className="h-5 w-5" />}
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Visible Costs</p>
            <p className="text-2xl font-black">{fmt(total, currency)}</p>
          </div>
          <span className="ml-auto text-sm text-slate-500">{filtered.length} entries</span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Month</th>
                <th className="px-4 py-3">Recurring</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.length ? filtered.map((c: any) => (
                <tr key={c.id} className="group hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 font-semibold text-white">{c.title}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-bold text-indigo-300">{c.category ?? "Other"}</span>
                  </td>
                  <td className="px-4 py-3 font-mono font-bold text-emerald-400">{fmt(c.amount, currency)}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{(c.cost_date ?? "").slice(0, 7)}</td>
                  <td className="px-4 py-3">
                    {c.is_recurring
                      ? <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold text-violet-300">Yes</span>
                      : <span className="text-slate-500 text-xs">No</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs max-w-[160px] truncate">{c.notes ?? "—"}</td>
                  <td className="px-4 py-3">
                    {deleteId === c.id ? (
                      <div className="flex items-center gap-2">
                        <button onClick={() => del(c.id)} className="rounded-lg bg-rose-600 px-2 py-1 text-xs font-bold text-white hover:bg-rose-500">Confirm</button>
                        <button onClick={() => setDeleteId(null)} className="text-slate-400 hover:text-white text-xs">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setDeleteId(c.id)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-400 transition-all">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-sm text-slate-500">No costs found. Add one above.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Cost Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}>
        <h2 className="mb-5 text-xl font-black text-white">Add Business Cost</h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase text-slate-400">Title *</label>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Office Rent — Oct"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500 placeholder:text-slate-500" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-slate-400">Category</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-xl border border-white/10 bg-[#1a2235] px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-slate-400">Currency</label>
              <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}
                className="w-full rounded-xl border border-white/10 bg-[#1a2235] px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500">
                <option value="INR">INR (&#8377;)</option>
                <option value="USD">USD ($)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-slate-400">Amount *</label>
              <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
                placeholder="0"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-slate-400">Month</label>
              <input type="month" value={form.cost_date?.slice(0, 7)}
                onChange={e => setForm({ ...form, cost_date: e.target.value + "-01" })}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase text-slate-400">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              rows={2} placeholder="Optional notes..."
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500 resize-none placeholder:text-slate-500" />
          </div>

          <label className="flex cursor-pointer items-center gap-3">
            <div onClick={() => setForm({ ...form, is_recurring: !form.is_recurring })}
              className={"h-5 w-5 rounded border-2 flex items-center justify-center transition-all " +
                (form.is_recurring ? "border-indigo-500 bg-indigo-600" : "border-white/20 bg-white/5")}>
              {form.is_recurring && <CheckCircle2 className="h-3 w-3 text-white" />}
            </div>
            <span className="text-sm text-slate-300">Recurring monthly cost</span>
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => setModalOpen(false)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving}
            className="rounded-xl bg-indigo-600 px-6 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
            {saving ? "Saving…" : "Save Cost"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
