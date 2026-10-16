'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Archive, ArchiveRestore, ArrowLeft, ChevronDown, CornerUpLeft, ExternalLink, Loader2, Mail, MailOpen, Paperclip,
  RefreshCw, Send, Sparkles, Star, X,
} from 'lucide-react';
import { inboxApi, isCancelled, type InboxItem, type InboxMessage, type ThreadSummary, errorText } from '@/lib/inboxApi';
import {
  Avatar, CategoryChip, EmailBody, NeedsReplyChip, PriorityChip, RecordChips, StatusPill, formatFull, recordHref,
} from '@/components/email/emailUi';

interface Props {
  messageKey: string;
  aiEnabled: boolean;
  onClose: () => void;
  onChanged: (item: InboxItem) => void;   // flags changed / reply sent — parent refreshes list + counts
}

const TONES = ['professional', 'friendly', 'concise', 'formal'];

function ThreadMessage({ m, defaultOpen }: { m: InboxMessage; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const outbound = m.direction === 'outbound';
  return (
    <article className={`rounded-2xl border ${outbound
      ? 'border-slate-200 bg-slate-50/70 dark:border-zinc-700 dark:bg-zinc-800/40'
      : 'border-slate-200 bg-white dark:border-zinc-700 dark:bg-zinc-900'}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <Avatar name={m.from_name} address={m.from_address || m.to} outbound={outbound} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[13px] font-bold text-slate-800 dark:text-zinc-100">
              {outbound ? (m.sent_by || 'You') : (m.from_name || m.from_address)}
            </span>
            {!outbound && m.from_name && <span className="text-[11px] text-slate-400">&lt;{m.from_address}&gt;</span>}
            <span className="ml-auto text-[11px] text-slate-400">{formatFull(m.date)}</span>
          </div>
          <p className="truncate text-[11px] text-slate-500 dark:text-zinc-400">
            to {m.to || '—'}{m.cc ? ` · cc ${m.cc}` : ''}
          </p>
          {!open && <p className="mt-1 truncate text-xs text-slate-500 dark:text-zinc-400">{m.snippet}</p>}
        </div>
        {outbound && <StatusPill item={m} />}
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 py-3 dark:border-zinc-800">
          <EmailBody text={m.body_text} fullText={m.body_text_full} html={m.body_html} />
          {m.attachments?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {m.attachments.map((a, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  title="Attachments stay in the mailbox; open it there to download.">
                  <Paperclip size={11} /> {a.filename}{a.size ? ` · ${Math.max(1, Math.round(a.size / 1024))} KB` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function MessageDetail({ messageKey, aiEnabled, onClose, onChanged }: Props) {
  const [message, setMessage] = useState<InboxMessage | null>(null);
  const [thread, setThread] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<ThreadSummary | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState('');

  const [replyOpen, setReplyOpen] = useState(false);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [instructions, setInstructions] = useState('');
  const [tone, setTone] = useState('professional');
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyNote, setReplyNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  // Held in a ref so a parent re-render (new callback identity) never re-triggers the load effect.
  const onChangedRef = useRef(onChanged);
  useEffect(() => { onChangedRef.current = onChanged; });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await inboxApi.message(messageKey);
      setMessage(data.message);
      setThread(data.thread);
      if (data.message.direction === 'inbound') onChangedRef.current(data.message);  // opening marks it read
    } catch (e) {
      setError(errorText(e, 'Could not open this email.'));
    } finally {
      setLoading(false);
    }
  }, [messageKey]);

  useEffect(() => {
    setSummary(null);
    setSummaryError('');
    setReplyOpen(false);
    setReplyNote(null);
    setShowOlder(false);
    load();
  }, [load]);

  const startReply = () => {
    if (!message) return;
    const counterpart = message.direction === 'inbound' ? message.from_address : message.to;
    setTo(counterpart || '');
    setCc('');
    setSubject(/^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`);
    setBody('');
    setReplyNote(null);
    setReplyOpen(true);
  };

  const setFlag = async (flags: Partial<Pick<InboxItem, 'is_read' | 'is_starred' | 'is_archived'>>) => {
    if (!message) return;
    try {
      const { item } = await inboxApi.flags(message.key, flags);
      setMessage({ ...message, ...item });
      onChangedRef.current(item);
    } catch (e) {
      setError(errorText(e, 'Could not update this email.'));
    }
  };

  const summarize = async (refresh = false) => {
    setSummarizing(true);
    setSummaryError('');
    try {
      setSummary(await inboxApi.summarizeThread(messageKey, refresh));
    } catch (e) {
      setSummaryError(errorText(e, 'Could not summarize this conversation.'));
    } finally {
      setSummarizing(false);
    }
  };

  const draft = async () => {
    setDrafting(true);
    setReplyNote(null);
    try {
      const d = await inboxApi.draftReply(messageKey, instructions, tone);
      setSubject(d.subject || subject);
      setBody(d.body);
    } catch (e) {
      setReplyNote({ kind: 'error', text: errorText(e, 'Could not draft a reply.') });
    } finally {
      setDrafting(false);
    }
  };

  const send = async () => {
    setSending(true);
    setReplyNote(null);
    try {
      const result = await inboxApi.reply(messageKey, { to, cc: cc || undefined, subject, body });
      if (isCancelled(result)) return;
      setReplyNote({ kind: 'ok', text: `Reply sent to ${to}.` });
      setReplyOpen(false);
      setBody('');
      onChangedRef.current(result.item);
      await load();
    } catch (e) {
      setReplyNote({ kind: 'error', text: errorText(e, 'The reply could not be sent.') });
    } finally {
      setSending(false);
    }
  };

  if (loading && !message) {
    return <div className="flex h-full items-center justify-center gap-2 text-xs font-semibold text-slate-400"><Loader2 size={16} className="animate-spin" /> Opening email…</div>;
  }
  if (error && !message) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm font-bold text-red-600">{error}</p>
        <button type="button" onClick={onClose} className="mt-3 text-xs font-bold text-indigo-600">Close</button>
      </div>
    );
  }
  if (!message) return null;

  const older = thread.length > 2 && !showOlder ? thread.slice(0, -2) : [];
  const visible = older.length ? thread.slice(-2) : thread;
  const recordLink = message.client
    ? { href: recordHref('client', message.client.id, 'email'), label: 'Open client' }
    : message.lead ? { href: recordHref('lead', message.lead.id, 'email'), label: 'Open lead' } : null;
  const iconBtn = 'rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-slate-200 px-5 py-4 dark:border-zinc-700">
        <div className="mb-2 flex items-center gap-1">
          <button type="button" onClick={onClose} className={iconBtn} title="Close"><ArrowLeft size={16} /></button>
          <div className="ml-auto flex items-center gap-0.5">
            {message.direction === 'inbound' && (
              <>
                <button type="button" className={iconBtn} title={message.is_starred ? 'Unstar' : 'Star'} onClick={() => setFlag({ is_starred: !message.is_starred })}>
                  <Star size={16} className={message.is_starred ? 'fill-amber-400 text-amber-400' : ''} />
                </button>
                <button type="button" className={iconBtn} title="Mark as unread" onClick={() => setFlag({ is_read: false })}><Mail size={16} /></button>
                <button type="button" className={iconBtn} title={message.is_archived ? 'Move back to inbox' : 'Archive'} onClick={() => setFlag({ is_archived: !message.is_archived })}>
                  {message.is_archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                </button>
              </>
            )}
            {recordLink && (
              <Link href={recordLink.href} className="ml-1 flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                <ExternalLink size={12} /> {recordLink.label}
              </Link>
            )}
          </div>
        </div>
        <h2 className="text-lg font-black leading-snug text-slate-900 dark:text-zinc-50">{message.subject}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <NeedsReplyChip item={message} />
          <PriorityChip priority={message.ai?.priority} />
          <CategoryChip category={message.ai?.category} />
          <StatusPill item={message} />
          <RecordChips lead={message.lead} client={message.client} tab="email" />
        </div>
        {message.ai?.summary && (
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-snug text-violet-700 dark:text-violet-300">
            <Sparkles size={12} className="mt-0.5 shrink-0" /> {message.ai.summary}
          </p>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {/* Conversation summary */}
        {thread.length > 0 && (
          <div className="rounded-2xl border border-violet-200 bg-violet-50/70 dark:border-violet-500/30 dark:bg-violet-500/10">
            <div className="flex items-center gap-2 px-4 py-2.5">
              <Sparkles size={14} className="text-violet-600 dark:text-violet-300" />
              <p className="flex-1 text-xs font-black uppercase tracking-wider text-violet-700 dark:text-violet-300">
                Conversation summary {thread.length > 1 ? `· ${thread.length} emails` : ''}
              </p>
              {summary ? (
                <button type="button" onClick={() => summarize(true)} disabled={summarizing} title="Regenerate"
                  className="rounded-md p-1 text-violet-600 hover:bg-violet-100 disabled:opacity-50 dark:text-violet-300 dark:hover:bg-violet-500/20">
                  {summarizing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                </button>
              ) : (
                <button type="button" onClick={() => summarize(false)} disabled={summarizing || !aiEnabled}
                  className="flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-violet-700 disabled:opacity-50">
                  {summarizing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Summarize
                </button>
              )}
            </div>
            {summaryError && <p className="px-4 pb-2.5 text-xs font-semibold text-red-600">{summaryError}</p>}
            {summary && (
              <div className="space-y-2 border-t border-violet-200 px-4 py-3 text-[13px] dark:border-violet-500/30">
                <p className="leading-relaxed text-slate-700 dark:text-zinc-300">{summary.summary.summary}</p>
                {summary.summary.key_points.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-5 text-slate-600 dark:text-zinc-400">
                    {summary.summary.key_points.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                )}
                {summary.summary.open_questions.length > 0 && (
                  <p className="text-xs text-slate-600 dark:text-zinc-400"><b>Open questions:</b> {summary.summary.open_questions.join(' · ')}</p>
                )}
                {summary.summary.next_step && (
                  <p className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-violet-800 dark:bg-zinc-900 dark:text-violet-200">
                    Next step: {summary.summary.next_step}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {older.length > 0 && (
          <button type="button" onClick={() => setShowOlder(true)}
            className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
            <ChevronDown size={13} /> Show {older.length} earlier email{older.length === 1 ? '' : 's'}
          </button>
        )}
        {visible.map((m) => <ThreadMessage key={m.key} m={m} defaultOpen={m.key === message.key || m === visible[visible.length - 1]} />)}

        {replyNote && (
          <p className={`rounded-xl px-3 py-2 text-xs font-semibold ${replyNote.kind === 'ok'
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
            : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'}`}>
            {replyNote.text}
          </p>
        )}

        {/* Reply */}
        {!replyOpen ? (
          <button type="button" onClick={startReply}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800">
            <CornerUpLeft size={15} /> {message.direction === 'inbound' ? 'Reply' : 'Follow up'}
          </button>
        ) : (
          <div className="rounded-2xl border border-indigo-200 bg-white shadow-sm dark:border-indigo-500/30 dark:bg-zinc-900">
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-zinc-800">
              <MailOpen size={14} className="text-indigo-600" />
              <span className="flex-1 text-xs font-black uppercase tracking-wider text-slate-500">Reply</span>
              <button type="button" onClick={() => setReplyOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800"><X size={14} /></button>
            </div>
            <div className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-violet-50 p-2 dark:bg-violet-500/10">
                <input value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={2000}
                  placeholder="Tell the AI what to say (optional) — e.g. “offer a call on Thursday”"
                  className="min-w-45 flex-1 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-violet-500 dark:border-violet-500/30 dark:bg-zinc-900 dark:text-zinc-100" />
                <select value={tone} onChange={(e) => setTone(e.target.value)}
                  className="rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-xs capitalize dark:border-violet-500/30 dark:bg-zinc-900 dark:text-zinc-100">
                  {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <button type="button" onClick={draft} disabled={drafting || !aiEnabled}
                  className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50">
                  {drafting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {body ? 'Redraft' : 'Draft with AI'}
                </button>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <span className="w-10 font-bold">To</span>
                <input value={to} onChange={(e) => setTo(e.target.value)} className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[13px] text-slate-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <span className="w-10 font-bold">Cc</span>
                <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="optional, comma-separated" className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[13px] text-slate-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <span className="w-10 font-bold">Subject</span>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[13px] text-slate-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" />
              </label>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} maxLength={20000}
                placeholder="Write your reply, or let the AI draft it from this conversation…"
                className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] leading-relaxed text-slate-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-slate-400">Sent from the CRM mailbox with open tracking; logged on the linked lead/client.</p>
                <button type="button" onClick={send} disabled={sending || !to.trim() || !subject.trim() || !body.trim()}
                  className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
