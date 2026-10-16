"use client";

import { useEffect, useState, useMemo } from "react";
import { 
  TrendingUp, TrendingDown, IndianRupee, RefreshCw, BarChart2, 
  Users, Target, Award, Calendar, Layers, CheckCircle2, DollarSign,
  ArrowUpRight, ArrowDownRight, Wallet, PieChart, ShieldCheck
} from "lucide-react";
import { API_BASE_URL } from "@/config";
import { useRole } from "@/context/RoleContext";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

type Currency = "INR" | "USD";
const EXCHANGE = 83.5; // 1 USD ≈ 83.5 INR

function fmt(amount: number, currency: Currency) {
  if (currency === "INR") {
    return "₹" + Math.round(amount).toLocaleString("en-IN");
  }
  const usd = amount / EXCHANGE;
  return "$" + Math.round(usd).toLocaleString("en-US");
}

function StatCard({ 
  label, 
  value, 
  sub, 
  icon, 
  trend,
  colorClass,
  badgeText
}: {
  label: string; 
  value: string; 
  sub?: string;
  icon: React.ReactNode; 
  trend?: "up" | "down" | "neutral";
  colorClass: string;
  badgeText?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 p-6 shadow-sm hover:shadow-md transition-all group">
      <div className="flex items-center justify-between mb-4">
        <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-105", colorClass)}>
          {icon}
        </div>
        {badgeText && (
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300">
            {badgeText}
          </span>
        )}
      </div>
      <div>
        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 dark:text-zinc-500">{label}</p>
        <p className="mt-1 text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">{value}</p>
        {sub && <p className="mt-1.5 text-xs text-slate-500 dark:text-zinc-400 font-medium">{sub}</p>}
      </div>
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
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      const h: any = token ? { Authorization: "Bearer " + token } : {};
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

  if (roleLoading) return null;
  if (role !== "Admin" && role !== "SuperAdmin") return null;

  return (
    <div className="min-h-screen bg-slate-50/70 dark:bg-zinc-950 text-slate-900 dark:text-zinc-100 p-4 sm:p-6 lg:p-8 space-y-8 animate-in fade-in duration-500 pb-20">
      
      {/* Dashboard Top Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5 bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-slate-200/80 dark:border-zinc-800 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-3.5 bg-gradient-to-br from-indigo-600 to-blue-600 rounded-2xl text-white shadow-md shadow-indigo-500/20">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
              Revenue & Profitability Dashboard
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-zinc-400 font-medium mt-0.5">
              Real-time financial performance, closed revenue, operational costs & margins
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Currency Toggle */}
          <div className="flex rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 p-1">
            <button
              onClick={() => setCurrency("INR")}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black transition-all",
                currency === "INR" ? "bg-white dark:bg-zinc-700 text-indigo-600 dark:text-indigo-300 shadow-sm" : "text-slate-500 hover:text-slate-900"
              )}
            >
              <IndianRupee className="w-3.5 h-3.5" />
              <span>INR (₹)</span>
            </button>
            <button
              onClick={() => setCurrency("USD")}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black transition-all",
                currency === "USD" ? "bg-white dark:bg-zinc-700 text-indigo-600 dark:text-indigo-300 shadow-sm" : "text-slate-500 hover:text-slate-900"
              )}
            >
              <span>USD ($)</span>
            </button>
          </div>

          {/* Timeframe Selector */}
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-800/80 px-3 py-2 text-xs font-bold text-slate-700 dark:text-zinc-200 shadow-sm">
            <Calendar className="w-4 h-4 text-indigo-500" />
            <select
              value={monthsCount}
              onChange={e => setMonthsCount(Number(e.target.value))}
              className="bg-transparent text-slate-800 dark:text-zinc-100 outline-none cursor-pointer font-bold"
            >
              <option value={3} className="dark:bg-zinc-900">Last 3 Months</option>
              <option value={6} className="dark:bg-zinc-900">Last 6 Months</option>
              <option value={12} className="dark:bg-zinc-900">Last 12 Months</option>
              <option value={24} className="dark:bg-zinc-900">Last 24 Months</option>
            </select>
          </div>

          {/* Refresh Button */}
          <button
            onClick={fetchAll}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 transition-all shadow-md shadow-indigo-600/20 active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          label="Won Revenue"
          value={fmt(wonRevenue, currency)}
          sub={`${totals.won_deals ?? 0} closed won deals`}
          icon={<IndianRupee className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />}
          colorClass="bg-emerald-100/70 dark:bg-emerald-500/15 border border-emerald-200/50 dark:border-emerald-500/20"
          badgeText="Closed Revenue"
        />

        <StatCard
          label="Total Operating Costs"
          value={fmt(totalCosts, currency)}
          sub="Salaries, Overhead & Operations"
          icon={<BarChart2 className="w-6 h-6 text-rose-600 dark:text-rose-400" />}
          colorClass="bg-rose-100/70 dark:bg-rose-500/15 border border-rose-200/50 dark:border-rose-500/20"
          badgeText="Expenditure"
        />

        <StatCard
          label="Net Profit (After Cost)"
          value={fmt(netProfit, currency)}
          sub={netProfit >= 0 ? "Profitable Period" : "Operating Deficit"}
          icon={netProfit >= 0 ? <TrendingUp className="w-6 h-6 text-indigo-600 dark:text-indigo-400" /> : <TrendingDown className="w-6 h-6 text-amber-600 dark:text-amber-400" />}
          colorClass="bg-indigo-100/70 dark:bg-indigo-500/15 border border-indigo-200/50 dark:border-indigo-500/20"
          badgeText={netProfit >= 0 ? "Positive ROI" : "Attention"}
        />

        <StatCard
          label="Profit Margin"
          value={`${marginPct}%`}
          sub="(Revenue − Cost) / Revenue"
          icon={<Target className="w-6 h-6 text-violet-600 dark:text-violet-400" />}
          colorClass="bg-violet-100/70 dark:bg-violet-500/15 border border-violet-200/50 dark:border-violet-500/20"
          badgeText="Efficiency"
        />
      </div>

      {/* Secondary Operational Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Invoiced Paid</span>
            <div className="w-2 h-2 rounded-full bg-cyan-500" />
          </div>
          <p className="text-xl font-black text-slate-900 dark:text-white">{fmt(totals.invoiced_paid ?? 0, currency)}</p>
          <span className="text-[11px] text-slate-400 font-medium mt-1">Realized billing cash</span>
        </div>

        <div className="p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Open Pipeline</span>
            <div className="w-2 h-2 rounded-full bg-purple-500" />
          </div>
          <p className="text-xl font-black text-slate-900 dark:text-white">{fmt(totals.open_pipeline ?? 0, currency)}</p>
          <span className="text-[11px] text-slate-400 font-medium mt-1">Active negotiations</span>
        </div>

        <div className="p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Avg Deal Size</span>
            <div className="w-2 h-2 rounded-full bg-amber-500" />
          </div>
          <p className="text-xl font-black text-slate-900 dark:text-white">{fmt(totals.avg_deal_size ?? 0, currency)}</p>
          <span className="text-[11px] text-slate-400 font-medium mt-1">Per closed client</span>
        </div>

        <div className="p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Win Rate</span>
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
          </div>
          <p className="text-xl font-black text-slate-900 dark:text-white">{totals.win_rate != null ? `${totals.win_rate}%` : "—"}</p>
          <span className="text-[11px] text-slate-400 font-medium mt-1">Conversion efficiency</span>
        </div>
      </div>

      {/* Monthly Breakdown Table */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-slate-200/80 dark:border-zinc-800 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white">Monthly Financial Breakdown</h2>
              <p className="text-xs text-slate-500 dark:text-zinc-400">Historical performance by month</p>
            </div>
          </div>
          <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-500">
            {summaryData?.months?.length || 0} Months Tracked
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-zinc-950/50 text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-200 dark:border-zinc-800">
              <tr>
                <th className="px-6 py-4">Month</th>
                <th className="px-6 py-4">Won Revenue</th>
                <th className="px-6 py-4">Invoiced Paid</th>
                <th className="px-6 py-4">Total Costs</th>
                <th className="px-6 py-4">Salaries</th>
                <th className="px-6 py-4">Net Profit</th>
                <th className="px-6 py-4 text-center">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/60">
              {(summaryData?.months ?? []).map((m: any, idx: number) => {
                const isProfitable = (m.net_profit ?? 0) >= 0;
                const hasActivity = (m.won_revenue || 0) > 0 || (m.costs || 0) > 0;
                return (
                  <tr key={idx} className={cn("hover:bg-slate-50/60 dark:hover:bg-zinc-800/40 transition-colors", hasActivity && "font-semibold")}>
                    <td className="px-6 py-4">
                      <span className="inline-block px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-zinc-800 font-mono text-xs font-bold text-slate-800 dark:text-zinc-200">
                        {m.month}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {fmt(m.won_revenue ?? 0, currency)}
                    </td>
                    <td className="px-6 py-4 font-mono text-cyan-600 dark:text-cyan-400">
                      {fmt(m.invoiced_paid ?? 0, currency)}
                    </td>
                    <td className="px-6 py-4 font-mono text-rose-600 dark:text-rose-400">
                      {fmt(m.costs ?? 0, currency)}
                    </td>
                    <td className="px-6 py-4 font-mono text-amber-600 dark:text-amber-400">
                      {fmt(m.salary_costs ?? 0, currency)}
                    </td>
                    <td className="px-6 py-4 font-mono font-black">
                      <span className={cn(
                        "px-2.5 py-1 rounded-xl text-xs",
                        isProfitable 
                          ? "bg-emerald-100/70 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                          : "bg-rose-100/70 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300"
                      )}>
                        {fmt(m.net_profit ?? 0, currency)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="text-xs font-bold text-slate-600 dark:text-zinc-400">
                        {m.margin_pct != null ? `${m.margin_pct}%` : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {(!summaryData?.months || summaryData.months.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400 text-sm">
                    No monthly revenue data available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2-Column Split: Sales Revenue by Rep & Costs by Category */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales by Rep */}
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-slate-200/80 dark:border-zinc-800 shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                <Users className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white">Sales Revenue by Rep</h3>
            </div>
          </div>
          <div className="p-4 flex-1">
            <div className="divide-y divide-slate-100 dark:divide-zinc-800/60">
              {(summaryData?.by_salesperson ?? []).map((s: any, idx: number) => (
                <div key={idx} className="py-3.5 px-3 flex items-center justify-between hover:bg-slate-50/60 dark:hover:bg-zinc-800/40 rounded-2xl transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black text-sm">
                      {s.salesperson?.charAt(0) || "S"}
                    </div>
                    <div>
                      <p className="font-bold text-sm text-slate-900 dark:text-white">{s.salesperson}</p>
                      <p className="text-xs text-slate-400">{s.won_deals ?? 0} deals won</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-black text-base text-emerald-600 dark:text-emerald-400">
                      {fmt(s.won_revenue ?? 0, currency)}
                    </p>
                  </div>
                </div>
              ))}
              {(!summaryData?.by_salesperson || summaryData.by_salesperson.length === 0) && (
                <div className="py-12 text-center text-slate-400 text-sm">
                  No sales recorded for this period.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Costs by Category */}
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-slate-200/80 dark:border-zinc-800 shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400">
                <Layers className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white">Costs by Category</h3>
            </div>
          </div>
          <div className="p-4 flex-1">
            <div className="divide-y divide-slate-100 dark:divide-zinc-800/60">
              {(summaryData?.cost_by_category ?? []).map((c: any, idx: number) => (
                <div key={idx} className="py-3.5 px-3 flex items-center justify-between hover:bg-slate-50/60 dark:hover:bg-zinc-800/40 rounded-2xl transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 flex items-center justify-center font-black text-sm">
                      <PieChart className="w-4 h-4" />
                    </div>
                    <p className="font-bold text-sm text-slate-900 dark:text-white">{c.category}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-black text-base text-rose-600 dark:text-rose-400">
                      {fmt(c.amount ?? 0, currency)}
                    </p>
                  </div>
                </div>
              ))}
              {(!summaryData?.cost_by_category || summaryData.cost_by_category.length === 0) && (
                <div className="py-12 text-center text-slate-400 text-sm">
                  No categorized expenses recorded.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Top Won Deals */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-slate-200/80 dark:border-zinc-800 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white">Top Closed Won Deals</h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400">Largest converted client accounts</p>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-zinc-950/50 text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-200 dark:border-zinc-800">
              <tr>
                <th className="px-6 py-4">Deal Title</th>
                <th className="px-6 py-4">Client</th>
                <th className="px-6 py-4">Sales Representative</th>
                <th className="px-6 py-4">Won Date</th>
                <th className="px-6 py-4 text-right">Deal Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/60">
              {(summaryData?.top_deals ?? []).map((d: any, idx: number) => (
                <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-zinc-800/40 transition-colors">
                  <td className="px-6 py-4 font-bold text-slate-900 dark:text-white">
                    {d.title}
                  </td>
                  <td className="px-6 py-4 text-slate-600 dark:text-zinc-300 font-medium">
                    {d.client_name ?? "—"}
                  </td>
                  <td className="px-6 py-4 text-slate-500 dark:text-zinc-400 font-medium text-xs">
                    {d.salesperson ?? "Unassigned"}
                  </td>
                  <td className="px-6 py-4 text-slate-400 text-xs font-mono">
                    {(d.won_at ?? "").slice(0, 10) || "—"}
                  </td>
                  <td className="px-6 py-4 text-right font-mono font-black text-emerald-600 dark:text-emerald-400">
                    {fmt(d.amount ?? 0, currency)}
                  </td>
                </tr>
              ))}
              {(!summaryData?.top_deals || summaryData.top_deals.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400 text-sm">
                    No closed won deals recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
