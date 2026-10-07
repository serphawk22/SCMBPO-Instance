"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserX,
  X,
  Loader2,
  DollarSign,
  Calendar,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Building2,
  FileText,
  Tag,
  ArrowUpRight
} from "lucide-react";
import { API_BASE_URL } from "@/config";

export const REASON_CATEGORIES = [
  "Price",
  "Service Quality",
  "Competition",
  "No Budget",
  "Merger/Acquisition",
  "Scope Change",
  "Project Completed",
  "Unresponsive",
  "Other"
];

export const REACTIVATION_OPTIONS = ["Low", "Medium", "High"] as const;

export const REACTIVATION_CONFIG = {
  Low: {
    badge: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-200 dark:border-red-900/40",
    btnActive: "bg-red-600 text-white shadow-sm shadow-red-500/30"
  },
  Medium: {
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-900/40",
    btnActive: "bg-amber-600 text-white shadow-sm shadow-amber-500/30"
  },
  High: {
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/40",
    btnActive: "bg-emerald-600 text-white shadow-sm shadow-emerald-500/30"
  }
};

interface DropClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  client: {
    id: number;
    companyName?: string;
    company_name?: string;
    projectName?: string;
    deal_value?: number | string;
    status?: string;
    customFields?: any;
    created_at?: string;
  };
  onSuccess?: (data?: any) => void;
  mode?: "drop" | "view";
}

