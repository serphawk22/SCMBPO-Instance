'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CalendarCheck, CalendarClock, CheckCircle2, Clock, Loader2, Plus, RefreshCw, Search, XCircle, type LucideIcon,
} from 'lucide-react';
import { errorText } from '@/lib/inboxApi';
import { followupsApi, type FollowUp, type FollowUpCounts, type FollowUpView } from '@/lib/followupsApi';
import FollowUpList from '@/components/followups/FollowUpList';
import { FollowUpFormDialog } from '@/components/followups/FollowUpDialogs';
import { btn } from '@/components/followups/followupUi';

const TABS: { key: FollowUpView; label: string; count?: keyof FollowUpCounts }[] = [
  { key: 'overdue', label: 'Overdue', count: 'overdue' },
  { key: 'today', label: 'Due today', count: 'today' },
  { key: 'upcoming', label: 'Upcoming', count: 'upcoming' },
  { key: 'pending', label: 'All pending', count: 'pending' },
  { key: 'completed', label: 'Completed', count: 'completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

const PAGE = 50;

function StatCard({ label, value, hint, icon: Icon, tone, active, onClick }: {
  label: string; value: number | string; hint: string; icon: LucideIcon; tone: string; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-3 rounded-2xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900 ${active ? 'border-indigo-400 ring-2 ring-indigo-500/20' : 'border-slate-200 dark:border-zinc-700'}`}>
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon size={20} /></div>
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-zinc-500">{label}</p>
        <p className="text-2xl font-black leading-tight text-slate-900 dark:text-white">{value}</p>
        <p className="truncate text-[11px] text-slate-500 dark:text-zinc-400">{hint}</p>
      </div>
    </button>
  );
}

/** The email-stack view of follow-ups (AI-prepared emails, auto-send, reminders, history). Shown as the
 *  "Email follow-ups" tab of /follow-ups; it reads the same follow_ups rows as the main board. */
export default function EmailFollowUpsView() {
  const [view, setView] = useState<FollowUpView>('overdue');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<FollowUp[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<FollowUpCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [initialised, setInitialised] = useState(false);

  // Deep link (/follow-ups?tab=email&view=today); otherwise open on the most urgent non-empty tab.
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('view') as FollowUpView | null;
    if (v && TABS.some((t) => t.key === v)) setView(v);
    followupsApi.summary().then((s) => {
      setCounts(s.counts);
      if (!v) setView(s.counts.overdue ? 'overdue' : s.counts.today ? 'today' : s.counts.upcoming ? 'upcoming' : 'pending');
    }).catch(() => undefined).finally(() => setInitialised(true));
  }, []);

  const load = useCallback(async (append = false) => {
    setLoading(true);
    setError('');
    try {
      const [list, summary] = await Promise.all([
        followupsApi.list({ view, mine, q: search || undefined, limit: PAGE, offset: append ? items.length : 0 }),
        followupsApi.summary(mine),
      ]);
      setItems((prev) => (append ? [...prev, ...list.items] : list.items));
      setTotal(list.total);
      setCounts(summary.counts);
    } catch (e) {
      setError(errorText(e, 'Could not load follow-ups.'));
    } finally {
      setLoading(false);
    }
    // items.length only matters for "load more"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, mine, search]);

  useEffect(() => {
    if (initialised) load();
  }, [load, initialised]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-500/30">
            <CalendarClock size={20} />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900 dark:text-white">Email follow-ups</h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400">Every promised next step with your leads and clients — with reminders, AI-prepared emails and full history.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            Only mine
          </label>
          <button className={btn.secondary} onClick={() => load()} disabled={loading} title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button className={btn.primary} onClick={() => setCreating(true)}><Plus size={14} /> New follow-up</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Overdue" value={counts?.overdue ?? '–'} hint="Past their follow-up date" icon={AlertTriangle}
          tone="bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400" active={view === 'overdue'} onClick={() => setView('overdue')} />
        <StatCard label="Due today" value={counts?.today ?? '–'} hint="Follow up before the day ends" icon={Clock}
          tone="bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400" active={view === 'today'} onClick={() => setView('today')} />
        <StatCard label="Upcoming" value={counts?.upcoming ?? '–'} hint={counts ? `${counts.upcoming_7d} in the next 7 days` : ' '} icon={CalendarClock}
          tone="bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400" active={view === 'upcoming'} onClick={() => setView('upcoming')} />
        <StatCard label="Completed" value={counts?.completed ?? '–'} hint={counts ? `${counts.completed_7d} this week` : ' '} icon={CheckCircle2}
          tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400" active={view === 'completed'} onClick={() => setView('completed')} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-zinc-800">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setView(t.key)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${view === t.key
                ? 'bg-white text-slate-900 shadow-sm dark:bg-zinc-900 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-zinc-400'}`}>
              {t.label}
              {t.count && counts && counts[t.count] > 0 && (
                <span className={`rounded-full px-1.5 text-[10px] font-black ${t.key === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-slate-200 text-slate-600 dark:bg-zinc-700 dark:text-zinc-300'}`}>
                  {counts[t.count]}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, contact, company…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <XCircle size={16} /> {error}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-slate-400" /></div>
      ) : (
        <FollowUpList
          items={items}
          onChanged={() => load()}
          empty={!error && (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 py-14 text-center dark:border-zinc-700">
              <CalendarCheck className="text-slate-300" size={36} />
              <p className="text-sm font-bold text-slate-500 dark:text-zinc-400">
                {view === 'overdue' ? 'Nothing overdue — nice work.' : view === 'today' ? 'No follow-ups due today.' : 'No follow-ups here.'}
              </p>
              <p className="max-w-md text-xs text-slate-400">
                Follow-ups are created from a lead or client page, from the Email Agent’s Excel campaigns, or automatically when AI finds a promised next step in your notes.
              </p>
            </div>
          )}
        />
      )}
      {items.length < total && (
        <div className="flex justify-center">
          <button className={btn.secondary} onClick={() => load(true)} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : null} Load more ({total - items.length})
          </button>
        </div>
      )}

      {creating && <FollowUpFormDialog onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
    </div>
  );
}
