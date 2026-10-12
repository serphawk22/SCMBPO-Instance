'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, ArrowDownLeft, ArrowUpRight, Brain, CalendarClock, CalendarDays, Check, ChevronDown, Copy, CornerUpLeft,
  ExternalLink, Handshake, HeartHandshake, Inbox, Loader2, Mail, MessagesSquare, PenLine, RefreshCw, Send, Sparkles,
  StickyNote, Undo2, X, type LucideIcon,
} from 'lucide-react';
import {
  ApiError, composerApi, errorText, inboxApi, isCancelled,
  type ComposerContext, type ComposerInclude, type Draft, type InboxItem, type InboxMessage, type RecordHistory, type RecordKind,
} from '@/lib/inboxApi';
import { EmailBody, StatusPill, formatFull, formatWhen } from './emailUi';

const PURPOSES = [
  { key: 'follow_up', label: 'Follow-up', hint: 'Pending tasks & promised next steps', icon: CalendarClock },
  { key: 'deal_update', label: 'Deal update', hint: 'Deals, quotes, proposals, invoices', icon: Handshake },
  { key: 'conversation_recap', label: 'Conversation recap', hint: 'Recap the last call or meeting', icon: MessagesSquare },
  { key: 'check_in', label: 'Check-in', hint: 'Keep the relationship warm', icon: HeartHandshake },
  { key: 'intro', label: 'Introduction', hint: 'First outreach', icon: Sparkles },
  { key: 'custom', label: 'Custom', hint: 'Describe it yourself', icon: PenLine },
];
const TONES = ['professional', 'friendly', 'concise', 'formal'];
const ALL_INCLUDED: ComposerInclude = { conversations: true, followups: true, deals: true, notes: true, meetings: true, emails: true, research: true };

interface Props {
  kind: RecordKind;
  recordId: string;
}

