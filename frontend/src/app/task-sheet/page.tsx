"use client";

import { useEffect, useState, useMemo } from "react";
import { 
  CalendarDays, Download, Edit3, Plus, Save, X, Bot, Sparkles, 
  TrendingUp, Users, Target, PhoneCall, CheckCircle, AlertCircle, 
  CalendarCheck, Clock, UserCheck, ChevronDown, RefreshCw, Loader2,
  Award, ArrowUpRight, BarChart3, Filter
} from "lucide-react";
import { API_BASE_URL } from "@/config";
import { useRole } from "@/context/RoleContext";
import { motion, AnimatePresence } from "framer-motion";

interface Entry {
  id: number;
  user_id: number;
  user_name: string;
  work_date: string;
  area: string;
  project_id?: number;
  project_name?: string;
  ticket_id?: number;
  ticket_name?: string;
  summary: string;
  status: string;
  time_spent_minutes?: number;
  blocker?: string;
  follow_up_date?: string;
  completion_date?: string;
  outreaches_count?: number;
  positives_count?: number;
  negatives_count?: number;
  followups_scheduled?: number;
  meetings_scheduled?: number;
  key_focus?: string;
  updated_at: string;
}

interface AISummaryData {
  executive_summary: string;
  period: string;
  metrics: {
    total_outreaches: number;
    total_positives: number;
    total_negatives: number;
    total_followups: number;
    total_meetings: number;
    positive_rate: number;
  };
  team_averages: {
    avg_outreaches_per_person: number;
    avg_positives_per_person: number;
    avg_meetings_per_person: number;
    avg_followups_per_person: number;
  };
  salesperson_breakdown: Array<{
    user_id: number;
    name: string;
    outreaches: number;
    positives: number;
    negatives: number;
    followups: number;
    meetings: number;
    positive_rate: number;
    key_focus: string;
    performance_rating: string;
  }>;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

const PERIODS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "this_week", label: "This Week" },
  { id: "this_month", label: "This Month" },
  { id: "custom", label: "Custom Date" },
  { id: "all", label: "All Dates" },
];

