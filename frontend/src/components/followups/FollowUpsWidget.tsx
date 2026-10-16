'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { followupsApi, type FollowUp, type FollowUpCounts } from '@/lib/followupsApi';
import { RecordChip, StateChip, relativeDue } from './followupUi';

/** Dashboard card: pending / overdue / due today / completed follow-ups and the most urgent ones. */
export default function FollowUpsWidget({ mine = false }: { mine?: boolean }) {
  const [counts, setCounts] = useState<FollowUpCounts | null>(null);
  const [next, setNext] = useState<FollowUp[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'hidden'>('loading');

  useEffect(() => {
    let alive = true;
    followupsApi.summary(mine)
      .then((s) => { if (alive) { setCounts(s.counts); setNext(s.next); setState('ok'); } })
      .catch(() => { if (alive) setState('hidden'); }); // e.g. a role without follow-up access
    return () => { alive = false; };
  }, [mine]);

  if (state === 'hidden') return null;

  const tiles = [
    { key: 'overdue', label: 'Overdue', value: counts?.overdue, icon: AlertTriangle, tone: 'text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-400' },
    { key: 'today', label: 'Due today', value: counts?.today, icon: Clock, tone: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-400' },
    { key: 'pending', label: 'Pending', value: counts?.pending, icon: CalendarClock, tone: 'text-sky-600 bg-sky-50 dark:bg-sky-500/10 dark:text-sky-400' },
    { key: 'completed', label: 'Completed (7d)', value: counts?.completed_7d, icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400', view: 'completed' },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-indigo-500" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-100">Follow-ups</h3>
        </div>
        <Link href="/follow-ups?tab=email" className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400">
          Open <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.key} href={`/follow-ups?tab=email&view=${t.view || t.key}`}
            className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 transition-colors hover:border-indigo-200 hover:bg-indigo-50/40 dark:border-zinc-800 dark:hover:bg-zinc-800/60">
            <div className={`rounded-lg p-2 ${t.tone}`}><t.icon className="h-4 w-4" /></div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t.label}</p>
              <p className="text-xl font-black leading-tight text-slate-900 dark:text-white">
                {state === 'loading' ? <Loader2 className="h-4 w-4 animate-spin text-slate-300" /> : t.value ?? 0}
              </p>
            </div>
          </Link>
        ))}
      </div>
      {next.length > 0 && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-zinc-800 dark:border-zinc-800">
          {next.slice(0, 5).map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
              <StateChip state={f.state} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700 dark:text-zinc-200">{f.title}</span>
              <RecordChip f={f} />
              <span className={`text-xs font-semibold ${f.state === 'overdue' ? 'text-red-600' : 'text-slate-500 dark:text-zinc-400'}`}>{relativeDue(f.due_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
