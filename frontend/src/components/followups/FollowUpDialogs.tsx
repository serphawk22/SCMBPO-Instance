'use client';

import React, { useEffect, useState } from 'react';
import { Bot, CalendarPlus, CheckCircle2, Loader2, Mail, Save, Send, Sparkles } from 'lucide-react';
import { errorText } from '@/lib/inboxApi';
import {
  followupsApi, wasCancelled,
  type Channel, type FollowUp, type FollowUpInput, type Priority, type SenderStatus,
} from '@/lib/followupsApi';
import { CHANNEL_META, ErrorNote, Modal, addDaysLocal, btn, fromLocalInput, input, label, toLocalInput } from './followupUi';

export interface RecordContext {
  kind: 'lead' | 'client';
  id: number;
  name: string;
  contact_name?: string | null;
  contact_email?: string | null;
}

const CHANNELS = Object.keys(CHANNEL_META) as Channel[];
const QUICK_DATES = [
  { label: 'Tomorrow', days: 1 }, { label: 'In 3 days', days: 3 }, { label: 'Next week', days: 7 }, { label: 'In 2 weeks', days: 14 },
];

// ─── Create / edit ───────────────────────────────────────────────────────────
export function FollowUpFormDialog({ initial, record, defaults, onClose, onSaved }: {
  initial?: FollowUp | null;
  record?: RecordContext | null;
  defaults?: Partial<FollowUpInput> & { due_local?: string };
  onClose: () => void;
  onSaved: (f: FollowUp) => void;
}) {
  const editing = !!initial;
  const [f, setF] = useState({
    title: initial?.title ?? defaults?.title ?? '',
    due: initial ? toLocalInput(initial.due_at) : defaults?.due_local ?? addDaysLocal(3),
    channel: (initial?.channel ?? defaults?.channel ?? 'email') as Channel,
    priority: (initial?.priority ?? defaults?.priority ?? 'medium') as Priority,
    notes: initial?.notes ?? defaults?.notes ?? '',
    assigned_to: initial?.assigned_to?.id ?? defaults?.assigned_to ?? null as number | null,
    contact_name: initial?.contact_name ?? defaults?.contact_name ?? record?.contact_name ?? '',
    contact_email: initial?.contact_email ?? defaults?.contact_email ?? record?.contact_email ?? '',
    company_name: initial?.company_name ?? defaults?.company_name ?? '',
    email_subject: initial?.email_subject ?? defaults?.email_subject ?? '',
    email_body: initial?.email_body ?? defaults?.email_body ?? '',
    auto_send: initial?.auto_send ?? defaults?.auto_send ?? false,
  });
  const [showEmail, setShowEmail] = useState(!!(f.email_body || f.auto_send));
  const [users, setUsers] = useState<{ id: number; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    followupsApi.assignees().then((r) => setUsers(r.users)).catch(() => setUsers([]));
  }, []);

  const save = async () => {
    setError('');
    if (!f.title.trim()) return setError('Give the follow-up a title.');
    if (!f.due) return setError('Pick a follow-up date.');
    if (!record && !editing && !f.contact_email.trim()) return setError('Add the contact’s email address.');
    if (f.auto_send && (!f.email_subject.trim() || !f.email_body.trim() || !f.contact_email.trim())) {
      return setError('Automatic sending needs the contact’s email plus an email subject and body.');
    }
    setSaving(true);
    try {
      const payload: FollowUpInput = {
        title: f.title.trim(), due_at: fromLocalInput(f.due), channel: f.channel, priority: f.priority,
        notes: f.notes.trim() || null, assigned_to: f.assigned_to, contact_name: f.contact_name.trim() || null,
        contact_email: f.contact_email.trim() || null, email_subject: f.email_subject.trim() || null,
        email_body: f.email_body.trim() || null, auto_send: f.auto_send,
      };
      let saved: FollowUp;
      if (editing && initial) {
        saved = (await followupsApi.update(initial.id, payload)).item;
      } else {
        saved = (await followupsApi.create({
          ...payload,
          lead_id: record?.kind === 'lead' ? record.id : null,
          client_id: record?.kind === 'client' ? record.id : null,
          company_name: f.company_name.trim() || null,
          source: defaults?.source ?? 'manual', source_ref: defaults?.source_ref ?? null, ai_reason: defaults?.ai_reason ?? null,
        })).item;
      }
      onSaved(saved);
    } catch (e) {
      setError(errorText(e, 'Could not save the follow-up.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={editing ? 'Edit follow-up' : 'New follow-up'}
      subtitle={record ? `${record.kind === 'lead' ? 'Lead' : 'Client'}: ${record.name}` : initial ? (initial.company_name || initial.contact_email || '') : 'Follow up with a contact'}
      onClose={onClose}
      footer={<>
        <button className={btn.secondary} onClick={onClose}>Cancel</button>
        <button className={btn.primary} onClick={save} disabled={saving}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {editing ? 'Save changes' : 'Create follow-up'}
        </button>
      </>}
    >
      <div className="space-y-3.5">
        {defaults?.ai_reason && (
          <div className="flex gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200">
            <Bot size={14} className="mt-0.5 shrink-0" /> <span>{defaults.ai_reason}</span>
          </div>
        )}
        <div>
          <label className={label}>What needs to happen</label>
          <input className={input} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Call Jane about the proposal" autoFocus />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Follow-up date</label>
            <input type="datetime-local" className={input} value={f.due} onChange={(e) => set('due', e.target.value)} />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {QUICK_DATES.map((q) => (
                <button key={q.days} type="button" onClick={() => set('due', addDaysLocal(q.days))}
                  className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-indigo-100 hover:text-indigo-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {q.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={label}>Channel</label>
              <select className={input} value={f.channel} onChange={(e) => set('channel', e.target.value as Channel)}>
                {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_META[c].label}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Priority</label>
              <select className={input} value={f.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
                <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </div>
          </div>
        </div>
        <div>
          <label className={label}>Context / what was discussed</label>
          <textarea className={`${input} min-h-[80px] resize-y`} value={f.notes} onChange={(e) => set('notes', e.target.value)}
            placeholder="e.g. Client will discuss internally and respond next week. Mentioned budget approval in Q4." />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Contact name</label>
            <input className={input} value={f.contact_name} onChange={(e) => set('contact_name', e.target.value)} placeholder="Jane Doe" />
          </div>
          <div>
            <label className={label}>Contact email</label>
            <input type="email" className={input} value={f.contact_email} onChange={(e) => set('contact_email', e.target.value)} placeholder="jane@company.com" />
          </div>
          {!record && !editing && (
            <div>
              <label className={label}>Company</label>
              <input className={input} value={f.company_name} onChange={(e) => set('company_name', e.target.value)} placeholder="Company name" />
            </div>
          )}
          {users.length > 1 && (
            <div>
              <label className={label}>Assigned to</label>
              <select className={input} value={f.assigned_to ?? ''} onChange={(e) => set('assigned_to', e.target.value ? Number(e.target.value) : null)}>
                <option value="">{record ? 'Record owner' : 'Me'}</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-zinc-700">
          <button type="button" onClick={() => setShowEmail((s) => !s)}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-bold text-slate-700 dark:text-zinc-200">
            <Mail size={14} className="text-indigo-500" /> Follow-up email (optional)
            <span className="ml-auto text-[10px] font-semibold text-slate-400">{showEmail ? 'Hide' : 'Add'}</span>
          </button>
          {showEmail && (
            <div className="space-y-2 border-t border-slate-100 px-3 py-3 dark:border-zinc-800">
              <input className={input} value={f.email_subject} onChange={(e) => set('email_subject', e.target.value)} placeholder="Subject" />
              <textarea className={`${input} min-h-[120px] resize-y`} value={f.email_body} onChange={(e) => set('email_body', e.target.value)}
                placeholder={'Hi Jane,\n\nFollowing up on our call last week…'} />
              <p className="text-[11px] text-slate-500 dark:text-zinc-400">Tip: after saving, use <b>Email → Draft with AI</b> to write this from the previous notes.</p>
              <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-zinc-300">
                <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-indigo-600" checked={f.auto_send} onChange={(e) => set('auto_send', e.target.checked)} />
                <span><b>Send this email automatically</b> when the follow-up is due, from the company email account.</span>
              </label>
            </div>
          )}
        </div>
        <ErrorNote text={error} />
      </div>
    </Modal>
  );
}

// ─── Complete ────────────────────────────────────────────────────────────────
export function CompleteDialog({ fu, onClose, onDone }: { fu: FollowUp; onClose: () => void; onDone: (f: FollowUp, next: FollowUp | null) => void }) {
  const [outcome, setOutcome] = useState('');
  const [scheduleNext, setScheduleNext] = useState(false);
  const [nextDue, setNextDue] = useState(addDaysLocal(7));
  const [nextTitle, setNextTitle] = useState(fu.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await followupsApi.complete(fu.id, outcome.trim(), scheduleNext ? { due_at: fromLocalInput(nextDue), title: nextTitle.trim() || fu.title } : null);
      onDone(r.item, r.next);
    } catch (e) {
      setError(errorText(e, 'Could not complete the follow-up.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Complete follow-up" subtitle={fu.title} onClose={onClose} footer={<>
      <button className={btn.secondary} onClick={onClose}>Cancel</button>
      <button className={btn.success} onClick={submit} disabled={busy}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Mark completed
      </button>
    </>}>
      <div className="space-y-3">
        <div>
          <label className={label}>Outcome / feedback (kept in the history)</label>
          <textarea className={`${input} min-h-[100px]`} value={outcome} onChange={(e) => setOutcome(e.target.value)} autoFocus
            placeholder="e.g. Spoke with Jane — they approved the budget, waiting for the signed contract." />
          <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">The AI uses this outcome when it prepares the next follow-up.</p>
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-zinc-200">
          <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={scheduleNext} onChange={(e) => setScheduleNext(e.target.checked)} />
          <CalendarPlus size={14} className="text-indigo-500" /> Schedule the next follow-up
        </label>
        {scheduleNext && (
          <div className="grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-2 dark:bg-zinc-950">
            <input className={input} value={nextTitle} onChange={(e) => setNextTitle(e.target.value)} placeholder="Next step" />
            <input type="datetime-local" className={input} value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
          </div>
        )}
        <ErrorNote text={error} />
      </div>
    </Modal>
  );
}

// ─── Email ───────────────────────────────────────────────────────────────────
export function FollowUpEmailDialog({ fu, onClose, onChanged }: { fu: FollowUp; onClose: () => void; onChanged: (f: FollowUp) => void }) {
  const [to, setTo] = useState(fu.contact_email || '');
  const [subject, setSubject] = useState(fu.email_subject || '');
  const [body, setBody] = useState(fu.email_body || '');
  const [tone, setTone] = useState('professional');
  const [instructions, setInstructions] = useState('');
  const [complete, setComplete] = useState(true);
  const [sender, setSender] = useState<SenderStatus | null>(null);
  const [busy, setBusy] = useState<'' | 'draft' | 'send' | 'schedule'>('');
  const [engine, setEngine] = useState<string>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    followupsApi.sender().then(setSender).catch(() => setSender(null));
  }, []);

  useEffect(() => {
    // No saved draft yet: write one from the previous notes straight away.
    if (!fu.email_body) draft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draft = async () => {
    setBusy('draft');
    setError('');
    try {
      const d = await followupsApi.draftEmail(fu.id, tone, instructions);
      setSubject(d.subject);
      setBody(d.body);
      setEngine(d.engine);
    } catch (e) {
      setError(errorText(e, 'Could not draft the email.'));
    } finally {
      setBusy('');
    }
  };

  const send = async () => {
    setError('');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim())) return setError('Enter a valid recipient email.');
    if (!subject.trim() || !body.trim()) return setError('Subject and body are required.');
    setBusy('send');
    try {
      const r = await followupsApi.sendEmail(fu.id, { to: to.trim(), subject: subject.trim(), body, complete });
      if (wasCancelled(r)) return;
      onChanged(r.item);
      onClose();
    } catch (e) {
      setError(errorText(e, 'The email could not be sent.'));
    } finally {
      setBusy('');
    }
  };

  const schedule = async () => {
    setError('');
    setBusy('schedule');
    try {
      const r = await followupsApi.update(fu.id, { contact_email: to.trim(), email_subject: subject.trim(), email_body: body, auto_send: true });
      onChanged(r.item);
      setNotice(`Saved — it will be sent automatically on ${new Date(fu.due_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`);
    } catch (e) {
      setError(errorText(e, 'Could not schedule the email.'));
    } finally {
      setBusy('');
    }
  };

  const dueInFuture = new Date(fu.due_at).getTime() > Date.now();

  return (
    <Modal wide title="Follow-up email" subtitle={`${fu.title}${fu.company_name ? ` · ${fu.company_name}` : ''}`} onClose={onClose} footer={<>
      <button className={btn.secondary} onClick={onClose}>Close</button>
      {dueInFuture && fu.status === 'Pending' && (
        <button className={btn.secondary} onClick={schedule} disabled={!!busy || !body.trim() || !sender?.configured}
          title="Save this email and send it automatically when the follow-up is due">
          {busy === 'schedule' ? <Loader2 size={14} className="animate-spin" /> : <CalendarPlus size={14} />} Send automatically when due
        </button>
      )}
      <button className={btn.primary} onClick={send} disabled={!!busy || !sender?.configured}>
        {busy === 'send' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send now
      </button>
    </>}>
      <div className="space-y-3">
        <div className={`rounded-xl px-3 py-2 text-xs ${sender?.configured
          ? 'border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
          : 'border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'}`}>
          {sender === null ? 'Checking the sending account…' : sender.configured
            ? <>Sends from <b>{sender.address}</b> ({sender.label}).</>
            : <>{sender.message} <a href="/email-agent?settings=email" className="font-bold underline">Open Email Agent settings</a></>}
        </div>
        {fu.notes && (
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-zinc-950 dark:text-zinc-300">
            <span className="font-bold">Previous discussion: </span>{fu.notes}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-500/30 dark:bg-violet-500/5">
          <div className="min-w-[150px] flex-1">
            <label className={label}>Extra instructions for the AI (optional)</label>
            <input className={input} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. mention the Q4 discount we discussed" />
          </div>
          <select className={`${input} w-auto`} value={tone} onChange={(e) => setTone(e.target.value)}>
            {['professional', 'friendly', 'concise', 'formal'].map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
          </select>
          <button className={btn.primary} onClick={draft} disabled={!!busy}>
            {busy === 'draft' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {body ? 'Redraft' : 'Draft'} from notes
          </button>
        </div>
        {engine === 'template' && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">AI is unavailable right now, so a personalized template was used — please review it before sending.</p>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr]">
          <div>
            <label className={label}>To</label>
            <input type="email" className={input} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className={label}>Subject</label>
            <input className={input} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
        </div>
        <div>
          <label className={label}>Message</label>
          {busy === 'draft' && !body ? (
            <div className="flex h-48 items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500 dark:border-zinc-700">
              <Loader2 size={14} className="animate-spin" /> Reading previous notes and drafting…
            </div>
          ) : (
            <textarea className={`${input} min-h-[220px] resize-y font-sans leading-relaxed`} value={body} onChange={(e) => setBody(e.target.value)} />
          )}
          <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">Your Email Agent signature is added automatically if it’s turned on.</p>
        </div>
        {fu.status === 'Pending' && (
          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-zinc-300">
            <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={complete} onChange={(e) => setComplete(e.target.checked)} />
            Mark this follow-up as completed after sending
          </label>
        )}
        {notice && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{notice}</p>}
        <ErrorNote text={error} />
      </div>
    </Modal>
  );
}
