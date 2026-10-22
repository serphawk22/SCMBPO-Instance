"use client";

import React from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  BarChart3, CalendarCheck, ClipboardList, PhoneCall, Wallet, CheckCircle2, AlertTriangle, TrendingUp, Layers,
} from "lucide-react";

export interface SalesAnalytics {
  pipeline: { stage: string; count: number; value: number }[];
  open_deals: number;
  open_pipeline_value: number;
  leads_by_status: { status: string; count: number }[];
  monthly: { month: string; leads_added: number; deals_won: number; revenue_won: number }[];
  meetings: { total: number; upcoming: number; completed: number; cancelled: number; no_show: number; this_month: number };
  calls: { total: number; last_30_days: number };
  task_sheet: {
    submitted_today: boolean;
    days_submitted_7d: number;
    totals_7d: { outreaches: number; positives: number; negatives: number; followups: number; meetings: number };
    positive_rate_7d: number;
    daily: { date: string; outreaches: number; positives: number; negatives: number; followups: number; meetings: number }[];
  };
}

const money = (n: number) => `$${Math.round(n || 0).toLocaleString("en-US")}`;
const shortDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });

const STAGE_COLORS: Record<string, string> = {
  Lead: "bg-slate-400",
  Discovery: "bg-sky-500",
  Demo: "bg-indigo-500",
  Negotiation: "bg-amber-500",
  "Closed Won": "bg-emerald-500",
  "Closed Lost": "bg-rose-400",
};

const CARD = "rounded-2xl border border-slate-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm";