export default function TaskSheetPage() {
  const { role, user } = useRole();
  const isAdmin = role === "Admin" || role === "SuperAdmin";
  // Everyone who isn't an admin only gets the submission form, shown inline.
  const inlineForm = !isAdmin;
  const [submitted, setSubmitted] = useState(false);

  const blankForm = () => ({
    work_date: todayStr(),
    area: role === "SalesManager" || role === "Employee" ? "Sales" : "Development",
    summary: "",
    status: "Completed",
    outreaches_count: "0",
    positives_count: "0",
    negatives_count: "0",
    followups_scheduled: "0",
    meetings_scheduled: "0",
    key_focus: "",
    time_spent_minutes: "480",
    blocker: "",
    follow_up_date: "",
    completion_date: todayStr(),
  });
  
  const [entries, setEntries] = useState<Entry[]>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [period, setPeriod] = useState<string>("today");
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [selectedEmployee, setSelectedEmployee] = useState<string>("all");
  
  // AI Bot state
  const [aiSummary, setAiSummary] = useState<AISummaryData | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  
  // Modal / Form state
  const [editing, setEditing] = useState<Entry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    work_date: todayStr(),
    area: "Sales",
    summary: "",
    status: "Completed",
    outreaches_count: "",
    positives_count: "",
    negatives_count: "",
    followups_scheduled: "",
    meetings_scheduled: "",
    key_focus: "",
    time_spent_minutes: "",
    blocker: "",
    follow_up_date: "",
    completion_date: todayStr(),
  });
  const [message, setMessage] = useState("");

  const loadEmployees = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/employees/workload`);
      const data = await res.json();
      setEmployees(data.employees || []);
    } catch (err) {}
  };

  const loadEntries = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (period === "custom") {
        params.set("work_date", selectedDate);
      } else {
        params.set("period", period);
      }
      
      if (!isAdmin && user?.id) {
        params.set("user_id", String(user.id));
      } else if (selectedEmployee !== "all") {
        params.set("user_id", selectedEmployee);
      }

      const res = await fetch(`${API_BASE_URL}/task-sheet?${params.toString()}`);
      const data = await res.json();
      setEntries(data.entries || []);
    } catch (err) {
      console.error(err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Entries and the staff list are admin-only on the API; non-admins never request them.
    if (isAdmin) loadEmployees();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setEntries([]);
      setLoading(false);
      return;
    }
    loadEntries();
  }, [period, selectedDate, selectedEmployee, isAdmin, user?.id]);

  const handleFetchAiSummary = async () => {
    setAiLoading(true);
    setShowAiModal(true);
    try {
      const body: any = { period: period === "custom" ? "today" : period };
      if (selectedEmployee !== "all") {
        body.salesperson_id = Number(selectedEmployee);
      }
      const res = await fetch(`${API_BASE_URL}/task-sheet/ai-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const data = await res.json();
        setAiSummary(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setAiLoading(false);
    }
  };

  const openNew = () => {
    setEditing(null);
    setForm({
      work_date: todayStr(),
      area: role === "SalesManager" || role === "Employee" ? "Sales" : "Development",
      summary: "",
      status: "Completed",
      outreaches_count: "0",
      positives_count: "0",
      negatives_count: "0",
      followups_scheduled: "0",
      meetings_scheduled: "0",
      key_focus: "",
      time_spent_minutes: "480",
      blocker: "",
      follow_up_date: "",
      completion_date: todayStr(),
    });
    setShowForm(true);
  };

  const openEdit = (entry: Entry) => {
    setEditing(entry);
    setForm({
      work_date: entry.work_date || todayStr(),
      area: entry.area || "Sales",
      summary: entry.summary || "",
      status: entry.status === "Done" ? "Completed" : entry.status,
      outreaches_count: String(entry.outreaches_count ?? 0),
      positives_count: String(entry.positives_count ?? 0),
      negatives_count: String(entry.negatives_count ?? 0),
      followups_scheduled: String(entry.followups_scheduled ?? 0),
      meetings_scheduled: String(entry.meetings_scheduled ?? 0),
      key_focus: entry.key_focus || "",
      time_spent_minutes: entry.time_spent_minutes ? String(entry.time_spent_minutes) : "",
      blocker: entry.blocker || "",
      follow_up_date: entry.follow_up_date || "",
      completion_date: entry.completion_date || "",
    });
    setShowForm(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.summary.trim() || !user?.id) return;
    const payload = {
      user_id: editing?.user_id || user.id,
      work_date: form.work_date || todayStr(),
      area: form.area,
      summary: form.summary.trim(),
      status: form.status,
      outreaches_count: Number(form.outreaches_count || 0),
      positives_count: Number(form.positives_count || 0),
      negatives_count: Number(form.negatives_count || 0),
      followups_scheduled: Number(form.followups_scheduled || 0),
      meetings_scheduled: Number(form.meetings_scheduled || 0),
      key_focus: form.key_focus.trim() || null,
      time_spent_minutes: form.time_spent_minutes ? Number(form.time_spent_minutes) : null,
      blocker: form.status === "Blocked" ? form.blocker.trim() || null : null,
      follow_up_date: form.follow_up_date || null,
      completion_date: form.status === "Completed" ? (form.completion_date || todayStr()) : null,
    };

    const response = await fetch(`${API_BASE_URL}/task-sheet${editing ? `/${editing.id}` : ""}`, {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setSubmitted(false);
      setMessage(data.detail || "Unable to save task-sheet entry");
      return;
    }

    setMessage("");
    if (inlineForm) {
      // Salespeople can't see entries, so confirm and give them a fresh form.
      setSubmitted(true);
      setForm(blankForm());
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setShowForm(false);
    loadEntries();
  };

  const downloadCSV = () => {
    const columns = [
      "Date", "Person", "Area", "Status", "Outreaches", "Positives", "Negatives", 
      "Follow-ups Sched", "Meetings Sched", "Key Client Focus", "Work Summary", "Time (min)"
    ];
    const rows = entries.map((e) => [
      e.work_date, e.user_name, e.area, e.status, 
      e.outreaches_count ?? 0, e.positives_count ?? 0, e.negatives_count ?? 0,
      e.followups_scheduled ?? 0, e.meetings_scheduled ?? 0, e.key_focus ?? "",
      e.summary, e.time_spent_minutes ?? ""
    ]);
    const csv = [columns, ...rows].map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `task-sheet-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Aggregated KPIs
  const totalOutreaches = entries.reduce((acc, e) => acc + (e.outreaches_count || 0), 0);
  const totalPositives = entries.reduce((acc, e) => acc + (e.positives_count || 0), 0);
  const totalNegatives = entries.reduce((acc, e) => acc + (e.negatives_count || 0), 0);
  const totalFollowups = entries.reduce((acc, e) => acc + (e.followups_scheduled || 0), 0);
  const totalMeetings = entries.reduce((acc, e) => acc + (e.meetings_scheduled || 0), 0);
  const winRate = totalOutreaches > 0 ? Math.round((totalPositives / totalOutreaches) * 100) : 0;

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* Non-admins only get the form: entries, KPIs and summaries are admin-only. */}
      {inlineForm && (
        <div className="max-w-3xl mx-auto bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-6 rounded-2xl shadow-sm">
          <span className="px-2.5 py-1 rounded-md text-[11px] font-extrabold uppercase tracking-wider bg-violet-500/10 text-violet-600 dark:text-violet-400">
            Daily Operations &amp; Sales Tracking
          </span>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white mt-1">Daily Task Sheet</h1>
          <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">
            Fill in today&apos;s outreach numbers and work summary. Your submission goes to your admin.
          </p>
          {submitted && (
            <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700 flex items-center gap-2">
              <CheckCircle size={16} /> Task sheet submitted. Thank you!
            </p>
          )}
          {message && <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{message}</p>}
        </div>
      )}

      {isAdmin && (
      <>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-6 rounded-2xl shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-md text-[11px] font-extrabold uppercase tracking-wider bg-violet-500/10 text-violet-600 dark:text-violet-400">
              Daily Operations & Sales Tracking
            </span>
          </div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white mt-1">Sales & Staff Task Sheet</h1>
          <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">
            Track outreaches, positives, scheduled meetings, and client follow-up commitments.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2.5">
          <button
            onClick={handleFetchAiSummary}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-purple-600 px-4 py-2.5 text-sm font-bold text-white shadow-md hover:opacity-95 transition-all active:scale-95"
          >
            <Bot size={17} className="text-amber-300" />
            🤖 AI Performance Summary
          </button>

          <button
            onClick={downloadCSV}
            className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm font-bold text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-700 transition-colors shadow-sm"
          >
            <Download size={15} /> Export CSV
          </button>

          <button
            onClick={openNew}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white shadow-md transition-all active:scale-95"
          >
            <Plus size={16} /> Submit Task Sheet
          </button>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Outreaches</span>
            <PhoneCall size={16} className="text-blue-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">{loading ? "—" : totalOutreaches}</div>
          <span className="text-[11px] text-slate-400">Total pitches done</span>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Positives</span>
            <CheckCircle size={16} className="text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600">{loading ? "—" : totalPositives}</div>
          <span className="text-[11px] text-slate-400">Interested prospects</span>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Negatives</span>
            <AlertCircle size={16} className="text-rose-500" />
          </div>
          <div className="text-2xl font-black text-rose-500">{loading ? "—" : totalNegatives}</div>
          <span className="text-[11px] text-slate-400">Not interested</span>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Win Rate</span>
            <TrendingUp size={16} className="text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-500">{loading ? "—" : `${winRate}%`}</div>
          <span className="text-[11px] text-slate-400">Positivity conversion</span>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Follow-ups</span>
            <CalendarCheck size={16} className="text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">{loading ? "—" : totalFollowups}</div>
          <span className="text-[11px] text-slate-400">Scheduled for later</span>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Meetings</span>
            <Clock size={16} className="text-purple-500" />
          </div>
          <div className="text-2xl font-black text-purple-600 dark:text-purple-400">{loading ? "—" : totalMeetings}</div>
          <span className="text-[11px] text-slate-400">Booked today</span>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-4 rounded-2xl shadow-sm">
        {/* Date Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          <Filter size={15} className="text-slate-400 shrink-0 mr-1" />
          {PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                period === p.id 
                  ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm" 
                  : "bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700"
              }`}
            >
              {p.label}
            </button>
          ))}

          {period === "custom" && (
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-800 dark:text-zinc-100 outline-none"
            />
          )}
        </div>

        {/* Salesperson Filter */}
        {isAdmin && (
          <div className="flex items-center gap-2 shrink-0">
            <Users size={15} className="text-slate-400" />
            <select
              value={selectedEmployee}
              onChange={e => setSelectedEmployee(e.target.value)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="all">All Salespeople & Staff</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {message && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{message}</p>}

      {/* Main Task Sheet Entries Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="p-4 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <CalendarDays size={18} className="text-indigo-500" />
            Submissions ({entries.length})
          </h2>
          <span className="text-xs font-semibold text-slate-400">
            Period: <span className="text-slate-700 dark:text-zinc-200 capitalize">{period.replace("_", " ")}</span>
          </span>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-indigo-500 w-8 h-8" /></div>
        ) : entries.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm font-semibold text-slate-400">
            No task sheet submissions found for this period. Click &quot;Submit Task Sheet&quot; to log work.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-zinc-800">
            {entries.map(entry => (
              <div key={entry.id} className="p-5 hover:bg-slate-50/50 dark:hover:bg-zinc-800/40 transition-colors">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  {/* Left: Rep & Metadata */}
                  <div className="space-y-1.5 min-w-[200px]">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-slate-900 dark:text-white text-base">{entry.user_name}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300">
                        {entry.area}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 font-medium">
                      Date: <strong className="text-slate-700 dark:text-zinc-300">{entry.work_date}</strong>
                    </div>

                    {/* Sales Metrics Badges */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200/50 dark:border-blue-800/50">
                        📞 {entry.outreaches_count ?? 0} Outreaches
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200/50 dark:border-emerald-800/50">
                        ✅ {entry.positives_count ?? 0} Positives
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border border-rose-200/50 dark:border-rose-800/50">
                        ❌ {entry.negatives_count ?? 0} Negatives
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/50">
                        🔔 {entry.followups_scheduled ?? 0} Follow-ups
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200/50 dark:border-purple-800/50">
                        🗓 {entry.meetings_scheduled ?? 0} Meetings
                      </span>
                    </div>
                  </div>

                  {/* Center: Work Summary & Key Focus */}
                  <div className="flex-1 space-y-2">
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Work Summary:</span>
                      <p className="text-sm text-slate-700 dark:text-zinc-200 mt-0.5 font-medium leading-relaxed whitespace-pre-wrap">
                        {entry.summary}
                      </p>
                    </div>

                    {entry.key_focus && (
                      <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-800/40">
                        <span className="text-[11px] font-bold text-amber-800 dark:text-amber-400 flex items-center gap-1.5 uppercase tracking-wide">
                          <Target size={14} className="text-amber-600" /> Key Account / Lead to Look After:
                        </span>
                        <p className="text-xs text-amber-950 dark:text-amber-200 mt-1 font-semibold">
                          {entry.key_focus}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Right: Actions */}
                  <div className="shrink-0 flex items-center gap-2">
                    <button
                      onClick={() => openEdit(entry)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 text-xs font-bold text-slate-700 dark:text-zinc-200 transition-colors"
                    >
                      <Edit3 size={13} /> Edit
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI SUMMARY MODAL */}
      <AnimatePresence>
        {showAiModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"
            onClick={e => { if (e.target === e.currentTarget) setShowAiModal(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 sm:p-8 max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl space-y-6"
            >
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-violet-600 to-indigo-600 flex items-center justify-center text-white shadow-md">
                    <Bot size={22} />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-slate-900 dark:text-white">AI Sales Performance & Team Analysis</h2>
                    <p className="text-xs text-slate-500 dark:text-zinc-400">
                      Automated audit of team throughput, conversion ratios, and key deal commitments.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowAiModal(false)}
                  className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-400 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {aiLoading ? (
                <div className="flex flex-col items-center justify-center py-24 space-y-3">
                  <Loader2 className="animate-spin text-violet-600 w-10 h-10" />
                  <p className="text-sm font-bold text-slate-600 dark:text-zinc-300">
                    Synthesizing sales metrics and team averages...
                  </p>
                </div>
              ) : aiSummary ? (
                <div className="space-y-6">
                  {/* Executive Synthesis */}
                  <div className="p-5 rounded-2xl bg-gradient-to-br from-violet-500/10 via-indigo-500/5 to-purple-500/10 border border-violet-500/20">
                    <h3 className="text-xs font-black uppercase tracking-wider text-violet-600 dark:text-violet-400 flex items-center gap-2 mb-2">
                      <Sparkles size={16} /> Executive AI Synthesis
                    </h3>
                    <p className="text-sm text-slate-800 dark:text-zinc-200 leading-relaxed font-medium whitespace-pre-wrap">
                      {aiSummary.executive_summary}
                    </p>
                  </div>

                  {/* Team Averages Callout */}
                  <div className="bg-slate-50 dark:bg-zinc-800/50 p-4 rounded-2xl border border-slate-200 dark:border-zinc-700/50">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-3 flex items-center gap-1.5">
                      <BarChart3 size={15} /> Team Benchmark Averages (Per Active Salesperson)
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="bg-white dark:bg-zinc-900 p-3 rounded-xl border border-slate-200 dark:border-zinc-700">
                        <span className="text-[11px] text-slate-400 font-semibold block">Avg Outreaches</span>
                        <span className="text-lg font-black text-slate-900 dark:text-white">
                          {aiSummary.team_averages.avg_outreaches_per_person}
                        </span>
                      </div>
                      <div className="bg-white dark:bg-zinc-900 p-3 rounded-xl border border-slate-200 dark:border-zinc-700">
                        <span className="text-[11px] text-slate-400 font-semibold block">Avg Positives</span>
                        <span className="text-lg font-black text-emerald-600">
                          {aiSummary.team_averages.avg_positives_per_person}
                        </span>
                      </div>
                      <div className="bg-white dark:bg-zinc-900 p-3 rounded-xl border border-slate-200 dark:border-zinc-700">
                        <span className="text-[11px] text-slate-400 font-semibold block">Avg Meetings</span>
                        <span className="text-lg font-black text-purple-600">
                          {aiSummary.team_averages.avg_meetings_per_person}
                        </span>
                      </div>
                      <div className="bg-white dark:bg-zinc-900 p-3 rounded-xl border border-slate-200 dark:border-zinc-700">
                        <span className="text-[11px] text-slate-400 font-semibold block">Avg Follow-ups</span>
                        <span className="text-lg font-black text-indigo-600">
                          {aiSummary.team_averages.avg_followups_per_person}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Individual Breakdown Table */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-3 flex items-center gap-1.5">
                      <Award size={15} /> Salesperson Performance Table
                    </h4>
                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-zinc-700">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 font-bold uppercase tracking-wider border-b border-slate-200 dark:border-zinc-700">
                            <th className="p-3">Salesperson</th>
                            <th className="p-3 text-center">Outreaches</th>
                            <th className="p-3 text-center">Positives</th>
                            <th className="p-3 text-center">Negatives</th>
                            <th className="p-3 text-center">Rate</th>
                            <th className="p-3 text-center">Follow-ups</th>
                            <th className="p-3 text-center">Meetings</th>
                            <th className="p-3">Key Focus Account</th>
                            <th className="p-3 text-right">Rating</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-zinc-800 font-medium">
                          {aiSummary.salesperson_breakdown.map((sp, idx) => (
                            <tr key={sp.user_id} className="hover:bg-slate-50 dark:hover:bg-zinc-800/50">
                              <td className="p-3 font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                                <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-zinc-700 text-[10px] flex items-center justify-center font-bold">
                                  {idx + 1}
                                </span>
                                {sp.name}
                              </td>
                              <td className="p-3 text-center text-slate-700 dark:text-zinc-200 font-semibold">{sp.outreaches}</td>
                              <td className="p-3 text-center text-emerald-600 font-bold">+{sp.positives}</td>
                              <td className="p-3 text-center text-rose-500 font-semibold">{sp.negatives}</td>
                              <td className="p-3 text-center font-bold text-amber-600">{sp.positive_rate}%</td>
                              <td className="p-3 text-center text-indigo-600 font-semibold">{sp.followups}</td>
                              <td className="p-3 text-center text-purple-600 font-bold">{sp.meetings}</td>
                              <td className="p-3 text-slate-600 dark:text-zinc-300 max-w-[200px] truncate" title={sp.key_focus}>
                                {sp.key_focus || "—"}
                              </td>
                              <td className="p-3 text-right">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  sp.performance_rating === "Top Performer" 
                                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                                    : sp.performance_rating === "Consistent"
                                    ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                                    : "bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300"
                                }`}>
                                  {sp.performance_rating}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : null}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </>
      )}

      {/* SUBMISSION / EDIT MODAL (admins) - and the whole page for everyone else */}
      <AnimatePresence>
        {(showForm || inlineForm) && (
          <div className={inlineForm ? "w-full" : "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"}>
            <form onSubmit={save} className={`w-full ${inlineForm ? "max-w-3xl mx-auto" : "max-w-2xl"} space-y-5 rounded-3xl bg-white p-6 sm:p-8 shadow-2xl dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800`}>
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800 pb-4">
                <div>
                  <h2 className="text-xl font-black text-slate-900 dark:text-white">
                    {editing ? "Edit Task Sheet Entry" : "Daily Sales Task Sheet Submission"}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                    Record your outreach numbers, positives, scheduled meetings, and priority account notes.
                  </p>
                </div>
                {!inlineForm && (
                  <button type="button" onClick={() => setShowForm(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-400">
                    <X size={18} />
                  </button>
                )}
              </div>

              {/* Date & Area */}
              <div className="grid grid-cols-2 gap-4">
                <label className="text-xs font-bold text-slate-600 dark:text-zinc-300">
                  Work Date <span className="text-red-500">*</span>
                  <input
                    type="date"
                    required
                    value={form.work_date}
                    onChange={e => setForm({ ...form, work_date: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-zinc-700 p-2.5 text-sm bg-white dark:bg-zinc-800 font-medium"
                  />
                </label>
                <label className="text-xs font-bold text-slate-600 dark:text-zinc-300">
                  Area / Department
                  <select
                    value={form.area}
                    onChange={e => setForm({ ...form, area: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-zinc-700 p-2.5 text-sm bg-white dark:bg-zinc-800 font-medium"
                  >
                    <option>Sales</option>
                    <option>Development</option>
                    <option>QA</option>
                    <option>Support</option>
                    <option>General</option>
                  </select>
                </label>
              </div>

              {/* 5 Sales Metrics */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700/60 space-y-3">
                <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400 block">
                  Today&apos;s Outreach & Performance Metrics
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <label className="text-xs font-bold text-slate-600 dark:text-zinc-300">
                    1. Outreaches Done
                    <input
                      type="number"
                      min="0"
                      value={form.outreaches_count}
                      onChange={e => setForm({ ...form, outreaches_count: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-slate-200 dark:border-zinc-700 p-2 text-sm bg-white dark:bg-zinc-900 font-bold text-blue-600"
                      placeholder="e.g. 45"
                    />
                  </label>

                  <label className="text-xs font-bold text-slate-600 dark:text-zinc-300">
                    2. Positives (Interested)
                    <input
                      type="number"
                      min="0"
                      value={form.positives_count}
                      onChange={e => setForm({ ...form, positives_count: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-slate-200 dark:border-zinc-700 p-2 text-sm bg-white dark:bg-zinc-900 font-bold text-emerald-600"
                      placeholder="e.g. 12"
                    />
                  </label>

                  <label className="text-xs font-bold text-slate-600 dark:text-zinc-300">
                    3. Negatives (Not Interested)
                    <input
                      type="number"
                      min="0"
                      value={form.negatives_count}
                      onChange={e => setForm({ ...form, negatives_count: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-slate-200 dark:border-zinc-700 p-2 text-sm bg-white dark:bg-zinc-900 font-bold text-rose-500"
                      placeholder="e.g. 8"
                    />
                  </label>

                  <label className="text-xs font-bold text-slate-600 dark:text-zinc-300">
                    4. Follow-ups Sched Today
                    <input
                      type="number"
                      min="0"
                      value={form.followups_scheduled}
                      onChange={e => setForm({ ...form, followups_scheduled: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-slate-200 dark:border-zinc-700 p-2 text-sm bg-white dark:bg-zinc-900 font-bold text-indigo-600"
                      placeholder="e.g. 5"
                    />
                  </label>

                  <label className="text-xs font-bold text-slate-600 dark:text-zinc-300">
                    5. Meetings Sched Today
                    <input
                      type="number"
                      min="0"
                      value={form.meetings_scheduled}
                      onChange={e => setForm({ ...form, meetings_scheduled: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-slate-200 dark:border-zinc-700 p-2 text-sm bg-white dark:bg-zinc-900 font-bold text-purple-600"
                      placeholder="e.g. 3"
                    />
                  </label>

                  <label className="text-xs font-bold text-slate-600 dark:text-zinc-300">
                    Time Spent (Minutes)
                    <input
                      type="number"
                      min="0"
                      value={form.time_spent_minutes}
                      onChange={e => setForm({ ...form, time_spent_minutes: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-slate-200 dark:border-zinc-700 p-2 text-sm bg-white dark:bg-zinc-900 font-medium"
                      placeholder="e.g. 480"
                    />
                  </label>
                </div>
              </div>

              {/* Key Lead/Client to Look After */}
              <label className="block text-xs font-bold text-slate-700 dark:text-zinc-200">
                Most Important Client / Lead to Look After Today &amp; Notes
                <textarea
                  rows={2}
                  value={form.key_focus}
                  onChange={e => setForm({ ...form, key_focus: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-amber-300/80 dark:border-amber-800 p-3 text-sm bg-amber-50/30 dark:bg-amber-950/20 font-medium"
                  placeholder="e.g. Titan Cargo Carriers — follow up at 3:30 PM with pricing proposal for customs clearance."
                />
              </label>

              {/* Work Summary */}
              <label className="block text-xs font-bold text-slate-700 dark:text-zinc-200">
                Work Summary <span className="text-red-500">*</span>
                <textarea
                  required
                  rows={4}
                  value={form.summary}
                  onChange={e => setForm({ ...form, summary: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 dark:border-zinc-700 p-3 text-sm bg-white dark:bg-zinc-800 font-medium"
                  placeholder="Summarize key outreaches, feedback received, objections handled, and closed actions..."
                />
              </label>

              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition-all active:scale-95"
              >
                <Save size={16} /> {editing ? "Save Changes" : "Submit Daily Task Sheet"}
              </button>
            </form>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
