"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, X, Clock, CheckCircle2, AlertTriangle, CalendarClock, Search, Loader2, Mail, Phone, Video,
  MessageCircle, Bell, BellOff, Pencil, Trash2, Sparkles, Send, RotateCcw, Hourglass, User, Building2,
  RefreshCw, ChevronRight, Flag, LayoutGrid, Table, Check, ExternalLink, Calendar, ChevronDown, UserCheck,
} from "lucide-react";
import { API_BASE_URL } from "@/config";
import { useRole } from "@/context/RoleContext";
import TimezonePicker from "@/components/TimezonePicker";
import EmailFollowUpsView from "@/components/followups/EmailFollowUpsView";
import { ListChecks as SectionBoardIcon, Mail as SectionEmailIcon } from "lucide-react";
import {
  detectTimeZone, formatInZone, relativeTime, toZonedInput, zonedWallToUtc, gmtLabel,
} from "@/lib/timezone";

type Bucket = "overdue" | "pending" | "upcoming" | "completed";
type FollowUpStatus = "Pending" | "In Progress" | "Completed" | "Cancelled";

interface FollowUp {
  id: number;
  title: string;
  notes?: string | null;
  channel: string;
  priority: string;
  status: string;
  bucket: Bucket;
  due_at: string | null;
  due_at_local: string | null;
  timezone: string | null;
  reminder_minutes: number;
  reminder_sent: boolean;
  completed_at: string | null;
  completion_note?: string | null;
  lead_id?: number | null;
  client_id?: number | null;
  contact_id?: number | null;
  entity_type: "lead" | "client" | "contact" | null;
  entity_name: string | null;
  owner_id?: number | null;
  owner_name?: string | null;
  last_email_at?: string | null;
  phone?: string | null;
}

interface Employee {
  id: number;
  name: string;
  email?: string;
  role?: string;
}

