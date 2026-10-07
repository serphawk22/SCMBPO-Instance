"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Users, UserCheck, ArrowRightLeft, Shield, RefreshCw,
  Search, CheckCircle2, AlertCircle, TrendingUp, IndianRupee, DollarSign,
} from "lucide-react";
import { API_BASE_URL } from "@/config";
import { useRole } from "@/context/RoleContext";
import { useRouter } from "next/navigation";

type Currency = "INR" | "USD";
const EXCHANGE = 83.5;

function fmt(amount: number, currency: Currency) {
  if (currency === "INR") return "\u20B9" + Math.round(amount).toLocaleString("en-IN");
  return "$" + Math.round(amount / EXCHANGE).toLocaleString("en-US");
}

export default function OwnershipPage() {
  const { role, loading: roleLoading } = useRole();
  const router = useRouter();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [currency, setCurrency] = useState<Currency>("INR");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!roleLoading && role !== "Admin" && role !== "SuperAdmin" && role !== "SalesManager") {
      router.replace("/");
    }
  }, [role, roleLoading, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(API_BASE_URL + "/ownership/report", {
        headers: { Authorization: "Bearer " + token },
      });
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const owners = data?.owners ?? [];
  const recentTransfers = data?.recent_transfers ?? [];

  const filteredOwners = owners.filter((o: any) =>
    !search || o.name?.toLowerCase().includes(search.toLowerCase()) || o.role?.toLowerCase().includes(search.toLowerCase())
  );

  if (roleLoading) return null;
  if (role !== "Admin" && role !== "SuperAdmin" && role !== "SalesManager") return null;

  return (
    <div className="min-h-screen bg-[#0c0f1d] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,#3b82f622_0%,transparent_60%)]" />

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Ownership & Reassignment Report</h1>
            <p className="mt-1 text-sm text-slate-400">Current owners, historical ownership transitions & workload balance</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Currency toggle */}
            <div className="flex overflow-hidden rounded-xl border border-white/10 bg-white/5">
              {(["INR", "USD"] as Currency[]).map(c => (
                <button key={c} onClick={() => setCurrency(c)}
                  className={"flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-all " + (currency === c ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white")}>
                  {c === "INR" ? <IndianRupee className="h-3.5 w-3.5" /> : <DollarSign className="h-3.5 w-3.5" />} {c}
                </button>
              ))}
            </div>

            <button onClick={load} disabled={loading}
              className="rounded-xl border border-white/10 bg-white/5 p-2 hover:bg-white/10">
              <RefreshCw className={"h-4 w-4 " + (loading ? "animate-spin text-indigo-400" : "text-slate-400")} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="mb-6 flex max-w-md items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
          <Search className="h-4 w-4 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by rep name or role..."
            className="flex-1 bg-transparent text-sm text-slate-300 outline-none placeholder:text-slate-500" />
        </div>

        {/* Current Owner Workload Table */}
        <div className="mb-10">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-black">
            <UserCheck className="h-5 w-5 text-indigo-400" /> Sales Team Workload & History
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <tr>
                  <th className="px-4 py-3">Rep Name</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Current Leads</th>
                  <th className="px-4 py-3">Current Clients</th>
                  <th className="px-4 py-3">Lifetime Leads Handled</th>
                  <th className="px-4 py-3">Lifetime Clients</th>
                  <th className="px-4 py-3">Transferred In</th>
                  <th className="px-4 py-3">Transferred Out</th>
                  <th className="px-4 py-3">Won Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredOwners.length ? filteredOwners.map((o: any) => (
                  <tr key={o.user_id} className="hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 font-semibold text-white">{o.name}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-500/20 px-2 py-0.5 text-[10px] font-bold text-slate-300">{o.role}</span>
                    </td>
                    <td className="px-4 py-3 font-bold text-cyan-400">{o.current_leads}</td>
                    <td className="px-4 py-3 font-bold text-emerald-400">{o.current_clients}</td>
                    <td className="px-4 py-3 text-slate-400">{o.historical_leads}</td>
                    <td className="px-4 py-3 text-slate-400">{o.historical_clients}</td>
                    <td className="px-4 py-3 text-indigo-300">+{o.transferred_in}</td>
                    <td className="px-4 py-3 text-rose-300">−{o.transferred_out}</td>
                    <td className="px-4 py-3 font-mono font-bold text-emerald-400">{fmt(o.won_revenue ?? 0, currency)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-500">
                      {loading ? "Loading owners…" : "No team members found."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Transfer Audit Log */}
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-black">
            <ArrowRightLeft className="h-5 w-5 text-amber-400" /> Recent Ownership Reassignments
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <tr>
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3">From Rep</th>
                  <th className="px-4 py-3">To Rep</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Reassigned By</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {recentTransfers.length ? recentTransfers.map((t: any, i: number) => (
                  <tr key={i} className="hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 font-semibold text-white">
                      <span className="capitalize">{t.entity_type}</span> #{t.entity_id}
                    </td>
                    <td className="px-4 py-3 text-rose-300">{t.from_user || "Unassigned"}</td>
                    <td className="px-4 py-3 text-emerald-300 font-semibold">{t.to_user || "Unassigned"}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs italic">{t.reason || "No reason given"}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs">{t.changed_by || "System"}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{(t.changed_at ?? "").slice(0, 16).replace("T", " ")}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500">
                      No reassignments recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
