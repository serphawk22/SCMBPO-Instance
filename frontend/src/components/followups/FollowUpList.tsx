'use client';

import React, { useState } from 'react';
import {
  AlertCircle, Bot, CalendarClock, CheckCircle2, ChevronDown, Clock3, Mail, MailCheck, Pencil, RotateCcw, Trash2, User, XCircle,
} from 'lucide-react';
import { errorText } from '@/lib/inboxApi';
import { followupsApi, type FollowUp } from '@/lib/followupsApi';
import { CompleteDialog, FollowUpEmailDialog, FollowUpFormDialog, type RecordContext } from './FollowUpDialogs';
import { CHANNEL_META, RecordChip, SourceChip, StateChip, addDaysLocal, btn, fromLocalInput, fullDate, relativeDue } from './followupUi';

const RESCHEDULE = [{ label: 'Tomorrow', days: 1 }, { label: 'In 3 days', days: 3 }, { label: 'Next week', days: 7 }, { label: 'In 2 weeks', days: 14 }];

function FollowUpRow({ f, showRecord, onAction }: {
  f: FollowUp; showRecord: boolean; onAction: (kind: 'complete' | 'email' | 'edit' | 'refresh', f: FollowUp) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const Channel = CHANNEL_META[f.channel]?.icon || Mail;
  const pending = f.status === 'Pending';

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      onAction('refresh', f);
    } catch (e) {
      setError(errorText(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
      setMenu(false);
    }
  };

  const accent = { overdue: 'border-l-red-500', today: 'border-l-amber-500', upcoming: 'border-l-sky-500', completed: 'border-l-emerald-500', cancelled: 'border-l-slate-300' }[f.state];

  return (
    <div className={`rounded-xl border border-l-4 border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900 ${accent}`}>
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${pending ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300' : 'bg-slate-100 text-slate-400 dark:bg-zinc-800'}`}>
          <Channel size={16} />
        </div>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen((o) => !o)}>
          <div className="flex flex-wrap items-center gap-1.5">
            <StateChip state={f.state} />
            <SourceChip f={f} />
            {f.priority === 'high' && <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-black uppercase text-white">High</span>}
            {f.auto_send && pending && !f.email_sent_at && (
              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">
                <Clock3 size={10} /> Auto-send
              </span>
            )}
            {f.email_sent_at && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                <MailCheck size={10} /> Email sent
              </span>
            )}
            {showRecord && <RecordChip f={f} />}
          </div>
          <p className={`mt-1 text-sm font-bold ${pending ? 'text-slate-800 dark:text-zinc-100' : 'text-slate-500 line-through decoration-slate-300 dark:text-zinc-500'}`}>{f.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-zinc-400">
            <span className={`inline-flex items-center gap-1 font-semibold ${f.state === 'overdue' ? 'text-red-600 dark:text-red-400' : ''}`} title={fullDate(f.due_at)}>
              <CalendarClock size={11} /> {pending ? relativeDue(f.due_at) : `Due ${fullDate(f.due_at)}`}
            </span>
            {(f.contact_name || f.contact_email) && <span>{[f.contact_name, f.contact_email].filter(Boolean).join(' · ')}</span>}
            {!showRecord || !(f.lead || f.client) ? (f.company_name && <span>{f.company_name}</span>) : null}
            {f.assigned_to && <span className="inline-flex items-center gap-1"><User size={11} /> {f.assigned_to.name}</span>}
          </p>
          {f.notes && !open && <p className="mt-1 line-clamp-1 text-xs text-slate-500 dark:text-zinc-400">{f.notes}</p>}
        </button>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {pending ? (
            <>
              <button className={btn.ghost} onClick={() => onAction('email', f)} title="Write / send the follow-up email"><Mail size={13} /> Email</button>
              <button className={btn.ghost} onClick={() => onAction('complete', f)} title="Mark completed"><CheckCircle2 size={13} /> Done</button>
              <div className="relative">
                <button className={btn.ghost} onClick={() => setMenu((m) => !m)} disabled={busy}><Clock3 size={13} /> Snooze <ChevronDown size={11} /></button>
                {menu && (
                  <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                    {RESCHEDULE.map((r) => (
                      <button key={r.days} className="block w-full px-3 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-indigo-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        onClick={() => run(() => followupsApi.update(f.id, { due_at: fromLocalInput(addDaysLocal(r.days)) }))}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button className={btn.ghost} onClick={() => onAction('edit', f)} title="Edit"><Pencil size={13} /></button>
            </>
          ) : (
            <button className={btn.ghost} onClick={() => run(() => followupsApi.update(f.id, { status: 'Pending' }))} disabled={busy} title="Reopen">
              <RotateCcw size={13} /> Reopen
            </button>
          )}
        </div>
      </div>
      {f.last_error && (
        <p className="mx-4 mb-3 flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">
          <AlertCircle size={12} className="mt-0.5 shrink-0" /> {f.last_error}
        </p>
      )}
      {error && <p className="mx-4 mb-3 text-[11px] font-semibold text-red-600">{error}</p>}
      {open && (
        <div className="space-y-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-600 dark:border-zinc-800 dark:text-zinc-300">
          {f.notes && <p className="whitespace-pre-wrap"><span className="font-bold text-slate-700 dark:text-zinc-200">Context: </span>{f.notes}</p>}
          {f.ai_reason && (
            <p className="flex items-start gap-1.5 rounded-lg bg-violet-50 px-2.5 py-1.5 text-violet-800 dark:bg-violet-500/10 dark:text-violet-200">
              <Bot size={12} className="mt-0.5 shrink-0" /> <span>AI found: “{f.ai_reason}”</span>
            </p>
          )}
          {f.outcome && <p className="whitespace-pre-wrap"><span className="font-bold text-slate-700 dark:text-zinc-200">Outcome: </span>{f.outcome}</p>}
          {f.email_body && (
            <div className="rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-zinc-950">
              <p className="font-bold text-slate-700 dark:text-zinc-200">{f.email_sent_at ? `Email sent ${fullDate(f.email_sent_at)}` : 'Prepared email'}: {f.email_subject}</p>
              <p className="mt-1 line-clamp-4 whitespace-pre-wrap">{f.email_body}</p>
            </div>
          )}
          <p className="text-[10.5px] text-slate-400">
            Created {fullDate(f.created_at)}{f.created_by ? ` by ${f.created_by.name}` : ''}
            {f.reminder_sent_at ? ` · reminder sent ${fullDate(f.reminder_sent_at)}` : ''}
            {f.completed_at ? ` · ${f.status.toLowerCase()} ${fullDate(f.completed_at)}${f.completed_by ? ` by ${f.completed_by.name}` : ''}` : ''}
          </p>
          <div className="flex gap-2 pt-1">
            {pending && (
              <button className={btn.ghost} onClick={() => run(() => followupsApi.update(f.id, { status: 'Cancelled' }))} disabled={busy}>
                <XCircle size={13} /> Cancel follow-up
              </button>
            )}
            <button className={`${btn.ghost} text-red-500 hover:text-red-700`} disabled={busy}
              onClick={() => { if (window.confirm('Delete this follow-up permanently?')) run(() => followupsApi.remove(f.id)); }}>
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A list of follow-ups with all row actions and their dialogs. `onChanged` should reload the list. */
export default function FollowUpList({ items, onChanged, showRecord = true, record = null, empty }: {
  items: FollowUp[]; onChanged: () => void; showRecord?: boolean; record?: RecordContext | null; empty?: React.ReactNode;
}) {
  const [dialog, setDialog] = useState<{ kind: 'complete' | 'email' | 'edit'; f: FollowUp } | null>(null);

  const onAction = (kind: 'complete' | 'email' | 'edit' | 'refresh', f: FollowUp) => {
    if (kind === 'refresh') onChanged();
    else setDialog({ kind, f });
  };
  const close = () => setDialog(null);
  const done = () => { setDialog(null); onChanged(); };

  return (
    <>
      {items.length === 0 ? (empty ?? null) : (
        <div className="space-y-2">
          {items.map((f) => <FollowUpRow key={f.id} f={f} showRecord={showRecord} onAction={onAction} />)}
        </div>
      )}
      {dialog?.kind === 'complete' && <CompleteDialog fu={dialog.f} onClose={close} onDone={done} />}
      {dialog?.kind === 'edit' && <FollowUpFormDialog initial={dialog.f} record={record} onClose={close} onSaved={done} />}
      {dialog?.kind === 'email' && <FollowUpEmailDialog fu={dialog.f} onClose={done} onChanged={() => onChanged()} />}
    </>
  );
}
