"use client";

import Link from "next/link";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { ArrowUpRight, TrendingDown, TrendingUp, Minus, IndianRupee, DollarSign } from "lucide-react";

/* ───────────────────────── currency ───────────────────────── */

export type Currency = "INR" | "USD";
export const EXCHANGE = 83.5; // 1 USD ≈ 83.5 INR (same convention as the Revenue / Lead Sources pages)
const CUR_KEY = "crm_currency";

export function useCurrency(): [Currency, (c: Currency) => void] {
  const [cur, setCur] = useState<Currency>("INR");
  useEffect(() => {
    try {
      const v = localStorage.getItem(CUR_KEY);
      if (v === "INR" || v === "USD") setCur(v);
    } catch { /* ignore */ }
  }, []);
  const set = useCallback((c: Currency) => {
    setCur(c);
    try { localStorage.setItem(CUR_KEY, c); } catch { /* ignore */ }
  }, []);
  return [cur, set];
}

export function money(amount: number | null | undefined, cur: Currency, compact = false): string {
  const a = Number(amount || 0);
  const v = cur === "USD" ? a / EXCHANGE : a;
  const sym = cur === "USD" ? "$" : "\u20B9";
  const abs = Math.abs(v);
  if (compact) {
    if (cur === "INR") {
      if (abs >= 1e7) return `${v < 0 ? "-" : ""}${sym}${(abs / 1e7).toFixed(2)}Cr`;
      if (abs >= 1e5) return `${v < 0 ? "-" : ""}${sym}${(abs / 1e5).toFixed(2)}L`;
      if (abs >= 1e3) return `${v < 0 ? "-" : ""}${sym}${(abs / 1e3).toFixed(1)}k`;
    } else {
      if (abs >= 1e6) return `${v < 0 ? "-" : ""}${sym}${(abs / 1e6).toFixed(2)}M`;
      if (abs >= 1e3) return `${v < 0 ? "-" : ""}${sym}${(abs / 1e3).toFixed(1)}k`;
    }
  }
  return `${v < 0 ? "-" : ""}${sym}${Math.round(abs).toLocaleString(cur === "INR" ? "en-IN" : "en-US")}`;
}

export const num = (n: number | null | undefined) => Number(n || 0).toLocaleString("en-IN");
export const pctf = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? "—" : `${Number(n).toFixed(d).replace(/\.0$/, "")}%`);

export const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6", "#3b82f6", "#f97316", "#84cc16", "#a855f7"];

export const TOOLTIP_STYLE = {
  backgroundColor: "var(--surface)",
  borderColor: "var(--border)",
  borderRadius: 10,
  color: "var(--text-primary)",
  fontSize: 12,
  fontWeight: 600,
  boxShadow: "0 8px 24px rgba(0,0,0,.18)",
} as const;

export const AXIS_TICK = { fontSize: 11, fill: "var(--text-secondary)" } as const;

/* ───────────────────────── tones ───────────────────────── */

export type Tone = "indigo" | "emerald" | "amber" | "rose" | "sky" | "violet" | "teal" | "slate" | "orange" | "pink";

const TONES: Record<Tone, { icon: string; bg: string; ring: string; bar: string }> = {
  indigo: { icon: "text-indigo-500", bg: "bg-indigo-500/10", ring: "hover:border-indigo-400/50", bar: "#6366f1" },
  emerald: { icon: "text-emerald-500", bg: "bg-emerald-500/10", ring: "hover:border-emerald-400/50", bar: "#10b981" },
  amber: { icon: "text-amber-500", bg: "bg-amber-500/10", ring: "hover:border-amber-400/50", bar: "#f59e0b" },
  rose: { icon: "text-rose-500", bg: "bg-rose-500/10", ring: "hover:border-rose-400/50", bar: "#ef4444" },
  sky: { icon: "text-sky-500", bg: "bg-sky-500/10", ring: "hover:border-sky-400/50", bar: "#0ea5e9" },
  violet: { icon: "text-violet-500", bg: "bg-violet-500/10", ring: "hover:border-violet-400/50", bar: "#8b5cf6" },
  teal: { icon: "text-teal-500", bg: "bg-teal-500/10", ring: "hover:border-teal-400/50", bar: "#14b8a6" },
  slate: { icon: "text-slate-500", bg: "bg-slate-500/10", ring: "hover:border-slate-400/50", bar: "#64748b" },
  orange: { icon: "text-orange-500", bg: "bg-orange-500/10", ring: "hover:border-orange-400/50", bar: "#f97316" },
  pink: { icon: "text-pink-500", bg: "bg-pink-500/10", ring: "hover:border-pink-400/50", bar: "#ec4899" },
};
export const toneColor = (t: Tone) => TONES[t].bar;

/* ───────────────────────── atoms ───────────────────────── */

/** Period-over-period change badge. `invert` = lower is better (e.g. cost). */
export function Delta({ value, invert = false, suffix = "%" }: { value: number | null | undefined; invert?: boolean; suffix?: string }) {
  if (value === null || value === undefined) return <span className="text-[10px] font-semibold text-[var(--text-secondary)]">—</span>;
  const up = value > 0;
  const flat = value === 0;
  const good = flat ? null : invert ? !up : up;
  const cls = flat ? "text-[var(--text-secondary)] bg-slate-500/10" : good ? "text-emerald-600 bg-emerald-500/10" : "text-rose-600 bg-rose-500/10";
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(value)}{suffix}
    </span>
  );
}

