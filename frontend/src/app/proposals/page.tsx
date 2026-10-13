"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, X, Loader2, FileSignature, CheckCircle, Send, Clock, XCircle, IndianRupee, Trash2, Eye, Edit3, Download, PlayCircle, Search, ShoppingCart, Package, ChevronRight, User2, Building2, Minus, AlertCircle, FileText, RefreshCw, ArrowLeft, FilePlus2, Link2, Sparkles, Check, ArrowRightLeft } from "lucide-react";
import { API_BASE_URL } from "@/config";
import { useRole } from "@/context/RoleContext";
import { useLanguage } from "@/context/LanguageContext";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface LineItem {
  product_id?: number;
  product_name: string;
  description?: string;
  quantity: number;
  unit_price: number;
  unit: string;
  currency: string;
}

interface Proposal {
  id: number;
  title: string;
  client_id?: number;
  lead_id?: number;
  deal_id?: number;
  deal_title?: string;
  deal_stage?: string;
  salesperson_id?: number;
  salesperson_name?: string;
  public_uuid?: string;
  recipient_type: string;
  client_name?: string;
  content?: string;
  line_items: LineItem[];
  currency: string;
  status: string;
  valid_until?: string;
  total_value?: number;
  signed_at?: string;
  creator_name?: string;
  created_at: string;
}

interface CatalogItem {
  id: number;
  name: string;
  code: string;
  description?: string;
  category: string;
  unit: string;
  photo_url?: string;
  unit_price: number;
  current_stock: number;
}

interface Client { id: number; companyName: string; projectName?: string; assignedEmployeeId?: number; assignedEmployeeName?: string; email?: string; }
interface Lead   { id: number; company_name?: string; contact_name?: string; email?: string; }
interface Deal   { id: number; title: string; stage: string; value: number; client_id?: number; }

type WizardStep = "recipient" | "cart" | "details";

// ─── Currency Config & Conversions (1 USD = 83.5 INR) ──────────────────────────
const USD_TO_INR_RATE = 83.5;

export function toInr(usd: number): number {
  return Math.round(usd * USD_TO_INR_RATE * 100) / 100;
}

export function toUsd(inr: number): number {
  return Math.round((inr / USD_TO_INR_RATE) * 100) / 100;
}

const CURRENCIES = [
  { code: "INR", label: "INR (₹)", symbol: "₹", icon: IndianRupee },
];

