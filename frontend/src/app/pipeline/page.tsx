"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRole } from "@/context/RoleContext";
import { API_BASE_URL } from "@/config";
import { useLanguage } from "@/context/LanguageContext";
import { Sidebar } from "@/components/Sidebar";
import { 
  Kanban, Plus, MoreVertical, DollarSign, Calendar, Clock, MapPin, Search, Pencil, FileText, X, ArrowUpRight,
  Handshake, Check, Tag, Percent
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Deal {
  id: number;
  title: string;
  value: number;
  client_id: number;
  client_name: string;
  assigned_to: number | null;
  assigned_name?: string;
  stage: string;
  expected_close_date: string | null;
  created_at: string;
}

const STAGES = ["Lead", "Discovery", "Demo", "Negotiation", "Closed Won", "Closed Lost"];

export default function PipelinePage() {
  const { t } = useLanguage();
  const { role, user } = useRole();
  const router = useRouter();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [salesPerformance, setSalesPerformance] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draggedDeal, setDraggedDeal] = useState<Deal | null>(null);
  const [sortBy, setSortBy] = useState<"latest" | "oldest" | "highest_value" | "lowest_value" | "stale">("latest");

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [newDeal, setNewDeal] = useState({ title: "", value: "", client_id: "", assigned_to: "", stage: "Lead", expected_close_date: "" });
  const [clients, setClients] = useState<{ id: number; email: string; companyName?: string }[]>([]);
  const [salesUsers, setSalesUsers] = useState<{ id: number; name: string; email: string }[]>([]);

  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [dealProposals, setDealProposals] = useState<any[]>([]);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [negotiations, setNegotiations] = useState<any[]>([]);
  const [loadingNegotiations, setLoadingNegotiations] = useState(false);
  const [activeDrawerTab, setActiveDrawerTab] = useState<"proposals" | "negotiations">("negotiations");
  const [negForm, setNegForm] = useState({ party: "us", price: "", discount_pct: "", notes: "" });
  const [savingNeg, setSavingNeg] = useState(false);

  useEffect(() => {
    if (role === "Client") {
      router.push("/login");
      return;
    }
    fetchDeals();
    fetchClients();
    fetch(`${API_BASE_URL}/users?role=SalesManager,Employee`).then(r => r.json()).then(data => setSalesUsers(data.users || [])).catch(() => {});
  }, [role, router]);

  const fetchDeals = async () => {
    try {
      const url = role === "SalesManager" ? `${API_BASE_URL}/deals?user_id=${user?.id || ""}` : `${API_BASE_URL}/deals`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch deals");
      const data = await res.json();
      setDeals(data.deals);
      setSalesPerformance(data.sales_performance || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchClients = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/clients`);
      if (res.ok) {
        const data = await res.json();
        setClients(data.clients || []);
      }
    } catch (err) {
      console.error("Failed to fetch clients for dropdown", err);
    }
  };

  const handleDragStart = (e: React.DragEvent, deal: Deal) => {
    setDraggedDeal(deal);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", deal.id.toString());
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = async (e: React.DragEvent, newStage: string) => {
    e.preventDefault();
    if (!draggedDeal || draggedDeal.stage === newStage) {
      setDraggedDeal(null);
      return;
    }

    const updatedDeals = deals.map(d => d.id === draggedDeal.id ? { ...d, stage: newStage } : d);
    setDeals(updatedDeals);

    try {
      const res = await fetch(`${API_BASE_URL}/deals/${draggedDeal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage })
      });
      if (!res.ok) throw new Error("Failed to update deal stage");
    } catch (err) {
      console.error(err);
      fetchDeals();
    }
    setDraggedDeal(null);
  };

  const handleAddDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const isEditing = Boolean(editingDeal);
      const res = await fetch(`${API_BASE_URL}/deals${isEditing ? `/${editingDeal?.id}` : ""}`, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newDeal.title,
          value: parseFloat(newDeal.value) || 0.0,
          client_id: parseInt(newDeal.client_id),
          assigned_to: role === "SalesManager" ? user?.id || null : (newDeal.assigned_to ? Number(newDeal.assigned_to) : null),
          stage: newDeal.stage,
          expected_close_date: newDeal.expected_close_date || null
        })
      });
      if (res.ok) {
        setShowAddModal(false);
        setEditingDeal(null);
        setNewDeal({ title: "", value: "", client_id: "", assigned_to: "", stage: "Lead", expected_close_date: "" });
        fetchDeals();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const openEditDeal = (deal: Deal) => {
    setEditingDeal(deal);
    setNewDeal({
      title: deal.title,
      value: String(deal.value ?? ""),
      client_id: String(deal.client_id),
      assigned_to: String(deal.assigned_to || ""),
      stage: deal.stage,
      expected_close_date: deal.expected_close_date || "",
    });
    setShowAddModal(true);
  };

  const openDealPanel = async (deal: Deal) => {
    setSelectedDeal(deal);
    setLoadingProposals(true);
    setLoadingNegotiations(true);
    try {
      const token = localStorage.getItem("token");
      const [propRes, negRes] = await Promise.all([
        fetch(`${API_BASE_URL}/deals/${deal.id}/proposals`),
        fetch(`${API_BASE_URL}/deals/${deal.id}/negotiations`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (propRes.ok) {
        const data = await propRes.json();
        setDealProposals(data.proposals || []);
      }
      if (negRes.ok) {
        const negData = await negRes.json();
        setNegotiations(negData.negotiations || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingProposals(false);
      setLoadingNegotiations(false);
    }
  };

  const handleCreateNegotiation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDeal || !negForm.price) return;
    setSavingNeg(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE_URL}/deals/${selectedDeal.id}/negotiations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          party: negForm.party,
          price: parseFloat(negForm.price),
          discount_pct: parseFloat(negForm.discount_pct || "0"),
          notes: negForm.notes || null,
        }),
      });
      if (res.ok) {
        setNegForm({ party: "us", price: "", discount_pct: "", notes: "" });
        const r = await fetch(`${API_BASE_URL}/deals/${selectedDeal.id}/negotiations`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) {
          const d = await r.json();
          setNegotiations(d.negotiations || []);
        }
        fetchDeals();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingNeg(false);
    }
  };

  const handleNegotiationAction = async (negId: number, action: "accept" | "reject") => {
    if (!selectedDeal) return;
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE_URL}/deals/${selectedDeal.id}/negotiations/${negId}/${action}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const r = await fetch(`${API_BASE_URL}/deals/${selectedDeal.id}/negotiations`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) {
          const d = await r.json();
          setNegotiations(d.negotiations || []);
        }
        fetchDeals();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const sortedDeals = [...deals].sort((a, b) => {
    if (sortBy === "highest_value") return (b.value || 0) - (a.value || 0);
    if (sortBy === "lowest_value") return (a.value || 0) - (b.value || 0);
    if (sortBy === "oldest") return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
    if (sortBy === "stale") {
      const age = (deal: Deal) => Date.now() - new Date(deal.created_at || 0).getTime();
      return age(b) - age(a);
    }
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });

  const dealsByStage = STAGES.reduce((acc, stage) => {
    acc[stage] = sortedDeals.filter(d => d.stage === stage);
    return acc;
  }, {} as Record<string, Deal[]>);

  const totalValue = deals.reduce((sum, d) => sum + (d.value || 0), 0);

  if (loading) return <div className="p-8 text-center">{t("pipeline.loading_pipeline")}</div>;

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-zinc-950">
      <Sidebar role={role} />
      <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
        <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6 relative">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-slate-800 dark:text-zinc-100 flex items-center gap-2">
                <Kanban className="w-6 h-6 text-indigo-600" />
                {t("pipeline.sales_pipeline")}
              </h1>
              <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">{t("pipeline.manage_track_deals")}</p>
            </div>
            
            <div className="flex items-center gap-4">
              <select value={sortBy} onChange={event => setSortBy(event.target.value as typeof sortBy)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" aria-label="Sort deals">
                <option value="latest">Latest first</option>
                <option value="oldest">Oldest first</option>
                <option value="highest_value">Highest value</option>
                <option value="lowest_value">Lowest value</option>
                <option value="stale">Stale longest</option>
              </select>
              <div className="bg-white dark:bg-zinc-900 px-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 shadow-sm flex flex-col items-end">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("pipeline.total_pipeline")}</span>
                <span className="text-lg font-bold text-slate-800 dark:text-zinc-100">${totalValue.toLocaleString()}</span>
              </div>
              <button 
                onClick={() => { setEditingDeal(null); setNewDeal({ title: "", value: "", client_id: "", assigned_to: "", stage: "Lead", expected_close_date: "" }); setShowAddModal(true); }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-2 text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                {t("pipeline.add_deal")}
              </button>
            </div>
          </div>

          {error && <div className="p-4 mb-4 bg-red-50 text-red-600 rounded-xl">{error}</div>}

          {role === "Admin" && salesPerformance.length > 0 && <div className="mb-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400 dark:bg-zinc-800"><tr><th className="px-4 py-3">Salesperson</th><th className="px-4 py-3">Deals</th><th className="px-4 py-3">Pipeline</th><th className="px-4 py-3">Won Revenue</th><th className="px-4 py-3">Lead</th><th className="px-4 py-3">Negotiation</th><th className="px-4 py-3">Won</th></tr></thead><tbody>{salesPerformance.map(item => <tr key={item.assigned_to || "unassigned"} className="border-t border-slate-100 dark:border-zinc-800"><td className="px-4 py-3 font-bold dark:text-white">{item.salesperson}</td><td className="px-4 py-3">{item.deals}</td><td className="px-4 py-3">${Number(item.pipeline_value).toLocaleString()}</td><td className="px-4 py-3 font-bold text-emerald-600">${Number(item.won_revenue).toLocaleString()}</td><td className="px-4 py-3">{item.stages.Lead || 0}</td><td className="px-4 py-3">{item.stages.Negotiation || 0}</td><td className="px-4 py-3">{item.stages["Closed Won"] || 0}</td></tr>)}</tbody></table></div>}

          {/* Kanban Board */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4 pb-6">
            {STAGES.map(stage => (
              <div 
                key={stage}
                className="min-w-0 min-h-[360px] bg-slate-100 dark:bg-zinc-800/50 rounded-2xl border border-slate-200 dark:border-zinc-700 flex flex-col"
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, stage)}
              >
                <div className="p-4 border-b border-slate-200 dark:border-zinc-700 flex items-center justify-between bg-slate-100 dark:bg-zinc-800/80 rounded-t-2xl">
                  <h3 className="font-semibold text-slate-700 dark:text-zinc-200 flex items-center gap-2">
                    {stage}
                    <span className="bg-white dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 text-xs py-0.5 px-2 rounded-full font-medium border border-slate-200 dark:border-zinc-700">
                      {dealsByStage[stage].length}
                    </span>
                  </h3>
                  <span className="text-sm font-medium text-slate-500 dark:text-zinc-400">
                    ${dealsByStage[stage].reduce((sum, d) => sum + (d.value || 0), 0).toLocaleString()}
                  </span>
                </div>
                
                <div className="p-3 flex-1 overflow-y-auto space-y-3 max-h-[calc(100vh-270px)]">
                  {dealsByStage[stage].map(deal => (
                    <div
                      key={deal.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, deal)}
                      onClick={() => openDealPanel(deal)}
                      className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-slate-200 dark:border-zinc-700 shadow-sm cursor-grab active:cursor-grabbing hover:border-indigo-300 hover:shadow-md transition-all group"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="min-w-0 flex-1 break-words whitespace-normal pr-2 font-semibold leading-5 text-slate-800 dark:text-zinc-100" title={deal.title}>{deal.title}</h4>
                        <button type="button" onClick={(e) => { e.stopPropagation(); openEditDeal(deal); }} title="Edit deal" className="text-slate-400 hover:text-indigo-600 dark:text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button type="button" className="hidden text-slate-400 hover:text-slate-600 dark:text-zinc-300">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <div className="min-w-0 text-sm text-slate-500 dark:text-zinc-400 mb-3 flex items-start gap-1.5">
                        <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span className="min-w-0 break-words whitespace-normal">{deal.client_name}</span>
                      </div>
                      
                      <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-zinc-800">
                        <div className="flex items-center gap-1 text-emerald-600 font-semibold text-sm">
                          <DollarSign className="w-4 h-4" />
                          {deal.value.toLocaleString()}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          {deal.assigned_name && <p className="min-w-[72px] flex-1 break-words text-left text-[10px] font-bold text-indigo-500">Owner: {deal.assigned_name}</p>}
                          {deal.expected_close_date && (
                            <div className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-slate-400 font-medium">
                              <Calendar className="w-3.5 h-3.5" />
                              {new Date(deal.expected_close_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </main>

        {/* Add Deal Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
              <div className="p-6 border-b border-slate-100 dark:border-zinc-800">
                <h2 className="text-xl font-bold text-slate-800 dark:text-zinc-100">{editingDeal ? "Edit Deal" : t("pipeline.create_new_deal")}</h2>
              </div>
              <form onSubmit={handleAddDeal} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-zinc-200 mb-1">{t("pipeline.deal_title")}</label>
                  <input required type="text" value={newDeal.title} onChange={e => setNewDeal({...newDeal, title: e.target.value})} className="w-full px-4 py-2 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none" placeholder="e.g. Website Redesign" />
                </div>
                {role !== "SalesManager" && <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-zinc-200 mb-1">Assign Sales Owner</label>
                  <select required value={newDeal.assigned_to} onChange={e => setNewDeal({...newDeal, assigned_to: e.target.value})} className="w-full px-4 py-2 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-700 rounded-xl outline-none">
                    <option value="">Select salesperson</option>
                    {salesUsers.map(salesUser => <option key={salesUser.id} value={salesUser.id}>{salesUser.name || salesUser.email} · {salesUser.email}</option>)}
                  </select>
                </div>}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-zinc-200 mb-1">{t("pipeline.client")}</label>
                  <select required value={newDeal.client_id} onChange={e => setNewDeal({...newDeal, client_id: e.target.value})} className="w-full px-4 py-2 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none">
                    <option value="">{t("pipeline.select_client")}</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.companyName || c.email}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-zinc-200 mb-1">{t("pipeline.value_label")}</label>
                    <input type="number" step="0.01" value={newDeal.value} onChange={e => setNewDeal({...newDeal, value: e.target.value})} className="w-full px-4 py-2 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none" placeholder="0.00" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-zinc-200 mb-1">{t("pipeline.close_date")}</label>
                    <input type="date" value={newDeal.expected_close_date} onChange={e => setNewDeal({...newDeal, expected_close_date: e.target.value})} className="w-full px-4 py-2 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-zinc-200 mb-1">{t("pipeline.starting_stage")}</label>
                  <select value={newDeal.stage} onChange={e => setNewDeal({...newDeal, stage: e.target.value})} className="w-full px-4 py-2 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none">
                    {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                
                <div className="flex gap-3 pt-4 border-t border-slate-100 dark:border-zinc-800">
                  <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 font-medium rounded-xl hover:bg-slate-50 dark:bg-zinc-950 transition-colors">{t("pipeline.cancel")}</button>
                  <button type="submit" className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors shadow-sm">{editingDeal ? "Save Changes" : t("pipeline.create_deal")}</button>
                </div>
              </form>
            </div>
          </div>
        )}
        {/* SIDE PANEL */}
        <AnimatePresence>
          {selectedDeal && (
            <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="absolute top-0 right-0 h-full w-full max-w-md bg-white dark:bg-zinc-900 shadow-2xl border-l border-slate-200 dark:border-zinc-800 flex flex-col z-40">
              <div className="p-6 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between bg-slate-50 dark:bg-zinc-800/50">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100">{selectedDeal.title}</h2>
                  <p className="text-sm font-medium text-slate-500 flex items-center gap-1 mt-1"><MapPin className="w-3.5 h-3.5"/> {selectedDeal.client_name}</p>
                </div>
                <button onClick={() => setSelectedDeal(null)} className="p-2 hover:bg-slate-200 dark:hover:bg-zinc-700 rounded-full transition-colors"><X className="w-5 h-5 text-slate-500" /></button>
              </div>

              <div className="p-6 flex-1 overflow-y-auto">
                <div className="grid grid-cols-2 gap-4 mb-8">
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-xl border border-emerald-100 dark:border-emerald-800">
                    <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1">Deal Value</p>
                    <p className="text-xl font-black text-emerald-700 dark:text-emerald-400">${selectedDeal.value.toLocaleString()}</p>
                  </div>
                  <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800">
                    <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-1">Sales Owner</p>
                    <p className="text-sm font-bold text-indigo-700 dark:text-indigo-400">{selectedDeal.assigned_name || "Unassigned"}</p>
                  </div>
                </div>

                {/* Drawer Tabs */}
                <div className="flex border-b border-slate-200 dark:border-zinc-800 mb-6">
                  <button
                    onClick={() => setActiveDrawerTab("negotiations")}
                    className={`flex-1 pb-3 text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1.5 ${activeDrawerTab === "negotiations" ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-slate-400 hover:text-slate-600"}`}
                  >
                    <Handshake className="w-4 h-4" /> Negotiations ({negotiations.length})
                  </button>
                  <button
                    onClick={() => setActiveDrawerTab("proposals")}
                    className={`flex-1 pb-3 text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1.5 ${activeDrawerTab === "proposals" ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-slate-400 hover:text-slate-600"}`}
                  >
                    <FileText className="w-4 h-4" /> Proposals ({dealProposals.length})
                  </button>
                </div>

                {activeDrawerTab === "negotiations" ? (
                  <div className="space-y-6">
                    {/* Add Round Form */}
                    <form onSubmit={handleCreateNegotiation} className="bg-slate-50 dark:bg-zinc-800/60 p-4 rounded-xl border border-slate-200 dark:border-zinc-700 space-y-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">Offer / Counter-Offer</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase">Party</label>
                          <select
                            value={negForm.party}
                            onChange={e => setNegForm({ ...negForm, party: e.target.value })}
                            className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg outline-none"
                          >
                            <option value="us">Our Offer</option>
                            <option value="client">Client Counter</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase">Offer Price ($) *</label>
                          <input
                            type="number"
                            required
                            placeholder="0"
                            value={negForm.price}
                            onChange={e => setNegForm({ ...negForm, price: e.target.value })}
                            className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg outline-none"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase">Discount %</label>
                          <input
                            type="number"
                            placeholder="0"
                            value={negForm.discount_pct}
                            onChange={e => setNegForm({ ...negForm, discount_pct: e.target.value })}
                            className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase">Notes</label>
                          <input
                            type="text"
                            placeholder="Reason / Terms..."
                            value={negForm.notes}
                            onChange={e => setNegForm({ ...negForm, notes: e.target.value })}
                            className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg outline-none"
                          />
                        </div>
                      </div>
                      <button
                        type="submit"
                        disabled={savingNeg || !negForm.price}
                        className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors"
                      >
                        {savingNeg ? "Submitting..." : "Record Pricing Round"}
                      </button>
                    </form>

                    {/* Negotiation Rounds History */}
                    <div className="space-y-3">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Negotiation History</p>
                      {loadingNegotiations ? (
                        <p className="text-xs text-slate-400 text-center py-4">Loading rounds...</p>
                      ) : negotiations.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-6 border border-dashed rounded-xl">No pricing rounds recorded yet.</p>
                      ) : (
                        negotiations.map((n: any) => (
                          <div key={n.id} className="border border-slate-200 dark:border-zinc-700 rounded-xl p-3 bg-white dark:bg-zinc-900 shadow-sm space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300">
                                Round {n.round_no} • {n.party === "us" ? "Our Offer" : "Client Counter"}
                              </span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${n.status === "Accepted" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : n.status === "Rejected" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"}`}>
                                {n.status}
                              </span>
                            </div>
                            <div className="flex items-baseline justify-between">
                              <span className="text-base font-black text-slate-900 dark:text-white">${Number(n.price).toLocaleString()}</span>
                              {n.discount_pct > 0 && (
                                <span className="text-xs font-bold text-rose-500">-{n.discount_pct}% off</span>
                              )}
                            </div>
                            {n.notes && <p className="text-xs text-slate-500 dark:text-zinc-400 italic">"{n.notes}"</p>}
                            <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-zinc-800 text-[10px] text-slate-400">
                              <span>By: {n.author_name || "Sales Rep"}</span>
                              {n.status !== "Accepted" && n.status !== "Rejected" && (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => handleNegotiationAction(n.id, "accept")}
                                    className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold transition-colors"
                                  >
                                    Accept
                                  </button>
                                  <button
                                    onClick={() => handleNegotiationAction(n.id, "reject")}
                                    className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold transition-colors"
                                  >
                                    Reject
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    {loadingProposals ? (
                      <div className="py-10 text-center text-slate-400">Loading...</div>
                    ) : dealProposals.length === 0 ? (
                      <div className="py-10 text-center border-2 border-dashed border-slate-200 dark:border-zinc-700 rounded-xl">
                        <p className="text-sm text-slate-500 font-medium">No proposals linked yet.</p>
                        <p className="text-xs text-slate-400 mt-1">Create one from the Proposals module.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {dealProposals.map(p => (
                          <div key={p.id} className="border border-slate-200 dark:border-zinc-700 rounded-xl p-4 hover:border-indigo-300 transition-colors bg-slate-50 dark:bg-zinc-800/50">
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <p className="font-bold text-slate-800 dark:text-zinc-100">{p.title}</p>
                                <p className="text-xs text-slate-500 font-mono mt-0.5">{p.quote_number}</p>
                              </div>
                              <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider ${p.status === "Accepted" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                                {p.status}
                              </span>
                            </div>
                            <div className="flex items-center justify-between mt-4">
                              <p className="text-lg font-black text-slate-700 dark:text-zinc-300">
                                {p.currency === "INR" ? "₹" : p.currency === "EUR" ? "€" : p.currency === "GBP" ? "£" : "$"}{p.grand_total.toLocaleString()}
                              </p>
                              <a
                                href={p.is_proposal ? `/proposals` : `/p/${p.public_uuid}`}
                                target={p.is_proposal ? "_self" : "_blank"}
                                rel="noopener noreferrer"
                                className="text-xs font-bold text-indigo-600 flex items-center gap-1 hover:underline"
                              >
                                {p.is_proposal ? "View Proposal" : "View Web Proposal"} <ArrowUpRight className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
