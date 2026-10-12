'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Bot, CheckCheck, Inbox as InboxIcon, Loader2, Mail, RefreshCw, Search, X } from 'lucide-react';
import { useRole } from '@/context/RoleContext';
import { inboxApi, type InboxCounts, type InboxFilters, type InboxItem, type InboxStatus, errorText } from '@/lib/inboxApi';
import { CATEGORY_META } from '@/components/email/emailUi';
import FilterRail, { FOLDERS, LINKED } from './components/FilterRail';
import MessageList from './components/MessageList';
import MessageDetail from './components/MessageDetail';
import AssistantPanel from './components/AssistantPanel';
import ViewSummaryCard from './components/ViewSummaryCard';

const INBOX_ROLES = ['Admin', 'SuperAdmin', 'Demo', 'SalesManager', 'Employee'];
const PAGE = 50;

function filtersFromUrl(): { filters: InboxFilters; message: string | null } {
  if (typeof window === 'undefined') return { filters: { folder: 'all' }, message: null };
  const p = new URLSearchParams(window.location.search);
  const folder = p.get('folder');
  return {
    filters: {
      folder: FOLDERS.some((f) => f.key === folder) ? folder! : 'all',
      linked: p.get('linked'),
      category: p.get('category'),
      priority: p.get('priority'),
      q: p.get('q'),
    },
    message: p.get('message'),
  };
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

function timeAgo(iso?: string | null) {
  if (!iso) return 'not yet';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs} h ago` : new Date(iso).toLocaleDateString();
}

export default function InboxPage() {
  const { role, loading: roleLoading } = useRole();
  const allowed = INBOX_ROLES.includes(role);
  const wide = useMediaQuery('(min-width: 1536px)');
  const narrow = !useMediaQuery('(min-width: 1024px)');

  const [filters, setFilters] = useState<InboxFilters>({ folder: 'all' });
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<InboxItem[]>([]);
  const [total, setTotal] = useState(0);
  const [viewLabel, setViewLabel] = useState('All mail');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [status, setStatus] = useState<InboxStatus | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [panel, setPanel] = useState<'assistant' | 'message'>('assistant');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [aiResults, setAiResults] = useState<{ question: string; items: InboxItem[] } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // ── Initial state from the URL (deep links like /inbox?folder=needs_reply or ?message=in-12)
  useEffect(() => {
    const { filters: f, message } = filtersFromUrl();
    setFilters(f);
    setSearch(f.q || '');
    if (message) {
      setSelectedKey(message);
      setPanel('message');
      setDrawerOpen(true);
    }
  }, []);

  // Mirror the current view into the URL so refresh / bookmarks keep it.
  useEffect(() => {
    const p = new URLSearchParams();
    if (filters.folder !== 'all') p.set('folder', filters.folder);
    (['linked', 'category', 'priority', 'q'] as const).forEach((k) => { if (filters[k]) p.set(k, String(filters[k])); });
    if (selectedKey) p.set('message', selectedKey);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `/inbox?${qs}` : '/inbox');
  }, [filters, selectedKey]);

  // Debounced search box → filters.q
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => ((f.q || '') === search.trim() ? f : { ...f, q: search.trim() || null }));
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const loadCounts = useCallback(async () => {
    try { setCounts(await inboxApi.counts()); } catch {}
    window.dispatchEvent(new Event('inbox-unread-changed'));  // sidebar badge
  }, []);

  const loadPage = useCallback(async (offset: number, silent = false) => {
    const f = filtersRef.current;
    if (!silent) setLoading(true);
    setListError('');
    try {
      const data = await inboxApi.list(f, PAGE, offset);
      if (filtersRef.current !== f) return;  // a newer filter change won the race
      setItems((prev) => (offset === 0 ? data.items : [...prev, ...data.items]));
      setTotal(data.total);
      setViewLabel(data.view);
    } catch (e) {
      setListError(errorText(e, 'Could not load emails.'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    setAiResults(null);
    setItems([]);  // never show the previous view's emails under the new filter while it loads
    loadPage(0);
  }, [filters, allowed, loadPage]);

  useEffect(() => {
    if (!allowed) return;
    loadCounts();
    inboxApi.status().then(setStatus).catch(() => {});
  }, [allowed, loadCounts]);

  // Quiet refresh every minute while the tab is visible.
  useEffect(() => {
    if (!allowed) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadCounts();
      if (!aiResults && items.length <= PAGE) loadPage(0, true);
    }, 60000);
    return () => clearInterval(id);
  }, [allowed, aiResults, items.length, loadCounts, loadPage]);

  const select = (item: InboxItem) => {
    setSelectedKey(item.key);
    setPanel('message');
    setDrawerOpen(true);
  };

  const openKey = (key: string) => {
    setSelectedKey(key);
    setPanel('message');
    setDrawerOpen(true);
  };

  const onChanged = useCallback((changed: InboxItem) => {
    const f = filtersRef.current;
    const leavesView =
      (changed.direction === 'inbound' && changed.is_archived !== (f.folder === 'archived')) ||
      (f.folder === 'starred' && !changed.is_starred);
    const patch = (list: InboxItem[]) => {
      const exists = list.some((i) => i.key === changed.key);
      if (!exists) return list;
      return leavesView ? list.filter((i) => i.key !== changed.key) : list.map((i) => (i.key === changed.key ? { ...i, ...changed } : i));
    };
    setItems(patch);
    setAiResults((r) => (r ? { ...r, items: patch(r.items) } : r));
    if (changed.direction === 'outbound') loadPage(0, true);  // a reply was just sent
    loadCounts();
  }, [loadCounts, loadPage]);

  const toggleFlag = async (item: InboxItem, flags: Partial<Pick<InboxItem, 'is_starred' | 'is_archived'>>) => {
    try {
      const { item: updated } = await inboxApi.flags(item.key, flags);
      onChanged(updated);
    } catch (e) {
      setNotice({ kind: 'error', text: errorText(e, 'Could not update the email.') });
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const res = await inboxApi.sync();
      const created = res.results.reduce((n, r) => n + (r.created || 0), 0);
      const failed = res.results.find((r) => r.error);
      setNotice(failed
        ? { kind: 'error', text: `Sync problem with ${failed.mailbox}: ${failed.error}` }
        : { kind: 'ok', text: res.results.length === 0 ? 'No mailbox is connected for your workspace yet.' : created ? `${created} new email${created === 1 ? '' : 's'} synced.` : 'You are up to date.' });
      inboxApi.status().then(setStatus).catch(() => {});
      await Promise.all([loadPage(0, true), loadCounts()]);
    } catch (e) {
      setNotice({ kind: 'error', text: errorText(e, 'Sync failed.') });
    } finally {
      setSyncing(false);
    }
  };

  const markAllRead = async () => {
    try {
      const { updated } = await inboxApi.markViewRead(filters);
      setNotice({ kind: 'ok', text: updated ? `Marked ${updated} email${updated === 1 ? '' : 's'} as read.` : 'Nothing unread in this view.' });
      await Promise.all([loadPage(0, true), loadCounts()]);
    } catch (e) {
      setNotice({ kind: 'error', text: errorText(e, 'Could not mark emails as read.') });
    }
  };

  const activeChips = useMemo(() => {
    const chips: { label: string; clear: Partial<InboxFilters> }[] = [];
    if (filters.linked) chips.push({ label: LINKED.find((l) => l.key === filters.linked)?.label || filters.linked, clear: { linked: null } });
    if (filters.category) chips.push({ label: CATEGORY_META[filters.category]?.label || filters.category, clear: { category: null } });
    if (filters.priority) chips.push({ label: 'High priority', clear: { priority: null } });
    if (filters.q) chips.push({ label: `“${filters.q}”`, clear: { q: null } });
    return chips;
  }, [filters]);

  if (roleLoading) return null;
  if (!allowed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-center">
        <div>
          <p className="text-2xl font-black text-red-500">Unauthorized</p>
          <p className="mt-1 text-sm text-slate-500">Your role does not have access to the Inbox.</p>
        </div>
      </div>
    );
  }

  const listItems = aiResults ? aiResults.items : items;
  const unread = counts?.unread || 0;
  const mailbox = status?.mailboxes?.[0];
  const aiEnabled = status?.ai_enabled ?? true;

  const rightPanel = (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex shrink-0 gap-1 border-b border-slate-200 p-1.5 dark:border-zinc-700">
        <button type="button" onClick={() => setPanel('assistant')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold ${panel === 'assistant' ? 'bg-violet-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800'}`}>
          <Bot size={13} /> AI Assistant
        </button>
        <button type="button" onClick={() => selectedKey && setPanel('message')} disabled={!selectedKey}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold disabled:opacity-40 ${panel === 'message' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800'}`}>
          <Mail size={13} /> Email
        </button>
        {!wide && (
          <button type="button" onClick={() => setDrawerOpen(false)} className="rounded-lg px-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800" title="Close">
            <X size={15} />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {/* Both stay mounted so switching tabs keeps the chat and the open email. */}
        <div className={panel === 'assistant' ? 'h-full' : 'hidden'}>
          <AssistantPanel
            aiEnabled={aiEnabled}
            activeQuestion={aiResults?.question || null}
            onApply={(question, results) => setAiResults({ question, items: results })}
            onOpen={select}
          />
        </div>
        {selectedKey && (
          <div className={panel === 'message' ? 'h-full' : 'hidden'}>
            <MessageDetail
              messageKey={selectedKey}
              aiEnabled={aiEnabled}
              onClose={() => { setSelectedKey(null); setPanel('assistant'); if (!wide) setDrawerOpen(false); }}
              onChanged={onChanged}
            />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 pb-6 2xl:h-[calc(100vh-110px)]">
      {/* ── Header ── */}
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight text-gray-900 dark:text-zinc-50">
            <span className="relative">
              <InboxIcon className="h-7 w-7" />
              {unread > 0 && (
                <span className="absolute -right-2 -top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-black text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </span>
            Inbox
          </h1>
          <p className="mt-1 text-sm font-medium text-gray-500 dark:text-zinc-400">
            {mailbox ? (
              <>Every email for <b className="text-gray-700 dark:text-zinc-300">{mailbox.address}</b> · synced {timeAgo(mailbox.last_sync_at)}</>
            ) : status ? (
              <>Replies to emails sent from the CRM appear here. <Link href="/admin/settings" className="font-bold text-indigo-600 hover:underline">Connect a mailbox</Link> to see all incoming mail.</>
            ) : 'All your emails, sorted and summarized by AI.'}
            {!status?.full_access && status && <span className="ml-1">· showing emails for your assigned leads and clients</span>}
          </p>
          {mailbox?.last_error && (
            <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
              <AlertTriangle size={12} /> Last sync failed: {mailbox.last_error}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
            <Search size={14} className="text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search emails…"
              className="w-44 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-zinc-100 md:w-56" />
            {search && <button type="button" onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600"><X size={13} /></button>}
          </div>
          <button type="button" onClick={markAllRead} title="Mark everything in this view as read"
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
            <CheckCheck size={14} /> Mark read
          </button>
          <button type="button" onClick={syncNow} disabled={syncing}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sync
          </button>
          {!wide && (
            <button type="button" onClick={() => { setPanel('assistant'); setDrawerOpen(true); }}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:opacity-90">
              <Bot size={14} /> Ask AI
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className={`flex shrink-0 items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold ${notice.kind === 'ok'
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
          : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'}`}>
          {notice.text}
          <button type="button" onClick={() => setNotice(null)}><X size={13} /></button>
        </div>
      )}

      {narrow && <FilterRail filters={filters} counts={counts} onChange={setFilters} compact />}

      {/* ── Body ── */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[200px_minmax(0,1fr)] 2xl:grid-cols-[200px_minmax(0,1fr)_minmax(400px,460px)]">
        {!narrow && (
          <aside className="min-h-0 overflow-y-auto pr-1">
            <FilterRail filters={filters} counts={counts} onChange={setFilters} />
          </aside>
        )}

        <section className="min-h-0 overflow-y-auto pr-1">
          {activeChips.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {activeChips.map((c) => (
                <button key={c.label} type="button" onClick={() => { setFilters((f) => ({ ...f, ...c.clear })); if (c.clear.q === null) setSearch(''); }}
                  className="flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300">
                  {c.label} <X size={11} />
                </button>
              ))}
            </div>
          )}
          {!aiResults && !(loading && items.length === 0) && (
            <ViewSummaryCard filters={filters} viewLabel={viewLabel} total={total} aiEnabled={aiEnabled} onOpen={openKey} />
          )}
          {listError && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">{listError}</p>}
          <MessageList
            items={listItems}
            selectedKey={selectedKey}
            loading={loading && !aiResults}
            hasMore={!aiResults && items.length < total}
            onSelect={select}
            onLoadMore={() => loadPage(items.length)}
            onToggleStar={(item) => toggleFlag(item, { is_starred: !item.is_starred })}
            onToggleArchive={(item) => toggleFlag(item, { is_archived: !item.is_archived })}
            aiResults={aiResults ? { question: aiResults.question, count: aiResults.items.length } : null}
            onClearAi={() => setAiResults(null)}
            emptyHint={filters.folder === 'needs_reply' ? 'Nothing is waiting on a reply. 🎉' : undefined}
          />
        </section>

        {wide && <aside className="min-h-0">{rightPanel}</aside>}
      </div>

      {/* Slide-over for the assistant / email below 2xl */}
      {!wide && drawerOpen && (
        <div className="fixed inset-0 z-[70] flex justify-end bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setDrawerOpen(false)}>
          <div className="h-full w-full max-w-[520px] p-2" onClick={(e) => e.stopPropagation()}>
            {rightPanel}
          </div>
        </div>
      )}
    </div>
  );
}