const TABS: { key: Bucket; label: string; hint: string; icon: any; tone: string; ring: string; chip: string; bg: string }[] = [
  { key: "overdue", label: "Overdue", hint: "Past due — act now", icon: AlertTriangle, tone: "text-rose-600 dark:text-rose-400", ring: "ring-rose-500", chip: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20", bg: "from-rose-500/10 to-transparent" },
  { key: "pending", label: "Pending (Due 24h)", hint: "Due soon or open", icon: Hourglass, tone: "text-amber-600 dark:text-amber-400", ring: "ring-amber-500", chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20", bg: "from-amber-500/10 to-transparent" },
  { key: "upcoming", label: "Upcoming", hint: "Scheduled later", icon: CalendarClock, tone: "text-blue-600 dark:text-blue-400", ring: "ring-blue-500", chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20", bg: "from-blue-500/10 to-transparent" },
  { key: "completed", label: "Completed", hint: "Finished", icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-500", chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20", bg: "from-emerald-500/10 to-transparent" },
];

const STATUS_CONFIG: Record<string, { label: string; icon: any; cls: string; selectCls: string }> = {
  Pending: {
    label: "Pending",
    icon: Hourglass,
    cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    selectCls: "bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700",
  },
  "In Progress": {
    label: "In Progress",
    icon: Clock,
    cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
    selectCls: "bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300 border-sky-300 dark:border-sky-700",
  },
  Completed: {
    label: "Completed",
    icon: CheckCircle2,
    cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    selectCls: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700",
  },
  Cancelled: {
    label: "Cancelled",
    icon: X,
    cls: "bg-slate-500/15 text-slate-700 dark:text-zinc-300 border-slate-500/30",
    selectCls: "bg-slate-50 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 border-slate-300 dark:border-zinc-700",
  },
};

const CHANNELS = [
  { key: "Email", icon: Mail },
  { key: "Call", icon: Phone },
  { key: "Meeting", icon: Video },
  { key: "WhatsApp", icon: MessageCircle },
  { key: "Other", icon: Flag },
];

const PRIORITY_CLS: Record<string, string> = {
  Low: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
  Medium: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  High: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  Urgent: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 font-bold animate-pulse",
};

const REMINDERS = [
  { v: 0, l: "No reminder" },
  { v: 15, l: "15 minutes before" },
  { v: 30, l: "30 minutes before" },
  { v: 60, l: "1 hour before" },
  { v: 120, l: "2 hours before" },
  { v: 1440, l: "1 day before" },
];

const inputCls = "w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800/80 border border-slate-200 dark:border-zinc-700 text-sm text-slate-800 dark:text-zinc-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all";
const labelCls = "text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase tracking-wider mb-1.5 block";

const emptyForm = (tz: string) => ({
  title: "",
  notes: "",
  channel: "Email",
  priority: "Medium",
  status: "Pending",
  due_local: "",
  timezone: tz,
  reminder_minutes: 60,
  linked: "",
  owner_id: null as number | null,
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
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
          onMouseDown={onClose}
        >
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            onMouseDown={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="bg-white dark:bg-zinc-900 w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92dvh] sm:max-h-[90vh] flex flex-col border border-slate-200 dark:border-zinc-800"
          >
            <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-zinc-800 shrink-0 bg-slate-50/50 dark:bg-zinc-800/40 rounded-t-3xl sm:rounded-t-2xl">
              <div>
                <h2 className="text-lg font-black text-slate-800 dark:text-zinc-100">{title}</h2>
                <p className="text-xs text-slate-400 mt-0.5">Configure schedule, sales account assignment & reminders</p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-200/60 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 transition"
              >
                <X className="w-4 h-4 text-slate-600 dark:text-zinc-300" />
              </button>
            </div>
            <div className="p-5 sm:px-6 py-4 space-y-4 overflow-y-auto overscroll-contain flex-1">{children}</div>
            {footer && (
              <div className="px-5 sm:px-6 py-3.5 border-t border-slate-200 dark:border-zinc-800 shrink-0 bg-slate-50/50 dark:bg-zinc-800/40 rounded-b-3xl sm:rounded-b-2xl pb-[max(1rem,env(safe-area-inset-bottom))]">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function RemindersBoard() {
  const { role } = useRole();
  const viewerTz = useMemo(() => detectTimeZone(), []);
  const canSeeAll = role === "Admin" || role === "SuperAdmin" || role === "SalesManager";

  const [items, setItems] = useState<FollowUp[]>([]);
  const [counts, setCounts] = useState<Record<Bucket, number>>({ overdue: 0, pending: 0, upcoming: 0, completed: 0 });
  const [bucket, setBucket] = useState<Bucket>("pending");
  const [autoPicked, setAutoPicked] = useState(false);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("All");
  const [priorityFilter, setPriorityFilter] = useState<string>("All");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [, setTick] = useState(0);

  // create / edit state
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FollowUp | null>(null);
  const [form, setForm] = useState(emptyForm(viewerTz));
  const [saving, setSaving] = useState(false);

  // Entities loaded
  const [leads, setLeads] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [entitiesLoaded, setEntitiesLoaded] = useState(false);

  // email drawer
  const [emailFor, setEmailFor] = useState<FollowUp | null>(null);
  const [draft, setDraft] = useState<{ to: string; subject: string; body: string; ai: boolean; used: number; counts: Record<string, number>; goal: string; complete: boolean } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/follow-ups?scope=${scope}`);
      if (res.ok) {
        const d = await res.json();
        setItems(Array.isArray(d.follow_ups) ? d.follow_ups : []);
        setCounts(d.counts || { overdue: 0, pending: 0, upcoming: 0, completed: 0 });
      }
    } catch { /* keep previous */ }
    setLoading(false);
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  // Periodic refresh every 60s
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
    const [l, c, k, e] = await Promise.all([
      safe("/leads"),
      safe("/clients?per_page=1000"),
      safe("/contacts"),
      safe("/employees/workload"),
    ]);
    setLeads(Array.isArray(l.leads) ? l.leads : []);
    setClients(Array.isArray(c.clients) ? c.clients : []);
    setContacts(Array.isArray(k.contacts) ? k.contacts : []);
    setEmployees(Array.isArray(e.employees) ? e.employees : []);
  }, [entitiesLoaded]);

  // Deep-linking: /follow-ups?new=1&lead_id=7
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("new")) {
      const linked = p.get("client_id")
        ? `client:${p.get("client_id")}`
        : p.get("lead_id")
        ? `lead:${p.get("lead_id")}`
        : p.get("contact_id")
        ? `contact:${p.get("contact_id")}`
        : "";
      setEditing(null);
      setForm({ ...emptyForm(viewerTz), linked, title: p.get("title") || "" });
      loadEntities();
      setShowForm(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [loadEntities, viewerTz]);

  // Filtered visible items
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(i => {
      if (i.bucket !== bucket) return false;
      if (channelFilter !== "All" && i.channel !== channelFilter) return false;
      if (priorityFilter !== "All" && i.priority !== priorityFilter) return false;
      if (q) {
        const matchesTitle = i.title.toLowerCase().includes(q);
        const matchesEntity = (i.entity_name || "").toLowerCase().includes(q);
        const matchesNotes = (i.notes || "").toLowerCase().includes(q);
        const matchesOwner = (i.owner_name || "").toLowerCase().includes(q);
        if (!matchesTitle && !matchesEntity && !matchesNotes && !matchesOwner) return false;
      }
      return true;
    });
  }, [items, bucket, search, channelFilter, priorityFilter]);

  // When user selects a related Lead / Client in the creation form,
  // automatically detect that Lead's assigned salesperson!
  const handleLinkedSelect = (linkedVal: string) => {
    const [type, idStr] = linkedVal.split(":");
    const id = Number(idStr);
    let autoOwnerId: number | null = null;

    if (type === "lead") {
      const foundLead = leads.find(l => l.id === id);
      if (foundLead && foundLead.owner_id) {
        autoOwnerId = foundLead.owner_id;
      }
    } else if (type === "client") {
      const foundClient = clients.find(c => c.id === id);
      if (foundClient && foundClient.assignedEmployeeId) {
        autoOwnerId = foundClient.assignedEmployeeId;
      }
    }

    setForm(prev => ({
      ...prev,
      linked: linkedVal,
      owner_id: autoOwnerId ?? prev.owner_id,
    }));
  };

  // Find the currently detected salesperson for the form
  const selectedLeadOwner = useMemo(() => {
    if (!form.linked) return null;
    const [type, idStr] = form.linked.split(":");
    const id = Number(idStr);
    if (type === "lead") {
      const found = leads.find(l => l.id === id);
      if (!found) return null;
      const emp = employees.find(e => e.id === found.owner_id);
      return {
        id: found.owner_id,
        name: emp?.name || found.owner_name || found.salesperson_name || (found.owner_id ? `Sales Rep #${found.owner_id}` : "Unassigned"),
        role: emp?.role || "Lead Salesperson",
      };
    } else if (type === "client") {
      const found = clients.find(c => c.id === id);
      if (!found) return null;
      const emp = employees.find(e => e.id === found.assignedEmployeeId);
      return {
        id: found.assignedEmployeeId,
        name: emp?.name || (found.assignedEmployeeId ? `Sales Rep #${found.assignedEmployeeId}` : "Unassigned"),
        role: emp?.role || "Client Manager",
      };
    }
    return null;
  }, [form.linked, leads, clients, employees]);

  // ── Open Create / Edit ──
  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm(viewerTz));
    loadEntities();
    setShowForm(true);
  };

  const openEdit = (f: FollowUp) => {
    const tz = f.timezone || viewerTz;
    setEditing(f);
    setForm({
      title: f.title,
      notes: f.notes || "",
      channel: f.channel,
      priority: f.priority,
      status: f.status || "Pending",
      due_local: f.due_at ? (f.due_at_local && f.timezone ? f.due_at_local : toZonedInput(f.due_at, tz)) : "",
      timezone: tz,
      reminder_minutes: f.reminder_minutes,
      linked: f.client_id ? `client:${f.client_id}` : f.lead_id ? `lead:${f.lead_id}` : f.contact_id ? `contact:${f.contact_id}` : "",
      owner_id: f.owner_id || null,
    });
    loadEntities();
    setShowForm(true);
  };

  // Quick schedule presets
  const quick = (kind: "1h" | "tomorrow" | "3d" | "monday") => {
    const tz = form.timezone || viewerTz;
    const now = new Date();
    if (kind === "1h") {
      const inst = new Date(now.getTime() + 3600000);
      setForm(f => ({ ...f, due_local: toZonedInput(inst, tz) }));
      return;
    }
    const today = toZonedInput(now, tz).slice(0, 10);
    const [y, m, d] = today.split("-").map(Number);
    const base = new Date(Date.UTC(y, m - 1, d));
    if (kind === "tomorrow") base.setUTCDate(base.getUTCDate() + 1);
    else if (kind === "3d") base.setUTCDate(base.getUTCDate() + 3);
    else {
      const dow = base.getUTCDay();
      base.setUTCDate(base.getUTCDate() + ((8 - dow) % 7 || 7));
    }
    const local = `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}T09:00`;
    setForm(f => ({ ...f, due_local: local }));
  };

  // Save follow-up
  const save = async () => {
    if (!form.title.trim()) return showToast("Please enter a title", false);
    const [lt, lid] = form.linked ? form.linked.split(":") : [];

    const payload: any = {
      title: form.title.trim(),
      notes: form.notes || null,
      channel: form.channel,
      priority: form.priority,
      status: form.status,
      due_at: form.due_local || null,
      timezone: form.timezone || viewerTz,
      reminder_minutes: form.reminder_minutes,
      lead_id: lt === "lead" ? +lid : null,
      client_id: lt === "client" ? +lid : null,
      contact_id: lt === "contact" ? +lid : null,
      owner_id: form.owner_id || (selectedLeadOwner?.id ?? null),
    };

    setSaving(true);
    try {
      const res = await fetch(editing ? `${API_BASE_URL}/follow-ups/${editing.id}` : `${API_BASE_URL}/follow-ups`, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        showToast(e.detail || "Could not save follow-up", false);
      } else {
        showToast(editing ? "Follow-up updated" : "Follow-up scheduled and assigned");
        setShowForm(false);
        load(true);
      }
    } catch {
      showToast("Network error", false);
    }
    setSaving(false);
  };

  // Change status directly (interactive dropdown on every card / table row)
  const handleStatusChange = async (f: FollowUp, newStatus: string) => {
    setBusyId(f.id);
    try {
      const res = await fetch(`${API_BASE_URL}/follow-ups/${f.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        showToast(`Status changed to ${newStatus}`);
        await load(true);
      } else {
        showToast("Could not update status", false);
      }
    } catch {
      showToast("Network error", false);
    }
    setBusyId(null);
  };

  // General action helper
  const act = async (f: FollowUp, path: string, method = "POST", body?: any, okMsg?: string) => {
    setBusyId(f.id);
    try {
      const res = await fetch(`${API_BASE_URL}/follow-ups/${f.id}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) {
        if (okMsg) showToast(okMsg);
        await load(true);
      } else showToast("Action failed", false);
    } catch {
      showToast("Network error", false);
    }
    setBusyId(null);
  };

  // Snooze
  const snooze = (f: FollowUp, kind: "1h" | "tomorrow" | "nextweek") => {
    const tz = f.timezone || viewerTz;
    let target: string;
    if (kind === "1h") {
      target = toZonedInput(new Date(Date.now() + 3600000), tz);
    } else if (kind === "tomorrow") {
      const [y, m, d] = toZonedInput(new Date(), tz).slice(0, 10).split("-").map(Number);
      const b = new Date(Date.UTC(y, m - 1, d + 1));
      target = `${b.getUTCFullYear()}-${String(b.getUTCMonth() + 1).padStart(2, "0")}-${String(b.getUTCDate()).padStart(2, "0")}T09:00`;
    } else {
      const [y, m, d] = toZonedInput(new Date(), tz).slice(0, 10).split("-").map(Number);
      const b = new Date(Date.UTC(y, m - 1, d + 7));
      target = `${b.getUTCFullYear()}-${String(b.getUTCMonth() + 1).padStart(2, "0")}-${String(b.getUTCDate()).padStart(2, "0")}T09:00`;
    }
    act(f, "/reschedule", "POST", { due_at: target, timezone: tz }, kind === "1h" ? "Pushed +1 hour" : kind === "tomorrow" ? "Moved to tomorrow 9:00 AM" : "Moved to next week");
  };

  const remove = async (f: FollowUp) => {
    if (!confirm(`Delete follow-up "${f.title}"?`)) return;
    act(f, "", "DELETE", undefined, "Follow-up deleted");
  };

  // ── AI Email Drafter ──
  const generate = async (f: FollowUp, goal = "") => {
    setDrafting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/follow-ups/email-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ follow_up_id: f.id, goal: goal || undefined }),
      });
      const d = await res.json();
      if (!res.ok) {
        showToast(d.detail || "Could not draft email", false);
        setEmailFor(null);
        setDrafting(false);
        return;
      }
      setDraft(prev => ({
        to: prev?.to || d.to_email || "",
        subject: d.subject,
        body: d.body,
        ai: !!d.ai,
        used: d.context_total || 0,
        counts: d.context_used || {},
        goal,
        complete: prev?.complete ?? true,
      }));
    } catch {
      showToast("Network error", false);
    }
    setDrafting(false);
  };

  const openEmail = (f: FollowUp) => {
    setEmailFor(f);
    setDraft(null);
    generate(f);
  };

  const sendEmail = async () => {
    if (!emailFor || !draft) return;
    if (!draft.to.includes("@")) return showToast("Enter a valid recipient email", false);
    setSending(true);
    try {
      const res = await fetch(`${API_BASE_URL}/follow-ups/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          follow_up_id: emailFor.id,
          to_email: draft.to,
          subject: draft.subject,
          body: draft.body,
          mark_complete: draft.complete,
        }),
      });
      const sent = res.ok ? await res.clone().json().catch(() => ({})) : null;
      if (res.ok && sent?.cancelled) {
        showToast("Email not sent", false);
      } else if (res.ok) {
        showToast("Email sent" + (draft.complete ? " · marked complete" : ""));
        setEmailFor(null);
        setDraft(null);
        load(true);
      } else {
        const e = await res.json().catch(() => ({}));
        showToast(e.detail || "Send failed", false);
      }
    } catch {
      showToast("Network error", false);
    }
    setSending(false);
  };

  const entityOptions = {
    clients: clients.map(c => ({
      v: `client:${c.id}`,
      l: c.companyName || c.projectName || c.contact_person || `Client #${c.id}`,
    })),
    leads: leads.map(l => ({
      v: `lead:${l.id}`,
      l: `${l.company_name || `Lead #${l.id}`}${l.salesperson_name ? ` (Rep: ${l.salesperson_name})` : ""}`,
    })),
    contacts: contacts.map(c => ({
      v: `contact:${c.id}`,
      l: `${c.first_name || ""} ${c.last_name || ""}`.trim() || `Contact #${c.id}`,
    })),
  };

  const totalFollowups = items.length;
  const activeFollowups = counts.overdue + counts.pending + counts.upcoming;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 p-3 sm:p-5 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-6 top-4 z-[90] flex items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-bold shadow-2xl backdrop-blur-md max-w-[92vw] transition-all ${
            toast.ok ? "bg-emerald-600/95 text-white shadow-emerald-600/30" : "bg-rose-600/95 text-white shadow-rose-600/30"
          }`}
        >
          {toast.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          {toast.msg}
        </div>
      )}

      {/* Top Header */}
      <div className="bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 rounded-3xl p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-13 h-13 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-amber-600 p-3 shadow-lg shadow-amber-500/25 flex items-center justify-center shrink-0">
              <Bell className="w-7 h-7 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-zinc-100 tracking-tight">
                  Follow-ups &amp; Reminders
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  {activeFollowups} Active
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-zinc-400 mt-1">
                Auto-assigned to lead owners, instant status changer, timezone sync, and AI email assistant.
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={() => load()}
              aria-label="Refresh follow-ups"
              className="h-11 px-3.5 rounded-xl bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-slate-200/60 dark:hover:bg-zinc-700 transition flex items-center gap-2 text-xs font-bold"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-amber-500" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* View Mode Switcher */}
            <div className="flex rounded-xl bg-slate-100 dark:bg-zinc-800 p-1 border border-slate-200 dark:border-zinc-700">
              <button
                onClick={() => setViewMode("cards")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                  viewMode === "cards" ? "bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
                title="Cards view"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Cards</span>
              </button>
              <button
                onClick={() => setViewMode("table")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                  viewMode === "table" ? "bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
                title="Compact table view"
              >
                <Table className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Table</span>
              </button>
            </div>

            <button
              onClick={openCreate}
              className="h-11 px-5 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white text-xs sm:text-sm font-extrabold hover:opacity-95 shadow-lg shadow-orange-500/25 flex items-center gap-2 transition active:scale-[0.98]"
            >
              <Plus className="w-4 h-4" />
              <span>Schedule Follow-up</span>
            </button>
          </div>
        </div>

        {/* Bucket KPI Tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5 pt-5 border-t border-slate-100 dark:border-zinc-800">
          {TABS.map(t => {
            const active = bucket === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setBucket(t.key)}
                aria-pressed={active}
                className={`relative text-left rounded-2xl p-4 transition-all duration-200 border ${
                  active
                    ? `bg-white dark:bg-zinc-900 ${t.ring} ring-2 border-transparent shadow-md`
                    : "bg-slate-50/70 dark:bg-zinc-800/50 border-slate-200/60 dark:border-zinc-800 hover:bg-white dark:hover:bg-zinc-800/80"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className={`p-2 rounded-xl bg-slate-100 dark:bg-zinc-800 ${t.tone}`}>
                    <t.icon className="w-4 h-4" />
                  </div>
                  <span className={`text-2xl font-black ${t.tone}`}>{loading ? "–" : counts[t.key]}</span>
                </div>
                <p className="mt-2 text-sm font-black text-slate-800 dark:text-zinc-100">{t.label}</p>
                <p className="text-[11px] text-slate-400 dark:text-zinc-500 leading-tight truncate">{t.hint}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter / Scope Toolbar */}
      <div className="bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 rounded-2xl p-3.5 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row items-center gap-3">
          {/* Search bar */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by title, contact, sales rep, notes…"
              className={`${inputCls} pl-10 pr-9`}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Scope toggle (My Follow-ups vs Whole Team) */}
          {canSeeAll && (
            <div className="flex rounded-xl overflow-hidden border border-slate-200 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 p-0.5 shrink-0 w-full md:w-auto">
              {(["mine", "all"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-xs font-bold transition ${
                    scope === s
                      ? "bg-amber-600 text-white shadow-sm"
                      : "text-slate-600 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200"
                  }`}
                >
                  {s === "mine" ? "👤 My Account Follow-ups" : "👥 Whole Team"}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Secondary Filter Chips */}
        <div className="flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-slate-100 dark:border-zinc-800/80 text-xs">
          {/* Channel Filters */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
            <span className="text-slate-400 font-semibold mr-1 shrink-0">Channel:</span>
            {["All", ...CHANNELS.map(c => c.key)].map(c => (
              <button
                key={c}
                onClick={() => setChannelFilter(c)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition shrink-0 ${
                  channelFilter === c
                    ? "bg-slate-800 dark:bg-zinc-100 text-white dark:text-zinc-900"
                    : "bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Priority Filters */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
            <span className="text-slate-400 font-semibold mr-1 shrink-0">Priority:</span>
            {["All", "Urgent", "High", "Medium", "Low"].map(p => (
              <button
                key={p}
                onClick={() => setPriorityFilter(p)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition shrink-0 ${
                  priorityFilter === p
                    ? "bg-amber-500 text-white"
                    : "bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content Rendering: Loading / Empty / Cards / Table */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 bg-white dark:bg-zinc-900 rounded-3xl border border-slate-200 dark:border-zinc-800">
          <Loader2 className="animate-spin text-amber-500 w-9 h-9" />
          <p className="text-sm font-semibold text-slate-400">Loading follow-ups & reminders…</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center bg-white dark:bg-zinc-900 border border-dashed border-slate-300 dark:border-zinc-800 rounded-3xl shadow-sm">
          <div className="w-16 h-16 rounded-3xl bg-amber-500/10 flex items-center justify-center mb-4">
            <CheckCircle2 className="w-8 h-8 text-amber-600 dark:text-amber-400" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-zinc-200">
            {search || channelFilter !== "All" || priorityFilter !== "All"
              ? "No matching follow-ups found"
              : `No ${bucket === "completed" ? "completed follow-ups yet" : `${bucket} follow-ups`}`}
          </h3>
          <p className="text-xs sm:text-sm text-slate-400 max-w-md mt-1 mb-5">
            {bucket === "completed"
              ? "Completed tasks will be archived here for your records."
              : "Everything looks clear! Schedule a new follow-up to stay ahead on your sales pipeline."}
          </p>
          <button
            onClick={openCreate}
            className="px-5 h-11 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white text-xs sm:text-sm font-bold flex items-center gap-2 shadow-md shadow-amber-500/20 hover:opacity-90 transition"
          >
            <Plus className="w-4 h-4" /> Schedule New Follow-up
          </button>
        </div>
      ) : viewMode === "cards" ? (
        /* ── Cards View ── */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map((f, i) => {
            const tab = TABS.find(t => t.key === f.bucket)!;
            const ChIcon = CHANNELS.find(c => c.key === f.channel)?.icon || Flag;
            const busy = busyId === f.id;
            const foreign = f.timezone && f.timezone !== viewerTz;
            const stCfg = STATUS_CONFIG[f.status] || STATUS_CONFIG.Pending;

            return (
              <motion.div
                key={f.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 8) * 0.03 }}
                className={`bg-white dark:bg-zinc-900 border rounded-3xl shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden flex flex-col justify-between ${
                  f.bucket === "overdue"
                    ? "border-rose-300/80 dark:border-rose-900/50 bg-gradient-to-b from-rose-500/[0.03] to-transparent"
                    : f.status === "Completed"
                    ? "border-emerald-200/80 dark:border-emerald-950/40 opacity-80"
                    : "border-slate-200/80 dark:border-zinc-800"
                }`}
              >
                <div className="p-5">
                  {/* Card Header: 1-Click Checkbox + Title + Interactive Status Selector */}
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() =>
                        f.status === "Completed"
                          ? handleStatusChange(f, "Pending")
                          : handleStatusChange(f, "Completed")
                      }
                      disabled={busy}
                      aria-label={f.status === "Completed" ? "Reopen follow-up" : "Mark completed"}
                      className={`mt-0.5 w-10 h-10 shrink-0 rounded-2xl border-2 flex items-center justify-center transition-all ${
                        f.status === "Completed"
                          ? "bg-emerald-500 border-emerald-500 text-white shadow-md shadow-emerald-500/25"
                          : "border-slate-300 dark:border-zinc-600 text-transparent hover:border-emerald-500 hover:text-emerald-500"
                      }`}
                    >
                      {busy ? (
                        <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                      ) : (
                        <Check className="w-5 h-5 stroke-[3]" />
                      )}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h4
                          className={`font-black text-slate-800 dark:text-zinc-100 text-base leading-snug break-words ${
                            f.status === "Completed" ? "line-through text-slate-400 dark:text-zinc-500" : ""
                          }`}
                        >
                          {f.title}
                        </h4>

                        {/* Interactive Status Dropdown Pill */}
                        <div className="shrink-0 relative">
                          <select
                            value={f.status}
                            disabled={busy}
                            onChange={e => handleStatusChange(f, e.target.value)}
                            className={`text-xs font-black uppercase tracking-wider px-2.5 py-1 rounded-xl border appearance-none pr-6 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition ${stCfg.selectCls}`}
                          >
                            <option value="Pending">⏳ Pending</option>
                            <option value="In Progress">⚡ In Progress</option>
                            <option value="Completed">✅ Completed</option>
                            <option value="Cancelled">❌ Cancelled</option>
                          </select>
                          <ChevronDown className="w-3.5 h-3.5 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
                        </div>
                      </div>

                      {/* Meta Tags: Priority, Channel, Reminder */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <span className={`text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md border ${tab.chip}`}>
                          {tab.label}
                        </span>
                        <span className={`text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md border ${PRIORITY_CLS[f.priority] || PRIORITY_CLS.Medium}`}>
                          {f.priority}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-600 dark:text-zinc-400 flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-zinc-800">
                          <ChIcon className="w-3 h-3 text-amber-500" />
                          {f.channel}
                        </span>
                        {f.reminder_minutes > 0 && f.status !== "Completed" ? (
                          <span className="text-[11px] text-slate-400 flex items-center gap-1 px-1.5 py-0.5">
                            <Bell className="w-3 h-3 text-amber-500" />
                            {f.reminder_sent ? "Alert sent" : `${f.reminder_minutes >= 60 ? f.reminder_minutes / 60 + "h" : f.reminder_minutes + "m"} reminder`}
                          </span>
                        ) : null}
                      </div>

                      {/* Related Entity + Assigned Salesperson Badge */}
                      <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-zinc-800/80 space-y-1.5">
                        {f.entity_name && (
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-slate-600 dark:text-zinc-300 flex items-center gap-1.5 font-bold truncate">
                              {f.entity_type === "contact" ? (
                                <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              ) : (
                                <Building2 className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                              )}
                              <span className="truncate">{f.entity_name}</span>
                              <span className="text-slate-400 font-normal capitalize">({f.entity_type})</span>
                            </span>

                            {/* Direct Communication Quick Buttons */}
                            <div className="flex items-center gap-1 shrink-0">
                              {f.channel === "Email" && (
                                <button
                                  onClick={() => openEmail(f)}
                                  className="text-[11px] text-violet-600 dark:text-violet-400 font-bold hover:underline flex items-center gap-1"
                                >
                                  <Sparkles className="w-3 h-3" /> Draft Email
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Owner / Sales Rep Pill */}
                        {f.owner_name && (
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-zinc-400">
                            <UserCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span>Assigned Rep:</span>
                            <span className="font-bold text-slate-700 dark:text-zinc-200">{f.owner_name}</span>
                          </div>
                        )}

                        {/* Due Date & Relative Time */}
                        {f.due_at ? (
                          <div className="text-xs flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="flex items-center gap-1.5 text-slate-600 dark:text-zinc-300 font-medium">
                              <Clock className="w-3.5 h-3.5 text-slate-400" />
                              {formatInZone(f.due_at, viewerTz)}
                            </span>
                            {f.status !== "Completed" && (
                              <span className={`font-black ${tab.tone}`}>
                                ({relativeTime(f.due_at)})
                              </span>
                            )}
                            {foreign && (
                              <span className="text-[11px] text-slate-400">
                                · in {f.timezone} ({gmtLabel(f.timezone!)})
                              </span>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" /> No due date
                          </p>
                        )}

                        {/* Notes */}
                        {f.notes && (
                          <p className="text-xs text-slate-600 dark:text-zinc-400 line-clamp-2 bg-slate-50 dark:bg-zinc-800/60 p-2 rounded-xl mt-1.5 whitespace-pre-wrap">
                            {f.notes}
                          </p>
                        )}
                        {f.completion_note && (
                          <p className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 p-2 rounded-xl mt-1.5">
                            ✓ {f.completion_note}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom Card Action Bar */}
                <div className="px-5 py-3 bg-slate-50/70 dark:bg-zinc-800/40 border-t border-slate-100 dark:border-zinc-800/80 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {f.status !== "Completed" && (
                      <>
                        <button
                          onClick={() => openEmail(f)}
                          disabled={busy}
                          className="h-8 px-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition"
                        >
                          <Sparkles className="w-3 h-3" /> AI Email
                        </button>
                        <button
                          onClick={() => snooze(f, "1h")}
                          disabled={busy}
                          title="Snooze 1 hour"
                          className="h-8 px-2 rounded-xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:text-amber-600 text-xs font-semibold flex items-center gap-1 transition"
                        >
                          <RotateCcw className="w-3 h-3" /> +1h
                        </button>
                        <button
                          onClick={() => snooze(f, "tomorrow")}
                          disabled={busy}
                          title="Move to tomorrow 9am"
                          className="h-8 px-2 rounded-xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:text-amber-600 text-xs font-semibold flex items-center gap-1 transition"
                        >
                          <ChevronRight className="w-3 h-3" /> Tomorrow
                        </button>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-1 ml-auto">
                    <button
                      onClick={() => openEdit(f)}
                      aria-label="Edit follow-up"
                      className="w-8 h-8 rounded-xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:text-amber-600 flex items-center justify-center transition"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => remove(f)}
                      aria-label="Delete follow-up"
                      className="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-600 hover:bg-rose-100 flex items-center justify-center transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        /* ── Compact Table View ── */
        <div className="bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 rounded-3xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-zinc-800/60 border-b border-slate-200 dark:border-zinc-800 text-slate-500 uppercase tracking-wider font-extrabold text-[10px]">
                <tr>
                  <th className="py-3 px-4 w-12 text-center">Done</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Title &amp; Notes</th>
                  <th className="py-3 px-4">Entity &amp; Sales Rep</th>
                  <th className="py-3 px-4">Channel / Priority</th>
                  <th className="py-3 px-4">Due Date</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                {visible.map(f => {
                  const tab = TABS.find(t => t.key === f.bucket)!;
                  const busy = busyId === f.id;
                  const stCfg = STATUS_CONFIG[f.status] || STATUS_CONFIG.Pending;

                  return (
                    <tr
                      key={f.id}
                      className={`hover:bg-slate-50/60 dark:hover:bg-zinc-800/40 transition ${
                        f.status === "Completed" ? "opacity-75" : ""
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() =>
                            f.status === "Completed"
                              ? handleStatusChange(f, "Pending")
                              : handleStatusChange(f, "Completed")
                          }
                          disabled={busy}
                          className={`w-7 h-7 rounded-xl border flex items-center justify-center mx-auto transition ${
                            f.status === "Completed"
                              ? "bg-emerald-500 border-emerald-500 text-white"
                              : "border-slate-300 dark:border-zinc-600 text-transparent hover:border-emerald-500 hover:text-emerald-500"
                          }`}
                        >
                          {busy ? <Loader2 className="w-3 h-3 animate-spin text-slate-400" /> : <Check className="w-4 h-4 stroke-[3]" />}
                        </button>
                      </td>

                      {/* Interactive Status Dropdown */}
                      <td className="py-3 px-4">
                        <div className="relative inline-block">
                          <select
                            value={f.status}
                            disabled={busy}
                            onChange={e => handleStatusChange(f, e.target.value)}
                            className={`text-[11px] font-black uppercase tracking-wider px-2 py-1 rounded-lg border appearance-none pr-5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-amber-500 ${stCfg.selectCls}`}
                          >
                            <option value="Pending">⏳ Pending</option>
                            <option value="In Progress">⚡ In Progress</option>
                            <option value="Completed">✅ Completed</option>
                            <option value="Cancelled">❌ Cancelled</option>
                          </select>
                          <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
                        </div>
                      </td>

                      {/* Title & Notes */}
                      <td className="py-3 px-4 max-w-xs">
                        <p className={`font-bold text-slate-800 dark:text-zinc-100 ${f.status === "Completed" ? "line-through text-slate-400" : ""}`}>
                          {f.title}
                        </p>
                        {f.notes && <p className="text-[11px] text-slate-400 truncate mt-0.5">{f.notes}</p>}
                      </td>

                      {/* Entity & Rep */}
                      <td className="py-3 px-4">
                        {f.entity_name ? (
                          <div className="font-semibold text-slate-700 dark:text-zinc-200 truncate">
                            {f.entity_name}
                            <span className="text-[10px] text-slate-400 ml-1 font-normal capitalize">({f.entity_type})</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">—</span>
                        )}
                        {f.owner_name && (
                          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 mt-0.5">
                            <UserCheck className="w-3 h-3" />
                            {f.owner_name}
                          </div>
                        )}
                      </td>

                      {/* Channel / Priority */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 font-bold text-[10px]">
                            {f.channel}
                          </span>
                          <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${PRIORITY_CLS[f.priority] || PRIORITY_CLS.Medium}`}>
                            {f.priority}
                          </span>
                        </div>
                      </td>

                      {/* Due Date */}
                      <td className="py-3 px-4">
                        {f.due_at ? (
                          <div>
                            <p className="font-medium text-slate-700 dark:text-zinc-200">
                              {formatInZone(f.due_at, viewerTz, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </p>
                            {f.status !== "Completed" && (
                              <span className={`text-[10px] font-bold ${tab.tone}`}>
                                {relativeTime(f.due_at)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openEmail(f)}
                            className="p-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 dark:bg-violet-950/40 text-violet-600 font-bold"
                            title="AI Email"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => openEdit(f)}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => remove(f)}
                            className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-600"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Create / Edit Follow-up Sheet ── */}
      <Sheet
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? "Edit Follow-up & Reminder" : "Schedule New Follow-up"}
        footer={
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowForm(false)}
              className="flex-1 h-11 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 font-bold text-sm hover:bg-slate-200 dark:hover:bg-zinc-700 transition"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || !form.title.trim()}
              className="flex-[1.5] h-11 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white font-extrabold text-sm disabled:opacity-50 flex items-center justify-center gap-2 shadow-md shadow-orange-500/25 hover:opacity-95 transition"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {editing ? "Save Changes" : "Confirm Schedule"}
            </button>
          </div>
        }
      >
        {/* Title */}
        <div>
          <label className={labelCls}>What needs following up? *</label>
          <input
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="e.g. Call regarding proposal discount, demo scheduled…"
            className={inputCls}
            autoFocus
          />
        </div>

        {/* Related Lead / Client / Contact */}
        <div>
          <label className={labelCls}>Related Lead / Client / Contact</label>
          <select
            value={form.linked}
            onChange={e => handleLinkedSelect(e.target.value)}
            className={inputCls}
          >
            <option value="">— None (General Task) —</option>
            {entityOptions.leads.length > 0 && (
              <optgroup label="Leads (Sales Pipeline)">
                {entityOptions.leads.map(o => (
                  <option key={o.v} value={o.v}>{o.l}</option>
                ))}
              </optgroup>
            )}
            {entityOptions.clients.length > 0 && (
              <optgroup label="Active Clients">
                {entityOptions.clients.map(o => (
                  <option key={o.v} value={o.v}>{o.l}</option>
                ))}
              </optgroup>
            )}
            {entityOptions.contacts.length > 0 && (
              <optgroup label="Contacts">
                {entityOptions.contacts.map(o => (
                  <option key={o.v} value={o.v}>{o.l}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        {/* Lead Salesperson Auto-Detection Highlight Card */}
        {selectedLeadOwner && (
          <div className="p-3.5 rounded-2xl bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-950/40 dark:to-indigo-950/40 border border-violet-200/80 dark:border-violet-800/60 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600 text-white font-extrabold flex items-center justify-center shrink-0 shadow-md shadow-violet-600/30">
              <UserCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-wider text-violet-700 dark:text-violet-300 bg-violet-200/60 dark:bg-violet-900/60 px-2 py-0.5 rounded-md">
                  Lead Salesperson
                </span>
                <span className="text-xs font-bold text-slate-800 dark:text-zinc-100">
                  {selectedLeadOwner.name}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5 leading-snug">
                This follow-up will automatically be created in this salesperson's account &amp; alert them.
              </p>
            </div>
          </div>
        )}

        {/* Assigned Salesperson / Account Override */}
        <div>
          <label className={labelCls}>Assigned Salesperson / Account</label>
          <select
            value={form.owner_id ?? ""}
            onChange={e => setForm(f => ({ ...f, owner_id: e.target.value ? Number(e.target.value) : null }))}
            className={inputCls}
          >
            <option value="">
              {selectedLeadOwner?.id
                ? `Auto-Assign to Lead Owner (${selectedLeadOwner.name})`
                : "Assign to My Account (Current User)"}
            </option>
            {employees.map(u => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role || "Sales Rep"})
              </option>
            ))}
          </select>
        </div>

        {/* Status & Priority */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Status</label>
            <select
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              className={inputCls}
            >
              <option value="Pending">⏳ Pending</option>
              <option value="In Progress">⚡ In Progress</option>
              <option value="Completed">✅ Completed</option>
              <option value="Cancelled">❌ Cancelled</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Priority</label>
            <select
              value={form.priority}
              onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
              className={inputCls}
            >
              {["Low", "Medium", "High", "Urgent"].map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Channel Selection */}
        <div>
          <label className={labelCls}>Communication Channel</label>
          <div className="grid grid-cols-5 gap-2">
            {CHANNELS.map(c => (
              <button
                key={c.key}
                type="button"
                onClick={() => setForm(f => ({ ...f, channel: c.key }))}
                aria-pressed={form.channel === c.key}
                className={`h-14 rounded-xl border flex flex-col items-center justify-center gap-1 text-[11px] font-bold transition ${
                  form.channel === c.key
                    ? "bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-500/25"
                    : "bg-slate-50 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100"
                }`}
              >
                <c.icon className="w-4 h-4" />
                {c.key}
              </button>
            ))}
          </div>
        </div>

        {/* Due Date & Time */}
        <div>
          <label className={labelCls}>Due Date &amp; Time</label>
          <input
            type="datetime-local"
            value={form.due_local}
            onChange={e => setForm(f => ({ ...f, due_local: e.target.value }))}
            className={inputCls}
          />
        </div>

        {/* Quick Date Presets */}
        <div className="flex flex-wrap gap-2 -mt-1">
          {([
            ["1h", "In 1 Hour"],
            ["tomorrow", "Tomorrow 9am"],
            ["3d", "In 3 Days"],
            ["monday", "Next Monday"],
          ] as const).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => quick(k)}
              className="px-3 py-1 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 text-xs font-semibold hover:bg-amber-100 hover:text-amber-800 dark:hover:bg-amber-950/40 dark:hover:text-amber-300 transition"
            >
              {l}
            </button>
          ))}
        </div>

        {/* Timezone */}
        <TimezonePicker
          value={form.timezone}
          onChange={tz => setForm(f => ({ ...f, timezone: tz }))}
          localTime={form.due_local}
          label="Timezone for this follow-up"
        />

        {/* Reminders */}
        <div>
          <label className={labelCls}>Reminder Notification</label>
          <select
            value={form.reminder_minutes}
            onChange={e => setForm(f => ({ ...f, reminder_minutes: +e.target.value }))}
            className={inputCls}
          >
            {REMINDERS.map(r => (
              <option key={r.v} value={r.v}>{r.l}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-400">
            An in-app notification &amp; email will alert the assigned salesperson before this due time.
          </p>
        </div>

        {/* Notes */}
        <div>
          <label className={labelCls}>Notes / Talking Points</label>
          <textarea
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            rows={3}
            placeholder="Key discussion points, promises made, budget discussion…"
            className={`${inputCls} resize-none`}
          />
        </div>
      </Sheet>

      {/* ── AI Email Drafter Sheet ── */}
      <Sheet
        open={!!emailFor}
        onClose={() => { setEmailFor(null); setDraft(null); }}
        title="AI-Personalised Follow-up Email"
        footer={
          draft && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.complete}
                  onChange={e => setDraft(d => d && ({ ...d, complete: e.target.checked }))}
                  className="w-4 h-4 accent-amber-500 rounded"
                />
                Automatically mark this follow-up Completed after sending
              </label>
              <div className="flex gap-3">
                <button
                  onClick={() => emailFor && generate(emailFor, draft.goal)}
                  disabled={drafting}
                  className="h-11 px-4 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 font-bold text-xs flex items-center gap-2 justify-center hover:bg-slate-200 transition"
                >
                  {drafting ? <Loader2 className="w-4 h-4 animate-spin text-amber-500" /> : <RefreshCw className="w-4 h-4" />}
                  Regenerate
                </button>
                <button
                  onClick={sendEmail}
                  disabled={sending || drafting}
                  className="flex-1 h-11 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white font-extrabold text-sm disabled:opacity-50 flex items-center justify-center gap-2 shadow-md shadow-orange-500/25 hover:opacity-95 transition"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send Email Now
                </button>
              </div>
            </div>
          )
        }
      >
        {emailFor && (
          <p className="text-xs text-slate-500 dark:text-zinc-400 -mt-1">
            Target: <b className="text-slate-800 dark:text-zinc-100">{emailFor.title}</b>
            {emailFor.entity_name ? ` · ${emailFor.entity_name}` : ""}
          </p>
        )}

        {drafting && !draft && (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-500">
            <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
            <p className="text-sm font-semibold">Reading previous calls, proposals &amp; notes to draft…</p>
          </div>
        )}

        {draft && (
          <div className="space-y-4">
            <div
              className={`rounded-2xl p-3 text-xs flex items-start gap-2.5 border ${
                draft.ai
                  ? "bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800"
                  : "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"
              }`}
            >
              <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
              <p>
                {draft.ai ? "Generated by SerpHawk AI" : "Template generated"}{" "}
                {draft.used > 0 ? (
                  <b>using {Object.entries(draft.counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ")}</b>
                ) : (
                  <span>(no previous CRM history linked)</span>
                )}
                . You can customize the message below before sending.
              </p>
            </div>

            <div>
              <label className={labelCls}>Goal / Angle (optional)</label>
              <input
                value={draft.goal}
                onChange={e => setDraft(d => d && ({ ...d, goal: e.target.value }))}
                placeholder="e.g. Schedule a 15-minute quick demo, follow up on pricing discount"
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>Recipient Email</label>
              <input
                type="email"
                value={draft.to}
                onChange={e => setDraft(d => d && ({ ...d, to: e.target.value }))}
                placeholder="lead@company.com"
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>Subject Line</label>
              <input
                value={draft.subject}
                onChange={e => setDraft(d => d && ({ ...d, subject: e.target.value }))}
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>Email Body</label>
              <textarea
                value={draft.body}
                onChange={e => setDraft(d => d && ({ ...d, body: e.target.value }))}
                rows={9}
                className={`${inputCls} font-mono text-xs leading-relaxed`}
              />
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}


type FollowUpSection = "board" | "email";

const SECTIONS: { key: FollowUpSection; label: string; hint: string; Icon: typeof SectionBoardIcon }[] = [
  { key: "board", label: "Follow-ups", hint: "Schedule, reminders, status", Icon: SectionBoardIcon },
  { key: "email", label: "Email follow-ups", hint: "AI emails, auto-send, history", Icon: SectionEmailIcon },
];

/** One Follow-ups section: the reminders board and the email follow-ups view show the same follow_ups rows.
 *  The tab lives in the URL: /follow-ups?tab=email opens the email view (old /followups links redirect there). */
export default function FollowUpsPage() {
  return (
    <Suspense fallback={null}>
      <FollowUpSections />
    </Suspense>
  );
}

function FollowUpSections() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const section: FollowUpSection = params.get("tab") === "email" ? "email" : "board";

  const choose = (next: FollowUpSection) => {
    const q = new URLSearchParams(params.toString());
    if (next === "email") q.set("tab", "email");
    else {
      q.delete("tab");
      q.delete("view");
    }
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950">
      <div className="max-w-7xl mx-auto px-3 sm:px-5 md:px-8 pt-3 sm:pt-5 md:pt-8">
        <div role="tablist" aria-label="Follow-up views" className="inline-flex w-full sm:w-auto rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-1 shadow-sm">
          {SECTIONS.map(({ key, label, hint, Icon }) => {
            const active = section === key;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={active}
                onClick={() => choose(key)}
                className={`flex flex-1 sm:flex-none items-center gap-2 rounded-xl px-4 py-2 text-left transition ${
                  active ? "bg-slate-900 text-white dark:bg-white dark:text-zinc-900 shadow" : "text-slate-600 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex flex-col leading-tight">
                  <span className="text-xs sm:text-sm font-black">{label}</span>
                  <span className={`hidden sm:block text-[10px] font-semibold ${active ? "opacity-70" : "text-slate-400 dark:text-zinc-500"}`}>{hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {section === "email" ? <EmailFollowUpsView /> : <RemindersBoard />}
    </div>
  );
}