function Panel({ title, icon: Icon, children, right }: { title: string; icon: any; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-zinc-400">
          <Icon className="w-4 h-4 text-indigo-500" /> {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function Kpi({ label, value, sub, icon: Icon, tint }: { label: string; value: React.ReactNode; sub: string; icon: any; tint: string }) {
  return (
    <div className={`${CARD} flex items-start gap-4`}>
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${tint}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
        <p className="text-2xl font-black text-slate-800 dark:text-white leading-tight">{value}</p>
        <p className="text-xs font-medium text-slate-400 mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

function HBar({ label, value, max, color, right }: { label: string; value: number; max: number; color: string; right?: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs font-semibold text-slate-600 dark:text-zinc-300 mb-1">
        <span>{label}</span>
        <span className="tabular-nums">{right ?? value}</span>
      </div>
      <div className="h-2.5 rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${max ? Math.max((value / max) * 100, value ? 3 : 0) : 0}%` }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className={`h-full rounded-full ${color}`}
        />
      </div>
    </div>
  );
}

function Columns({ values, labels, color, format }: { values: number[]; labels: string[]; color: string; format?: (n: number) => string }) {
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-2 h-28">
      {values.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-1" title={`${labels[i]}: ${format ? format(v) : v}`}>
          <span className="text-[10px] font-bold text-slate-500 dark:text-zinc-400 tabular-nums">{v ? (format ? format(v) : v) : ""}</span>
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: `${(v / max) * 70}%` }}
            transition={{ duration: 0.7, delay: i * 0.05, ease: "easeOut" }}
            className={`w-full rounded-t-md min-h-[3px] ${color} ${v ? "" : "opacity-30"}`}
          />
          <span className="text-[10px] font-semibold text-slate-400">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

export function SalesManagerAnalytics({ analytics }: { analytics?: SalesAnalytics | null }) {
  if (!analytics) return null;
  const { pipeline, meetings, calls, task_sheet: ts, monthly, leads_by_status } = analytics;

  const maxStage = Math.max(...pipeline.map(p => p.count), 1);
  const maxLead = Math.max(...leads_by_status.map(l => l.count), 1);
  const dayLabels = ts.daily.map(d => shortDay(d.date));
  const hasDeals = pipeline.some(p => p.count > 0);

  return (
    <section className="space-y-4" aria-label="My progress and analytics">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-black text-slate-800 dark:text-white">
          <TrendingUp className="w-5 h-5 text-indigo-500" /> My Progress &amp; Analytics
        </h2>
        <span className="text-xs font-semibold text-slate-400">Only your own work</span>
      </div>

      {!ts.submitted_today && (
        <Link
          href="/task-sheet"
          className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/50 px-5 py-3 text-sm font-bold text-amber-800 dark:text-amber-300 hover:bg-amber-100/70 transition-colors"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          You haven&apos;t submitted today&apos;s task sheet yet — fill it in now
        </Link>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="Open pipeline" value={money(analytics.open_pipeline_value)} sub={`${analytics.open_deals} open deal${analytics.open_deals === 1 ? "" : "s"}`}
             icon={Wallet} tint="bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400" />
        <Kpi label="Meetings" value={meetings.upcoming} sub={`${meetings.completed} completed · ${meetings.this_month} this month`}
             icon={CalendarCheck} tint="bg-violet-50 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400" />
        <Kpi label="Calls (30 days)" value={calls.last_30_days} sub={`${calls.total} all-time`}
             icon={PhoneCall} tint="bg-sky-50 text-sky-600 dark:bg-sky-900/20 dark:text-sky-400" />
        <Kpi label="Task sheet (7 days)" value={`${ts.days_submitted_7d}/7`} sub={ts.submitted_today ? "Today's sheet submitted" : "Today's sheet pending"}
             icon={ts.submitted_today ? CheckCircle2 : ClipboardList}
             tint={ts.submitted_today ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400" : "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="My deal pipeline" icon={Layers}>
          {hasDeals ? (
            <div className="space-y-3">
              {pipeline.map(p => (
                <HBar key={p.stage} label={p.stage} value={p.count} max={maxStage}
                      color={STAGE_COLORS[p.stage] || "bg-slate-400"} right={`${p.count} · ${money(p.value)}`} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 py-6 text-center">No deals assigned to you yet.</p>
          )}
        </Panel>

        <Panel title="My lead funnel" icon={BarChart3}>
          {leads_by_status.length ? (
            <div className="space-y-3">
              {leads_by_status.map(l => (
                <HBar key={l.status} label={l.status} value={l.count} max={maxLead} color="bg-indigo-500" />
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 py-6 text-center">No leads assigned to you yet.</p>
          )}
        </Panel>

        <Panel title="Last 7 days — outreach" icon={ClipboardList}
               right={<span className="text-xs font-bold text-emerald-600">{ts.positive_rate_7d}% positive</span>}>
          <div className="grid grid-cols-5 gap-2 mb-4 text-center">
            {[
              ["Outreaches", ts.totals_7d.outreaches, "text-blue-600"],
              ["Positives", ts.totals_7d.positives, "text-emerald-600"],
              ["Negatives", ts.totals_7d.negatives, "text-rose-500"],
              ["Follow-ups", ts.totals_7d.followups, "text-indigo-600"],
              ["Meetings", ts.totals_7d.meetings, "text-violet-600"],
            ].map(([label, val, cls]) => (
              <div key={label as string} className="rounded-xl bg-slate-50 dark:bg-zinc-800/60 py-2">
                <p className={`text-lg font-black ${cls}`}>{val as number}</p>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label as string}</p>
              </div>
            ))}
          </div>
          <Columns values={ts.daily.map(d => d.outreaches)} labels={dayLabels} color="bg-blue-500" />
        </Panel>

        <Panel title="Last 6 months" icon={TrendingUp}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Leads added</p>
              <Columns values={monthly.map(m => m.leads_added)} labels={monthly.map(m => m.month.slice(0, 3))} color="bg-indigo-500" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Revenue won</p>
              <Columns values={monthly.map(m => m.revenue_won)} labels={monthly.map(m => m.month.slice(0, 3))} color="bg-emerald-500"
                       format={n => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)))} />
            </div>
          </div>
        </Panel>
      </div>
    </section>
  );
}
