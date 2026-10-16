'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { inboxApi, type InboxFilters, type ViewSummary, errorText } from '@/lib/inboxApi';

interface Props {
  filters: InboxFilters;
  viewLabel: string;
  total: number;
  aiEnabled: boolean;
  onOpen: (key: string) => void;
}

const filterKey = (f: InboxFilters) => JSON.stringify([f.folder, f.linked || '', f.category || '', f.priority || '', f.q || '']);

// Summaries already generated this session, per filter, so flipping between filters doesn't re-ask the AI.
const sessionCache = new Map<string, ViewSummary>();

/** "AI summary of this view" — one briefing per filter (folder / linked / category / search). */
export default function ViewSummaryCard({ filters, viewLabel, total, aiEnabled, onOpen }: Props) {
  const key = filterKey(filters);
  const [data, setData] = useState<ViewSummary | null>(() => sessionCache.get(key) || null);
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(sessionCache.get(key) || null);
    setError('');
  }, [key]);

  const run = async (refresh = false) => {
    setLoading(true);
    setError('');
    try {
      const result = await inboxApi.summarizeView(filters, refresh);
      sessionCache.set(key, result);
      setData(result);
      setOpen(true);
    } catch (e) {
      setError(errorText(e, 'Could not summarize this view.'));
    } finally {
      setLoading(false);
    }
  };

  const s = data?.summary;
  const who = (k: string) => data?.emails?.[k];

  return (
    <section className="mb-3 overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/60 dark:border-indigo-500/20 dark:from-indigo-500/10 dark:via-zinc-900 dark:to-violet-500/10">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-sm">
          <Sparkles size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500 dark:text-indigo-300">AI summary · {viewLabel}</p>
          <p className="truncate text-sm font-bold text-slate-800 dark:text-zinc-100">
            {s ? s.headline : data?.message || `Get a briefing on the ${total} email${total === 1 ? '' : 's'} in this view.`}
          </p>
        </div>
        {s ? (
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => run(true)} disabled={loading} title="Regenerate"
              className="rounded-lg p-1.5 text-slate-500 hover:bg-white/80 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800">
              {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            </button>
            <button type="button" onClick={() => setOpen((o) => !o)} title={open ? 'Collapse' : 'Expand'}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-white/80 dark:text-zinc-400 dark:hover:bg-zinc-800">
              <ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => run(false)}
            disabled={loading || !aiEnabled || total === 0}
            title={!aiEnabled ? 'AI is not configured on the server' : undefined}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {loading ? 'Summarizing…' : 'Summarize'}
          </button>
        )}
      </div>

      {error && <p className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      {s && open && (
        <div className="space-y-3 border-t border-indigo-100 px-4 py-3 text-[13px] dark:border-indigo-500/20">
          {s.overview && <p className="leading-relaxed text-slate-700 dark:text-zinc-300">{s.overview}</p>}
          {s.key_points.length > 0 && (
            <ul className="space-y-1">
              {s.key_points.map((p, i) => (
                <li key={i} className="flex gap-2 text-slate-600 dark:text-zinc-400">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" /> {p}
                </li>
              ))}
            </ul>
          )}
          {s.action_items.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">To do</p>
              <ul className="space-y-1">
                {s.action_items.map((a) => (
                  <li key={a.key + a.text}>
                    <button type="button" onClick={() => onOpen(a.key)}
                      className="flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left hover:bg-white dark:hover:bg-zinc-800">
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-500" />
                      <span className="flex-1 text-slate-700 dark:text-zinc-300">
                        {a.text}
                        {who(a.key) && <span className="ml-1 text-[11px] text-slate-400">— {who(a.key)?.who}, “{who(a.key)?.subject}”</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {s.highlights.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {s.highlights.map((h) => (
                <button key={h.key} type="button" onClick={() => onOpen(h.key)} title={h.why}
                  className="max-w-full truncate rounded-full border border-indigo-200 bg-white px-3 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-500/30 dark:bg-zinc-900 dark:text-indigo-300">
                  {who(h.key)?.subject || h.key} · {h.why}
                </button>
              ))}
            </div>
          )}
          <p className="text-[10px] text-slate-400">
            Based on the {Math.min(40, data?.total || 0)} most recent of {data?.total} emails{data?.cached ? ' · cached' : ''}. AI can make mistakes — open the email before acting.
          </p>
        </div>
      )}
    </section>
  );
}
