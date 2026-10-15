"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Users, Plus, Check, X, Shield, Mail, Phone, Loader2, Briefcase, 
  Target, IndianRupee, Calendar, PhoneCall, CalendarClock, Clock,
  ArrowUpRight, AlertCircle, FileText, CheckCircle2, ChevronRight, Activity, TrendingUp
} from "lucide-react";
import { API_BASE_URL } from "@/config";
import { cn } from "@/lib/utils";
import PageGuide from "@/components/PageGuide";
import { useLanguage } from "@/context/LanguageContext";

export default function TeamsPage() {
  const { t } = useLanguage();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("SalesManager");

  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userStats, setUserStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [activeTab, setActiveTab] = useState<"leads" | "clients" | "meetings" | "calls" | "followups">("leads");

  const handleUserClick = async (u: any) => {
    setSelectedUser(u);
    setUserStats(null);
    setLoadingStats(true);
    setActiveTab("leads");
    try {
      const res = await fetch(`${API_BASE_URL}/users/${u.id}/stats`);
      if (res.ok) {
        setUserStats(await res.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingStats(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/users`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setUsers(data.users || []);
    } catch (error) {
      console.error("Error fetching users:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setCreateError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });

      if (res.ok) {
        setShowCreateModal(false);
        fetchUsers();
        setName("");
        setEmail("");
        setPassword("");
        setRole("SalesManager");
      } else {
        let msg = `Request failed (${res.status})`;
        try {
          const data = await res.json();
          if (typeof data.detail === "string") msg = data.detail;
          else if (Array.isArray(data.detail) && data.detail[0]?.msg) msg = data.detail[0].msg;
          else if (data.message) msg = data.message;
        } catch { /* non-JSON body */ }
        setCreateError(msg);
      }
    } catch (error) {
      console.error("Error creating user:", error);
      setCreateError("Network error — could not reach the server.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Only display team members (Admins and Sales team)
  const teamMembers = users.filter(u => ['Admin', 'SuperAdmin', 'SalesManager', 'Sales', 'Employee'].includes(u.role));

  if (loading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 dark:text-zinc-50 tracking-tight">{t("teams.title")}</h1>
          <p className="text-gray-500 dark:text-zinc-400 font-medium">Manage your sales representatives and administrators.</p>
        </div>
        <button 
          onClick={() => {
            setShowCreateModal(true);
            setRole("SalesManager");
          }}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold text-sm hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 active:scale-95"
        >
          <Plus className="w-4 h-4" /> {t("teams.add_member")}
        </button>
      </div>

      {/* Team Directory Container */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl shadow-sm overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-100 dark:border-zinc-800 flex justify-between items-center bg-gray-50/50 dark:bg-zinc-950/50">
          <h3 className="font-bold text-lg text-gray-900 dark:text-zinc-50 flex items-center gap-3">
            <div className="p-2.5 bg-blue-100 dark:bg-blue-500/10 rounded-2xl">
              <Briefcase className="w-5 h-5 text-blue-600 dark:text-blue-400"/>
            </div>
            <span>Team Members</span>
          </h3>
          <span className="text-xs font-bold text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-zinc-800 px-3 py-1.5 rounded-full">
            {teamMembers.length} {t("teams.members")}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100 dark:divide-zinc-800">
          <div className="divide-y divide-gray-100 dark:divide-zinc-800">
            {teamMembers.slice(0, Math.ceil(teamMembers.length / 2)).map(u => (
              <div 
                key={u.id} 
                className="p-5 flex items-center justify-between hover:bg-blue-50/40 dark:hover:bg-zinc-800/40 transition-all cursor-pointer group"
                onClick={() => handleUserClick(u)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-blue-100/70 dark:bg-blue-500/15 border border-blue-200/50 dark:border-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center font-black text-lg group-hover:scale-105 transition-transform">
                    {u.name?.charAt(0) || u.email?.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-black text-gray-900 dark:text-zinc-50 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {u.name || t("teams.unnamed")}
                    </p>
                    <p className="text-xs font-medium text-gray-500 dark:text-zinc-400 mt-0.5">{u.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg",
                    ['Admin', 'SuperAdmin'].includes(u.role)
                      ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-200/50 dark:border-purple-800/50"
                      : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200/50 dark:border-blue-800/50"
                  )}>
                    {u.role === "SalesManager" ? "Sales" : u.role}
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors" />
                </div>
              </div>
            ))}
          </div>

          <div className="divide-y divide-gray-100 dark:divide-zinc-800">
            {teamMembers.slice(Math.ceil(teamMembers.length / 2)).map(u => (
              <div 
                key={u.id} 
                className="p-5 flex items-center justify-between hover:bg-blue-50/40 dark:hover:bg-zinc-800/40 transition-all cursor-pointer group"
                onClick={() => handleUserClick(u)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-blue-100/70 dark:bg-blue-500/15 border border-blue-200/50 dark:border-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center font-black text-lg group-hover:scale-105 transition-transform">
                    {u.name?.charAt(0) || u.email?.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-black text-gray-900 dark:text-zinc-50 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {u.name || t("teams.unnamed")}
                    </p>
                    <p className="text-xs font-medium text-gray-500 dark:text-zinc-400 mt-0.5">{u.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg",
                    ['Admin', 'SuperAdmin'].includes(u.role)
                      ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-200/50 dark:border-purple-800/50"
                      : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200/50 dark:border-blue-800/50"
                  )}>
                    {u.role === "SalesManager" ? "Sales" : u.role}
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {teamMembers.length === 0 && (
          <div className="p-16 text-center flex flex-col items-center">
            <Users className="w-12 h-12 text-gray-300 dark:text-zinc-700 mb-3" />
            <p className="text-base font-bold text-gray-600 dark:text-zinc-400">{t("teams.no_members")}</p>
          </div>
        )}
      </div>

      {/* Add Team Member Modal - Only Admin or Sales */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-zinc-900 w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-100 dark:border-zinc-800">
            <div className="p-8 border-b border-gray-100 dark:border-zinc-800 flex justify-between items-center bg-gray-50 dark:bg-zinc-950/50">
              <div>
                <h2 className="text-2xl font-black text-gray-900 dark:text-zinc-50 tracking-tight">{t("teams.modal_title")}</h2>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Create Admin or Sales Member</p>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="p-3 hover:bg-white dark:hover:bg-zinc-800 rounded-2xl transition-all shadow-sm">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            
            <form onSubmit={handleCreate} className="p-8 space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t("teams.field_name")}</label>
                <input 
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rahul Sharma" 
                  className="w-full px-5 py-3.5 bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all outline-none text-gray-900 dark:text-white"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t("teams.field_email")}</label>
                <input 
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. rahul@serphawk.com" 
                  className="w-full px-5 py-3.5 bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all outline-none text-gray-900 dark:text-white"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t("teams.field_password")}</label>
                <input 
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password" 
                  className="w-full px-5 py-3.5 bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all outline-none text-gray-900 dark:text-white"
                />
              </div>

              {/* STRICTLY ADMIN OR SALES ONLY */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Team Role</label>
                <select 
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full px-5 py-3.5 bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-all outline-none text-gray-900 dark:text-white"
                >
                  <option value="Admin">Admin</option>
                  <option value="SalesManager">Sales</option>
                </select>
              </div>

              {createError && (
                <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 text-xs font-bold rounded-2xl px-4 py-3">
                  {createError}
                </div>
              )}

              <div className="pt-3 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-5 py-3.5 bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 rounded-2xl font-bold text-sm hover:bg-gray-200 transition-all"
                >
                  {t("teams.cancel")}
                </button>
                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-5 py-3.5 bg-blue-600 text-white rounded-2xl font-bold text-sm hover:bg-blue-700 shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center gap-2"
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {t("teams.add_member_btn")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* User Stats Drawer - Comprehensive Sales Metrics (Tickets/Cases removed) */}
      <AnimatePresence>
        {selectedUser && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedUser(null)}
              className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-xl bg-white dark:bg-zinc-950 border-l border-gray-200 dark:border-zinc-800 shadow-2xl z-[100] flex flex-col overflow-y-auto"
            >
              {/* Drawer Header */}
              <div className="p-6 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between sticky top-0 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md z-10">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-blue-100 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-500/25 text-blue-600 dark:text-blue-400 flex items-center justify-center font-black text-xl">
                    {selectedUser.name?.charAt(0) || selectedUser.email?.charAt(0)}
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-gray-900 dark:text-white leading-tight">
                      {selectedUser.name || "Unnamed Member"}
                    </h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                        {selectedUser.role === "SalesManager" ? "Sales Representative" : selectedUser.role}
                      </span>
                      <span className="text-zinc-300 dark:text-zinc-700">•</span>
                      <span className="text-xs text-gray-500 dark:text-zinc-400 font-medium">
                        {selectedUser.email}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedUser(null)}
                  className="p-2.5 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-2xl transition-colors text-gray-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 flex-1 space-y-6">
                {loadingStats ? (
                  <div className="flex flex-col items-center justify-center h-64 space-y-4">
                    <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                    <p className="text-sm font-bold text-gray-500 dark:text-zinc-400">Loading performance data...</p>
                  </div>
                ) : userStats ? (
                  <div className="space-y-6 animate-in fade-in duration-300">
                    {/* Primary Financial KPIs: Made vs Due */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* How Much He Made */}
                      <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-900/10 rounded-3xl p-5 border border-emerald-200/60 dark:border-emerald-800/40 relative overflow-hidden">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                            Revenue Made
                          </span>
                          <div className="p-1.5 bg-emerald-500 text-white rounded-xl shadow-sm">
                            <TrendingUp className="w-3.5 h-3.5" />
                          </div>
                        </div>
                        <p className="text-2xl font-black text-emerald-900 dark:text-emerald-200">
                          ₹{(userStats.revenue_made || 0).toLocaleString("en-IN")}
                        </p>
                        <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 mt-1">
                          Won Deals / Closed Revenue
                        </p>
                      </div>

                      {/* How Much Due */}
                      <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/30 dark:to-amber-900/10 rounded-3xl p-5 border border-amber-200/60 dark:border-amber-800/40 relative overflow-hidden">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400">
                            Amount Due
                          </span>
                          <div className="p-1.5 bg-amber-500 text-white rounded-xl shadow-sm">
                            <Clock className="w-3.5 h-3.5" />
                          </div>
                        </div>
                        <p className="text-2xl font-black text-amber-900 dark:text-amber-200">
                          ₹{(userStats.revenue_due || 0).toLocaleString("en-IN")}
                        </p>
                        <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 mt-1">
                          Pending Invoices & Pipeline
                        </p>
                      </div>
                    </div>

                    {/* Pipeline Outcomes: Won, Lost, In Progress */}
                    <div>
                      <h4 className="text-[11px] font-black uppercase tracking-wider text-gray-400 mb-3 ml-1">
                        Deals Pipeline Outcome
                      </h4>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-gray-50 dark:bg-zinc-900 rounded-2xl p-4 border border-gray-100 dark:border-zinc-800 text-center">
                          <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Won</span>
                          <p className="text-2xl font-black text-gray-900 dark:text-white mt-1">
                            {userStats.won_deals_count || 0}
                          </p>
                          <span className="text-[10px] font-medium text-gray-400">Closed Won</span>
                        </div>
                        <div className="bg-gray-50 dark:bg-zinc-900 rounded-2xl p-4 border border-gray-100 dark:border-zinc-800 text-center">
                          <span className="text-xs font-bold text-rose-500">Lost</span>
                          <p className="text-2xl font-black text-gray-900 dark:text-white mt-1">
                            {userStats.lost_deals_count || 0}
                          </p>
                          <span className="text-[10px] font-medium text-gray-400">Closed Lost</span>
                        </div>
                        <div className="bg-gray-50 dark:bg-zinc-900 rounded-2xl p-4 border border-gray-100 dark:border-zinc-800 text-center">
                          <span className="text-xs font-bold text-blue-600 dark:text-blue-400">In Progress</span>
                          <p className="text-2xl font-black text-gray-900 dark:text-white mt-1">
                            {userStats.in_progress_deals_count || 0}
                          </p>
                          <span className="text-[10px] font-medium text-gray-400">Active Deals</span>
                        </div>
                      </div>
                    </div>

                    {/* Interactive Tabbed Detail Section: Leads, Clients, Meetings, Calls, Follow-ups */}
                    <div className="pt-2">
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none border-b border-gray-200 dark:border-zinc-800">
                        <button
                          onClick={() => setActiveTab("leads")}
                          className={cn(
                            "px-3.5 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap flex items-center gap-1.5",
                            activeTab === "leads"
                              ? "bg-blue-600 text-white shadow-sm"
                              : "text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800"
                          )}
                        >
                          <Target className="w-3.5 h-3.5" />
                          <span>Client Leads ({userStats.leads_count || 0})</span>
                        </button>
                        <button
                          onClick={() => setActiveTab("clients")}
                          className={cn(
                            "px-3.5 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap flex items-center gap-1.5",
                            activeTab === "clients"
                              ? "bg-blue-600 text-white shadow-sm"
                              : "text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800"
                          )}
                        >
                          <Briefcase className="w-3.5 h-3.5" />
                          <span>Clients ({userStats.clients_count || 0})</span>
                        </button>
                        <button
                          onClick={() => setActiveTab("meetings")}
                          className={cn(
                            "px-3.5 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap flex items-center gap-1.5",
                            activeTab === "meetings"
                              ? "bg-blue-600 text-white shadow-sm"
                              : "text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800"
                          )}
                        >
                          <Calendar className="w-3.5 h-3.5" />
                          <span>Meetings ({userStats.meetings_count || 0})</span>
                        </button>
                        <button
                          onClick={() => setActiveTab("calls")}
                          className={cn(
                            "px-3.5 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap flex items-center gap-1.5",
                            activeTab === "calls"
                              ? "bg-blue-600 text-white shadow-sm"
                              : "text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800"
                          )}
                        >
                          <PhoneCall className="w-3.5 h-3.5" />
                          <span>Calls ({userStats.calls_count || 0})</span>
                        </button>
                        <button
                          onClick={() => setActiveTab("followups")}
                          className={cn(
                            "px-3.5 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap flex items-center gap-1.5",
                            activeTab === "followups"
                              ? "bg-blue-600 text-white shadow-sm"
                              : "text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800"
                          )}
                        >
                          <CalendarClock className="w-3.5 h-3.5" />
                          <span>Follow-ups ({userStats.followups_count || 0})</span>
                        </button>
                      </div>

                      {/* Tab Contents */}
                      <div className="pt-4">
                        {/* 1. Client Leads */}
                        {activeTab === "leads" && (
                          <div className="space-y-2.5">
                            {userStats.leads?.length > 0 ? (
                              userStats.leads.map((l: any) => (
                                <div key={l.id} className="p-3.5 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 flex items-center justify-between">
                                  <div>
                                    <p className="font-bold text-sm text-gray-900 dark:text-white">{l.company_name}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                      <span className="text-[10px] font-bold text-gray-400 uppercase">Est. ₹{(l.estimated_value || 0).toLocaleString("en-IN")}</span>
                                      <span className="text-zinc-300 dark:text-zinc-700">•</span>
                                      <span className="text-[10px] text-gray-400 font-medium">Source: {l.source}</span>
                                    </div>
                                  </div>
                                  <span className="text-xs font-bold px-2.5 py-1 rounded-xl bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                                    {l.status}
                                  </span>
                                </div>
                              ))
                            ) : (
                              <div className="p-8 text-center border-2 border-dashed border-gray-100 dark:border-zinc-800 rounded-2xl text-gray-400 text-sm">
                                No leads assigned yet.
                              </div>
                            )}
                          </div>
                        )}

                        {/* 2. Clients */}
                        {activeTab === "clients" && (
                          <div className="space-y-2.5">
                            {userStats.clients?.length > 0 ? (
                              userStats.clients.map((c: any) => (
                                <div key={c.id} className="p-3.5 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl">
                                      <Briefcase className="w-4 h-4" />
                                    </div>
                                    <p className="font-bold text-sm text-gray-900 dark:text-white">{c.company_name}</p>
                                  </div>
                                  <span className="text-xs font-bold px-2.5 py-1 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                                    {c.status || "Active"}
                                  </span>
                                </div>
                              ))
                            ) : (
                              <div className="p-8 text-center border-2 border-dashed border-gray-100 dark:border-zinc-800 rounded-2xl text-gray-400 text-sm">
                                No active client accounts assigned.
                              </div>
                            )}
                          </div>
                        )}

                        {/* 3. Meetings */}
                        {activeTab === "meetings" && (
                          <div className="space-y-2.5">
                            {userStats.meetings?.length > 0 ? (
                              userStats.meetings.map((m: any) => (
                                <div key={m.id} className="p-3.5 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800">
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <p className="font-bold text-sm text-gray-900 dark:text-white">{m.title}</p>
                                      <p className="text-xs text-gray-400 mt-0.5">
                                        {m.scheduled_at ? new Date(m.scheduled_at).toLocaleString() : "Date not set"}
                                      </p>
                                    </div>
                                    <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">
                                      {m.status}
                                    </span>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="p-8 text-center border-2 border-dashed border-gray-100 dark:border-zinc-800 rounded-2xl text-gray-400 text-sm">
                                No meetings scheduled.
                              </div>
                            )}
                          </div>
                        )}

                        {/* 4. Calls */}
                        {activeTab === "calls" && (
                          <div className="space-y-2.5">
                            {userStats.calls?.length > 0 ? (
                              userStats.calls.map((c: any) => (
                                <div key={c.id} className="p-3.5 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800">
                                  <div className="flex items-center justify-between">
                                    <p className="font-bold text-sm text-gray-900 dark:text-white">{c.phone_number}</p>
                                    <span className="text-xs text-gray-400 font-medium">
                                      {Math.round((c.duration_seconds || 0) / 60)} mins
                                    </span>
                                  </div>
                                  {c.summary && <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">{c.summary}</p>}
                                </div>
                              ))
                            ) : (
                              <div className="p-8 text-center border-2 border-dashed border-gray-100 dark:border-zinc-800 rounded-2xl text-gray-400 text-sm">
                                No call history found.
                              </div>
                            )}
                          </div>
                        )}

                        {/* 5. Follow-ups */}
                        {activeTab === "followups" && (
                          <div className="space-y-2.5">
                            {userStats.followups?.length > 0 ? (
                              userStats.followups.map((f: any) => (
                                <div key={f.id} className="p-3.5 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 flex items-center justify-between">
                                  <div>
                                    <p className="font-bold text-sm text-gray-900 dark:text-white">{f.title}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                      <span className="text-[10px] font-bold text-blue-500 uppercase">{f.channel}</span>
                                      <span className="text-zinc-300 dark:text-zinc-700">•</span>
                                      <span className="text-[10px] text-gray-400">Due: {f.due_at ? new Date(f.due_at).toLocaleDateString() : "Pending"}</span>
                                    </div>
                                  </div>
                                  <span className={cn(
                                    "text-xs font-bold px-2 py-0.5 rounded-lg",
                                    f.status === "Completed" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                                  )}>
                                    {f.status}
                                  </span>
                                </div>
                              ))
                            ) : (
                              <div className="p-8 text-center border-2 border-dashed border-gray-100 dark:border-zinc-800 rounded-2xl text-gray-400 text-sm">
                                No follow-ups scheduled.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm font-medium text-gray-500">No data available.</p>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <PageGuide 
        pageKey="teams-directory"
        title={t("teams.guide_title")}
        description={t("teams.guide_desc")}
        steps={[
          { icon: <Users className="w-5 h-5 text-blue-500" />, text: t("teams.guide_s1") },
          { icon: <Plus className="w-5 h-5 text-blue-500" />, text: t("teams.guide_s2") }
        ]}
      />
    </div>
  );
}
