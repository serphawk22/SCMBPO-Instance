"use client";

import { useEffect, useState, useMemo } from "react";
import {
  TrendingUp, TrendingDown, DollarSign, IndianRupee, RefreshCw,
  BarChart2, Users, Target, Award, Calendar, Layers, CheckCircle2,
} from "lucide-react";
import { API_BASE_URL } from "@/config";
import { useRole } from "@/context/RoleContext";
import { useRouter } from "next/navigation";

type Currency = "INR" | "USD";
const EXCHANGE = 83.5; // 1 USD ≈ 83.5 INR

function fmt(amount: number, currency: Currency) {
  if (currency === "INR") {
    return "\u20B9" + Math.round(amount).toLocaleString("en-IN");
  }
  const usd = amount / EXCHANGE;
  return "$" + Math.round(usd).toLocaleString("en-US");
}

function StatCard({ label, value, sub, icon, color }: {
  label: string; value: string; sub?: string;
  icon: React.ReactNode; color: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm transition-all hover:bg-white/10 hover:shadow-xl">
      <div className={"mb-4 flex h-11 w-11 items-center justify-center rounded-xl text-white " + color}>
        {icon}
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-black text-white">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function Table({ headers, rows, empty }: { headers: string[]; rows: React.ReactNode[][]; empty?: string }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="bg-white/5 text-[10px] font-black uppercase tracking-widest text-slate-400">
          <tr>{headers.map(h => <th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.length ? rows.map((row, i) => (
            <tr key={i} className="hover:bg-white/5 transition-colors">
              {row.map((cell, j) => <td key={j} className="whitespace-nowrap px-4 py-3 text-slate-300">{cell}</td>)}
            </tr>
          )) : (
            <tr><td colSpan={headers.length} className="px-4 py-12 text-center text-sm text-slate-500">{empty ?? "No data."}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function RevenueDashboard() {
  const { role, loading: roleLoading } = useRole();
  const router = useRouter();

  const [currency, setCurrency] = useState<Currency>("INR");
  const [monthsCount, setMonthsCount] = useState<number>(12);
  const [summaryData, setSummaryData] = useState<any>(null);
  const [costsData, setCostsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!roleLoading && role !== "Admin" && role !== "SuperAdmin") {
      router.replace("/");
    }
  }, [role, roleLoading, router]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const h: any = { Authorization: "Bearer " + token };
      const [sumRes, costsRes] = await Promise.all([
        fetch(API_BASE_URL + "/revenue/summary?months=" + monthsCount, { headers: h }),
        fetch(API_BASE_URL + "/business-costs", { headers: h }),
      ]);
      if (sumRes.ok) setSummaryData(await sumRes.json());
      if (costsRes.ok) setCostsData(await costsRes.json());
    } catch { /* silent */ }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [monthsCount]);

  const totals = summaryData?.totals || {};
  const wonRevenue = totals.won_revenue ?? 0;
  const totalCosts = totals.costs ?? (costsData.reduce((s: number, c: any) => s + (c.amount || 0), 0));
  const netProfit = totals.net_profit ?? (wonRevenue - totalCosts);
  const marginPct = totals.margin_pct ?? (wonRevenue > 0 ? ((netProfit / wonRevenue) * 100).toFixed(1) : "0.0");

  const staffRows: React.ReactNode[][] = (summaryData?.by_salesperson ?? []).map((s: any) => [
    <span key="n" className="font-semibold text-white">{s.salesperson}</span>,
    fmt(s.won_revenue ?? 0, currency),
    String(s.won_deals ?? 0),
  ]);

  const topDealRows: React.ReactNode[][] = (summaryData?.top_deals ?? []).map((d: any) => [
    <span key="t" className="font-semibold text-white">{d.title}</span>,
    <span key="c" className="text-slate-400">{d.client_name ?? "—"}</span>,
    <span key="sp" className="text-slate-300">{d.salesperson ?? "Unassigned"}</span>,
    <span key="a" className="font-mono font-bold text-emerald-400">{fmt(d.amount ?? 0, currency)}</span>,
    <span key="w" className="text-xs text-slate-500">{(d.won_at ?? "").slice(0, 10)}</span>,
  ]);

  const monthRows: React.ReactNode[][] = (summaryData?.months ?? []).map((m: any) => [
    <span key="m" className="font-bold text-white">{m.month}</span>,
    <span key="r" className="font-mono text-emerald-400">{fmt(m.won_revenue ?? 0, currency)}</span>,
    <span key="p" className="font-mono text-cyan-400">{fmt(m.invoiced_paid ?? 0, currency)}</span>,
    <span key="c" className="font-mono text-rose-400">{fmt(m.costs ?? 0, currency)}</span>,
    <span key="s" className="font-mono text-amber-400">{fmt(m.salary_costs ?? 0, currency)}</span>,
    <span key="np" className={"font-mono font-bold " + ((m.net_profit ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
      {fmt(m.net_profit ?? 0, currency)}
    </span>,
    <span key="mg" className="text-xs text-slate-300">
      {m.margin_pct != null ? `${m.margin_pct}%` : "—"}
    </span>,
  ]);

  const costCatRows: React.ReactNode[][] = (summaryData?.cost_by_category ?? []).map((c: any) => [
    <span key="cat" className="font-medium text-white">{c.category}</span>,
    <span key="a" className="font-mono font-bold text-rose-400">{fmt(c.amount ?? 0, currency)}</span>,
  ]);

  if (roleLoading) return null;
  if (role !== "Admin" && role !== "SuperAdmin") return null;

  return (
    <div className="min-h-screen bg-[#0c0f1d] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top_left,#1e3a5f33_0%,transparent_60%),radial-gradient(ellipse_at_bottom_right,#4c1d9533_0%,transparent_60%)]" />

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Revenue Dashboard</h1>
            <p className="mt-1 text-sm text-slate-400">Financial performance & profitability · Admin only</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Currency toggle */}
            <div className="flex overflow-hidden rounded-xl border border-white/10 bg-white/5">
              {(["INR", "USD"] as Currency[]).map(c => (
                <button key={c} onClick={() => setCurrency(c)}
                  className={"flex items-center gap-1.5 px-4 py-2 text-sm font-bold transition-all " + (currency === c ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white")}>
                  {c === "INR" ? <IndianRupee className="h-3.5 w-3.5" /> : <DollarSign className="h-3.5 w-3.5" />}
                  {c}
                </button>
              ))}
            </div>

            {/* Timeframe */}
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <Calendar className="h-4 w-4 text-slate-400" />
              <select value={monthsCount} onChange={e => setMonthsCount(Number(e.target.value))}
                className="bg-transparent text-slate-300 outline-none">
                <option value={3} className="bg-[#111827]">Last 3 Months</option>
                <option value={6} className="bg-[#111827]">Last 6 Months</option>
                <option value={12} className="bg-[#111827]">Last 12 Months</option>
                <option value={24} className="bg-[#111827]">Last 24 Months</option>
              </select>
            </div>

            <button onClick={fetchAll} disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
              <RefreshCw className={"h-4 w-4 " + (loading ? "animate-spin" : "")} />
              Refresh
            </button>
          </div>
        </div>

        {/* Primary KPI cards */}
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Won Revenue" value={fmt(wonRevenue, currency)}
            sub={(totals.won_deals ?? 0) + " won deals"}
            icon={currency === "INR" ? <IndianRupee className="h-5 w-5" /> : <DollarSign className="h-5 w-5" />}
            color="bg-emerald-600" />
          <StatCard label="Total Costs" value={fmt(totalCosts, currency)}
            sub="Salaries, Ops & Overhead"
            icon={<BarChart2 className="h-5 w-5" />} color="bg-rose-600" />
          <StatCard label="Net Profit (After Cost)" value={fmt(netProfit, currency)}
            sub={netProfit >= 0 ? "Profitable" : "Deficit"}
            icon={netProfit >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
            color={netProfit >= 0 ? "bg-indigo-600" : "bg-orange-600"} />
          <StatCard label="Profit Margin" value={`${marginPct}%`}
            sub="(Revenue − Cost) / Revenue"
            icon={<Target className="h-5 w-5" />} color="bg-violet-600" />
        </div>

        {/* Secondary metric chips */}
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-5 py-4 backdrop-blur-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Invoiced Paid</p>
            <p className="mt-1 text-2xl font-black text-white">{fmt(totals.invoiced_paid ?? 0, currency)}</p>
          </div>
          <div className="rounded-2xl border border-purple-500/20 bg-purple-500/10 px-5 py-4 backdrop-blur-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-purple-300">Open Pipeline</p>
            <p className="mt-1 text-2xl font-black text-white">{fmt(totals.open_pipeline ?? 0, currency)}</p>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-5 py-4 backdrop-blur-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">Avg Deal Size</p>
            <p className="mt-1 text-2xl font-black text-white">{fmt(totals.avg_deal_size ?? 0, currency)}</p>
          </div>
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-4 backdrop-blur-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Win Rate</p>
            <p className="mt-1 text-2xl font-black text-white">{totals.win_rate != null ? `${totals.win_rate}%` : "—"}</p>
          </div>
        </div>

        {/* Monthly Breakdown Table */}
        <div className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-black">
            <Calendar className="h-5 w-5 text-indigo-400" /> Monthly Revenue & Cost Breakdown
          </h2>
          <Table
            headers={["Month", "Won Revenue", "Invoiced Paid", "Total Costs", "Salaries", "Net Profit", "Margin"]}
            rows={monthRows}
            empty="No monthly financial history available."
          />
        </div>

        {/* 2-Column Split: Salesperson Performance & Cost by Category */}
        <div className="mb-8 grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-black">
              <Users className="h-5 w-5 text-indigo-400" /> Sales Revenue by Rep
            </h2>
            <Table
              headers={["Salesperson", "Won Revenue", "Won Deals"]}
              rows={staffRows}
              empty="No sales recorded for this period."
            />
          </div>
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-black">
              <Layers className="h-5 w-5 text-rose-400" /> Costs by Category
            </h2>
            <Table
              headers={["Category", "Total Spent"]}
              rows={costCatRows}
              empty="No categorized costs recorded."
            />
          </div>
        </div>

        {/* Top Won Deals */}
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-black">
            <Award className="h-5 w-5 text-emerald-400" /> Top Won Deals
          </h2>
          <Table
            headers={["Deal Title", "Client", "Salesperson", "Amount", "Won Date"]}
            rows={topDealRows}
            empty="No won deals yet."
          />
        </div>
      </div>
    </div>
  );
}
