'use client';

import React from 'react';
import { Archive, ArchiveRestore, Inbox, Loader2, Sparkles, Star, X } from 'lucide-react';
import type { InboxItem } from '@/lib/inboxApi';
import {
  AttachmentFlag, Avatar, CategoryChip, NeedsReplyChip, PriorityChip, RecordChips, StatusPill, formatWhen, senderLabel,
} from '@/components/email/emailUi';

interface Props {
  items: InboxItem[];
  selectedKey: string | null;
  loading: boolean;
  hasMore: boolean;
  onSelect: (item: InboxItem) => void;
  onLoadMore: () => void;
  onToggleStar: (item: InboxItem) => void;
  onToggleArchive: (item: InboxItem) => void;
  aiResults?: { question: string; count: number } | null;
  onClearAi?: () => void;
  emptyHint?: string;
}

export default function MessageList({
  items, selectedKey, loading, hasMore, onSelect, onLoadMore, onToggleStar, onToggleArchive, aiResults, onClearAi, emptyHint,
}: Props) {
  return (
    <div>
      {aiResults && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200">
          <Sparkles size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            <b>Sorted by AI</b> for “{aiResults.question}” · {aiResults.count} email{aiResults.count === 1 ? '' : 's'}
          </span>
          <button type="button" onClick={onClearAi} className="flex items-center gap-1 rounded-lg px-2 py-1 font-bold hover:bg-violet-100 dark:hover:bg-violet-500/20">
            <X size={12} /> Clear
          </button>
        </div>
      )}

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-zinc-800 dark:border-zinc-700 dark:bg-zinc-900">
        {items.map((item) => {
          const unread = item.direction === 'inbound' && !item.is_read;
          const active = item.key === selectedKey;
          return (
            <li key={item.key}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onSelect(item)}
                onKeyDown={(e) => { if (e.key === 'Enter') onSelect(item); }}
                className={`group relative flex cursor-pointer gap-3 px-4 py-3 transition-colors ${active
                  ? 'bg-indigo-50/80 dark:bg-indigo-500/10'
                  : 'hover:bg-slate-50 dark:hover:bg-zinc-800/60'}`}
              >
                {active && <span className="absolute inset-y-0 left-0 w-1 bg-indigo-600" />}
                <Avatar name={item.from_name} address={item.from_address || item.to} outbound={item.direction === 'outbound'} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={`truncate text-[13px] ${unread ? 'font-black text-slate-900 dark:text-white' : 'font-semibold text-slate-700 dark:text-zinc-200'}`}>
                      {senderLabel(item)}
                    </span>
                    {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-600" aria-label="Unread" />}
                    <span className="ml-auto shrink-0 text-[11px] font-semibold text-slate-400">{formatWhen(item.date)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <p className={`truncate text-[13px] ${unread ? 'font-bold text-slate-800 dark:text-zinc-100' : 'text-slate-700 dark:text-zinc-300'}`}>
                      {item.subject}
                      {item.snippet && <span className="font-normal text-slate-400"> — {item.snippet}</span>}
                    </p>
                    <AttachmentFlag item={item} />
                  </div>
                  {item.ai?.summary && (
                    <p className="mt-1 flex items-start gap-1 text-[11.5px] leading-snug text-violet-700 dark:text-violet-300">
                      <Sparkles size={11} className="mt-0.5 shrink-0" />
                      <span className="line-clamp-2">{item.ai.summary}</span>
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <NeedsReplyChip item={item} />
                    <PriorityChip priority={item.ai?.priority} />
                    <CategoryChip category={item.ai?.category} />
                    <StatusPill item={item} />
                    <RecordChips lead={item.lead} client={item.client} />
                  </div>
                </div>
                {item.direction === 'inbound' && (
                  <div className={`flex shrink-0 flex-col items-center gap-1 ${item.is_starred ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                    <button type="button" title={item.is_starred ? 'Unstar' : 'Star'}
                      onClick={(e) => { e.stopPropagation(); onToggleStar(item); }}
                      className="rounded-md p-1 hover:bg-slate-200/70 dark:hover:bg-zinc-700">
                      <Star size={14} className={item.is_starred ? 'fill-amber-400 text-amber-400' : 'text-slate-400'} />
                    </button>
                    <button type="button" title={item.is_archived ? 'Move back to inbox' : 'Archive'}
                      onClick={(e) => { e.stopPropagation(); onToggleArchive(item); }}
                      className="rounded-md p-1 text-slate-400 opacity-0 hover:bg-slate-200/70 group-hover:opacity-100 dark:hover:bg-zinc-700">
                      {item.is_archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}

        {!loading && items.length === 0 && (
          <li className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <Inbox size={34} className="text-slate-300 dark:text-zinc-600" />
            <p className="text-sm font-bold text-slate-600 dark:text-zinc-300">No emails here</p>
            <p className="max-w-sm text-xs text-slate-400">{emptyHint || 'Try another filter, or sync to check for new mail.'}</p>
          </li>
        )}
        {loading && (
          <li className="flex items-center justify-center gap-2 px-6 py-8 text-xs font-semibold text-slate-400">
            <Loader2 size={16} className="animate-spin" /> Loading emails…
          </li>
        )}
      </ul>

      {hasMore && !loading && (
        <button type="button" onClick={onLoadMore}
          className="mt-3 w-full rounded-xl border border-slate-200 bg-white py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
          Load more
        </button>
      )}
    </div>
  );
}