export function Tile({
  label, value, sub, icon: Icon, tone = "indigo", href, delta, invertDelta, compact,
}: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: any; tone?: Tone; href?: string;
  delta?: number | null; invertDelta?: boolean; compact?: boolean;
}) {
  const t = TONES[tone];
  const body = (
    <div className={`group relative h-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] ${compact ? "p-3" : "p-4"} shadow-sm transition-all ${href ? `cursor-pointer hover:-translate-y-0.5 hover:shadow-md ${t.ring}` : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] leading-tight">{label}</p>
        {Icon ? <div className={`shrink-0 rounded-lg p-1.5 ${t.bg}`}><Icon className={`h-3.5 w-3.5 ${t.icon}`} /></div> : null}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <p className={`${compact ? "text-lg" : "text-xl"} font-black leading-none text-[var(--text-primary)]`}>{value}</p>
        {delta !== undefined ? <Delta value={delta} invert={invertDelta} /> : null}
      </div>
      {sub ? <p className="mt-1.5 text-[11px] font-medium leading-snug text-[var(--text-secondary)]">{sub}</p> : null}
      {href ? <ArrowUpRight className="absolute bottom-2 right-2 h-3 w-3 text-[var(--text-secondary)] opacity-0 transition-opacity group-hover:opacity-70" /> : null}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

export function Card({
  title, icon: Icon, tone = "indigo", href, linkLabel = "View all", right, children, className = "", bodyClassName = "p-4",
}: {
  title: ReactNode; icon?: any; tone?: Tone; href?: string; linkLabel?: string; right?: ReactNode;
  children: ReactNode; className?: string; bodyClassName?: string;
}) {
  const t = TONES[tone];
  return (
    <section className={`flex min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm ${className}`}>
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--sidebar-hover)]/30 px-4 py-3">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
          {Icon ? <Icon className={`h-4 w-4 shrink-0 ${t.icon}`} /> : null}
          <span className="truncate">{title}</span>
        </h3>
        <div className="flex shrink-0 items-center gap-3">
          {right}
          {href ? (
            <Link href={href} className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--primary)] hover:underline">
              {linkLabel} <ArrowUpRight className="h-3 w-3" />
            </Link>
          ) : null}
        </div>
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function SectionTitle({ icon: Icon, title, subtitle, tone = "indigo", right }: { icon?: any; title: string; subtitle?: string; tone?: Tone; right?: ReactNode }) {
  const t = TONES[tone];
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 text-base font-extrabold tracking-tight text-[var(--text-primary)]">
          {Icon ? <span className={`rounded-lg p-1.5 ${t.bg}`}><Icon className={`h-4 w-4 ${t.icon}`} /></span> : null}
          {title}
        </h2>
        {subtitle ? <p className="mt-0.5 text-xs font-medium text-[var(--text-secondary)]">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Meter({ value, max = 100, color = "#6366f1", height = 6 }: { value: number; max?: number; color?: string; height?: number }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="w-full overflow-hidden rounded-full bg-slate-500/10" style={{ height }}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${w}%`, backgroundColor: color }} />
    </div>
  );
}

export function Empty({ text = "No data yet", icon: Icon }: { text?: string; icon?: any }) {
  return (
    <div className="flex h-full min-h-[110px] flex-col items-center justify-center gap-2 py-6 text-center text-[var(--text-secondary)]">
      {Icon ? <Icon className="h-6 w-6 opacity-40" /> : null}
      <p className="text-xs font-semibold">{text}</p>
    </div>
  );
}

export function Pill({ children, color = "#6366f1" }: { children: ReactNode; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: `${color}1f`, color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-slate-500/10 ${className}`} />;
}

export function CurrencyToggle({ value, onChange }: { value: Currency; onChange: (c: Currency) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
      {(["INR", "USD"] as Currency[]).map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors ${value === c ? "bg-[var(--primary)] text-white shadow" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
        >
          {c === "INR" ? <IndianRupee className="h-3 w-3" /> : <DollarSign className="h-3 w-3" />}
          {c}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors ${value === o.value ? "bg-[var(--primary)] text-white shadow" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function relTime(iso?: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z").getTime();
  if (isNaN(t)) return "—";
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  const label = m < 1 ? "just now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  if (label === "just now") return label;
  return diff >= 0 ? `${label} ago` : `in ${label}`;
}

export const STATUS_COLORS: Record<string, string> = {
  New: "#3b82f6", Contacted: "#0ea5e9", "Not Responded": "#94a3b8", Neutral: "#f59e0b", Positive: "#14b8a6", Negative: "#ef4444", Converted: "#10b981",
  Draft: "#94a3b8", Sent: "#3b82f6", Accepted: "#10b981", Rejected: "#ef4444", "Demo Requested": "#8b5cf6", Expired: "#64748b",
  Paid: "#10b981", Overdue: "#ef4444", Partial: "#f59e0b", Pending: "#f59e0b", Failed: "#ef4444", Active: "#10b981", Hold: "#f59e0b",
  Lead: "#94a3b8", Discovery: "#3b82f6", Demo: "#8b5cf6", Negotiation: "#f59e0b", "Closed Won": "#10b981", "Closed Lost": "#ef4444",
  Todo: "#94a3b8", InProgress: "#3b82f6", Done: "#10b981", Planning: "#f59e0b", Completed: "#10b981",
  Received: "#10b981", Cancelled: "#ef4444", Fulfilled: "#10b981", Urgent: "#ef4444", High: "#f97316", Medium: "#f59e0b", Low: "#94a3b8",
};
export const statusColor = (s: string, i = 0) => STATUS_COLORS[s] || PALETTE[i % PALETTE.length];
