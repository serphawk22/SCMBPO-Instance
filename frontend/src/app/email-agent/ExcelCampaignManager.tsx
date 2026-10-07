"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileSpreadsheet, Upload, Send, CheckCircle2, AlertCircle, Clock,
  RefreshCw, Users, FileText, ChevronRight, Download, Eye, X,
  Mail, Building2, Check, ArrowRight, ShieldCheck, Sparkles, Filter
} from "lucide-react";
import { API_BASE_URL } from "@/config";

interface Campaign {
  id: number;
  campaign_name: string;
  template_subject?: string;
  template_body?: string;
  total_records: number;
  sent_count: number;
  failed_count: number;
  status: string;
  created_at?: string;
  completed_at?: string;
}

interface CampaignRecord {
  id: number;
  email: string;
  name?: string;
  company?: string;
  status: string;
  error_message?: string;
  sent_at?: string;
}

export default function ExcelCampaignManager() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Form State
  const [campaignName, setCampaignName] = useState("");
  const [templateSubject, setTemplateSubject] = useState("Exclusive Partnership with {{company}}");
  const [templateBody, setTemplateBody] = useState(
    "Hi {{name}},\n\nI came across {{company}} and wanted to reach out regarding how SCM BPO can streamline your logistics back-office operations.\n\nWould you be open for a quick 10-minute discovery call this week?\n\nBest regards,\nNoushad C I\nSCM BPO"
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  // Drawer / modal for drilldown
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);
  const [records, setRecords] = useState<CampaignRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const fetchCampaigns = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/email-campaigns`);
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data.campaigns || []);
      }
    } catch (e) {
      console.error("Failed to load campaigns", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchCampaigns();
  };

  const handleDownloadSample = () => {
    const csvContent = "data:text/csv;charset=utf-8,name,email,company\nJohn Smith,john@acmelogistics.com,Acme Logistics\nSarah Jenkins,sarah@globalfreight.io,Global Freight\nDavid Kumar,david@apexshipping.co,Apex Shipping";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "scm_campaign_sample.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setToast({ ok: false, msg: "Please select an Excel or CSV file to upload." });
      return;
    }
    if (!campaignName.trim()) {
      setToast({ ok: false, msg: "Please provide a name for this campaign." });
      return;
    }

    setUploading(true);
    setToast(null);

    const formData = new FormData();
    formData.append("campaign_name", campaignName.trim());
    formData.append("template_subject", templateSubject);
    formData.append("template_body", templateBody);
    formData.append("file", selectedFile);

    try {
      const res = await fetch(`${API_BASE_URL}/email-campaigns/excel-upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Upload failed");
      }

      const data = await res.json();
      setToast({
        ok: true,
        msg: `Campaign started! ${data.total_records} contacts queued for outreach.`,
      });
      setCampaignName("");
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      fetchCampaigns();
    } catch (err: any) {
      setToast({ ok: false, msg: err.message || "Failed to launch campaign" });
    } finally {
      setUploading(false);
    }
  };

  const openCampaignDetails = async (campaign: Campaign) => {
    setActiveCampaign(campaign);
    setLoadingRecords(true);
    try {
      const res = await fetch(`${API_BASE_URL}/email-campaigns/${campaign.id}/records`);
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingRecords(false);
    }
  };

  // Preview calculations
  const previewSubject = templateSubject
    .replace("{{name}}", "Sarah Jenkins")
    .replace("{{company}}", "Global Freight Inc");
  const previewBody = templateBody
    .replace(/{{name}}/g, "Sarah Jenkins")
    .replace(/{{company}}/g, "Global Freight Inc");

  const totalContacts = campaigns.reduce((acc, c) => acc + (c.total_records || 0), 0);
  const totalSent = campaigns.reduce((acc, c) => acc + (c.sent_count || 0), 0);
  const totalFailed = campaigns.reduce((acc, c) => acc + (c.failed_count || 0), 0);

  return (
    <div className="w-full max-w-5xl mx-auto space-y-8">
      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`p-4 rounded-2xl flex items-center justify-between text-sm font-semibold shadow-lg ${
              toast.ok
                ? "bg-emerald-500 text-white"
                : "bg-red-500 text-white"
            }`}
          >
            <div className="flex items-center gap-2">
              {toast.ok ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
              <span>{toast.msg}</span>
            </div>
            <button onClick={() => setToast(null)} className="p-1 hover:opacity-80 rounded-md">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">Total Campaigns</span>
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-800 dark:text-zinc-100 mt-2">{campaigns.length}</p>
          <span className="text-xs text-slate-400 mt-1 block">{totalContacts} contacts targeted</span>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">Emails Dispatched</span>
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
              <Mail className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-2">{totalSent}</p>
          <span className="text-xs text-slate-400 mt-1 block">Live background worker</span>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">Success Rate</span>
            <div className="p-2 rounded-xl bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-800 dark:text-zinc-100 mt-2">
            {totalSent + totalFailed > 0 ? Math.round((totalSent / (totalSent + totalFailed)) * 100) : 100}%
          </p>
          <span className="text-xs text-slate-400 mt-1 block">{totalFailed} bounced/failed</span>
        </div>
      </div>

      {/* Campaign Creation Card */}
      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 md:p-8 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-100 dark:border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-bold text-slate-800 dark:text-zinc-100">Upload Excel & Launch Campaign</h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
              Upload a spreadsheet with <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 font-mono text-[11px]">name</code>, <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 font-mono text-[11px]">email</code>, and <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 font-mono text-[11px]">company</code> columns.
            </p>
          </div>

          <button
            type="button"
            onClick={handleDownloadSample}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors shadow-sm"
          >
            <Download className="w-4 h-4 text-indigo-500" />
            Download Sample CSV
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Campaign Name */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-2">
                Campaign Name *
              </label>
              <input
                type="text"
                required
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="e.g. Q4 Logistics Outreach"
                className="w-full px-4 py-3 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-700 rounded-xl text-sm font-semibold text-slate-800 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            {/* File Upload Box */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-2">
                Spreadsheet File (.csv, .xlsx, .xls) *
              </label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`w-full p-4 border-2 border-dashed rounded-xl cursor-pointer transition-colors flex items-center justify-between ${
                  selectedFile
                    ? "border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20"
                    : "border-slate-300 dark:border-zinc-700 hover:border-indigo-400 bg-slate-50 dark:bg-zinc-950"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Upload className={`w-5 h-5 ${selectedFile ? "text-emerald-600" : "text-slate-400"}`} />
                  <div>
                    <p className="text-xs font-bold text-slate-800 dark:text-zinc-100 truncate max-w-[220px]">
                      {selectedFile ? selectedFile.name : "Click to browse or drop file here"}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {selectedFile ? `${(selectedFile.size / 1024).toFixed(1)} KB` : "Supports CSV, XLSX"}
                    </p>
                  </div>
                </div>
                {selectedFile && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="p-1 hover:bg-slate-200 dark:hover:bg-zinc-800 rounded-lg text-slate-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </div>
            </div>
          </div>

          {/* Email Subject & Tokens */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
                Email Subject Line
              </label>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <span>Available tokens:</span>
                <button
                  type="button"
                  onClick={() => setTemplateSubject(prev => prev + " {{name}}")}
                  className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 font-mono text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  &#123;&#123;name&#125;&#125;
                </button>
                <button
                  type="button"
                  onClick={() => setTemplateSubject(prev => prev + " {{company}}")}
                  className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 font-mono text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  &#123;&#123;company&#125;&#125;
                </button>
              </div>
            </div>
            <input
              type="text"
              value={templateSubject}
              onChange={(e) => setTemplateSubject(e.target.value)}
              className="w-full px-4 py-3 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-700 rounded-xl text-sm font-semibold text-slate-800 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          {/* Email Template Body & Preview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
                  Email Body Template
                </label>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                  <button
                    type="button"
                    onClick={() => setTemplateBody(prev => prev + " {{name}}")}
                    className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 font-mono text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    + &#123;&#123;name&#125;&#125;
                  </button>
                  <button
                    type="button"
                    onClick={() => setTemplateBody(prev => prev + " {{company}}")}
                    className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 font-mono text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    + &#123;&#123;company&#125;&#125;
                  </button>
                </div>
              </div>
              <textarea
                rows={9}
                value={templateBody}
                onChange={(e) => setTemplateBody(e.target.value)}
                className="w-full p-4 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-700 rounded-xl text-sm font-mono text-slate-800 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none leading-relaxed"
              />
            </div>

            {/* Live Preview Panel */}
            <div className="flex flex-col">
              <span className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-2 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-indigo-500" /> Live Personalized Sample Preview
              </span>
              <div className="flex-1 bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-zinc-950 dark:to-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-4 flex flex-col shadow-inner">
                <div className="border-b border-slate-200/80 dark:border-zinc-800 pb-3 mb-3 space-y-1">
                  <p className="text-xs text-slate-400"><strong>To:</strong> Sarah Jenkins &lt;sarah@globalfreight.io&gt;</p>
                  <p className="text-xs font-bold text-slate-800 dark:text-zinc-100"><strong>Subject:</strong> {previewSubject}</p>
                </div>
                <div className="flex-1 text-xs text-slate-700 dark:text-zinc-300 font-sans whitespace-pre-wrap leading-relaxed">
                  {previewBody}
                </div>
              </div>
            </div>
          </div>

          {/* Submit Action */}
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={uploading || !selectedFile}
              className="px-7 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm flex items-center gap-2 shadow-lg shadow-indigo-500/25 disabled:opacity-50 transition-all hover:-translate-y-0.5"
            >
              {uploading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Dispatching Campaign...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Start Outreach Campaign
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Campaigns History Table */}
      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 md:p-8 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-800 dark:text-zinc-100">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-zinc-100">Campaign History</h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400">Track delivery status across your uploaded contact batches</p>
            </div>
          </div>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-indigo-600" : ""}`} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Loading campaigns...
          </div>
        ) : campaigns.length === 0 ? (
          <div className="py-12 text-center border-2 border-dashed border-slate-200 dark:border-zinc-800 rounded-2xl">
            <FileSpreadsheet className="w-10 h-10 text-slate-300 dark:text-zinc-700 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-600 dark:text-zinc-400">No campaigns launched yet</p>
            <p className="text-xs text-slate-400 mt-1">Upload a CSV or Excel file above to start reaching out.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-zinc-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="pb-3 px-3">Campaign</th>
                  <th className="pb-3 px-3">Status</th>
                  <th className="pb-3 px-3 text-center">Contacts</th>
                  <th className="pb-3 px-3 text-center">Sent</th>
                  <th className="pb-3 px-3 text-center">Failed</th>
                  <th className="pb-3 px-3">Created</th>
                  <th className="pb-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/60 text-xs">
                {campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/60 dark:hover:bg-zinc-800/30 transition-colors">
                    <td className="py-3 px-3 font-bold text-slate-800 dark:text-zinc-200">
                      {c.campaign_name}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          c.status === "Completed"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                            : c.status === "Sending"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 animate-pulse"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center font-bold text-slate-700 dark:text-zinc-300">
                      {c.total_records}
                    </td>
                    <td className="py-3 px-3 text-center font-black text-emerald-600">
                      {c.sent_count}
                    </td>
                    <td className="py-3 px-3 text-center font-black text-red-500">
                      {c.failed_count}
                    </td>
                    <td className="py-3 px-3 text-slate-400">
                      {c.created_at ? new Date(c.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() => openCampaignDetails(c)}
                        className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        View Details <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recipient Details Modal */}
      <AnimatePresence>
        {activeCampaign && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[200] p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-zinc-800 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="px-6 py-5 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between bg-slate-50 dark:bg-zinc-950">
                <div>
                  <h3 className="font-bold text-base text-slate-800 dark:text-zinc-100">
                    {activeCampaign.campaign_name}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {activeCampaign.sent_count} sent · {activeCampaign.failed_count} failed of {activeCampaign.total_records} contacts
                  </p>
                </div>
                <button
                  onClick={() => setActiveCampaign(null)}
                  className="p-1.5 hover:bg-slate-200 dark:hover:bg-zinc-800 rounded-full text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Records List */}
              <div className="p-6 flex-1 overflow-y-auto space-y-3">
                {loadingRecords ? (
                  <div className="py-12 text-center text-slate-400">Loading contacts...</div>
                ) : records.length === 0 ? (
                  <p className="text-center py-10 text-xs text-slate-400">No contact records found for this campaign.</p>
                ) : (
                  records.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between p-3.5 rounded-xl border border-slate-100 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-950/40"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-xs">
                          {r.name?.charAt(0) || r.email.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-800 dark:text-zinc-100">
                            {r.name || "Unnamed"} {r.company && <span className="font-normal text-slate-400">· {r.company}</span>}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500">{r.email}</p>
                          {r.error_message && (
                            <p className="text-[10px] text-red-500 mt-0.5">{r.error_message}</p>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            r.status === "Sent"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                              : r.status === "Failed"
                              ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                              : "bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400"
                          }`}
                        >
                          {r.status}
                        </span>
                        {r.sent_at && (
                          <p className="text-[9px] text-slate-400 mt-1">
                            {new Date(r.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
