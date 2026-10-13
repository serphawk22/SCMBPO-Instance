"use client";

import { useEffect, useState } from "react";
import CompanyOperationsVisualizations from "@/components/CompanyOperationsVisualizations";
import { API_BASE_URL } from "@/config";
import { useRole } from "@/context/RoleContext";
import { RefreshCw, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function VisualizationsPage() {
  const { role, loading: roleLoading } = useRole();
  const [data, setData] = useState<any>(null);
  const [classicData, setClassicData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const getAuthHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("token");
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const savedUser = localStorage.getItem("crm_user");
      if (savedUser) {
        try {
          const parsed = JSON.parse(savedUser);
          if (parsed?.id) headers["X-User-ID"] = String(parsed.id);
          if (parsed?.tenant_id && parsed.role !== "SuperAdmin") headers["X-Tenant-ID"] = String(parsed.tenant_id);
        } catch {}
      }
    }
    return headers;
  };

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [dossierRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE_URL}/reports/executive-dossier?months=12`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/reports/summary?months=12`, { headers: getAuthHeaders() }),
      ]);
      if (dossierRes.ok) {
        const json = await dossierRes.json();
        setData(json);
      }
      if (summaryRes.ok) {
        const json = await summaryRes.json();
        setClassicData(json);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load visualization data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (role && !roleLoading) {
      loadData();
    }
  }, [role, roleLoading]);

  if (role !== "Admin" && role !== "SuperAdmin" && role !== "SalesManager") {
    return (
      <div className="p-12 text-center font-bold text-slate-500">
        Operations intelligence is restricted to administrators and managers.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1550px] space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <Link
          href="/reports"
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-indigo-600 dark:text-zinc-400 dark:hover:text-indigo-400 transition-colors"
        >
          <ArrowLeft size={14} /> Back to Reports Hub
        </Link>
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 px-3.5 py-1.5 text-xs font-black text-slate-700 dark:text-zinc-200 shadow-sm hover:bg-slate-50"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <CompanyOperationsVisualizations
        executiveData={data}
        classicData={classicData}
      />
    </div>
  );
}
