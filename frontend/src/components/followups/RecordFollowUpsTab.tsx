'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, Bot, CalendarCheck, CalendarClock, CheckCircle2, History, Loader2, MessageSquare, Phone, Plus,
  ScanSearch, Sparkles, StickyNote, Users, X, type LucideIcon,
} from 'lucide-react';
import { errorText } from '@/lib/inboxApi';
import { followupsApi, type DraftEmail, type RecordHistory, type Suggestion, type TimelineEvent } from '@/lib/followupsApi';
import FollowUpList from './FollowUpList';
import { FollowUpFormDialog, type RecordContext } from './FollowUpDialogs';
import { CHANNEL_META, ErrorNote, btn, dateAtHour, fullDate } from './followupUi';

const EVENT_META: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  note: { label: 'Note', icon: StickyNote, tone: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  remark: { label: 'Remark', icon: StickyNote, tone: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  call: { label: 'Call', icon: Phone, tone: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  meeting: { label: 'Meeting', icon: Users, tone: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  email_in: { label: 'Email received', icon: ArrowDownLeft, tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  email_out: { label: 'Email sent', icon: ArrowUpRight, tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' },
  email: { label: 'Email (logged)', icon: ArrowUpRight, tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' },
  followup: { label: 'Follow-up', icon: CalendarClock, tone: 'bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300' },
  followup_done: { label: 'Follow-up done', icon: CheckCircle2, tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
};
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'notes', label: 'Notes', types: ['note', 'remark'] },
  { key: 'conversations', label: 'Conversations', types: ['call', 'meeting', 'whatsapp', 'visit', 'other', 'conversation'] },
  { key: 'emails', label: 'Emails', types: ['email_in', 'email_out', 'email'] },
  { key: 'followups', label: 'Follow-ups', types: ['followup', 'followup_done'] },
];

function TimelineItem({ e }: { e: TimelineEvent }) {
  const [open, setOpen] = useState(false);
  const meta = EVENT_META[e.type] || { label: e.type, icon: MessageSquare, tone: 'bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300' };
  const Icon = meta.icon;
  const long = (e.body || '').length > 220;
  return (
    <li className="relative pl-9">
      <span className={`absolute left-0 top-0.5 flex h-6 w-6 items-center justify-center rounded-full ${meta.tone}`}><Icon size={12} /></span>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{meta.label}</span>
        {e.date && <span className="text-[10.5px] text-slate-400">{fullDate(e.date)}</span>}
        {e.author && <span className="text-[10.5px] text-slate-400">· {e.author}</span>}
      </div>
      {e.title && e.title !== 'Note' && <p className="text-xs font-bold text-slate-700 dark:text-zinc-200">{e.title}</p>}
      {e.body && (
        <p className={`whitespace-pre-wrap text-xs leading-relaxed text-slate-600 dark:text-zinc-300 ${!open && long ? 'line-clamp-3' : ''}`}>{e.body}</p>
      )}
      {long && <button className="text-[10.5px] font-bold text-indigo-600" onClick={() => setOpen((o) => !o)}>{open ? 'Show less' : 'Show more'}</button>}
      {e.due_at && <p className="text-[10.5px] text-slate-400">Due {fullDate(e.due_at)}</p>}
      {!!e.replies?.length && (
        <ul className="mt-1.5 space-y-1 border-l-2 border-slate-100 pl-2.5 dark:border-zinc-800">
          {e.replies.map((r, i) => (
            <li key={i} className="text-[11.5px] text-slate-600 dark:text-zinc-300">
              <span className="font-bold">{r.author || 'Reply'}</span>{r.date ? <span className="text-slate-400"> · {fullDate(r.date)}</span> : null}: {r.content}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function RecordFollowUpsTab({ kind, recordId }: { kind: 'lead' | 'client'; recordId: string | number }) {
  const [data, setData] = useState<RecordHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [showHistory, setShowHistory] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<{ s: Suggestion; email: DraftEmail | null } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<null | { fromSuggestion: boolean }>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await followupsApi.history(kind, recordId));
    } catch (e) {
      setError(errorText(e, 'Could not load follow-ups.'));
    } finally {
      setLoading(false);
    }
  }, [kind, recordId]);

  useEffect(() => { load(); }, [load]);

  const record: RecordContext | null = data ? {
    kind, id: data.record.id, name: data.record.name, contact_name: data.record.contact_name, contact_email: data.record.contact_email,
  } : null;

  const pending = useMemo(() => (data?.followups || []).filter((f) => f.status === 'Pending')
    .sort((a, b) => a.due_at.localeCompare(b.due_at)), [data]);
  const closed = useMemo(() => (data?.followups || []).filter((f) => f.status !== 'Pending'), [data]);
  const timeline = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter);
    return (data?.timeline || []).filter((e) => !f?.types || f.types.includes(e.type));
  }, [data, filter]);

  const suggest = async () => {
    setSuggesting(true);
    setError('');
    setNotice('');
    try {
      const r = await followupsApi.suggest(kind, recordId);
      setSuggestion({ s: r.suggestion, email: r.email });
    } catch (e) {
      setError(errorText(e, 'Could not get a suggestion.'));
    } finally {
      setSuggesting(false);
    }
  };

  const scan = async () => {
    setScanning(true);
    setError('');
    setNotice('');
    try {
      const r = await followupsApi.scan(kind, recordId);
      const parts = [
        r.created.length ? `created ${r.created.length} follow-up${r.created.length > 1 ? 's' : ''}` : '',
        r.updated.length ? `updated ${r.updated.length} existing follow-up${r.updated.length > 1 ? 's' : ''} with what was said` : '',
      ].filter(Boolean);
      setNotice(!r.scanned
        ? 'All notes have already been analysed. New notes are checked automatically every minute.'
        : `Read ${r.scanned} new note${r.scanned === 1 ? '' : 's'} — ${parts.length ? parts.join(' and ') : 'no follow-up needed'}.`);
      await load();
    } catch (e) {
      setError(errorText(e, 'Could not scan the notes.'));
    } finally {
      setScanning(false);
    }
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-slate-400" /></div>;

  const overdue = pending.filter((f) => f.state === 'overdue').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="mr-auto flex items-center gap-2 px-1">
          <CalendarClock size={16} className="text-indigo-500" />
          <span className="text-sm font-black text-slate-800 dark:text-zinc-100">Follow-ups</span>
          <span className="rounded-full bg-slate-100 px-2 text-[11px] font-bold text-slate-600 dark:bg-zinc-800 dark:text-zinc-300">{pending.length} pending</span>
          {overdue > 0 && <span className="rounded-full bg-red-100 px-2 text-[11px] font-bold text-red-700">{overdue} overdue</span>}
        </div>
        <button className={btn.secondary} onClick={scan} disabled={scanning} title="Let AI read recent notes and conversations and create the follow-ups they imply">
          {scanning ? <Loader2 size={14} className="animate-spin" /> : <ScanSearch size={14} />} Scan notes
        </button>
        <button className={btn.secondary} onClick={suggest} disabled={suggesting} title="AI proposes the next follow-up from the full history">
          {suggesting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Suggest with AI
        </button>
        <button className={btn.primary} onClick={() => setForm({ fromSuggestion: false })}><Plus size={14} /> New follow-up</button>
      </div>

      <ErrorNote text={error} />
      {notice && <p className="rounded-xl bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">{notice}</p>}

      {suggestion && (
        <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-4 shadow-sm dark:border-violet-500/30 dark:from-violet-500/10 dark:to-zinc-900">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white"><Bot size={16} /></div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-violet-600 dark:text-violet-300">
                  {suggestion.s.engine === 'ai' ? 'AI suggestion' : 'Suggestion (rules — AI unavailable)'}
                </p>
                {suggestion.s.should_follow_up && suggestion.s.due_date && (
                  <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-violet-700 shadow-sm dark:bg-zinc-900 dark:text-violet-300">
                    {new Date(`${suggestion.s.due_date}T10:00`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })} · {CHANNEL_META[suggestion.s.channel]?.label}
                  </span>
                )}
              </div>
              {suggestion.s.should_follow_up ? (
                <>
                  <p className="mt-1 text-sm font-bold text-slate-800 dark:text-zinc-100">{suggestion.s.title}</p>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-zinc-300">{suggestion.s.reason}</p>
                  {suggestion.s.quote && <p className="mt-1 text-xs italic text-slate-500 dark:text-zinc-400">“{suggestion.s.quote}”</p>}
                  {suggestion.email && (
                    <details className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-xs dark:bg-zinc-950/60">
                      <summary className="cursor-pointer font-bold text-slate-700 dark:text-zinc-200">Prepared email: {suggestion.email.subject}</summary>
                      <p className="mt-1.5 whitespace-pre-wrap text-slate-600 dark:text-zinc-300">{suggestion.email.body}</p>
                    </details>
                  )}
                </>
              ) : (
                <p className="mt-1 text-sm text-slate-600 dark:text-zinc-300">{suggestion.s.reason || 'No follow-up looks necessary right now.'}</p>
              )}
            </div>
            <button onClick={() => setSuggestion(null)} className="rounded-full p-1 text-slate-400 hover:bg-white" aria-label="Dismiss"><X size={14} /></button>
          </div>
          {suggestion.s.should_follow_up && (
            <div className="mt-3 flex justify-end gap-2">
              <button className={btn.secondary} onClick={() => setSuggestion(null)}>Dismiss</button>
              <button className={btn.primary} onClick={() => setForm({ fromSuggestion: true })}><CalendarCheck size={14} /> Review & create</button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          <FollowUpList items={pending} onChanged={load} showRecord={false} record={record} empty={(
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center dark:border-zinc-700">
              <CalendarClock className="mx-auto text-slate-300" size={32} />
              <p className="mt-2 text-sm font-bold text-slate-500 dark:text-zinc-400">No pending follow-ups</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-slate-400">Create one, or let AI suggest the next step from the notes and conversations on this record.</p>
            </div>
          )} />
          {closed.length > 0 && (
            <div>
              <button className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 dark:text-zinc-400" onClick={() => setShowHistory((s) => !s)}>
                <History size={13} /> {showHistory ? 'Hide' : 'Show'} follow-up history ({closed.length})
              </button>
              {showHistory && <div className="mt-2"><FollowUpList items={closed} onChanged={load} showRecord={false} record={record} /></div>}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <div className="border-b border-slate-100 px-4 py-3 dark:border-zinc-800">
            <p className="flex items-center gap-1.5 text-sm font-black text-slate-800 dark:text-zinc-100"><History size={14} className="text-indigo-500" /> Conversation history</p>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400">Notes, calls, emails and follow-ups — what the AI reads before preparing a follow-up.</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button key={f.key} onClick={() => setFilter(f.key)}
                  className={`rounded-md px-2 py-0.5 text-[10.5px] font-bold ${filter === f.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-300'}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[640px] overflow-y-auto px-4 py-3">
            {timeline.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">Nothing recorded yet.</p>
            ) : (
              <ul className="space-y-4">{timeline.map((e) => <TimelineItem key={e.key} e={e} />)}</ul>
            )}
          </div>
        </div>
      </div>

      {form && record && (
        <FollowUpFormDialog
          record={record}
          defaults={form.fromSuggestion && suggestion ? {
            title: suggestion.s.title, notes: suggestion.s.reason, channel: suggestion.s.channel, priority: suggestion.s.priority,
            due_local: suggestion.s.due_date ? dateAtHour(suggestion.s.due_date) : undefined,
            email_subject: suggestion.email?.subject, email_body: suggestion.email?.body,
            source: 'ai_suggested', ai_reason: suggestion.s.quote || suggestion.s.reason,
          } : undefined}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); setSuggestion(null); load(); }}
        />
      )}
    </div>
  );
}
