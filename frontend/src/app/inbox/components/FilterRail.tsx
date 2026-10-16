'use client';

import React from 'react';
import {
  Archive, ArrowDownLeft, Building2, CornerUpLeft, Flame, HelpCircle, Inbox, Mail, Send, Sparkles, Star, Target,
  type LucideIcon,
} from 'lucide-react';
import type { InboxCounts, InboxFilters } from '@/lib/inboxApi';
import { CATEGORY_META } from '@/components/email/emailUi';

export const FOLDERS = [
  { key: 'all', label: 'All mail', icon: Inbox },
  { key: 'received', label: 'Received', icon: ArrowDownLeft },
  { key: 'needs_reply', label: 'Needs reply', icon: CornerUpLeft },
  { key: 'unread', label: 'Unread', icon: Mail },
  { key: 'starred', label: 'Starred', icon: Star },
  { key: 'sent', label: 'Sent', icon: Send },
  { key: 'archived', label: 'Archived', icon: Archive },
];

export const LINKED = [
  { key: 'lead', label: 'Leads', icon: Target },
  { key: 'client', label: 'Clients', icon: Building2 },
  { key: 'unlinked', label: 'Unknown senders', icon: HelpCircle },
];

interface Props {
  filters: InboxFilters;
  counts: InboxCounts | null;
  onChange: (next: InboxFilters) => void;
  compact?: boolean;
}

function RailButton({ active, onClick, icon: Icon, label, count, accent }: {
  active: boolean; onClick: () => void; icon?: LucideIcon; label: string; count?: number; accent?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold transition-colors ${active
        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
        : 'text-slate-600 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-800'}`}
    >
      {Icon ? <Icon size={15} className={active ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-400'} /> : (
        <span className={`h-2 w-2 shrink-0 rounded-full ${accent || 'bg-slate-300'}`} />
      )}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className={`min-w-5 rounded-full px-1.5 text-center text-[10px] font-black leading-4.5 ${active
          ? 'bg-indigo-600 text-white'
          : 'bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400'}`}>
          {count > 999 ? '999+' : count}
        </span>
      )}
    </button>
  );
}

const CATEGORY_DOTS: Record<string, string> = {
  inquiry: 'bg-emerald-500', follow_up: 'bg-sky-500', pricing: 'bg-amber-500', meeting: 'bg-violet-500',
  support: 'bg-rose-500', billing: 'bg-orange-500', partnership: 'bg-indigo-500', promotional: 'bg-slate-400',
  spam: 'bg-zinc-400', other: 'bg-slate-300',
};

export default function FilterRail({ filters, counts, onChange, compact }: Props) {
  const set = (patch: Partial<InboxFilters>) => onChange({ ...filters, ...patch });
  const toggle = (field: 'linked' | 'category' | 'priority', value: string) =>
    set({ [field]: filters[field] === value ? null : value } as Partial<InboxFilters>);

  const categories = Object.keys(CATEGORY_META)
    .map((key) => ({ key, count: counts?.categories?.[key] || 0 }))
    .filter((c) => c.count > 0 || filters.category === c.key);

  if (compact) {
    // Narrow screens: one horizontal row of pills instead of the side rail.
    const pill = (active: boolean) => `shrink-0 rounded-full border px-3 py-1 text-xs font-bold ${active
      ? 'border-indigo-600 bg-indigo-600 text-white'
      : 'border-slate-200 bg-white text-slate-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'}`;
    return (
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FOLDERS.map((f) => (
          <button key={f.key} type="button" className={pill(filters.folder === f.key)} onClick={() => set({ folder: f.key })}>
            {f.label}{counts?.folders?.[f.key] ? ` · ${counts.folders[f.key]}` : ''}
          </button>
        ))}
        {LINKED.map((l) => (
          <button key={l.key} type="button" className={pill(filters.linked === l.key)} onClick={() => toggle('linked', l.key)}>{l.label}</button>
        ))}
        {categories.map((c) => (
          <button key={c.key} type="button" className={pill(filters.category === c.key)} onClick={() => toggle('category', c.key)}>
            {CATEGORY_META[c.key].label} · {c.count}
          </button>
        ))}
      </div>
    );
  }

  return (
    <nav className="flex flex-col gap-4 text-sm" aria-label="Inbox filters">
      <div className="flex flex-col gap-0.5">
        {FOLDERS.map((f) => (
          <RailButton key={f.key} active={filters.folder === f.key} onClick={() => set({ folder: f.key })}
            icon={f.icon} label={f.label} count={counts?.folders?.[f.key]} />
        ))}
      </div>

      <div>
        <p className="mb-1 px-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Linked to</p>
        <div className="flex flex-col gap-0.5">
          {LINKED.map((l) => (
            <RailButton key={l.key} active={filters.linked === l.key} onClick={() => toggle('linked', l.key)}
              icon={l.icon} label={l.label} count={counts?.linked?.[l.key]} />
          ))}
          <RailButton active={filters.priority === 'high'} onClick={() => toggle('priority', 'high')}
            icon={Flame} label="High priority" count={counts?.high_priority} />
        </div>
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1 px-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
          <Sparkles size={10} /> AI categories
        </p>
        {categories.length === 0 ? (
          <p className="px-2.5 text-[11px] leading-snug text-slate-400">
            {counts && counts.unclassified > 0
              ? `AI is sorting ${counts.unclassified} new email${counts.unclassified === 1 ? '' : 's'}…`
              : 'Categories appear here as emails arrive.'}
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {categories.map((c) => (
              <RailButton key={c.key} active={filters.category === c.key} onClick={() => toggle('category', c.key)}
                label={CATEGORY_META[c.key].label} count={c.count} accent={CATEGORY_DOTS[c.key]} />
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
