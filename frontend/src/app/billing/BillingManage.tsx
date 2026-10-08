"use client";
import { useRef } from "react";
import { Plus, FileSignature, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import Invoices, { InvoicesHandle } from "./Invoices";

export default function BillingManage() {
  const invoicesRef = useRef<InvoicesHandle>(null);

  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-zinc-950 p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20">
            <FileSignature className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-zinc-100">Billing</h1>
            <p className="text-sm text-slate-500 dark:text-zinc-400">SCM BPO · Invoices &amp; billing</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/proposals"
            className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-xs font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors shadow-sm"
          >
            Open Proposals Center <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
          <button
            onClick={() => invoicesRef.current?.openCreate()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-semibold hover:opacity-90 shadow-md transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" /> New Invoice
          </button>
        </div>
      </div>

      {/* Content */}
      <Invoices embedded ref={invoicesRef} />
    </div>
  );
}
