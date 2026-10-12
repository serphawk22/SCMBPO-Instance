"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, X, Clock, CheckCircle2, AlertTriangle, CalendarClock, Search, Loader2, Mail, Phone, Video,
  MessageCircle, Bell, BellOff, Pencil, Trash2, Sparkles, Send, RotateCcw, Hourglass, User, Building2,
  RefreshCw, ChevronRight, Flag,
} from "lucide-react";
import { API_BASE_URL } from "@/config";
import { useRole } from "@/context/RoleContext";
import TimezonePicker from "@/components/TimezonePicker";
import {
  detectTimeZone, formatInZone, relativeTime, toZonedInput, zonedWallToUtc, gmtLabel,
} from "@/lib/timezone";

type Bucket = "overdue" | "pending" | "upcoming" | "completed";

interface FollowUp {
  id: number; title: string; notes?: string | null; channel: string; priority: string;
  status: string; bucket: Bucket; due_at: string | null; due_at_local: string | null; timezone: string | null;
  reminder_minutes: number; reminder_sent: boolean; completed_at: string | null; completion_note?: string | null;
  lead_id?: number | null; client_id?: number | null; contact_id?: number | null;
  entity_type: "lead" | "client" | "contact" | null; entity_name: string | null;
  owner_id?: number | null; owner_name?: string | null; last_email_at?: string | null;
}

