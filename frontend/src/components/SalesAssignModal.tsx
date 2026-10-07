'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Zap, UserCheck, X, ChevronDown, Briefcase, TrendingUp,
  AlertCircle, CheckCircle2, Loader2, BarChart2, History, MessageSquare, Clock
} from 'lucide-react';
import { API_BASE_URL } from '@/config';

interface SalesPerson {
  id: number;
  name: string;
  email?: string;
  role: string;
  active_clients: number;
  active_leads: number;
  total_active: number;
}

interface HistoryItem {
  id: number;
  from_user_name?: string;
  to_user_name?: string;
  reason?: string;
  reassigned_at?: string;
}

interface SalesAssignModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAssign: (employeeId: number | null, employeeName: string | null, reason?: string) => void;
  entityType: 'client' | 'lead';
  clientId?: number;
  currentSalespersonName?: string;
}

function getWorkloadColor(total: number): { bar: string; badge: string; label: string } {
  if (total === 0) return { bar: 'bg-emerald-400', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', label: 'Available' };
  if (total <= 5) return { bar: 'bg-blue-400', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', label: 'Light' };
  if (total <= 10) return { bar: 'bg-amber-400', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', label: 'Moderate' };
  return { bar: 'bg-red-400', badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', label: 'Heavy' };
}

const PRESET_REASONS = [
  'Territory Rebalancing',
  'Workload Distribution',
  'Client Request',
  'Staff Transition',
  'Account Escalation',
  'Specialization Match',
];

export default function SalesAssignModal({
  isOpen,
  onClose,
  onAssign,
  entityType,
  clientId,
  currentSalespersonName
}: SalesAssignModalProps) {
  const [employees, setEmployees] = useState<SalesPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'assign' | 'history'>('assign');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const fetchWorkload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/employees/workload`);
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees || []);
      }
    } catch (e) {
      console.error('Failed to fetch employee workload:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    if (!clientId) return;
    setLoadingHistory(true);
    try {
      const res = await fetch(`${API_BASE_URL}/salesperson/history/${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history || []);
      }
    } catch (e) {
      console.error('Failed to load reassignment history', e);
    } finally {
      setLoadingHistory(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (isOpen) {
      fetchWorkload();
      setSelected(null);
      setReason('');
      setError(null);
      setTab('assign');
      if (clientId) {
        fetchHistory();
      }
    }
  }, [isOpen, fetchWorkload, clientId, fetchHistory]);

  const handleAutoAssign = () => {
    // Auto-assign: pick the sales person with the fewest total active items (prefer someone other than current assignee if reassigning)
    const available = employees.filter(e => !currentSalespersonName || e.name.toLowerCase() !== currentSalespersonName.toLowerCase());
    const pool = available.length > 0 ? available : employees;
    const sorted = [...pool].sort((a, b) => {
      if (a.total_active !== b.total_active) return a.total_active - b.total_active;
      const roleRank = (r: string) => r === 'Employee' ? 0 : r === 'SalesManager' ? 1 : 2;
      if (roleRank(a.role) !== roleRank(b.role)) return roleRank(a.role) - roleRank(b.role);
      return (a.name || '').localeCompare(b.name || '');
    });
    if (sorted.length > 0) {
      setSelected(sorted[0].id);
      setError(null);
    }
  };

  const handleConfirm = async () => {
    setError(null);
    if (selected === null) {
      setError('Please select a salesperson to assign.');
      return;
    }
    const emp = employees.find(e => e.id === selected);
    const isReassigning = !!(clientId || currentSalespersonName);

    if (isReassigning && emp?.name && currentSalespersonName && emp.name.toLowerCase() === currentSalespersonName.toLowerCase()) {
      setError(`"${emp.name}" is already the assigned salesperson for this account. Please select a different team member.`);
      return;
    }

    if (isReassigning && !reason.trim()) {
      setError('A proper reassignment reason is required when reassigning. Please enter or select a reason below.');
      return;
    }

    setAssigning(true);
    try {
      await onAssign(selected, emp?.name || null, reason.trim() || undefined);
    } finally {
      setAssigning(false);
    }
  };

  const handleSkip = () => {
    onAssign(null, null);
  };

  const maxWorkload = Math.max(...employees.map(e => e.total_active), 1);
  const selectedEmp = employees.find(e => e.id === selected);
  const isReassign = !!(clientId || currentSalespersonName);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[200] p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 24, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-zinc-700 w-full max-w-lg overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-7 pt-7 pb-4 border-b border-slate-100 dark:border-zinc-800 bg-gradient-to-br from-violet-50/60 to-white dark:from-violet-950/20 dark:to-zinc-900 relative">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-violet-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
                    <Users size={20} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-slate-800 dark:text-zinc-100 leading-tight">
                      {clientId ? 'Reassign Salesperson' : `Assign ${entityType === 'client' ? 'Client' : 'Lead'}`}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                      {currentSalespersonName
                        ? `Currently assigned to: ${currentSalespersonName}`
                        : `Assign this ${entityType} to a salesperson`}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Sub tabs (only if editing existing client with clientId) */}
              {clientId && (
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setTab('assign')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      tab === 'assign'
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-zinc-200'
                    }`}
                  >
                    Select Rep
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('history')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      tab === 'history'
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-zinc-200'
                    }`}
                  >
                    <History size={13} />
                    Audit Trail ({history.length})
                  </button>
                </div>
              )}
            </div>

            {/* Body */}
            {tab === 'assign' ? (
              <div className="px-7 py-5 space-y-4 max-h-[55vh] overflow-y-auto custom-scrollbar">
                {/* Auto-Assign Banner */}
                <button
                  type="button"
                  onClick={handleAutoAssign}
                  className="w-full flex items-center justify-between p-3.5 bg-gradient-to-r from-violet-500/10 via-indigo-500/10 to-violet-500/5 hover:from-violet-500/20 hover:to-indigo-500/20 border border-violet-200 dark:border-violet-800/60 rounded-2xl transition-all group"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-violet-600 flex items-center justify-center text-white shadow-md shadow-violet-500/20">
                      <Zap size={15} />
                    </div>
                    <div className="text-left">
                      <p className="text-xs font-black text-violet-700 dark:text-violet-300">
                        ⚡ Smart Auto-Assign
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-zinc-400">
                        Selects rep with lowest active workload
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] font-bold text-violet-600 dark:text-violet-400 group-hover:underline">
                    Pick for me →
                  </span>
                </button>

                {/* Salespersons list */}
                {loading ? (
                  <div className="flex items-center justify-center py-10 gap-2 text-slate-400 text-xs font-bold">
                    <Loader2 size={16} className="animate-spin text-violet-600" />
                    Loading team workload…
                  </div>
                ) : employees.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-xs">
                    No sales team members found
                  </div>
                ) : (
                  <div className="space-y-2">
                    {employees.map(emp => {
                      const isSelected = selected === emp.id;
                      const wl = getWorkloadColor(emp.total_active);
                      const barWidth = Math.round((emp.total_active / maxWorkload) * 100);

                      return (
                        <motion.button
                          key={emp.id}
                          type="button"
                          onClick={() => setSelected(emp.id)}
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          className={`w-full text-left p-3.5 rounded-2xl border transition-all ${
                            isSelected
                              ? 'border-violet-600 bg-violet-50/60 dark:bg-violet-950/30 ring-2 ring-violet-500/30'
                              : 'border-slate-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-800/40 hover:border-slate-300 dark:hover:border-zinc-600'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-xs font-black shrink-0">
                                {emp.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-xs font-bold text-slate-800 dark:text-zinc-100 leading-tight">
                                  {emp.name}
                                </p>
                                <p className="text-[10px] text-slate-400 leading-tight">
                                  {emp.role} {emp.email ? `· ${emp.email}` : ''}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${wl.badge}`}>
                                {wl.label}
                              </span>
                              {isSelected && <CheckCircle2 size={16} className="text-violet-500 shrink-0" />}
                            </div>
                          </div>

                          {/* Stats row */}
                          <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-zinc-400 mb-2">
                            <span className="flex items-center gap-1.5">
                              <Briefcase size={11} className="text-blue-400" />
                              <span><strong className="text-slate-700 dark:text-zinc-200">{emp.active_clients}</strong> clients</span>
                            </span>
                            <span className="flex items-center gap-1.5">
                              <TrendingUp size={11} className="text-violet-400" />
                              <span><strong className="text-slate-700 dark:text-zinc-200">{emp.active_leads}</strong> leads</span>
                            </span>
                            <span className="ml-auto flex items-center gap-1 text-[10px] font-black text-slate-400">
                              <BarChart2 size={11} />
                              {emp.total_active} total
                            </span>
                          </div>

                          {/* Workload bar */}
                          <div className="h-1.5 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${barWidth}%` }}
                              transition={{ duration: 0.5, ease: 'easeOut' }}
                              className={`h-full rounded-full ${wl.bar}`}
                            />
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                )}

                {/* Current -> Target Summary if reassigning */}
                {isReassign && (
                  <div className="p-3 bg-violet-50/80 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800/60 rounded-2xl flex items-center justify-between text-xs">
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-black text-slate-400">Current Assignee</span>
                      <span className="font-bold text-slate-700 dark:text-zinc-200">{currentSalespersonName || 'Unassigned'}</span>
                    </div>
                    <span className="text-violet-500 font-black text-sm">➔</span>
                    <div className="flex flex-col text-right">
                      <span className="text-[10px] uppercase font-black text-slate-400">New Assignee</span>
                      <span className={`font-bold ${selectedEmp ? 'text-violet-700 dark:text-violet-300' : 'text-slate-400 italic'}`}>
                        {selectedEmp ? selectedEmp.name : 'Select rep below'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Reason input & Presets */}
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400 flex items-center gap-1.5">
                      <MessageSquare size={13} className="text-violet-500" />
                      {isReassign ? 'Reassignment Reason' : 'Assignment Note'}
                      {isReassign && <span className="text-rose-500 font-black">*</span>}
                    </label>
                    {isReassign && <span className="text-[10px] font-bold text-rose-500 uppercase tracking-wider">Required</span>}
                  </div>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => { setReason(e.target.value); setError(null); }}
                    placeholder={isReassign ? "e.g. Territory rebalancing, client request..." : "Optional note for assignment"}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-700 rounded-xl text-xs font-semibold text-slate-800 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-violet-500 transition-all"
                  />
                  
                  {/* Preset reason tags for 1-click select */}
                  {isReassign && (
                    <div className="mt-2.5">
                      <p className="text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">Quick reasons:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {PRESET_REASONS.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => { setReason(preset); setError(null); }}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                              reason === preset
                                ? 'bg-violet-600 text-white border-violet-600 shadow-sm shadow-violet-500/20'
                                : 'bg-slate-50 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:border-violet-400 dark:hover:border-violet-500'
                            }`}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Validation Error Banner */}
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-3 p-2.5 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-xl flex items-center gap-2 text-rose-600 dark:text-rose-400 text-xs font-semibold"
                    >
                      <AlertCircle size={15} className="shrink-0" />
                      <span>{error}</span>
                    </motion.div>
                  )}
                </div>
              </div>
            ) : (
              /* History Tab */
              <div className="px-7 py-5 space-y-3 max-h-[55vh] overflow-y-auto custom-scrollbar">
                {loadingHistory ? (
                  <div className="py-12 text-center text-slate-400 text-xs">Loading history…</div>
                ) : history.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 text-xs">
                    <Clock size={28} className="mx-auto mb-2 opacity-40" />
                    No previous reassignment records found for this account.
                  </div>
                ) : (
                  history.map((h) => (
                    <div
                      key={h.id}
                      className="p-3.5 rounded-xl border border-slate-100 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-950/40 space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-800 dark:text-zinc-100">
                          {h.from_user_name || 'Unassigned'} → <strong className="text-violet-600">{h.to_user_name || 'Unassigned'}</strong>
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {h.reassigned_at ? new Date(h.reassigned_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                        </span>
                      </div>
                      {h.reason && (
                        <p className="text-xs text-slate-500 dark:text-zinc-400 italic">
                          "{h.reason}"
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Footer */}
            <div className="px-7 py-4 border-t border-slate-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center gap-3">
              <button
                type="button"
                onClick={isReassign ? onClose : handleSkip}
                className="flex-1 py-2.5 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 rounded-xl font-bold text-xs transition-colors"
              >
                {isReassign ? 'Cancel' : 'Skip for now'}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={selected === null || assigning}
                className="flex-1 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-xl font-bold text-xs transition-all shadow-lg shadow-violet-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {assigning ? <Loader2 size={15} className="animate-spin" /> : <UserCheck size={15} />}
                {assigning ? 'Assigning…' : isReassign ? 'Confirm Reassignment' : 'Confirm Assignment'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