export default function DropClientModal({
  isOpen,
  onClose,
  client,
  onSuccess,
  mode = "drop"
}: DropClientModalProps) {
  const companyName =
    client?.company_name ||
    client?.companyName ||
    client?.projectName ||
    "Client";

  const [form, setForm] = useState({
    company_name: "",
    reason: "",
    reason_category: "Price",
    last_revenue: "",
    relationship_months: "6",
    reactivation_potential: "Low" as "Low" | "Medium" | "High",
    notes: ""
  });

  const [saving, setSaving] = useState(false);
  const [existingRecord, setExistingRecord] = useState<any>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Pre-fill form when modal opens
  useEffect(() => {
    if (isOpen && client) {
      const revenue = client.deal_value || client.customFields?.total_revenue || 0;
      setForm({
        company_name: companyName,
        reason: "",
        reason_category: "Price",
        last_revenue: revenue ? String(revenue).replace(/[^0-9.]/g, "") : "",
        relationship_months: "6",
        reactivation_potential: "Low",
        notes: ""
      });
      setErrorMsg(null);

      // Check if client is already dropped or if we should fetch existing dropped record
      if (client.status === "Dropped" || mode === "view") {
        fetchExistingDrop();
      }
    }
  }, [isOpen, client, mode]);

  const fetchExistingDrop = async () => {
    if (!client?.id) return;
    setLoadingExisting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/dropped-clients/by-client/${client.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.dropped_client) {
          setExistingRecord(data.dropped_client);
        }
      }
    } catch (err) {
      console.error("Error fetching drop record:", err);
    } finally {
      setLoadingExisting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.reason.trim()) {
      setErrorMsg("Please provide a reason why this client is being dropped.");
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${API_BASE_URL}/dropped-clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: client.id,
          company_name: form.company_name.trim() || companyName,
          reason: form.reason.trim(),
          reason_category: form.reason_category,
          last_revenue: parseFloat(form.last_revenue) || 0,
          relationship_months: parseInt(form.relationship_months, 10) || 0,
          reactivation_potential: form.reactivation_potential,
          notes: form.notes.trim() || null
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to mark client as dropped.");
      }

      const data = await res.json();
      onSuccess?.(data);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "An error occurred while saving.");
    } finally {
      setSaving(false);
    }
  };

  const handleReactivate = async () => {
    if (!confirm("Reactivate this client back to Active status?")) return;
    setReactivating(true);
    try {
      const res = await fetch(`${API_BASE_URL}/dropped-clients/by-client/${client.id}/reactivate`, {
        method: "POST"
      });
      if (res.ok) {
        onSuccess?.({ status: "Active" });
        onClose();
      } else {
        alert("Failed to reactivate client.");
      }
    } catch (err) {
      console.error(err);
      alert("Error reactivating client.");
    } finally {
      setReactivating(false);
    }
  };

  if (!isOpen) return null;

  const isAlreadyDropped = client?.status === "Dropped" || existingRecord;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 overflow-y-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 14 }}
          className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden my-8"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-zinc-800 bg-rose-50/50 dark:bg-rose-950/20">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-md shadow-rose-500/20">
                <UserX className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
                  {isAlreadyDropped ? "Dropped Client Details" : "Mark Client as Dropped"}
                </h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400">
                  {isAlreadyDropped
                    ? `Discontinued relationship record for ${companyName}`
                    : `Record drop reasons and retention metrics for ${companyName}`}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          {loadingExisting ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-rose-500" />
              <p className="text-xs font-semibold text-slate-500">Loading drop records...</p>
            </div>
          ) : isAlreadyDropped && existingRecord ? (
            /* View Existing Drop Details */
            <div className="p-6 space-y-4">
              <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-bold text-rose-900 dark:text-rose-200">
                    This client was marked as dropped
                  </p>
                  {existingRecord.dropped_at && (
                    <p className="text-rose-700/80 dark:text-rose-400/80 mt-0.5">
                      Discontinued on: {new Date(existingRecord.dropped_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200/80 dark:border-zinc-700/60">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Loss Category
                  </span>
                  <span className="inline-flex px-2 py-0.5 rounded-md font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                    {existingRecord.reason_category || "Other"}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200/80 dark:border-zinc-700/60">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Reactivation Potential
                  </span>
                  <span
                    className={`inline-flex px-2 py-0.5 rounded-md font-bold ${
                      REACTIVATION_CONFIG[
                        (existingRecord.reactivation_potential as "Low" | "Medium" | "High") || "Low"
                      ].badge
                    }`}
                  >
                    {existingRecord.reactivation_potential || "Low"}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200/80 dark:border-zinc-700/60">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Last Known Revenue
                  </span>
                  <span className="font-black text-slate-800 dark:text-zinc-100 text-sm">
                    ${Number(existingRecord.last_revenue || 0).toLocaleString()}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200/80 dark:border-zinc-700/60">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Relationship Duration
                  </span>
                  <span className="font-black text-slate-800 dark:text-zinc-100 text-sm">
                    {existingRecord.relationship_months || 0} months
                  </span>
                </div>
              </div>

              {existingRecord.reason && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200/80 dark:border-zinc-700/60">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Drop Reason
                  </span>
                  <p className="text-sm text-slate-800 dark:text-zinc-200">
                    {existingRecord.reason}
                  </p>
                </div>
              )}

              {existingRecord.notes && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200/80 dark:border-zinc-700/60">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Internal Handover Notes
                  </span>
                  <p className="text-xs text-slate-600 dark:text-zinc-300 whitespace-pre-wrap">
                    {existingRecord.notes}
                  </p>
                </div>
              )}

              <div className="flex items-center gap-3 pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleReactivate}
                  disabled={reactivating}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-90 text-white text-xs font-bold shadow-md transition-all flex items-center justify-center gap-2"
                >
                  {reactivating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RotateCcw className="w-4 h-4" />
                  )}
                  Reactivate Client
                </button>
              </div>
            </div>
          ) : (
            /* Mark as Dropped Form */
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {errorMsg && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Company Name */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" /> Company Name
                </label>
                <input
                  type="text"
                  required
                  value={form.company_name}
                  onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500 font-medium"
                />
              </div>

              {/* Loss Category & Reactivation Potential */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5" /> Reason Category *
                  </label>
                  <select
                    value={form.reason_category}
                    onChange={(e) => setForm((f) => ({ ...f, reason_category: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500 font-medium"
                  >
                    {REASON_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1.5">
                    <ArrowUpRight className="w-3.5 h-3.5" /> Reactivation Potential
                  </label>
                  <div className="grid grid-cols-3 gap-1 bg-slate-100 dark:bg-zinc-800 p-1 rounded-xl">
                    {REACTIVATION_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, reactivation_potential: opt }))}
                        className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                          form.reactivation_potential === opt
                            ? REACTIVATION_CONFIG[opt].btnActive
                            : "text-slate-600 dark:text-zinc-400 hover:text-slate-900"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Primary Drop Reason */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1.5 block">
                  Why is the client leaving? *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Switched to competitor, budget cuts, project completed..."
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              {/* Last Revenue & Relationship Duration */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                    <DollarSign className="w-3.5 h-3.5" /> Last Revenue ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={form.last_revenue}
                    onChange={(e) => setForm((f) => ({ ...f, last_revenue: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" /> Relationship (months)
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="6"
                    value={form.relationship_months}
                    onChange={(e) => setForm((f) => ({ ...f, relationship_months: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              </div>

              {/* Internal Notes / Handover */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5" /> Handover Notes / Feedback (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Key learnings, feedback received, or what would be required to win them back..."
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-sm text-slate-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 pt-3 border-t border-slate-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 hover:opacity-90 disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-rose-500/20 transition-all flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Recording Drop...
                    </>
                  ) : (
                    <>
                      <UserX className="w-4 h-4" /> Confirm Client Dropped
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
