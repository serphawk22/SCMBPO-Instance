'use client';

import React from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Bot, Building2, CalendarClock, CheckCircle2, Clock, Mail, MessageCircle, MoreHorizontal, Phone,
  Send, Target, Users, XCircle, type LucideIcon,
} from 'lucide-react';
import type { Channel, FollowUp, FollowUpState } from '@/lib/followupsApi';

const chip = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold leading-none whitespace-nowrap';

export const STATE_META: Record<FollowUpState, { label: string; className: string; icon: LucideIcon }> = {
  overdue: { label: 'Overdue', icon: AlertTriangle, className: 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300' },
  today: { label: 'Due today', icon: Clock, className: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300' },
  upcoming: { label: 'Upcoming', icon: CalendarClock, className: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300' },
  completed: { label: 'Completed', icon: CheckCircle2, className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300' },
  cancelled: { label: 'Cancelled', icon: XCircle, className: 'border-slate-200 bg-slate-50 text-slate-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400' },
};

export const CHANNEL_META: Record<Channel, { label: string; icon: LucideIcon }> = {
  email: { label: 'Email', icon: Mail },
  call: { label: 'Call', icon: Phone },
  meeting: { label: 'Meeting', icon: Users },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle },
  other: { label: 'Other', icon: MoreHorizontal },
};

export function StateChip({ state }: { state: FollowUpState }) {
  const m = STATE_META[state];
  const Icon = m.icon;
  return <span className={`${chip} ${m.className}`}><Icon size={10} /> {m.label}</span>;
}

export function SourceChip({ f }: { f: FollowUp }) {
  if (f.source === 'ai_auto' || f.source === 'ai_suggested') {
    return (
      <span className={`${chip} border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300`}
        title={f.source === 'ai_auto' ? 'Created automatically by AI from a note or conversation' : 'Suggested by AI from previous notes'}>
        <Bot size={10} /> AI
      </span>
    );
  }
  if (f.source === 'campaign') {
    return <span className={`${chip} border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300`}><Send size={10} /> Campaign</span>;
  }
  return null;
}

/** "in 3 days", "2 days ago", "today 14:30" — relative to now in the viewer's timezone. */
export function relativeDue(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(now)) / 86400000);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  if (days < 0) return `${-days} days ago`;
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' }) + ` ${time}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function fullDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

/** ISO -> value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value -> ISO (UTC). */
export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

/** A date string YYYY-MM-DD at a local hour, as a datetime-local value. */
export function dateAtHour(day: string, hour = 10): string {
  return `${day}T${String(hour).padStart(2, '0')}:00`;
}

export function addDaysLocal(days: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return toLocalInput(d.toISOString());
}

export function recordLink(f: Pick<FollowUp, 'lead' | 'client'>, tab = 'followups'): string | null {
  if (f.client) return `/admin/clients/${f.client.id}?tab=${tab}`;
  if (f.lead) return `/leads/${f.lead.id}?tab=${tab}`;
  return null;
}

export function RecordChip({ f }: { f: FollowUp }) {
  const href = recordLink(f);
  const ref = f.client || f.lead;
  if (!href || !ref) return null;
  const Icon = f.client ? Building2 : Target;
  const cls = f.client
    ? 'border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300'
    : 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100 dark:border-fuchsia-500/30 dark:bg-fuchsia-500/10 dark:text-fuchsia-300';
  return (
    <Link href={href} onClick={(e) => e.stopPropagation()} className={`${chip} ${cls}`} title={f.client ? 'Open client' : 'Open lead'}>
      <Icon size={10} /> {ref.name}
    </Link>
  );
}

export const btn = {
  primary: 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50',
  secondary: 'inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800',
  ghost: 'inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
  success: 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50',
};

export const input = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100';
export const label = 'mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-zinc-500';

export function Modal({ title, subtitle, onClose, children, footer, wide }: {
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[90vh] w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900`}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="text-base font-black text-slate-900 dark:text-white">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-zinc-800" aria-label="Close">
            <XCircle size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-950/40">{footer}</div>}
      </div>
    </div>
  );
}

export function ErrorNote({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" /> <span>{text}</span>
    </div>
  );
}