function fmtUsd(val: number): string {
  return `₹${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtInr(val: number): string {
  return `₹${val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDualCurrency(amount: number, baseCurr: string = "INR"): { usdText: string; inrText: string } {
  if (baseCurr === "INR") {
    const usd = toUsd(amount);
    return { usdText: fmtUsd(usd), inrText: fmtInr(amount) };
  }
  const inr = toInr(amount);
  return { usdText: fmtUsd(amount), inrText: fmtInr(inr) };
}

// ─── Status Config ─────────────────────────────────────────────────────────────
const STATUS_CFG: Record<string, { icon: any; color: string; dot: string; label: string }> = {
  Draft:            { icon: Edit3,       color: "text-slate-500",   dot: "bg-slate-400",   label: "Draft" },
  Sent:             { icon: Send,        color: "text-blue-600",    dot: "bg-blue-500",    label: "Proposal Sent" },
  "Proposal Sent":  { icon: Send,        color: "text-blue-600",    dot: "bg-blue-500",    label: "Proposal Sent" },
  Negotiation:      { icon: Clock,       color: "text-amber-600",   dot: "bg-amber-500",   label: "Negotiation" },
  Accepted:         { icon: CheckCircle, color: "text-emerald-600", dot: "bg-emerald-500", label: "Won / Accepted" },
  Won:              { icon: CheckCircle, color: "text-emerald-600", dot: "bg-emerald-500", label: "Won / Accepted" },
  Rejected:         { icon: XCircle,     color: "text-red-500",     dot: "bg-red-500",     label: "Lost / Rejected" },
  Lost:             { icon: XCircle,     color: "text-red-500",     dot: "bg-red-500",     label: "Lost / Rejected" },
  "Demo Requested": { icon: PlayCircle,  color: "text-violet-600",  dot: "bg-violet-500",  label: "Demo Requested" },
};

// ─── Main Proposals Component with Suspense ────────────────────────────────────
function ProposalsPageContent() {
  const { t } = useLanguage();
  const { role, user } = useRole();
  const isClient = role === "Client";
  const isAdmin = role === "Admin" || role === "SuperAdmin";
  const clientId = user?.client_id;
  const searchParams = useSearchParams();

  const [proposals, setProposals]       = useState<Proposal[]>([]);
  const [clients,   setClients]         = useState<Client[]>([]);
  const [leads,     setLeads]           = useState<Lead[]>([]);
  const [deals,     setDeals]           = useState<Deal[]>([]);
  const [catalog,   setCatalog]         = useState<CatalogItem[]>([]);
  const [loading,   setLoading]         = useState(true);
  const [filterStatus, setFilterStatus] = useState("All");
  const [convertingId, setConvertingId] = useState<number | null>(null);

  // Wizard state
  const [showWizard, setShowWizard]     = useState(false);
  const [step, setStep]                 = useState<WizardStep>("recipient");
  const [saving, setSaving]             = useState(false);

  // Recipient step
  const [recipientType, setRecipientType] = useState<"client" | "lead">("client");
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [selectedLeadId, setSelectedLeadId]     = useState<number | null>(null);
  const [recipientSearch, setRecipientSearch]   = useState("");

  // Cart step
  const [cart, setCart]                 = useState<LineItem[]>([]);
  const [currency, setCurrency]         = useState<"USD" | "INR">("INR");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogCategory, setCatalogCategory] = useState("All");

  // Custom Item Form state
  const [customName, setCustomName]     = useState("");
  const [customDesc, setCustomDesc]     = useState("");
  const [customQty, setCustomQty]       = useState("1");
  const [customUnit, setCustomUnit]     = useState("service");
  const [customInrPrice, setCustomInrPrice] = useState("");

  // Details step
  const [quoteTitle, setQuoteTitle]     = useState("");
  const [validUntil, setValidUntil]     = useState("");
  const [notes, setNotes]               = useState("");
  const [sendStatus, setSendStatus]     = useState<"Draft" | "Sent">("Sent");
  const [selectedDealId, setSelectedDealId] = useState<number | null>(null);

  // Detail view
  const [selected, setSelected]         = useState<Proposal | null>(null);

  // PDF preview
  const [preview, setPreview]           = useState<{ id: number; name: string; url: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ─── Fetch Proposals ────────────────────────────────────────────────────────
  const fetchProposals = useCallback(async () => {
    setLoading(true);
    try {
      let url = `${API_BASE_URL}/proposals`;
      if (isClient && clientId) {
        url += `?client_id=${clientId}`;
      } else if (!isAdmin && user?.id) {
        url += `?user_id=${user.id}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      setProposals(data.proposals || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [isClient, clientId, isAdmin, user?.id]);

  useEffect(() => {
    fetchProposals();
    if (!isClient) {
      const clientsUrl = !isAdmin && user?.id ? `${API_BASE_URL}/clients?assigned_employee_id=${user.id}&per_page=500` : `${API_BASE_URL}/clients?per_page=500`;
      const leadsUrl = !isAdmin && user?.id ? `${API_BASE_URL}/leads?owner_id=${user.id}` : `${API_BASE_URL}/leads`;
      const dealsUrl = !isAdmin && user?.id ? `${API_BASE_URL}/deals?user_id=${user.id}` : `${API_BASE_URL}/deals`;

      Promise.all([
        fetch(clientsUrl).then(r => r.json()),
        fetch(leadsUrl).then(r => r.json()),
        fetch(`${API_BASE_URL}/proposals/catalog`).then(r => r.json()),
        fetch(dealsUrl).then(r => r.json()),
      ]).then(([c, l, cat, d]) => {
        setClients(c.clients || []);
        setLeads(l.leads || []);
        setCatalog(cat.items || []);
        setDeals(d.deals || []);
      }).catch(console.error);
    }
  }, [fetchProposals, isClient, isAdmin, user?.id]);

  // ─── Auto-open wizard from URL query parameters ───────────────────────────
  useEffect(() => {
    const isNew = searchParams.get("new");
    const cId = searchParams.get("client_id");
    const lId = searchParams.get("lead_id");
    if (isNew === "true") {
      setShowWizard(true);
      if (cId) {
        setSelectedClientId(Number(cId));
        setRecipientType("client");
        setStep("cart");
      } else if (lId) {
        setSelectedLeadId(Number(lId));
        setRecipientType("lead");
        setStep("cart");
      } else {
        setStep("recipient");
      }
    }
  }, [searchParams]);

  // ─── Wizard Helpers ────────────────────────────────────────────────────────
  function openWizard() {
    setStep("recipient");
    setRecipientType("client");
    setSelectedClientId(null);
    setSelectedLeadId(null);
    setSelectedDealId(null);
    setRecipientSearch("");
    setCart([]);
    setCurrency("INR");
    setCatalogSearch("");
    setCatalogCategory("All");
    setQuoteTitle("");
    setValidUntil("");
    setNotes("");
    setSendStatus("Sent");
    setShowWizard(true);
  }

  function recipientName(): string {
    if (recipientType === "client") {
      const c = clients.find(c => c.id === selectedClientId);
      return c?.companyName || "";
    }
    const l = leads.find(l => l.id === selectedLeadId);
    return l?.company_name || l?.contact_name || "";
  }

  // ─── Cart Calculations ─────────────────────────────────────────────────────
  const cartTotal = useMemo(() => {
    return cart.reduce((sum, li) => sum + (li.quantity * li.unit_price), 0);
  }, [cart]);

  const dualTotal = useMemo(() => {
    return fmtDualCurrency(cartTotal, currency);
  }, [cartTotal, currency]);

  function addToCart(item: CatalogItem) {
    // Catalog prices are stored in INR
    const finalPrice = item.unit_price > 0 ? item.unit_price : 100;

    setCart(prev => {
      const existing = prev.findIndex(c => c.product_id === item.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { ...updated[existing], quantity: updated[existing].quantity + 1 };
        return updated;
      }
      return [...prev, {
        product_id: item.id,
        product_name: item.name,
        description: item.description,
        quantity: 1,
        unit_price: finalPrice,
        unit: item.unit || "pcs",
        currency,
      }];
    });
  }

  function addCustomItem() {
    if (!customName.trim()) return;
    const qty = Math.max(1, parseFloat(customQty) || 1);
    const price = parseFloat(customInrPrice) || 0;

    setCart(prev => [...prev, {
      product_name: customName.trim(),
      description: customDesc.trim() || undefined,
      quantity: qty,
      unit_price: price,
      unit: customUnit.trim() || "service",
      currency,
    }]);

    setCustomName("");
    setCustomDesc("");
    setCustomQty("1");
    setCustomInrPrice("");
  }

  function removeFromCart(idx: number) {
    setCart(prev => prev.filter((_, i) => i !== idx));
  }

  function updateCartQty(idx: number, qty: number) {
    if (qty <= 0) { removeFromCart(idx); return; }
    setCart(prev => prev.map((li, i) => i === idx ? { ...li, quantity: qty } : li));
  }

  // Two-way price updates for an existing cart line item
  function updateCartPriceUsd(idx: number, usdVal: number) {
    const targetPrice = currency === "USD" ? usdVal : toInr(usdVal);
    setCart(prev => prev.map((li, i) => i === idx ? { ...li, unit_price: targetPrice } : li));
  }

  function updateCartPriceInr(idx: number, inrVal: number) {
    const targetPrice = currency === "INR" ? inrVal : toUsd(inrVal);
    setCart(prev => prev.map((li, i) => i === idx ? { ...li, unit_price: targetPrice } : li));
  }

  // When proposal currency base switches
  function switchCurrency(newCurr: "USD" | "INR") {
    if (newCurr === currency) return;
    setCurrency(newCurr);
    setCart(prev => prev.map(li => ({
      ...li,
      currency: newCurr,
      unit_price: newCurr === "INR" ? toInr(li.unit_price) : toUsd(li.unit_price),
    })));
  }

  // ─── Submit Proposal ────────────────────────────────────────────────────────
  async function submitQuote() {
    setSaving(true);
    // Total is stored directly in the proposal currency (INR)
    const totalValue = cartTotal;
    const autoTitle = quoteTitle.trim() ||
      `Commercial Proposal for ${recipientName()} – ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

    try {
      const res = await fetch(`${API_BASE_URL}/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: autoTitle,
          client_id: recipientType === "client" ? selectedClientId : null,
          lead_id: recipientType === "lead" ? selectedLeadId : null,
          recipient_type: recipientType,
          content: notes || null,
          status: sendStatus,
          valid_until: validUntil || null,
          total_value: totalValue,
          line_items: cart,
          currency,
          deal_id: selectedDealId || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to create proposal");
        return;
      }

      setShowWizard(false);
      await fetchProposals();
    } catch (err) {
      console.error(err);
      alert("Failed to submit proposal.");
    } finally {
      setSaving(false);
    }
  }

  // ─── Update Proposal Status (Multi-Way Sync) ───────────────────────────────
  async function updateStatus(id: number, newStatus: string) {
    try {
      const res = await fetch(`${API_BASE_URL}/proposals/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setProposals(prev => prev.map(p => p.id === id ? { ...p, status: newStatus } : p));
        if (selected?.id === id) setSelected(s => s ? { ...s, status: newStatus } : s);
      }
    } catch (e) { console.error(e); }
  }

  async function deleteProposal(id: number) {
    if (!confirm(t("proposals.confirm_delete") || "Are you sure you want to delete this proposal?")) return;
    await fetch(`${API_BASE_URL}/proposals/${id}`, { method: "DELETE" });
    setProposals(prev => prev.filter(p => p.id !== id));
    setSelected(null);
  }

  function downloadPDF(id: number) {
    const uid = user?.id ? `?user_id=${user.id}` : "";
    window.open(`${API_BASE_URL}/proposals/${id}/pdf${uid}`, "_blank");
  }

  function previewPDF(id: number) {
    const uid = user?.id ? `?user_id=${user.id}` : "";
    const p = proposals.find(x => x.id === id);
    setPreviewLoading(true);
    fetch(`${API_BASE_URL}/proposals/${id}/pdf${uid}`)
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.blob(); })
      .then(blob => setPreview({ id, name: p?.title || `Q-${String(id).padStart(4, "0")}`, url: URL.createObjectURL(new Blob([blob], { type: "application/pdf" })) }))
      .catch(() => alert("Failed to load PDF preview."))
      .finally(() => setPreviewLoading(false));
  }

  function closePreview() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  // ─── Filtered Data ──────────────────────────────────────────────────────────
  const filtered = filterStatus === "All"
    ? proposals
    : proposals.filter(p => {
        if (filterStatus === "Sent") return p.status === "Sent" || p.status === "Proposal Sent";
        if (filterStatus === "Accepted") return p.status === "Accepted" || p.status === "Won";
        if (filterStatus === "Rejected") return p.status === "Rejected" || p.status === "Lost";
        return p.status === filterStatus;
      });

  const catalogCategories = ["All", ...Array.from(new Set(catalog.map(i => i.category || "General")))];
  const filteredCatalog = catalog.filter(item => {
    const matchCat = catalogCategory === "All" || item.category === catalogCategory;
    const matchQ   = !catalogSearch || item.name.toLowerCase().includes(catalogSearch.toLowerCase());
    return matchCat && matchQ;
  });

  const filteredRecipients = recipientType === "client"
    ? clients.filter(c => !recipientSearch || (c.companyName || "").toLowerCase().includes(recipientSearch.toLowerCase()))
    : leads.filter(l => {
        const name = (l.company_name || l.contact_name || "").toLowerCase();
        return !recipientSearch || name.includes(recipientSearch.toLowerCase());
      });

  const stats = {
    total: proposals.length,
    sent: proposals.filter(p => p.status === "Sent" || p.status === "Proposal Sent").length,
    negotiation: proposals.filter(p => p.status === "Negotiation").length,
    accepted: proposals.filter(p => p.status === "Accepted" || p.status === "Won").length,
    value: proposals.filter(p => p.status === "Accepted" || p.status === "Won")
      .reduce((s, p) => s + (p.total_value || 0), 0),
  };

  return (
    <div className="flex flex-col h-full bg-[#f8fafc] dark:bg-black min-h-screen">

      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-black">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
              <span>Proposals &amp; Quotations</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                INR (₹) Engine
              </span>
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Two-way auto currency conversion · Instant stage sync across Client Hub, Deals Pipeline &amp; Revenue
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={fetchProposals} title="Refresh proposals list"
              className="p-2.5 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
            {!isClient && (
              <button id="create-quotation-btn" onClick={openWizard}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-all hover:shadow-md active:scale-95">
                <Plus className="w-4 h-4" /> Create Proposal
              </button>
            )}
          </div>
        </div>

        {/* Currency Rate Banner & Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
          {[
            { label: "Total Proposals", value: stats.total, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-900/20" },
            { label: "Proposals Sent", value: stats.sent, color: "text-sky-600", bg: "bg-sky-50 dark:bg-sky-900/20" },
            { label: "In Negotiation", value: stats.negotiation, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-900/20" },
            { label: "Won Deals", value: stats.accepted, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
            {
              label: "Won Revenue (₹)",
              value: `₹${(stats.value/1000).toFixed(1)}k / ₹${(toInr(stats.value)/100000).toFixed(1)}L`,
              color: "text-violet-600",
              bg: "bg-violet-50 dark:bg-violet-900/20"
            },
          ].map(s => (
            <div key={s.label} className={`flex flex-col justify-center px-4 py-3 rounded-xl ${s.bg}`}>
              <p className={`text-lg font-black ${s.color}`}>{loading ? "—" : s.value}</p>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 font-semibold">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── FILTER BAR ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-6 py-3 bg-white dark:bg-black border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        <div className="flex gap-2">
          {["All", "Sent", "Negotiation", "Accepted", "Rejected", "Draft"].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                filterStatus === s
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              }`}>
              {s === "Sent" ? "Proposal Sent" : s === "Accepted" ? "Won" : s === "Rejected" ? "Lost" : s}
            </button>
          ))}
        </div>
        <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 font-medium shrink-0 bg-slate-50 dark:bg-zinc-900 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-800">
          <ArrowRightLeft className="w-3.5 h-3.5 text-blue-500" />
          <span>Base Currency: <strong>INR (₹)</strong></span>
        </div>
      </div>

      {/* ── LIST ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <FileSignature className="w-12 h-12 text-slate-300 mb-3" />
            <p className="text-slate-500 font-medium">No proposals matching your filter.</p>
            {!isClient && (
              <button onClick={openWizard} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">
                Create Proposal
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(p => {
              const cfg = STATUS_CFG[p.status] || STATUS_CFG.Draft;
              const inrVal = p.total_value || 0;

              return (
                <div key={p.id}
                  onClick={() => setSelected(p)}
                  className="bg-white dark:bg-[#111] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 cursor-pointer hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-700 transition-all group flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
                          PROP-{String(p.id).padStart(4, "0")}
                        </span>
                        <h3 className="font-semibold text-slate-900 dark:text-white text-sm leading-tight truncate mt-0.5">
                          {p.title}
                        </h3>
                      </div>
                      <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${cfg.color} bg-slate-100 dark:bg-slate-800`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                    </div>

                    {p.client_name && (
                      <div className="flex items-center gap-1.5 mb-2.5">
                        {p.recipient_type === "lead"
                          ? <User2 className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                          : <Building2 className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
                        <span className="text-xs text-slate-700 dark:text-slate-300 truncate font-semibold">
                          {p.client_name}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ml-auto ${
                          p.recipient_type === "lead"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                        }`}>
                          {p.recipient_type === "lead" ? "Lead" : "Client"}
                        </span>
                      </div>
                    )}

                    {/* Salesperson & Pipeline Deal Badge */}
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-3 bg-slate-50 dark:bg-zinc-900/70 px-2.5 py-1.5 rounded-xl border border-slate-100 dark:border-zinc-800/80">
                      <div className="flex items-center gap-1.5 truncate">
                        <User2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <span className="truncate font-medium">{p.salesperson_name || p.creator_name || "Sales Rep"}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-blue-100/70 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 shrink-0">
                        <span>Pipeline:</span>
                        <span>{p.deal_stage || (p.status === "Sent" ? "Proposal Sent" : p.status === "Accepted" ? "Closed Won" : "Negotiation")}</span>
                      </div>
                    </div>

                    {p.line_items?.length > 0 && (
                      <div className="mb-3 flex flex-wrap gap-1">
                        {p.line_items.slice(0, 2).map((li, i) => (
                          <span key={i} className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded-md">
                            {li.product_name} ×{li.quantity}
                          </span>
                        ))}
                        {p.line_items.length > 2 && (
                          <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-400 px-2 py-0.5 rounded-md">
                            +{p.line_items.length - 2} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Amount & Row Actions */}
                  <div className="flex items-center justify-between mt-2 pt-2.5 border-t border-slate-100 dark:border-zinc-800/80">
                    <div>
                      <div className="text-base font-black text-slate-900 dark:text-white">
                        {fmtInr(inrVal)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {p.public_uuid && (
                        <a
                          href={`/p/${p.public_uuid}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 transition-colors"
                          title="Open Live Public Web Proposal">
                          <Link2 className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); previewPDF(p.id); }}
                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-purple-100 text-slate-500 hover:text-purple-600 dark:bg-slate-800 dark:hover:bg-purple-900/30 dark:text-slate-400 dark:hover:text-purple-400 transition-colors"
                        title="Preview PDF">
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); downloadPDF(p.id); }}
                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-blue-100 text-slate-500 hover:text-blue-600 dark:bg-slate-800 dark:hover:bg-blue-900/30 dark:text-slate-400 dark:hover:text-blue-400 transition-colors"
                        title="Download PDF">
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); deleteProposal(p.id); }}
                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-500 dark:bg-slate-800 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition-colors"
                        title="Delete Proposal">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {p.valid_until && (
                    <p className="text-[10px] text-slate-400 mt-2 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Valid until: {p.valid_until}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* DETAIL PANEL                                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {selected && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-start justify-between p-6 border-b border-slate-200 dark:border-slate-800">
              <div>
                <span className="text-xs font-mono text-slate-400">PROP-{String(selected.id).padStart(4, "0")}</span>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">{selected.title}</h2>
                {selected.client_name && (
                  <p className="text-sm text-slate-500 mt-0.5 flex items-center gap-1.5">
                    {selected.recipient_type === "lead"
                      ? <User2 className="w-3.5 h-3.5 text-amber-500" />
                      : <Building2 className="w-3.5 h-3.5 text-blue-500" />}
                    {selected.client_name}
                  </p>
                )}
              </div>
              <button onClick={() => setSelected(null)} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Synchronized Stage Updater */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Sync Status across CRM</p>
                  <span className="text-[11px] text-blue-600 font-semibold">Updates Client &amp; Deal automatically</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: "Sent", label: "Proposal Sent", icon: Send },
                    { id: "Negotiation", label: "Negotiation", icon: Clock },
                    { id: "Accepted", label: "Won (Accepted)", icon: CheckCircle },
                    { id: "Rejected", label: "Lost (Rejected)", icon: XCircle },
                    { id: "Draft", label: "Draft", icon: Edit3 },
                  ].map(s => {
                    const isCurrent = selected.status === s.id || (s.id === "Sent" && selected.status === "Proposal Sent");
                    return (
                      <button key={s.id} onClick={() => updateStatus(selected.id, s.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                          isCurrent
                            ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-600 shadow-sm"
                            : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                        }`}>
                        <s.icon className="w-3.5 h-3.5" />{s.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Line items with Dual Currency */}
              {selected.line_items?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2">
                    Line Items &amp; Pricing
                  </p>
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900 text-left">
                          <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400 text-xs">Product / Service</th>
                          <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400 text-xs text-right">Qty</th>
                          <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400 text-xs text-right">Unit (₹)</th>
                          <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400 text-xs text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.line_items.map((li, i) => {
                          const liInr = li.currency === "INR" ? li.unit_price : toInr(li.unit_price);
                          const totalInr = liInr * li.quantity;

                          return (
                            <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                              <td className="px-3 py-2.5 text-slate-900 dark:text-white">
                                <p className="font-semibold">{li.product_name}</p>
                                {li.description && <p className="text-xs text-slate-400">{li.description}</p>}
                              </td>
                              <td className="px-3 py-2.5 text-right text-slate-600 dark:text-slate-300 font-mono">
                                {li.quantity} {li.unit || "pcs"}
                              </td>
                              <td className="px-3 py-2.5 text-right text-slate-600 dark:text-slate-300 font-mono text-xs">
                                <div>{fmtInr(liInr)}</div>
                              </td>
                              <td className="px-3 py-2.5 text-right font-bold text-slate-900 dark:text-white font-mono">
                                <div>{fmtInr(totalInr)}</div>
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                          <td colSpan={3} className="px-3 py-2.5 font-bold text-slate-900 dark:text-white text-right">
                            Grand Total:
                          </td>
                          <td className="px-3 py-2.5 text-right font-black text-blue-600 text-base font-mono">
                            <div>{fmtInr(selected.currency === "INR" ? (selected.total_value || 0) : toInr(selected.total_value || 0))}</div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Notes */}
              {selected.content && (
                <div>
                  <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-1.5">Proposal Notes &amp; Scope</p>
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-900 rounded-xl p-3">{selected.content}</p>
                </div>
              )}

              {/* Meta information */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Assigned Sales Rep", value: selected.salesperson_name || selected.creator_name || "Unassigned" },
                  { label: "Deals Pipeline",    value: `Stage: ${selected.deal_stage || "Negotiation"}` },
                  { label: "Valid Until",       value: selected.valid_until || "—" },
                  { label: "Exchange Rate",     value: "INR (₹)" },
                  { label: "Created Date",      value: new Date(selected.created_at).toLocaleDateString("en-US") },
                  { label: "Created By",        value: selected.creator_name || "Sales Admin" },
                ].map(m => (
                  <div key={m.label} className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">{m.label}</p>
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{m.value}</p>
                  </div>
                ))}
              </div>

              {/* Public Proposal Link */}
              {selected.public_uuid && (
                <div className="p-3.5 bg-blue-50/70 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800/60 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-blue-900 dark:text-blue-300">Live Client Proposal &amp; Digital Sign Link</p>
                    <p className="text-xs text-slate-500 truncate font-mono">/p/{selected.public_uuid}</p>
                  </div>
                  <a
                    href={`/p/${selected.public_uuid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shrink-0 transition-colors shadow-sm"
                  >
                    <span>Open Public Web View</span>
                    <Link2 className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button onClick={() => previewPDF(selected.id)}
                  className="px-4 py-2.5 bg-purple-50 text-purple-600 rounded-xl font-semibold text-sm hover:bg-purple-100 dark:bg-purple-900/20 dark:text-purple-400 dark:hover:bg-purple-900/30 transition-colors">
                  <Eye className="w-4 h-4" />
                </button>
                <button onClick={() => downloadPDF(selected.id)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors">
                  <Download className="w-4 h-4" /> Download PDF
                </button>
                {selected.status === 'Accepted' && (
                  <button
                    onClick={async () => {
                      if (!confirm('Convert this proposal to an invoice?')) return;
                      setConvertingId(selected.id);
                      try {
                        const res = await fetch(`${API_BASE_URL}/proposals/${selected.id}/convert-to-invoice`, { method: 'POST' });
                        if (res.ok) {
                          alert('Invoice created! Go to Billing → Invoices to view it.');
                        } else {
                          const d = await res.json().catch(() => ({}));
                          alert(d.detail || 'Failed to convert.');
                        }
                      } finally { setConvertingId(null); }
                    }}
                    disabled={convertingId === selected.id}
                    className="px-4 py-2.5 bg-emerald-50 text-emerald-700 rounded-xl font-semibold text-sm hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    title="Convert to Invoice"
                  >
                    {convertingId === selected.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePlus2 className="w-4 h-4" />}
                    Invoice
                  </button>
                )}
                <button onClick={() => deleteProposal(selected.id)}
                  className="px-4 py-2.5 bg-red-50 text-red-600 rounded-xl font-semibold text-sm hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PDF PREVIEW MODAL                                                   */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {preview && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-zinc-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">{preview.name} (PDF Preview)</h3>
              <button onClick={closePreview} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="flex-1 bg-slate-100 dark:bg-black">
              <iframe src={preview.url} className="w-full h-full border-0" />
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PROPOSAL CREATION WIZARD (WITH TWO-WAY USD <-> INR CONVERSION)     */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {showWizard && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111] rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[92vh] overflow-hidden">
            {/* Wizard Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#161616]">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Create Commercial Proposal</h2>
                <p className="text-xs text-slate-500">Currency: ₹ INR</p>
              </div>
              <button onClick={() => setShowWizard(false)} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Stepper */}
            <div className="flex border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111]">
              {[
                { id: "recipient", num: "1", title: "Select Client" },
                { id: "cart",      num: "2", title: "Products & Pricing (₹)" },
                { id: "details",   num: "3", title: "Terms & Send" },
              ].map(s => {
                const isActive = step === s.id;
                return (
                  <div key={s.id}
                    className={`flex-1 py-3 px-4 flex items-center gap-2 border-b-2 font-medium text-xs transition-colors ${
                      isActive ? "border-blue-600 text-blue-600 dark:text-blue-400 font-bold bg-blue-50/50 dark:bg-blue-950/20" : "border-transparent text-slate-400"
                    }`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      isActive ? "bg-blue-600 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                    }`}>
                      {s.num}
                    </span>
                    <span>{s.title}</span>
                  </div>
                );
              })}
            </div>

            {/* ── STEP 1: RECIPIENT ────────────────────────────────────── */}
            {step === "recipient" && (
              <div className="p-6 flex-1 overflow-y-auto">
                <div className="flex gap-2 mb-4">
                  <button onClick={() => { setRecipientType("client"); setSelectedLeadId(null); }}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors flex items-center justify-center gap-1.5 ${
                      recipientType === "client" ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" : "border-slate-200 dark:border-slate-700 text-slate-500"
                    }`}>
                    <Building2 className="w-4 h-4" /> Existing Client
                  </button>
                  <button onClick={() => { setRecipientType("lead"); setSelectedClientId(null); }}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors flex items-center justify-center gap-1.5 ${
                      recipientType === "lead" ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" : "border-slate-200 dark:border-slate-700 text-slate-500"
                    }`}>
                    <User2 className="w-4 h-4" /> Pipeline Lead
                  </button>
                </div>

                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    value={recipientSearch}
                    onChange={e => setRecipientSearch(e.target.value)}
                    placeholder={`Search ${recipientType === "client" ? "clients" : "leads"}…`}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {filteredRecipients.map((r: any) => {
                    const isSelected = recipientType === "client" ? selectedClientId === r.id : selectedLeadId === r.id;
                    const name = recipientType === "client" ? r.companyName : (r.company_name || r.contact_name);
                    return (
                      <button key={r.id}
                        onClick={() => {
                          if (recipientType === "client") setSelectedClientId(r.id);
                          else setSelectedLeadId(r.id);
                        }}
                        className={`w-full p-3 rounded-xl border text-left flex items-center gap-3 transition-colors ${
                          isSelected ? "border-blue-500 bg-blue-50/70 dark:bg-blue-950/30" : "border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                        }`}>
                        <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center shrink-0">
                          {recipientType === "client" ? <Building2 className="w-4 h-4" /> : <User2 className="w-4 h-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-xs text-slate-900 dark:text-white truncate">{name}</p>
                          {r.email && <p className="text-[11px] text-slate-400 truncate">{r.email}</p>}
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
                      </button>
                    );
                  })}
                  {filteredRecipients.length === 0 && (
                    <p className="text-center text-slate-400 py-8 text-xs">No matching clients found.</p>
                  )}
                </div>

                {recipientType === "client" && selectedClientId && (
                  (() => {
                    const selClient = clients.find(c => c.id === selectedClientId);
                    return (
                      <div className="mt-4 p-3.5 rounded-xl bg-blue-50/90 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">Sales Representative:</span>
                          <span className="font-bold text-blue-700 dark:text-blue-300">{selClient?.assignedEmployeeName || user?.name || "Auto-assigned"}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">
                          ⚡ Sending this proposal will immediately update the client to <strong>Proposal Sent</strong> and keep deals pipeline synchronized.
                        </p>
                      </div>
                    );
                  })()
                )}

                <div className="mt-6 flex justify-end">
                  <button
                    disabled={recipientType === "client" ? !selectedClientId : !selectedLeadId}
                    onClick={() => setStep("cart")}
                    className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Continue to Products &amp; Pricing →
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 2: CART & DUAL CURRENCY AUTO CONVERSION ─────────── */}
            {step === "cart" && (
              <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
                {/* Left: Custom Product Form & Catalog */}
                <div className="flex-1 overflow-y-auto p-5 border-r border-slate-200 dark:border-slate-800 space-y-5">
                  {/* Currency Selector & Live Rate */}
                  <div className="flex items-center justify-between bg-blue-50/60 dark:bg-blue-950/20 p-3 rounded-xl border border-blue-100 dark:border-blue-900/40">
                    <div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white">Proposal Base Currency</p>
                      <p className="text-[11px] text-slate-500">All amounts shown in Rupees (₹)</p>
                    </div>
                    <div className="flex gap-1 bg-white dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                      {CURRENCIES.map(c => (
                        <button key={c.code} onClick={() => switchCurrency(c.code as "USD" | "INR")}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                            currency === c.code
                              ? "bg-blue-600 text-white shadow-sm"
                              : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                          }`}>
                          <c.icon className="w-3.5 h-3.5" />{c.code}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── ADD CUSTOM SERVICE / PRODUCT WITH TWO-WAY CONVERTER ── */}
                  <div className="bg-slate-50 dark:bg-zinc-900/80 p-4 rounded-xl border border-slate-200 dark:border-zinc-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                        Add Custom Service / Line Item
                      </span>
                      <span className="text-[10px] font-semibold text-blue-600 bg-blue-100/60 dark:bg-blue-900/40 px-2 py-0.5 rounded">
                        Two-Way Conversion
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        value={customName}
                        onChange={e => setCustomName(e.target.value)}
                        placeholder="Service or Product Title (e.g. BPO Sprint)"
                        className="px-3 py-2 bg-white dark:bg-black border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <input
                        value={customDesc}
                        onChange={e => setCustomDesc(e.target.value)}
                        placeholder="Scope / SLA Description (optional)"
                        className="px-3 py-2 bg-white dark:bg-black border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Quantity</label>
                        <input
                          type="number"
                          min="1"
                          value={customQty}
                          onChange={e => setCustomQty(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-black border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Unit</label>
                        <input
                          value={customUnit}
                          onChange={e => setCustomUnit(e.target.value)}
                          placeholder="service / mo"
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-black border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                        />
                      </div>
                      {/* Price in Rupees */}
                      <div>
                        <label className="text-[10px] font-black text-blue-600 block mb-0.5">Price in Rupees (₹ INR)</label>
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-bold">₹</span>
                          <input
                            type="number"
                            step="0.01"
                            value={customInrPrice}
                            onChange={e => setCustomInrPrice(e.target.value)}
                            placeholder="0.00"
                            className="w-full pl-6 pr-2 py-1.5 bg-white dark:bg-black border border-blue-300 dark:border-blue-700 rounded-lg text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        onClick={addCustomItem}
                        disabled={!customName.trim()}
                        className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add to Proposal
                      </button>
                    </div>
                  </div>

                  {/* ── CATALOG ITEMS ── */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Pick from Catalog</p>
                      <span className="text-[11px] text-slate-400">{filteredCatalog.length} available</span>
                    </div>

                    <div className="flex gap-2 mb-3">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <input value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)}
                          placeholder="Search catalog items…"
                          className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
                      </div>
                      <select value={catalogCategory} onChange={e => setCatalogCategory(e.target.value)}
                        className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-300">
                        {catalogCategories.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto">
                      {filteredCatalog.map(item => {
                        const inCart = cart.find(c => c.product_id === item.id);
                        const price = item.unit_price > 0 ? item.unit_price : 100;

                        return (
                          <button key={item.id} onClick={() => addToCart(item)}
                            className={`text-left p-2.5 rounded-xl border transition-all text-xs flex items-center justify-between gap-2 ${
                              inCart ? "border-blue-400 bg-blue-50/70 dark:bg-blue-900/20" : "border-slate-200 dark:border-slate-800 hover:border-blue-300"
                            }`}>
                            <div className="min-w-0 flex-1">
                              <p className="font-bold text-slate-900 dark:text-white truncate">{item.name}</p>
                              <p className="text-[10px] text-slate-400 truncate">{item.category} · {item.unit || "pcs"}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-black text-blue-600 font-mono">{fmtInr(price)}</div>
                            </div>
                            {inCart && (
                              <span className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0">
                                ×{inCart.quantity}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Right: Cart Review with Live Two-Way Price Edit */}
                <div className="w-full md:w-80 flex flex-col bg-slate-50 dark:bg-[#0a0a0a] border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800">
                  <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShoppingCart className="w-4 h-4 text-blue-600" />
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">Proposal Cart ({cart.length})</p>
                    </div>
                    <span className="text-[11px] font-bold text-blue-600 font-mono">{currency}</span>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 space-y-2 max-h-[380px]">
                    {cart.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-48 text-slate-400 text-center px-4">
                        <ShoppingCart className="w-8 h-8 mb-2 opacity-30" />
                        <p className="text-xs font-semibold">Your proposal cart is empty</p>
                        <p className="text-[11px] text-slate-400 mt-1">Add items from the catalog or create a custom service above.</p>
                      </div>
                    ) : cart.map((li, idx) => {
                      const liInr = li.currency === "INR" ? li.unit_price : toInr(li.unit_price);
                      const subtotalInr = liInr * li.quantity;

                      return (
                        <div key={idx} className="bg-white dark:bg-[#111] rounded-xl p-3 border border-slate-200 dark:border-slate-800 text-xs">
                          <div className="flex items-start justify-between gap-1 mb-1.5">
                            <p className="font-bold text-slate-900 dark:text-white truncate flex-1">{li.product_name}</p>
                            <button onClick={() => removeFromCart(idx)} className="text-slate-300 hover:text-red-500 transition-colors">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Qty controls */}
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => updateCartQty(idx, li.quantity - 1)} className="w-5 h-5 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center hover:bg-slate-200">
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="font-bold w-6 text-center font-mono">{li.quantity}</span>
                              <button onClick={() => updateCartQty(idx, li.quantity + 1)} className="w-5 h-5 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center hover:bg-slate-200">
                                <Plus className="w-3 h-3" />
                              </button>
                              <span className="text-[10px] text-slate-400">{li.unit}</span>
                            </div>
                            <div className="text-right">
                              <div className="font-black text-blue-600 font-mono">{fmtInr(subtotalInr)}</div>
                            </div>
                          </div>

                          {/* Live unit price input */}
                          <div className="pt-1.5 border-t border-slate-100 dark:border-zinc-800">
                            <div>
                              <span className="text-[9px] font-bold text-blue-600 block">Unit (₹ INR)</span>
                              <input
                                type="number"
                                step="0.01"
                                value={liInr}
                                onChange={e => updateCartPriceInr(idx, parseFloat(e.target.value) || 0)}
                                className="w-full px-1.5 py-0.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-[11px] font-mono text-slate-900 dark:text-white"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Total Summary */}
                  <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111]">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs text-slate-500 font-semibold">Total:</span>
                      <span className="text-base font-black text-blue-600 font-mono">{dualTotal.inrText}</span>
                    </div>

                    <div className="flex gap-2">
                      <button onClick={() => setStep("recipient")}
                        className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Back
                      </button>
                      <button disabled={cart.length === 0} onClick={() => setStep("details")}
                        className="flex-1 py-2 bg-blue-600 text-white rounded-xl font-bold text-xs hover:bg-blue-700 disabled:opacity-40 transition-colors">
                        Continue to Terms &amp; Send →
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 3: DETAILS & SEND ───────────────────────────────── */}
            {step === "details" && (
              <div className="flex-1 overflow-y-auto p-6 max-w-xl mx-auto w-full space-y-4">
                {/* Summary banner */}
                <div className="bg-blue-50 dark:bg-blue-950/30 rounded-2xl p-4 border border-blue-200 dark:border-blue-900/50">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-bold text-sm text-slate-900 dark:text-white">{recipientName()}</p>
                    <span className="text-xs font-mono font-bold text-blue-600 uppercase">{currency} Proposal</span>
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <div className="text-xl font-black text-blue-700 dark:text-blue-400 font-mono">
                      {dualTotal.inrText}
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">{cart.length} line item{cart.length !== 1 ? "s" : ""} included.</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                    Proposal Title
                  </label>
                  <input
                    value={quoteTitle}
                    onChange={e => setQuoteTitle(e.target.value)}
                    placeholder={`Commercial Proposal for ${recipientName()}`}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                    Valid Until Date
                  </label>
                  <input
                    type="date"
                    value={validUntil}
                    onChange={e => setValidUntil(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                    Scope of Work / Commercial Terms
                  </label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Enter delivery timeline, operational milestones, payment terms, or custom notes…"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>

                {/* Pipeline Integration */}
                {recipientType === "client" && selectedClientId && (
                  <div>
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                      Deals Pipeline Stage Sync
                    </label>
                    <select
                      value={selectedDealId || ""}
                      onChange={e => setSelectedDealId(e.target.value ? Number(e.target.value) : null)}
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">⚡ Auto-sync with Client's Active Deal (Stage: Proposal Sent)</option>
                      {deals
                        .filter(d => d.client_id === selectedClientId && d.stage !== "Closed Won" && d.stage !== "Closed Lost")
                        .map(d => (
                          <option key={d.id} value={d.id}>
                            Link to Deal: {d.title} ({d.stage} — ${d.value?.toLocaleString()})
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                {/* Proposal Status Options */}
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                    Action upon Creation
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSendStatus("Sent")}
                      className={`p-3 rounded-xl border-2 text-left transition-all ${
                        sendStatus === "Sent"
                          ? "border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 shadow-sm"
                          : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      <div className="flex items-center gap-2 font-bold text-xs">
                        <Send className="w-3.5 h-3.5 text-blue-600" />
                        <span>Send Proposal to Client</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Automatically changes client status to <strong>Proposal Sent</strong>.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSendStatus("Draft")}
                      className={`p-3 rounded-xl border-2 text-left transition-all ${
                        sendStatus === "Draft"
                          ? "border-slate-600 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm"
                          : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      <div className="flex items-center gap-2 font-bold text-xs">
                        <Edit3 className="w-3.5 h-3.5 text-slate-600" />
                        <span>Save as Draft</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Keeps proposal internal until ready for client delivery.
                      </p>
                    </button>
                  </div>
                </div>

                <div className="flex gap-3 pt-3">
                  <button onClick={() => setStep("cart")}
                    className="px-6 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300">
                    Back
                  </button>
                  <button onClick={submitQuote} disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-xs hover:bg-blue-700 disabled:opacity-50 transition-all shadow-md active:scale-95">
                    {saving ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Creating Proposal…</>
                    ) : (
                      <><FileText className="w-4 h-4" /> {sendStatus === "Sent" ? "Generate & Send Proposal" : "Save Proposal as Draft"}</>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProposalsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-[#f8fafc] dark:bg-black">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    }>
      <ProposalsPageContent />
    </Suspense>
  );
}
