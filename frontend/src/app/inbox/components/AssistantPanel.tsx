'use client';

import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUpRight, Bot, ListFilter, Loader2, RotateCcw, Send, Sparkles } from 'lucide-react';
import { inboxApi, type AssistantResult, type AssistantTurn, type InboxItem, errorText } from '@/lib/inboxApi';
import { formatWhen, senderLabel } from '@/components/email/emailUi';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  result?: AssistantResult;
  error?: boolean;
}

interface Props {
  aiEnabled: boolean;
  activeQuestion: string | null;
  onApply: (question: string, items: InboxItem[]) => void;
  onOpen: (item: InboxItem) => void;
}

const STARTERS = [
  'What needs my reply today?',
  'Summarize the pricing questions from this week',
  'Which clients emailed us in the last 7 days?',
  'Are any customers unhappy?',
  'Which leads replied to our proposals?',
  'Show unread emails from unknown senders',
];

const STORAGE_KEY = 'inbox_assistant_turns';

/** The Inbox's own AI assistant: answers questions about the mailbox and sorts the list to match. */
export default function AssistantPanel({ aiEnabled, activeQuestion, onApply, onOpen }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the conversation across navigation within this browser tab session.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setTurns(JSON.parse(saved));
    } catch {}
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-20))); } catch {}
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const history: AssistantTurn[] = turns.filter((t) => !t.error).slice(-8).map(({ role, text }) => ({ role, text }));
    setTurns((t) => [...t, { role: 'user', text: q }]);
    setInput('');
    setBusy(true);
    try {
      const result = await inboxApi.ask(q, history);
      setTurns((t) => [...t, { role: 'assistant', text: result.answer, result }]);
      if (result.items.length > 0) onApply(q, result.items);  // the list re-sorts to the answer right away
    } catch (e) {
      setTurns((t) => [...t, { role: 'assistant', text: errorText(e, 'Something went wrong. Please try again.'), error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const lastSuggestions = [...turns].reverse().find((t) => t.result)?.result?.suggestions || [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4 dark:border-zinc-700">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-md">
          <Bot size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-slate-900 dark:text-zinc-50">Inbox Assistant</p>
          <p className="text-[11px] text-slate-500 dark:text-zinc-400">Ask anything about your emails — I answer and sort the list for you.</p>
        </div>
        {turns.length > 0 && (
          <button type="button" onClick={() => setTurns([])} title="New conversation"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800">
            <RotateCcw size={14} />
          </button>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {!aiEnabled && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            AI is not configured on the server (OPENAI_API_KEY), so the assistant is unavailable.
          </p>
        )}

        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400">Try asking:</p>
            <div className="flex flex-col gap-2">
              {STARTERS.map((s) => (
                <button key={s} type="button" disabled={!aiEnabled || busy} onClick={() => ask(s)}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-[13px] font-semibold text-slate-700 hover:border-violet-300 hover:bg-violet-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-violet-500/10">
                  <Sparkles size={13} className="shrink-0 text-violet-500" /> {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          t.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 px-3.5 py-2 text-[13px] font-medium text-white">{t.text}</p>
            </div>
          ) : (
            <div key={i} className="space-y-2">
              <div className={`rounded-2xl rounded-bl-md border px-3.5 py-2.5 text-[13px] leading-relaxed ${t.error
                ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300'
                : 'border-slate-200 bg-white text-slate-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'}`}>
                {t.error ? t.text : (
                  <div className="[&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_strong]:font-bold [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{t.text}</ReactMarkdown>
                  </div>
                )}
              </div>
              {t.result && (t.result.applied_filters.length > 0 || t.result.relaxed) && (
                <p className="flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
                  <ListFilter size={11} />
                  {t.result.relaxed ? `No exact match — searched the ${t.result.considered} most recent emails` : `Searched: ${t.result.applied_filters.join(' · ')}`}
                </p>
              )}
              {t.result && t.result.items.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-violet-200 dark:border-violet-500/30">
                  {t.result.items.slice(0, 5).map((item) => (
                    <button key={item.key} type="button" onClick={() => onOpen(item)}
                      className="flex w-full items-center gap-2 border-b border-violet-100 bg-white px-3 py-2 text-left last:border-0 hover:bg-violet-50 dark:border-violet-500/20 dark:bg-zinc-900 dark:hover:bg-violet-500/10">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-slate-800 dark:text-zinc-100">{senderLabel(item)}</p>
                        <p className="truncate text-[11px] text-slate-500 dark:text-zinc-400">{item.subject}</p>
                      </div>
                      <span className="shrink-0 text-[10px] text-slate-400">{formatWhen(item.date)}</span>
                      <ArrowUpRight size={12} className="shrink-0 text-violet-500" />
                    </button>
                  ))}
                  <button type="button" onClick={() => onApply(turns[i - 1]?.text || '', t.result!.items)}
                    disabled={activeQuestion === (turns[i - 1]?.text || '')}
                    className="w-full bg-violet-50 px-3 py-2 text-[11px] font-bold text-violet-700 hover:bg-violet-100 disabled:cursor-default disabled:opacity-60 dark:bg-violet-500/10 dark:text-violet-300">
                    {activeQuestion === (turns[i - 1]?.text || '')
                      ? `Showing these ${t.result.items.length} in the list`
                      : `Sort the list by these ${t.result.items.length} result${t.result.items.length === 1 ? '' : 's'}`}
                  </button>
                </div>
              )}
            </div>
          )
        ))}

        {busy && (
          <p className="flex items-center gap-2 text-xs font-semibold text-violet-600 dark:text-violet-300">
            <Loader2 size={14} className="animate-spin" /> Reading your inbox…
          </p>
        )}
        {!busy && lastSuggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {lastSuggestions.map((s) => (
              <button key={s} type="button" onClick={() => ask(s)}
                className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50 dark:border-violet-500/30 dark:bg-zinc-900 dark:text-violet-300">
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); ask(input); }}
        className="border-t border-slate-200 p-3 dark:border-zinc-700"
      >
        <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 focus-within:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); } }}
            rows={2}
            maxLength={1000}
            disabled={!aiEnabled}
            placeholder="e.g. Which leads asked about pricing and are still waiting on us?"
            className="max-h-32 flex-1 resize-none bg-transparent px-1 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 dark:text-zinc-100"
          />
          <button type="submit" disabled={!input.trim() || busy || !aiEnabled}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40" title="Ask">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-slate-400">The assistant only reads emails you have access to. AI can be wrong — open emails before acting.</p>
      </form>
    </div>
  );
}
