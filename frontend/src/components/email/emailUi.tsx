'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Building2, CornerUpLeft, Eye, Paperclip, Target } from 'lucide-react';
import type { InboxItem, RecordRef } from '@/lib/inboxApi';

// ─── AI triage categories (keys match modules/email_ai.CATEGORIES) ───────────
export const CATEGORY_META: Record<string, { label: string; className: string }> = {
  inquiry: { label: 'New inquiry', className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30' },
  follow_up: { label: 'Follow-up', className: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/30' },
  pricing: { label: 'Pricing & quotes', className: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30' },
  meeting: { label: 'Meetings', className: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/30' },
  support: { label: 'Support & issues', className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30' },
  billing: { label: 'Billing', className: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/30' },
  partnership: { label: 'Partnerships', className: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30' },
  promotional: { label: 'Promotions', className: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700' },
  spam: { label: 'Spam', className: 'bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700' },
  other: { label: 'Other', className: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700' },
};

const chip = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold leading-none whitespace-nowrap';

export function CategoryChip({ category }: { category?: string | null }) {
  if (!category) return null;
  const meta = CATEGORY_META[category] || CATEGORY_META.other;
  return <span className={`${chip} ${meta.className}`}>{meta.label}</span>;
}

export function PriorityChip({ priority }: { priority?: string | null }) {
  if (priority !== 'high') return null;
  return (
    <span className={`${chip} border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300`}>
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> High priority
    </span>
  );
}

export function NeedsReplyChip({ item }: { item: InboxItem }) {
  if (item.direction !== 'inbound' || item.replied_at || !item.ai?.needs_reply) return null;
  return (
    <span className={`${chip} border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300`}>
      <CornerUpLeft size={10} /> Needs reply
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  Sent: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  Delivered: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300',
  Opened: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300',
  Replied: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
};

export function StatusPill({ item }: { item: InboxItem }) {
  if (item.direction === 'inbound') {
    return item.replied_at ? <span className={`${chip} ${STATUS_STYLES.Replied}`}>Answered</span> : null;
  }
  const status = item.status || 'Sent';
  return (
    <span className={`${chip} ${STATUS_STYLES[status] || STATUS_STYLES.Sent}`}>
      {status === 'Opened' && <Eye size={10} />}
      {status}
      {status === 'Opened' && (item.open_count || 0) > 1 ? ` ×${item.open_count}` : ''}
    </span>
  );
}

export function recordHref(type: 'lead' | 'client', id: number, tab?: string) {
  const base = type === 'lead' ? `/leads/${id}` : `/admin/clients/${id}`;
  return tab ? `${base}?tab=${tab}` : base;
}

export function RecordChips({ lead, client, tab }: { lead: RecordRef | null; client: RecordRef | null; tab?: string }) {
  return (
    <>
      {client && (
        <Link
          href={recordHref('client', client.id, tab)}
          onClick={(e) => e.stopPropagation()}
          className={`${chip} border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300`}
          title="Open client"
        >
          <Building2 size={10} /> {client.name}
        </Link>
      )}
      {lead && !client && (
        <Link
          href={recordHref('lead', lead.id, tab)}
          onClick={(e) => e.stopPropagation()}
          className={`${chip} border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100 dark:border-fuchsia-500/30 dark:bg-fuchsia-500/10 dark:text-fuchsia-300`}
          title="Open lead"
        >
          <Target size={10} /> {lead.name}
        </Link>
      )}
    </>
  );
}

export function AttachmentFlag({ item }: { item: InboxItem }) {
  return item.has_attachments ? <Paperclip size={12} className="shrink-0 text-slate-400" aria-label="Has attachments" /> : null;
}

export function Avatar({ name, address, outbound, size = 36 }: { name?: string | null; address?: string | null; outbound?: boolean; size?: number }) {
  const label = (name || address || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim();
  const initials = label.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
  const palette = ['from-indigo-500 to-violet-500', 'from-sky-500 to-cyan-500', 'from-emerald-500 to-teal-500',
    'from-amber-500 to-orange-500', 'from-rose-500 to-pink-500', 'from-fuchsia-500 to-purple-500'];
  const hue = palette[(address || name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length];
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white font-black ${outbound ? 'from-slate-500 to-slate-700' : hue}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {outbound ? '→' : initials}
    </div>
  );
}

export function formatWhen(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const days = (now.getTime() - d.getTime()) / 86400000;
  if (days < 6) return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], d.getFullYear() === now.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatFull(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

export function senderLabel(item: InboxItem): string {
  return item.direction === 'outbound' ? `To: ${item.to || 'unknown'}` : item.from_name || item.from_address || 'Unknown sender';
}

/**
 * Message body with Clean / Full thread / Formatted views. HTML is untrusted mail content, so it only
 * ever renders inside a sandboxed iframe (sandbox="" blocks scripts, forms and navigation) — same
 * approach as the Email Agent's reply viewer.
 */
export function EmailBody({ text, fullText, html, height = 320 }: { text?: string | null; fullText?: string | null; html?: string | null; height?: number }) {
  const hasText = !!(text && text.trim());
  const [view, setView] = useState<'clean' | 'full' | 'html'>(hasText || !html ? 'clean' : 'html');
  const hasFull = !!fullText && fullText.trim() !== (text || '').trim();
  const shown = view === 'full' ? fullText : text;
  const tab = (key: typeof view, label: string) => (
    <button
      type="button"
      onClick={() => setView(key)}
      className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${view === key
        ? 'bg-indigo-600 text-white'
        : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'}`}
    >
      {label}
    </button>
  );
  return (
    <div>
      {(hasFull || html) && (
        <div className="mb-2 flex flex-wrap gap-1">
          {(hasText || !html) && tab('clean', 'Clean')}
          {hasFull && tab('full', 'Full thread')}
          {html && tab('html', 'Formatted')}
        </div>
      )}
      {view === 'html' && html ? (
        <iframe
          sandbox=""
          srcDoc={html}
          title="Email content"
          className="w-full rounded-xl border border-slate-200 bg-white dark:border-zinc-700"
          style={{ height }}
        />
      ) : (
        <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-slate-700 dark:text-zinc-300">
          {shown?.trim() || <span className="italic text-slate-400">No text content.</span>}
        </div>
      )}
    </div>
  );
}