function ContextSection({ title, icon: Icon, count, included, onToggle, children }: {
  title: string; icon: LucideIcon; count: number; included: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(count > 0 && count <= 3);
  return (
    <div className="border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <input type="checkbox" checked={included} onChange={onToggle} disabled={count === 0}
          title="Let the AI use this when drafting" className="h-3.5 w-3.5 accent-indigo-600" />
        <button type="button" onClick={() => setOpen((o) => !o)} disabled={count === 0}
          className="flex flex-1 items-center gap-2 text-left disabled:cursor-default">
          <Icon size={14} className={count ? 'text-indigo-500' : 'text-slate-300'} />
          <span className={`flex-1 text-xs font-bold ${count ? 'text-slate-700' : 'text-slate-400'}`}>{title}</span>
          <span className={`rounded-full px-1.5 text-[10px] font-black leading-4.5 ${count ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>{count}</span>
          {count > 0 && <ChevronDown size={13} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />}
        </button>
      </div>
      {open && count > 0 && <div className="space-y-1.5 px-4 pb-3">{children}</div>}
    </div>
  );
}

function ContextItem({ title, meta, detail, onDraft }: { title: string; meta?: string | null; detail?: string | null; onDraft?: () => void }) {
  return (
    <div className="group rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold leading-snug text-slate-700">{title}</p>
          {meta && <p className="mt-0.5 text-[10.5px] text-slate-400">{meta}</p>}
          {detail && <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500">{detail}</p>}
        </div>
        {onDraft && (
          <button type="button" onClick={onDraft} title="Draft an email about this"
            className="shrink-0 rounded-md bg-white px-1.5 py-1 text-[10px] font-bold text-violet-600 opacity-80 shadow-sm ring-1 ring-violet-100 hover:bg-violet-50 group-hover:opacity-100">
            <Sparkles size={11} className="inline" /> Draft
          </button>
        )}
      </div>
    </div>
  );
}

const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '');

export default function RecordEmailTab({ kind, recordId }: Props) {
  const noun = kind === 'leads' ? 'lead' : 'client';
  const [ctx, setCtx] = useState<ComposerContext | null>(null);
  const [history, setHistory] = useState<RecordHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ status: number; text: string } | null>(null);

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [purpose, setPurpose] = useState('follow_up');
  const [tone, setTone] = useState('professional');
  const [instructions, setInstructions] = useState('');
  const [include, setInclude] = useState<ComposerInclude>(ALL_INCLUDED);
  const [focus, setFocus] = useState<{ key: string; label: string } | null>(null);
  const [replyTo, setReplyTo] = useState<InboxItem | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [previous, setPrevious] = useState<Draft | null>(null);
  const [logConversation, setLogConversation] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [openMessage, setOpenMessage] = useState<InboxMessage | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const [c, h] = await Promise.all([composerApi.context(kind, recordId), composerApi.history(kind, recordId)]);
      setCtx(c);
      setHistory(h);
      setLoadError(null);
      if (initial) {
        setPurpose(c.suggested_purpose);
        setTo((current) => current || c.recipients[0]?.email || '');
      }
    } catch (e) {
      setLoadError({ status: e instanceof ApiError ? e.status : 0, text: errorText(e, 'Could not load email data.') });
    } finally {
      if (initial) setLoading(false);
    }
  }, [kind, recordId]);

  useEffect(() => { load(true); }, [load]);

  const generate = async (opts?: { purpose?: string; focus?: { key: string; label: string } | null }) => {
    const usePurpose = opts?.purpose || purpose;
    const useFocus = opts && 'focus' in opts ? opts.focus : focus;
    if (usePurpose === 'custom' && !instructions.trim()) {
      setNote({ kind: 'error', text: 'For a custom email, describe what you want in the instructions box first.' });
      return;
    }
    setDrafting(true);
    setNote(null);
    try {
      const d = await composerApi.draft(kind, recordId, {
        purpose: usePurpose, tone, instructions: instructions.trim() || undefined, to: to || undefined, include,
        focus_key: useFocus?.key || null, reply_to_key: replyTo?.key || null,
      });
      if (subject || body) setPrevious({ subject, body });
      setSubject(d.subject);
      setBody(d.body);
    } catch (e) {
      setNote({ kind: 'error', text: errorText(e, 'Could not generate a draft.') });
    } finally {
      setDrafting(false);
    }
  };

  const draftAbout = (key: string, label: string, forPurpose: string) => {
    const f = { key, label };
    setFocus(f);
    setPurpose(forPurpose);
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    generate({ purpose: forPurpose, focus: f });
  };

  const startReply = (item: InboxItem) => {
    setReplyTo(item);
    setPurpose('reply');
    setFocus(null);
    setTo(item.from_address || to);
    setSubject(/^re:/i.test(item.subject) ? item.subject : `Re: ${item.subject}`);
    setBody('');
    setNote(null);
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const send = async () => {
    setSending(true);
    setNote(null);
    try {
      const result = await composerApi.send(kind, recordId, {
        to, cc: cc || undefined, subject, body, purpose, log_conversation: logConversation, reply_to_key: replyTo?.key || null,
      });
      if (isCancelled(result)) return;
      setNote({ kind: 'ok', text: result.message || `Email sent to ${to}.` });
      setSubject('');
      setBody('');
      setPrevious(null);
      setFocus(null);
      setReplyTo(null);
      if (purpose === 'reply') setPurpose(ctx?.suggested_purpose || 'follow_up');
      setCc('');
      await load();
      // Let the page refresh its timeline / conversations / activity.
      window.dispatchEvent(new Event(kind === 'leads' ? 'refresh-lead-data' : 'refresh-client-data'));
    } catch (e) {
      setNote({ kind: 'error', text: errorText(e, 'The email could not be sent.') });
    } finally {
      setSending(false);
    }
  };

  const toggleOpen = async (item: InboxItem) => {
    if (openKey === item.key) {
      setOpenKey(null);
      return;
    }
    setOpenKey(item.key);
    setOpenMessage(null);
    setOpenLoading(true);
    try {
      setOpenMessage((await inboxApi.message(item.key)).message);
    } catch {
      setOpenMessage(null);
    } finally {
      setOpenLoading(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-indigo-200 bg-white px-5 py-10 text-sm font-semibold text-indigo-600 shadow-sm">
        <Loader2 size={18} className="animate-spin" /> Loading email history and context…
      </div>
    );
  }
  if (loadError || !ctx) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
        <AlertCircle size={18} className="mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-bold">{loadError?.status === 403 ? `You can't email this ${noun}` : 'Email is unavailable'}</p>
          <p className="text-xs">{loadError?.text}</p>
          {loadError?.status !== 403 && (
            <button type="button" onClick={() => load(true)} className="mt-2 text-xs font-bold underline">Try again</button>
          )}
        </div>
      </div>
    );
  }

  const c = ctx.context;
  const counts: Record<string, number> = {
    follow_up: c.followups.length, deal_update: c.deals.length, conversation_recap: c.conversations.length + c.meetings.length,
  };
  const canSend = ctx.sender.configured && !!to.trim() && !!subject.trim() && !!body.trim();
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const flip = (k: keyof ComposerInclude) => setInclude((i) => ({ ...i, [k]: !i[k] }));
  const input = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 outline-none transition focus:border-indigo-500 focus:bg-white';

  return (
    <div className="space-y-5">
      {/* ── Header, matching the AI DATA tab ── */}
      <section className="overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <Mail size={20} />
            <div>
              <h2 className="text-base font-black tracking-tight">EMAIL</h2>
              <p className="text-xs text-indigo-100">AI-written emails grounded in this {noun}’s conversations, deals and follow-ups</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {history && (
              <span className="rounded-lg bg-white/15 px-2.5 py-1.5 font-bold">
                {history.stats.sent} sent · {history.stats.opened} opened · {history.stats.replied} replied · {history.stats.received} received
              </span>
            )}
            <button type="button" onClick={() => load()} className="flex items-center gap-1 rounded-lg bg-white/15 px-2.5 py-1.5 font-bold hover:bg-white/25">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>
        {!ctx.sender.configured && (
          <div className="flex items-start gap-2 bg-amber-50 px-5 py-2.5 text-xs text-amber-800">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>Sending isn’t configured yet — connect your own email account in <Link href="/email-agent?settings=email" className="font-bold underline">Email Agent → Settings</Link> (email + app password). Everything you send, receive and track then uses it. You can still draft here and use “Open in mail app”.</span>
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* ── Composer ── */}
        <section ref={composerRef} className="scroll-mt-40 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">What is this email about?</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PURPOSES.map((p) => {
              const active = purpose === p.key;
              const n = counts[p.key];
              return (
                <button key={p.key} type="button" onClick={() => { setPurpose(p.key); setFocus(null); }}
                  className={`relative rounded-xl border px-3 py-2.5 text-left transition ${active
                    ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                    : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50'}`}>
                  <div className="flex items-center gap-1.5">
                    <p.icon size={14} className={active ? 'text-indigo-600' : 'text-slate-400'} />
                    <span className={`text-[12.5px] font-bold ${active ? 'text-indigo-700' : 'text-slate-700'}`}>{p.label}</span>
                    {n > 0 && <span className="ml-auto rounded-full bg-indigo-100 px-1.5 text-[10px] font-black text-indigo-700">{n}</span>}
                  </div>
                  <p className="mt-0.5 text-[10.5px] leading-snug text-slate-400">{p.hint}</p>
                  {ctx.suggested_purpose === p.key && (
                    <span className="absolute -top-2 right-2 rounded-full bg-violet-600 px-1.5 py-0.5 text-[8.5px] font-black uppercase tracking-wider text-white">Suggested</span>
                  )}
                </button>
              );
            })}
          </div>

          {(focus || replyTo) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {focus && (
                <span className="flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200">
                  <Sparkles size={11} /> About: {focus.label}
                  <button type="button" onClick={() => setFocus(null)} title="Remove"><X size={11} /></button>
                </span>
              )}
              {replyTo && (
                <span className="flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-200">
                  <CornerUpLeft size={11} /> Replying to “{replyTo.subject}”
                  <button type="button" onClick={() => { setReplyTo(null); if (purpose === 'reply') setPurpose(ctx.suggested_purpose); }} title="Remove"><X size={11} /></button>
                </span>
              )}
            </div>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_160px]">
            <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} maxLength={2000}
              placeholder={purpose === 'custom' ? 'Describe the email you want…' : 'Anything specific to mention? (optional) — e.g. “offer 10% if they sign this month”'}
              className={`${input} resize-none`} />
            <div className="flex flex-col gap-2">
              <select value={tone} onChange={(e) => setTone(e.target.value)} className={`${input} capitalize`} aria-label="Tone">
                {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button type="button" onClick={() => generate()} disabled={drafting || !ctx.ai_enabled}
                title={!ctx.ai_enabled ? 'AI is not configured on the server' : undefined}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50">
                {drafting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {drafting ? 'Writing…' : body ? 'Rewrite with AI' : 'Generate with AI'}
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-4">
            <label className="flex items-center gap-3">
              <span className="w-14 text-xs font-bold text-slate-500">To</span>
              <input value={to} onChange={(e) => setTo(e.target.value)} list={`recipients-${kind}-${recordId}`}
                placeholder="name@company.com" className={input} />
              <datalist id={`recipients-${kind}-${recordId}`}>
                {ctx.recipients.map((r) => <option key={r.email} value={r.email}>{[r.name, r.source].filter(Boolean).join(' · ')}</option>)}
              </datalist>
            </label>
            {ctx.recipients.length > 1 && (
              <div className="flex flex-wrap gap-1.5 pl-17">
                {ctx.recipients.map((r) => (
                  <button key={r.email} type="button" onClick={() => setTo(r.email)} title={r.source}
                    className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ${to === r.email ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}>
                    {r.name ? `${r.name} · ` : ''}{r.email}
                  </button>
                ))}
              </div>
            )}
            <label className="flex items-center gap-3">
              <span className="w-14 text-xs font-bold text-slate-500">Cc</span>
              <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="optional, comma-separated" className={input} />
            </label>
            <label className="flex items-center gap-3">
              <span className="w-14 text-xs font-bold text-slate-500">Subject</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} placeholder="Subject" className={input} />
            </label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} maxLength={20000}
              placeholder={`Write your email, or pick a purpose above and click “Generate with AI” to draft it from this ${noun}’s history.`}
              className={`${input} resize-y leading-relaxed`} />
          </div>

          {note && (
            <p className={`mt-3 rounded-xl px-3 py-2 text-xs font-semibold ${note.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{note.text}</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={send} disabled={!canSend || sending}
              title={!ctx.sender.configured ? 'Sending is not configured' : undefined}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send email
            </button>
            {previous && (
              <button type="button" onClick={() => { setSubject(previous.subject); setBody(previous.body); setPrevious(null); }}
                className="flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100">
                <Undo2 size={13} /> Undo AI rewrite
              </button>
            )}
            <button type="button" onClick={copy} disabled={!body}
              className="flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-40">
              {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
            </button>
            <a href={mailto} className={`flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 ${!to ? 'pointer-events-none opacity-40' : ''}`}>
              <ExternalLink size={13} /> Open in mail app
            </a>
            <label className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
              <input type="checkbox" checked={logConversation} onChange={(e) => setLogConversation(e.target.checked)} className="h-3.5 w-3.5 accent-indigo-600" />
              Log in Conversations
            </label>
          </div>
          <p className="mt-2 text-[10.5px] text-slate-400">
            From {ctx.sender.address || 'your mailbox'}{ctx.sender.label ? ` (${ctx.sender.label})` : ''} as {ctx.sender.user_name} · open tracking on · replies show up in the Inbox and below.
          </p>
        </section>

        {/* ── What the AI uses ── */}
        <aside className="h-fit overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
            <Brain size={15} className="text-violet-600" />
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-slate-700">What the AI uses</p>
              <p className="text-[10.5px] text-slate-400">Untick anything you want left out</p>
            </div>
          </div>
          <ContextSection title="Follow-ups & tasks" icon={CalendarClock} count={c.followups.length} included={include.followups} onToggle={() => flip('followups')}>
            {c.followups.map((f) => (
              <ContextItem key={f.key} title={f.title}
                meta={[f.source, f.due ? `due ${f.due}` : null, f.status].filter(Boolean).join(' · ')}
                detail={f.detail && f.detail !== f.title ? f.detail : null}
                onDraft={() => draftAbout(f.key, f.title, 'follow_up')} />
            ))}
          </ContextSection>
          <ContextSection title="Deals, quotes & invoices" icon={Handshake} count={c.deals.length} included={include.deals} onToggle={() => flip('deals')}>
            {c.deals.map((d) => (
              <ContextItem key={d.key} title={`${d.kind}: ${d.title}`}
                meta={[d.status, d.amount, d.detail].filter(Boolean).join(' · ')}
                onDraft={() => draftAbout(d.key, `${d.kind} ${d.title}`, 'deal_update')} />
            ))}
          </ContextSection>
          <ContextSection title="Conversations" icon={MessagesSquare} count={c.conversations.length} included={include.conversations} onToggle={() => flip('conversations')}>
            {c.conversations.map((cv) => (
              <ContextItem key={cv.key} title={cv.title} meta={[cv.type, day(cv.date), cv.author].filter(Boolean).join(' · ')}
                detail={cv.description} onDraft={() => draftAbout(cv.key, cv.title, 'conversation_recap')} />
            ))}
          </ContextSection>
          <ContextSection title="Meetings" icon={CalendarDays} count={c.meetings.length} included={include.meetings} onToggle={() => flip('meetings')}>
            {c.meetings.map((m) => (
              <ContextItem key={m.key} title={m.title} meta={[m.type, m.status, day(m.date)].filter(Boolean).join(' · ')}
                detail={m.outcome} onDraft={() => draftAbout(m.key, m.title, 'conversation_recap')} />
            ))}
          </ContextSection>
          <ContextSection title="Notes" icon={StickyNote} count={c.notes.length} included={include.notes} onToggle={() => flip('notes')}>
            {c.notes.map((n) => <ContextItem key={n.key} title={n.content} meta={[day(n.date), n.author].filter(Boolean).join(' · ')} />)}
          </ContextSection>
          <ContextSection title="Recent emails" icon={Inbox} count={c.emails.length} included={include.emails} onToggle={() => flip('emails')}>
            {c.emails.map((e) => (
              <ContextItem key={e.key} title={e.subject}
                meta={`${e.direction === 'inbound' ? `from ${e.from_address}` : `to ${e.to}`} · ${day(e.date)}`} detail={e.ai?.summary || e.snippet} />
            ))}
          </ContextSection>
          <ContextSection title="Company research" icon={Brain} count={c.research ? 1 : 0} included={include.research} onToggle={() => flip('research')}>
            {c.research && <ContextItem title="AI research overview" detail={c.research.overview || c.research.pain_points} />}
          </ContextSection>
        </aside>
      </div>

      {/* ── History ── */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-sm font-black text-slate-800">Email history</h3>
          <Link href="/inbox" className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline"><Inbox size={13} /> Open Inbox</Link>
        </div>
        {!history || history.items.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">No emails with this {noun} yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {history.items.map((item) => {
              const inbound = item.direction === 'inbound';
              const isOpen = openKey === item.key;
              return (
                <li key={item.key}>
                  <button type="button" onClick={() => toggleOpen(item)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${inbound ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'}`}>
                      {inbound ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-[13px] ${inbound && !item.is_read ? 'font-black text-slate-900' : 'font-semibold text-slate-700'}`}>{item.subject}</p>
                      <p className="truncate text-[11px] text-slate-400">
                        {inbound ? `From ${item.from_name || item.from_address}` : `To ${item.to}`} · {item.ai?.summary || item.snippet}
                      </p>
                    </div>
                    <StatusPill item={item} />
                    <span className="shrink-0 text-[11px] text-slate-400">{formatWhen(item.date)}</span>
                    <ChevronDown size={14} className={`shrink-0 text-slate-300 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOpen && (
                    <div className="space-y-3 bg-slate-50/60 px-5 pb-4 pt-1">
                      {openLoading ? (
                        <p className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={13} className="animate-spin" /> Loading…</p>
                      ) : openMessage ? (
                        <>
                          <p className="text-[11px] text-slate-500">
                            {inbound ? `From ${openMessage.from_name ? `${openMessage.from_name} <${openMessage.from_address}>` : openMessage.from_address}` : `Sent by ${openMessage.sent_by || 'the team'} to ${openMessage.to}`}
                            {' · '}{formatFull(openMessage.date)}
                            {!inbound && openMessage.opened_at ? ` · first opened ${formatFull(openMessage.opened_at)}` : ''}
                          </p>
                          <div className="rounded-xl border border-slate-200 bg-white p-3">
                            <EmailBody text={openMessage.body_text} fullText={openMessage.body_text_full} html={openMessage.body_html} height={280} />
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-red-600">Could not load this email.</p>
                      )}
                      <div className="flex gap-2">
                        {inbound && (
                          <button type="button" onClick={() => startReply(item)}
                            className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700">
                            <CornerUpLeft size={12} /> Reply with AI
                          </button>
                        )}
                        <Link href={`/inbox?message=${item.key}`} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100">
                          <ExternalLink size={12} /> Open in Inbox
                        </Link>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
