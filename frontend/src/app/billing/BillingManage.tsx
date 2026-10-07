"use client";
import { useRef, useState } from "react";
import { Plus, Receipt, FileSignature, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import Quotes, { QuotesHandle } from "./Quotes";
import Invoices, { InvoicesHandle } from "./Invoices";
import { ExportActions } from "@/components/ExportActions";
import { API_BASE_URL } from "@/config";

export default function BillingManage() {
  const quotesRef = useRef<QuotesHandle>(null);
  const invoicesRef = useRef<InvoicesHandle>(null);
  const [activeTab, setActiveTab] = useState<"quotes" | "invoices">("quotes");

  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-zinc-950 p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20">
            <FileSignature className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-zinc-100">Billing & Commercial</h1>
            <p className="text-sm text-slate-500 dark:text-zinc-400">SCM BPO · Unified proposals, quotes &amp; invoices</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/proposals"
            className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-xs font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors shadow-sm"
          >
            Open Proposals Center <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
          {activeTab === "quotes" && (
            <>
              <ExportActions
                downloadUrl={`${API_BASE_URL}/quotes/export-pdf`}
                emailUrl={`${API_BASE_URL}/quotes/export-pdf`}
                filename="proposals-and-quotes.pdf"
                label="Quotes"
                formats={[
                  { format: "pdf", ext: "pdf", label: "PDF" },
                  { format: "xlsx", ext: "xlsx", label: "Excel" },
                  { format: "csv", ext: "csv", label: "CSV" },
                ]}
              />
              <button
                onClick={() => quotesRef.current?.openCreate()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white text-sm font-semibold hover:opacity-90 shadow-md transition-all active:scale-95"
              >
                <Plus className="w-4 h-4" /> New Proposal / Quote
              </button>
            </>
          )}
          {activeTab === "invoices" && (
            <button
              onClick={() => invoicesRef.current?.openCreate()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-semibold hover:opacity-90 shadow-md transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" /> New Invoice
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-gray-100 dark:bg-zinc-900 p-1 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab("quotes")}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
            activeTab === "quotes"
              ? "bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm"
              : "text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-300"
          }`}
        >
          <FileSignature className="w-4 h-4" /> Proposals &amp; Quotes
        </button>
        <button
          onClick={() => setActiveTab("invoices")}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
            activeTab === "invoices"
              ? "bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm"
              : "text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-300"
          }`}
        >
          <Receipt className="w-4 h-4" /> Invoices
        </button>
      </div>

      {/* Content */}
      {activeTab === "quotes" ? (
        <Quotes embedded ref={quotesRef} />
      ) : (
        <Invoices embedded ref={invoicesRef} />
      )}
    </div>
  );
}