const TABS: { key: Bucket; label: string; hint: string; icon: any; tone: string; ring: string; chip: string }[] = [
  { key: "overdue", label: "Overdue", hint: "Past due — act now", icon: AlertTriangle, tone: "text-red-600 dark:text-red-400", ring: "ring-red-500", chip: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
  { key: "pending", label: "Pending", hint: "Due in 24h or unscheduled", icon: Hourglass, tone: "text-amber-600 dark:text-amber-400", ring: "ring-amber-500", chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
  { key: "upcoming", label: "Upcoming", hint: "Scheduled later", icon: CalendarClock, tone: "text-blue-600 dark:text-blue-400", ring: "ring-blue-500", chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
  { key: "completed", label: "Completed", hint: "Done", icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-500", chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
];

const CHANNELS = [
  { key: "Email", icon: Mail }, { key: "Call", icon: Phone }, { key: "Meeting", icon: Video },
  { key: "WhatsApp", icon: MessageCircle }, { key: "Other", icon: Flag },
];
const PRIORITY_CLS: Record<string, string> = {
  Low: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  Medium: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  High: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  Urgent: "bg-red-500/10 text-red-500 border-red-500/20",
};
const REMINDERS = [
  { v: 0, l: "No reminder" }, { v: 15, l: "15 minutes before" }, { v: 30, l: "30 minutes before" },
  { v: 60, l: "1 hour before" }, { v: 120, l: "2 hours before" }, { v: 1440, l: "1 day before" },
];

const inputCls = "w-full px-4 py-3 sm:py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-base sm:text-sm text-slate-800 dark:text-zinc-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500";
const labelCls = "text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-widest mb-1 block";

const emptyForm = (tz: string) => ({
  title: "", notes: "", channel: "Email", priority: "Medium", due_local: "", timezone: tz,
  reminder_minutes: 60, linked: "",
});

function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" onMouseDown={onClose}>
          <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }} onMouseDown={e => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-label={title}
            className="bg-white dark:bg-zinc-900 w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92dvh] sm:max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-zinc-700 shrink-0">
              <h2 className="text-lg font-black text-slate-800 dark:text-zinc-100">{title}</h2>
              <button onClick={onClose} aria-label="Close" className="w-10 h-10 -mr-2 flex items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 sm:p-6 space-y-4 overflow-y-auto overscroll-contain flex-1">{children}</div>
            {footer && <div className="px-5 sm:px-6 py-4 border-t border-slate-200 dark:border-zinc-700 shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function FollowUpsPage() {
  const { role } = useRole();
  const viewerTz = useMemo(() => detectTimeZone(), []);
  const canSeeAll = role === "Admin" || role === "SuperAdmin" || role === "SalesManager";

  const [items, setItems] = useState<FollowUp[]>([]);
  const [counts, setCounts] = useState<Record<Bucket, number>>({ overdue: 0, pending: 0, upcoming: 0, completed: 0 });
  const [bucket, setBucket] = useState<Bucket>("pending");
  const [autoPicked, setAutoPicked] = useState(false);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [, setTick] = useState(0);

  // create / edit
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FollowUp | null>(null);
  const [form, setForm] = useState(emptyForm(viewerTz));
  const [saving, setSaving] = useState(false);
  const [leads, setLeads] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [entitiesLoaded, setEntitiesLoaded] = useState(false);

  // email
  const [emailFor, setEmailFor] = useState<FollowUp | null>(null);
  const [draft, setDraft] = useState<{ to: string; subject: string; body: string; ai: boolean; used: number; counts: Record<string, number>; goal: string; complete: boolean } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // fetch all buckets once so the tab counts are right, then filter locally
      const res = await fetch(`${API_BASE_URL}/follow-ups?scope=${scope}`);
      if (res.ok) {
        const d = await res.json();
        setItems(Array.isArray(d.follow_ups) ? d.follow_ups : []);
        setCounts(d.counts || { overdue: 0, pending: 0, upcoming: 0, completed: 0 });
      }
    } catch { /* keep previous data */ }
    setLoading(false);
  }, [scope]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { load(true); setTick(x => x + 1); }, 60000);
    return () => clearInterval(t);
  }, [load]);

  // first load: land on the most urgent non-empty tab
  useEffect(() => {
    if (autoPicked || loading) return;
    const first = (["overdue", "pending", "upcoming"] as Bucket[]).find(b => counts[b] > 0);
    if (first) setBucket(first);
    setAutoPicked(true);
  }, [loading, counts, autoPicked]);

  const loadEntities = useCallback(async () => {
    if (entitiesLoaded) return;
    setEntitiesLoaded(true);
    const safe = (u: string) => fetch(`${API_BASE_URL}${u}`).then(r => r.json()).catch(() => ({}));
    const [l, c, k] = await Promise.all([safe("/leads"), safe("/clients?per_page=1000"), safe("/contacts")]);
    setLeads(Array.isArray(l.leads) ? l.leads : []);
    setClients(Array.isArray(c.clients) ? c.clients : []);
    setContacts(Array.isArray(k.contacts) ? k.contacts : []);
  }, [entitiesLoaded]);

  // deep link: /follow-ups?new=1&lead_id=7  (used from lead / client pages)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("new")) {
      const linked = p.get("client_id") ? `client:${p.get("client_id")}` : p.get("lead_id") ? `lead:${p.get("lead_id")}` : p.get("contact_id") ? `contact:${p.get("contact_id")}` : "";
      setEditing(null);
      setForm({ ...emptyForm(viewerTz), linked, title: p.get("title") || "" });
      loadEntities();
      setShowForm(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(i => i.bucket === bucket && (!q || i.title.toLowerCase().includes(q) || (i.entity_name || "").toLowerCase().includes(q) || (i.notes || "").toLowerCase().includes(q)));
  }, [items, bucket, search]);

  // ── form helpers ──
  const openCreate = () => {
    setEditing(null); setForm(emptyForm(viewerTz)); loadEntities(); setShowForm(true);
  };
  const openEdit = (f: FollowUp) => {
    const tz = f.timezone || viewerTz;
    setEditing(f);
    setForm({
      title: f.title, notes: f.notes || "", channel: f.channel, priority: f.priority,
      due_local: f.due_at ? (f.due_at_local && f.timezone ? f.due_at_local : toZonedInput(f.due_at, tz)) : "",
      timezone: tz, reminder_minutes: f.reminder_minutes,
      linked: f.client_id ? `client:${f.client_id}` : f.lead_id ? `lead:${f.lead_id}` : f.contact_id ? `contact:${f.contact_id}` : "",
    });
    loadEntities(); setShowForm(true);
  };

  const quick = (kind: "1h" | "tomorrow" | "3d" | "monday") => {
    const tz = form.timezone || viewerTz;
    const now = new Date();
    let inst: Date;
    if (kind === "1h") inst = new Date(now.getTime() + 3600000);
    else {
      const today = toZonedInput(now, tz).slice(0, 10);
      const [y, m, d] = today.split("-").map(Number);
      const base = new Date(Date.UTC(y, m - 1, d));
      if (kind === "tomorrow") base.setUTCDate(base.getUTCDate() + 1);
      else if (kind === "3d") base.setUTCDate(base.getUTCDate() + 3);
      else { const dow = base.getUTCDay(); base.setUTCDate(base.getUTCDate() + ((8 - dow) % 7 || 7)); }
      const local = `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}T09:00`;
      setForm(f => ({ ...f, due_local: local })); return;
    }
    setForm(f => ({ ...f, due_local: toZonedInput(inst, tz) }));
  };

  const save = async () => {
    if (!form.title.trim()) return showToast("Please enter a title", false);
    const [lt, lid] = form.linked ? form.linked.split(":") : [];
    const payload: any = {
      title: form.title.trim(), notes: form.notes || null, channel: form.channel, priority: form.priority,
      due_at: form.due_local || null, timezone: form.timezone || viewerTz, reminder_minutes: form.reminder_minutes,
      lead_id: lt === "lead" ? +lid : null, client_id: lt === "client" ? +lid : null, contact_id: lt === "contact" ? +lid : null,
    };
    setSaving(true);
    try {
      const res = await fetch(editing ? `${API_BASE_URL}/follow-ups/${editing.id}` : `${API_BASE_URL}/follow-ups`, {
        method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); showToast(e.detail || "Could not save follow-up", false); }
      else { showToast(editing ? "Follow-up updated" : "Follow-up scheduled"); setShowForm(false); load(true); }
    } catch { showToast("Network error", false); }
    setSaving(false);
  };

  const act = async (f: FollowUp, path: string, method = "POST", body?: any, okMsg?: string) => {
    setBusyId(f.id);
    try {
      const res = await fetch(`${API_BASE_URL}/follow-ups/${f.id}${path}`, {
        method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) { if (okMsg) showToast(okMsg); await load(true); }
      else showToast("Action failed", false);
    } catch { showToast("Network error", false); }
    setBusyId(null);
  };

  const snooze = (f: FollowUp, kind: "1h" | "tomorrow") => {
    const tz = f.timezone || viewerTz;
    let target: string;
    if (kind === "1h") target = toZonedInput(new Date(Date.now() + 3600000), tz);
    else {
      const [y, m, d] = toZonedInput(new Date(), tz).slice(0, 10).split("-").map(Number);
      const b = new Date(Date.UTC(y, m - 1, d + 1));
      target = `${b.getUTCFullYear()}-${String(b.getUTCMonth() + 1).padStart(2, "0")}-${String(b.getUTCDate()).padStart(2, "0")}T09:00`;
    }
    act(f, "/reschedule", "POST", { due_at: target, timezone: tz }, kind === "1h" ? "Pushed back 1 hour" : "Moved to tomorrow 9:00");
  };

  const remove = async (f: FollowUp) => {
    if (!confirm(`Delete follow-up "${f.title}"?`)) return;
    act(f, "", "DELETE", undefined, "Follow-up deleted");
  };

  // ── email ──
  const generate = async (f: FollowUp, goal = "") => {
    setDrafting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/follow-ups/email-draft`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ follow_up_id: f.id, goal: goal || undefined }),
      });
      const d = await res.json();
      if (!res.ok) { showToast(d.detail || "Could not draft email", false); setEmailFor(null); setDrafting(false); return; }
      setDraft(prev => ({
        to: prev?.to || d.to_email || "", subject: d.subject, body: d.body, ai: !!d.ai, used: d.context_total || 0,
        counts: d.context_used || {}, goal, complete: prev?.complete ?? true,
      }));
    } catch { showToast("Network error", false); }
    setDrafting(false);
  };
  const openEmail = (f: FollowUp) => {
    setEmailFor(f); setDraft(null); generate(f);
  };
  const sendEmail = async () => {
    if (!emailFor || !draft) return;
    if (!draft.to.includes("@")) return showToast("Enter the recipient's email address", false);
    setSending(true);
    try {
      const res = await fetch(`${API_BASE_URL}/follow-ups/send-email`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ follow_up_id: emailFor.id, to_email: draft.to, subject: draft.subject, body: draft.body, mark_complete: draft.complete }),
      });
      if (res.ok) { showToast("Email sent" + (draft.complete ? " · follow-up completed" : "")); setEmailFor(null); setDraft(null); load(true); }
      else { const e = await res.json().catch(() => ({})); showToast(e.detail || "Send failed", false); }
    } catch { showToast("Network error", false); }
    setSending(false);
  };

  const entityOptions = {
    clients: clients.map(c => ({ v: `client:${c.id}`, l: c.companyName || c.projectName || c.contact_person || `Client #${c.id}` })),
    leads: leads.map(l => ({ v: `lead:${l.id}`, l: l.company_name || `Lead #${l.id}` })),
    contacts: contacts.map(c => ({ v: `contact:${c.id}`, l: `${c.first_name || ""} ${c.last_name || ""}`.trim() || `Contact #${c.id}` })),
  };
  const previewLocal = form.due_local;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6">
      {toast && (
        <div role="status" className={`fixed left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-6 top-4 z-[90] flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-2xl max-w-[92vw] ${toast.ok ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>
          {toast.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-orange-500/20 shrink-0"><Bell className="w-6 h-6 text-white" /></div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-black text-slate-800 dark:text-zinc-100">Follow-ups &amp; Reminders</h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-zinc-400">Schedule follow-ups, get reminded automatically, and send AI-personalised emails.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load()} aria-label="Refresh" className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-slate-500 hover:text-violet-600">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={openCreate} className="flex-1 sm:flex-none h-11 px-5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white text-sm font-bold hover:opacity-90 shadow-md flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" /> New follow-up
          </button>
        </div>
      </div>

      {/* Bucket tabs */}
      <div className="-mx-3 px-3 sm:mx-0 sm:px-0 overflow-x-auto pb-1 [scrollbar-width:none]">
        <div className="grid grid-flow-col auto-cols-[minmax(150px,1fr)] sm:grid-flow-row sm:grid-cols-4 gap-3 min-w-max sm:min-w-0">
          {TABS.map(t => {
            const active = bucket === t.key;
            return (
              <button key={t.key} onClick={() => setBucket(t.key)} aria-pressed={active}
                className={`text-left bg-white dark:bg-zinc-900 border rounded-2xl p-4 shadow-sm transition-all ${active ? `ring-2 ${t.ring} border-transparent` : "border-slate-200 dark:border-zinc-700 hover:shadow-md"}`}>
                <div className="flex items-center justify-between">
                  <t.icon className={`w-5 h-5 ${t.tone}`} />
                  <span className={`text-2xl font-black ${t.tone}`}>{loading ? "–" : counts[t.key]}</span>
                </div>
                <p className="mt-2 text-sm font-black text-slate-800 dark:text-zinc-100">{t.label}</p>
                <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-tight">{t.hint}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by title, company or notes…" className={`${inputCls} pl-9`} />
        </div>
        {canSeeAll && (
          <div className="flex rounded-xl overflow-hidden border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
            {(["mine", "all"] as const).map(s => (
              <button key={s} onClick={() => setScope(s)} className={`flex-1 sm:flex-none px-5 h-11 text-xs font-bold ${scope === s ? "bg-violet-600 text-white" : "text-slate-500 dark:text-zinc-400"}`}>
                {s === "mine" ? "My follow-ups" : "Whole team"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* List */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-orange-500 w-8 h-8" /></div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center bg-white dark:bg-zinc-900 border border-dashed border-slate-300 dark:border-zinc-700 rounded-2xl">
            <div className="w-14 h-14 rounded-2xl bg-orange-500/10 flex items-center justify-center mb-3"><CheckCircle2 className="w-7 h-7 text-orange-500" /></div>
            <p className="font-bold text-slate-700 dark:text-zinc-200">{search ? "No matches" : `Nothing ${bucket === "completed" ? "completed yet" : bucket}`}</p>
            <p className="text-sm text-slate-400 mt-1 mb-4">{bucket === "completed" ? "Completed follow-ups will appear here." : "You're all caught up — or schedule a new one."}</p>
            {bucket !== "completed" && <button onClick={openCreate} className="px-4 h-10 rounded-xl bg-orange-500 text-white text-sm font-bold flex items-center gap-2"><Plus className="w-4 h-4" /> Schedule a follow-up</button>}
          </div>
        ) : visible.map((f, i) => {
          const tab = TABS.find(t => t.key === f.bucket)!;
          const ChIcon = CHANNELS.find(c => c.key === f.channel)?.icon || Flag;
          const busy = busyId === f.id;
          const foreign = f.timezone && f.timezone !== viewerTz;
          return (
            <motion.div key={f.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.03 }}
              className={`bg-white dark:bg-zinc-900 border rounded-2xl shadow-sm overflow-hidden ${f.bucket === "overdue" ? "border-red-300 dark:border-red-500/40" : "border-slate-200 dark:border-zinc-700"}`}>
              <div className="p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <button onClick={() => (f.status === "Completed" ? act(f, "/reopen", "POST", undefined, "Reopened") : act(f, "/complete", "POST", {}, "Marked complete"))}
                    disabled={busy} aria-label={f.status === "Completed" ? "Reopen follow-up" : "Mark complete"}
                    className={`mt-0.5 w-11 h-11 sm:w-10 sm:h-10 shrink-0 rounded-xl border-2 flex items-center justify-center transition-all ${f.status === "Completed" ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 dark:border-zinc-600 text-transparent hover:border-emerald-500 hover:text-emerald-500"}`}>
                    {busy ? <Loader2 className="w-5 h-5 animate-spin text-slate-400" /> : <CheckCircle2 className="w-5 h-5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`font-black text-slate-800 dark:text-zinc-100 break-words ${f.status === "Completed" ? "line-through opacity-60" : ""}`}>{f.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span className={`text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md border ${tab.chip}`}>{tab.label}</span>
                      <span className={`text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md border ${PRIORITY_CLS[f.priority] || PRIORITY_CLS.Medium}`}>{f.priority}</span>
                      <span className="text-[11px] text-slate-500 dark:text-zinc-400 flex items-center gap-1"><ChIcon className="w-3 h-3" />{f.channel}</span>
                      {f.reminder_minutes > 0 && f.status !== "Completed"
                        ? <span className="text-[11px] text-slate-400 flex items-center gap-1" title={f.reminder_sent ? "Reminder already sent" : "Reminder scheduled"}><Bell className="w-3 h-3" />{f.reminder_sent ? "reminded" : `${f.reminder_minutes >= 60 ? f.reminder_minutes / 60 + "h" : f.reminder_minutes + "m"} before`}</span>
                        : f.status !== "Completed" && <span className="text-[11px] text-slate-400 flex items-center gap-1"><BellOff className="w-3 h-3" />no reminder</span>}
                    </div>
                    {f.entity_name && (
                      <p className="mt-2 text-xs text-slate-600 dark:text-zinc-300 flex items-center gap-1.5">
                        {f.entity_type === "contact" ? <User className="w-3.5 h-3.5 text-slate-400" /> : <Building2 className="w-3.5 h-3.5 text-slate-400" />}
                        <span className="font-semibold truncate">{f.entity_name}</span>
                        <span className="text-slate-400 capitalize">· {f.entity_type}</span>
                      </p>
                    )}
                    {f.due_at ? (
                      <div className="mt-2 text-xs flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="flex items-center gap-1.5 text-slate-600 dark:text-zinc-300"><Clock className="w-3.5 h-3.5 text-slate-400" />{formatInZone(f.due_at, viewerTz)}</span>
                        {f.status !== "Completed" && <span className={`font-bold ${tab.tone}`}>{relativeTime(f.due_at)}</span>}
                        {foreign && <span className="text-[11px] text-slate-400">· set in {f.timezone} ({formatInZone(f.due_at, f.timezone!, { weekday: undefined })} {gmtLabel(f.timezone!)})</span>}
                      </div>
                    ) : <p className="mt-2 text-xs text-slate-400 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />No due date</p>}
                    {f.notes && <p className="mt-2 text-xs text-slate-500 dark:text-zinc-400 line-clamp-2 whitespace-pre-wrap">{f.notes}</p>}
                    {f.completion_note && <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">✓ {f.completion_note}</p>}
                    {f.owner_name && scope === "all" && <p className="mt-1.5 text-[11px] text-slate-400">Owner: {f.owner_name}</p>}
                  </div>
                </div>

                {/* Actions — always visible, touch-sized */}
                <div className="mt-4 flex flex-wrap gap-2">
                  {f.status !== "Completed" && (
                    <>
                      <button onClick={() => openEmail(f)} disabled={busy} className="h-11 sm:h-9 px-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-1.5 flex-1 sm:flex-none justify-center">
                        <Sparkles className="w-3.5 h-3.5" /> AI email
                      </button>
                      <button onClick={() => snooze(f, "1h")} disabled={busy} className="h-11 sm:h-9 px-3 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 text-xs font-bold flex items-center gap-1.5 justify-center">
                        <RotateCcw className="w-3.5 h-3.5" /> +1h
                      </button>
                      <button onClick={() => snooze(f, "tomorrow")} disabled={busy} className="h-11 sm:h-9 px-3 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 text-xs font-bold flex items-center gap-1.5 justify-center">
                        <ChevronRight className="w-3.5 h-3.5" /> Tomorrow
                      </button>
                    </>
                  )}
                  <button onClick={() => openEdit(f)} aria-label="Edit" className="h-11 w-11 sm:h-9 sm:w-9 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 flex items-center justify-center ml-auto"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => remove(f)} aria-label="Delete" className="h-11 w-11 sm:h-9 sm:w-9 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Create / edit */}
      <Sheet open={showForm} onClose={() => setShowForm(false)} title={editing ? "Edit follow-up" : "New follow-up"}
        footer={
          <div className="flex gap-3">
            <button onClick={() => setShowForm(false)} className="flex-1 h-12 sm:h-11 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 font-bold text-sm">Cancel</button>
            <button onClick={save} disabled={saving || !form.title.trim()} className="flex-[1.4] h-12 sm:h-11 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} {editing ? "Save changes" : "Schedule follow-up"}
            </button>
          </div>
        }>
        <div>
          <label className={labelCls}>What needs following up? *</label>
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Chase proposal feedback" className={inputCls} autoFocus />
        </div>
        <div>
          <label className={labelCls}>Related lead / client / contact</label>
          <select value={form.linked} onChange={e => setForm(f => ({ ...f, linked: e.target.value }))} className={inputCls}>
            <option value="">— none —</option>
            {entityOptions.clients.length > 0 && <optgroup label="Clients">{entityOptions.clients.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</optgroup>}
            {entityOptions.leads.length > 0 && <optgroup label="Leads">{entityOptions.leads.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</optgroup>}
            {entityOptions.contacts.length > 0 && <optgroup label="Contacts">{entityOptions.contacts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</optgroup>}
          </select>
          <p className="mt-1 text-[11px] text-slate-400">Linking lets the AI use your previous notes, calls and meetings when drafting emails.</p>
        </div>
        <div>
          <label className={labelCls}>How?</label>
          <div className="grid grid-cols-5 gap-2">
            {CHANNELS.map(c => (
              <button key={c.key} type="button" onClick={() => setForm(f => ({ ...f, channel: c.key }))} aria-pressed={form.channel === c.key}
                className={`h-14 rounded-xl border flex flex-col items-center justify-center gap-1 text-[10px] font-bold ${form.channel === c.key ? "bg-violet-600 text-white border-violet-600" : "bg-slate-50 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-500 dark:text-zinc-300"}`}>
                <c.icon className="w-4 h-4" />{c.key}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Due date &amp; time</label>
            <input type="datetime-local" value={form.due_local} onChange={e => setForm(f => ({ ...f, due_local: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Priority</label>
            <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className={inputCls}>
              {["Low", "Medium", "High", "Urgent"].map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 -mt-1">
          {([["1h", "In 1 hour"], ["tomorrow", "Tomorrow 9am"], ["3d", "In 3 days"], ["monday", "Next Monday"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => quick(k)} className="px-3 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 text-xs font-bold hover:bg-violet-100 dark:hover:bg-violet-500/20 hover:text-violet-700">{l}</button>
          ))}
        </div>
        <TimezonePicker value={form.timezone} onChange={tz => setForm(f => ({ ...f, timezone: tz }))} localTime={previewLocal} label="Timezone for this due time" />
        <div>
          <label className={labelCls}>Remind me</label>
          <select value={form.reminder_minutes} onChange={e => setForm(f => ({ ...f, reminder_minutes: +e.target.value }))} className={inputCls}>
            {REMINDERS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-slate-400">You'll get an in-app notification and an email. You're also alerted if it becomes overdue.</p>
        </div>
        <div>
          <label className={labelCls}>Notes</label>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Context, talking points, what was promised…" className={`${inputCls} resize-none`} />
        </div>
      </Sheet>

      {/* AI email */}
      <Sheet open={!!emailFor} onClose={() => { setEmailFor(null); setDraft(null); }} title="Personalised follow-up email"
        footer={draft && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-zinc-300 cursor-pointer">
              <input type="checkbox" checked={draft.complete} onChange={e => setDraft(d => d && ({ ...d, complete: e.target.checked }))} className="w-4 h-4 accent-violet-600" />
              Mark this follow-up complete after sending
            </label>
            <div className="flex gap-3">
              <button onClick={() => emailFor && generate(emailFor, draft.goal)} disabled={drafting} className="h-12 sm:h-11 px-4 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 font-bold text-sm flex items-center gap-2 justify-center">
                {drafting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Regenerate
              </button>
              <button onClick={sendEmail} disabled={sending || drafting} className="flex-1 h-12 sm:h-11 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send email
              </button>
            </div>
          </div>
        )}>
        {emailFor && <p className="text-xs text-slate-500 dark:text-zinc-400 -mt-1">For: <b className="text-slate-700 dark:text-zinc-200">{emailFor.title}</b>{emailFor.entity_name ? ` · ${emailFor.entity_name}` : ""}</p>}
        {drafting && !draft && (
          <div className="py-16 flex flex-col items-center gap-3 text-slate-500"><Loader2 className="w-7 h-7 animate-spin text-violet-500" /><p className="text-sm">Reading previous discussions and drafting…</p></div>
        )}
        {draft && (
          <>
            <div className={`rounded-xl px-3 py-2.5 text-xs flex items-start gap-2 ${draft.ai ? "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300" : "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
              <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
              <p>
                {draft.ai ? "Written by AI" : "Template draft (AI unavailable)"} using{" "}
                {draft.used > 0 ? <b>{Object.entries(draft.counts).map(([k, v]) => `${v} ${k.toLowerCase()}${v > 1 ? "s" : ""}`).join(", ")}</b> : <b>no previous discussion</b>}
                {draft.used === 0 && " — add notes, calls or meetings on this lead/client to personalise further"}.
              </p>
            </div>
            <div><label className={labelCls}>Angle / goal (optional)</label>
              <div className="flex gap-2">
                <input value={draft.goal} onChange={e => setDraft(d => d && ({ ...d, goal: e.target.value }))} placeholder="e.g. book a demo next week" className={inputCls} />
              </div>
            </div>
            <div><label className={labelCls}>To</label><input type="email" value={draft.to} onChange={e => setDraft(d => d && ({ ...d, to: e.target.value }))} placeholder="recipient@company.com" className={inputCls} /></div>
            <div><label className={labelCls}>Subject</label><input value={draft.subject} onChange={e => setDraft(d => d && ({ ...d, subject: e.target.value }))} className={inputCls} /></div>
            <div><label className={labelCls}>Message</label><textarea value={draft.body} onChange={e => setDraft(d => d && ({ ...d, body: e.target.value }))} rows={11} className={`${inputCls} leading-relaxed`} /></div>
          </>
        )}
      </Sheet>
    </div>
  );
}
