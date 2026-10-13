"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Zap, Users, CheckCircle2, IndianRupee, Target, Briefcase, Clock, TrendingUp, Filter, FileText, ChevronRight, ExternalLink, Calendar, BarChart2, ShieldAlert, Sparkles } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend
} from "recharts";
import { API_BASE_URL } from "@/config";
import { useRole } from "@/context/RoleContext";
import {
  Currency, useCurrency, money, num, pctf, PALETTE, TOOLTIP_STYLE, AXIS_TICK,
  Tile, Card, Pill, Skeleton, CurrencyToggle, Segmented, relTime, statusColor
} from "@/components/analytics/kit";

export default function LeadSourceDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { role, loading: roleLoading } = useRole();
  const [currency, setCurrency] = useCurrency();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"leads" | "deals" | "proposals">("leads");

  const sourceId = id as string;

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/analytics/lead-sources/${sourceId}/detail`);
      if (!res.ok) {
        throw new Error(`Failed to load source details (${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load source");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!roleLoading && sourceId) {
      fetchData();
    }
  }, [roleLoading, sourceId]);

  if (loading || roleLoading) {
    return (
      <div className="space-y-6 p-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 text-center max-w-md mx-auto mt-12 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-lg">
        <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-[var(--text-primary)]">Source Not Found</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-2">{error || "Could not load this lead source."}</p>
        <Link
          href="/lead-source-analytics"
          className="inline-block mt-6 px-4 py-2 bg-[var(--primary)] text-white rounded-lg font-bold text-sm"
        >
          Back to Analytics
        </Link>
      </div>
    );
  }

  const s = data.source || {};
  const leads = data.leads || [];
  const deals = data.deals || [];
  const proposals = data.proposals || [];
  const trend = data.trend || [];

  return (
    <div className="space-y-6 pb-16">
      {/* ── Top Bar ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-3">
          <Link
            href="/lead-source-analytics"
            className="p-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--sidebar-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span
            className="h-4 w-4 rounded-full shrink-0"
            style={{ backgroundColor: s.color || "#6366f1" }}
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black tracking-tight text-[var(--text-primary)]">
                {s.source}
              </h1>
              <Pill color={s.color || "#6366f1"}>{s.channel || "Channel"}</Pill>
            </div>
            {s.utm_key && (
              <p className="text-xs font-mono text-[var(--text-secondary)]">
                UTM Campaign / Tag: {s.utm_key}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <CurrencyToggle value={currency} onChange={setCurrency} />
          <Link
            href="/lead-sources"
            className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--sidebar-hover)] transition-colors"
          >
            Configure Sources
          </Link>
        </div>
      </div>

      {/* ── KPI METRICS GRID ────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Tile
          label="Total Leads"
          value={num(s.leads)}
          sub={`${pctf(s.share_of_leads)} of all inbound`}
          icon={Users}
          tone="indigo"
          href="/leads"
        />
        <Tile
          label="Converted Leads"
          value={num(s.converted)}
          sub={`${pctf(s.conversion_rate)} conversion rate`}
          icon={CheckCircle2}
          tone="emerald"
          href="/leads?status=Converted"
        />
        <Tile
          label="Won Revenue"
          value={money(s.won_revenue, currency, true)}
          sub={`${num(s.won_deals)} won deals (${pctf(s.win_rate)} win)`}
          icon={IndianRupee}
          tone="amber"
          href="/revenue"
        />
        <Tile
          label="Avg Deal Size"
          value={money(s.avg_deal_size, currency, true)}
          sub={`Rev/lead: ${money(s.revenue_per_lead, currency, true)}`}
          icon={Briefcase}
          tone="violet"
          href="/pipeline"
        />
        <Tile
          label="Pipeline Value"
          value={money(s.pipeline_value, currency, true)}
          sub={`${s.open_deals || 0} active open deals`}
          icon={Target}
          tone="sky"
          href="/pipeline"
        />
        <Tile
          label="Sales Cycle"
          value={s.avg_cycle_days ? `${s.avg_cycle_days}d` : "—"}
          sub="Lead creation to close"
          icon={Clock}
          tone="teal"
        />

        {s.total_cost !== null && s.total_cost !== undefined && (
          <>
            <Tile
              label="Marketing Spend"
              value={money(s.total_cost, currency, true)}
              sub={`Spend/mo: ${money(s.monthly_cost, currency, true)}`}
              icon={IndianRupee}
              tone="slate"
              href="/business-costs"
            />
            <Tile
              label="Cost Per Lead (CPL)"
              value={money(s.cost_per_lead, currency, true)}
              sub="Acquisition cost"
              icon={Target}
              tone="orange"
              href="/business-costs"
            />
            <Tile
              label="Cost Per Customer (CAC)"
              value={money(s.cost_per_conversion, currency, true)}
              sub="Conversion cost"
              icon={TrendingUp}
              tone="rose"
              href="/business-costs"
            />
            <Tile
              label="Return on Spend (ROI)"
              value={pctf(s.roi_pct)}
              sub={`ROAS: ${s.roas ? s.roas + "x" : "—"}`}
              icon={TrendingUp}
              tone={s.roi_pct >= 0 ? "emerald" : "rose"}
              href="/revenue"
            />
          </>
        )}
      </div>

      {/* ── TREND & BREAKDOWNS ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card
          title="Monthly Lead & Revenue Trend"
          icon={TrendingUp}
          tone="indigo"
          className="lg:col-span-2"
        >
          <div className="h-72 w-full">
            {trend.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)] text-center py-20">No monthly trend data</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorSrcLeads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="colorSrcConv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} />
                  <YAxis tick={AXIS_TICK} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="leads" name="Leads" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorSrcLeads)" />
                  <Area type="monotone" dataKey="converted" name="Converted" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorSrcConv)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Lead Stages & Owners */}
        <div className="space-y-4 lg:col-span-1">
          <Card title="Funnel Statuses" icon={Filter} tone="violet">
            <div className="space-y-2">
              {(data.statuses || []).map((st: any) => (
                <div key={st.status} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusColor(st.status) }} />
                    <span className="font-semibold text-[var(--text-primary)]">{st.status}</span>
                  </div>
                  <span className="font-bold text-[var(--text-secondary)]">{st.count} leads</span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Top Sales Owners" icon={Users} tone="teal">
            <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
              {(data.owners || []).map((o: any) => (
                <div key={o.owner} className="flex items-center justify-between text-xs py-1 border-b border-[var(--border)] last:border-0">
                  <span className="font-semibold text-[var(--text-primary)] truncate">{o.owner}</span>
                  <span className="text-indigo-500 font-bold">{o.leads} leads</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* ── DETAILS TABS (LEADS, DEALS, PROPOSALS) ─────────────── */}
      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <header className="border-b border-[var(--border)] bg-[var(--sidebar-hover)]/30 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-indigo-500" />
            <h3 className="text-sm font-extrabold text-[var(--text-primary)]">
              Associated Records for {s.source}
            </h3>
          </div>

          <Segmented
            value={activeTab}
            onChange={(v) => setActiveTab(v as any)}
            options={[
              { value: "leads", label: `Leads (${leads.length})` },
              { value: "deals", label: `Deals (${deals.length})` },
              { value: "proposals", label: `Proposals (${proposals.length})` },
            ]}
          />
        </header>

        <div className="overflow-x-auto">
          {activeTab === "leads" && (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--border)] bg-[var(--sidebar-hover)]/40 text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)]">
                <tr>
                  <th className="py-2.5 px-4">Lead / Company</th>
                  <th className="py-2.5 px-3">Industry</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Assigned Rep</th>
                  <th className="py-2.5 px-3 text-right">Won Deal Value</th>
                  <th className="py-2.5 px-3 text-right">Open Pipeline</th>
                  <th className="py-2.5 px-3 text-right">Created</th>
                  <th className="py-2.5 px-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] font-medium">
                {leads.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-[var(--text-secondary)]">No leads found for this source</td>
                  </tr>
                ) : (
                  leads.map((l: any) => (
                    <tr
                      key={l.id}
                      className="hover:bg-[var(--sidebar-hover)]/60 cursor-pointer transition-colors"
                      onClick={() => router.push(`/leads/${l.id}`)}
                    >
                      <td className="py-2.5 px-4 font-bold text-[var(--text-primary)]">
                        {l.company_name || `Lead #${l.id}`}
                        {l.email && <span className="block text-[10px] text-[var(--text-secondary)] font-normal">{l.email}</span>}
                      </td>
                      <td className="py-2.5 px-3 text-[var(--text-secondary)]">{l.industry || "—"}</td>
                      <td className="py-2.5 px-3">
                        <Pill color={statusColor(l.status)}>{l.status}</Pill>
                      </td>
                      <td className="py-2.5 px-3 text-[var(--text-secondary)]">{l.owner}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-emerald-600">
                        {l.deal_value ? money(l.deal_value, currency) : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right text-[var(--text-secondary)]">
                        {l.open_value ? money(l.open_value, currency) : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right text-[var(--text-secondary)]">
                        {relTime(l.created_at)}
                      </td>
                      <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <Link
                          href={`/leads/${l.id}`}
                          className="p-1 rounded hover:bg-[var(--primary)]/10 text-[var(--primary)] inline-flex items-center"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {activeTab === "deals" && (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--border)] bg-[var(--sidebar-hover)]/40 text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)]">
                <tr>
                  <th className="py-2.5 px-4">Deal Title</th>
                  <th className="py-2.5 px-3">Client</th>
                  <th className="py-2.5 px-3">Stage</th>
                  <th className="py-2.5 px-3 text-right">Amount</th>
                  <th className="py-2.5 px-3">Owner</th>
                  <th className="py-2.5 px-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] font-medium">
                {deals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[var(--text-secondary)]">No deals tied to this source</td>
                  </tr>
                ) : (
                  deals.map((d: any) => (
                    <tr
                      key={d.id}
                      className="hover:bg-[var(--sidebar-hover)]/60 cursor-pointer transition-colors"
                      onClick={() => router.push(d.client_id ? `/clients/${d.client_id}` : `/pipeline`)}
                    >
                      <td className="py-2.5 px-4 font-bold text-[var(--text-primary)]">{d.title}</td>
                      <td className="py-2.5 px-3 text-[var(--text-secondary)]">{d.client || "—"}</td>
                      <td className="py-2.5 px-3">
                        <Pill color={statusColor(d.stage)}>{d.stage}</Pill>
                      </td>
                      <td className="py-2.5 px-3 text-right font-extrabold text-amber-600">
                        {money(d.amount, currency)}
                      </td>
                      <td className="py-2.5 px-3 text-[var(--text-secondary)]">{d.owner}</td>
                      <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <Link
                          href={d.client_id ? `/clients/${d.client_id}` : `/pipeline`}
                          className="p-1 rounded hover:bg-[var(--primary)]/10 text-[var(--primary)] inline-flex items-center"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {activeTab === "proposals" && (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--border)] bg-[var(--sidebar-hover)]/40 text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)]">
                <tr>
                  <th className="py-2.5 px-4">Proposal</th>
                  <th className="py-2.5 px-3">Client</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Value</th>
                  <th className="py-2.5 px-3 text-right">Sent</th>
                  <th className="py-2.5 px-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] font-medium">
                {proposals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[var(--text-secondary)]">No proposals sent for this source</td>
                  </tr>
                ) : (
                  proposals.map((p: any) => (
                    <tr
                      key={p.id}
                      className="hover:bg-[var(--sidebar-hover)]/60 cursor-pointer transition-colors"
                      onClick={() => router.push(`/proposals`)}
                    >
                      <td className="py-2.5 px-4 font-bold text-[var(--text-primary)]">{p.title}</td>
                      <td className="py-2.5 px-3 text-[var(--text-secondary)]">{p.client || "—"}</td>
                      <td className="py-2.5 px-3">
                        <Pill color={statusColor(p.status)}>{p.status}</Pill>
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-amber-600">
                        {money(p.value, currency)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-[var(--text-secondary)]">
                        {relTime(p.created_at)}
                      </td>
                      <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <Link
                          href="/proposals"
                          className="p-1 rounded hover:bg-[var(--primary)]/10 text-[var(--primary)] inline-flex items-center"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
