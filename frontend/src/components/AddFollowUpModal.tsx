"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarClock, X, Check, Mail, Bell, Clock,
  Calendar, AlertCircle, Sparkles, Building2, User, Loader2
} from "lucide-react";
import { API_BASE_URL } from "@/config";
import TimezonePicker from "@/components/TimezonePicker";
import { detectTimeZone, zonedWallToUtc } from "@/lib/timezone";

export interface FollowUpTarget {
  type: "lead" | "client";
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  salespersonName?: string | null;
}

interface AddFollowUpModalProps {
  open: boolean;
  onClose: () => void;
  target: FollowUpTarget | null;
  onSuccess?: () => void;
}

export default function AddFollowUpModal({ open, onClose, target, onSuccess }: AddFollowUpModalProps) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [timezone, setTimezone] = useState(() => detectTimeZone());
  const [channel, setChannel] = useState("Email");
  const [priority, setPriority] = useState("Medium");
  const [notes, setNotes] = useState("");
  const [sendNotification, setSendNotification] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [remindOneHourBefore, setRemindOneHourBefore] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize defaults on target change
  useEffect(() => {
    if (open) {
      // Default to tomorrow 10:00 AM
      const tmrw = new Date();
      tmrw.setDate(tmrw.getDate() + 1);
      const yyyy = tmrw.getFullYear();
      const mm = String(tmrw.getMonth() + 1).padStart(2, "0");
      const dd = String(tmrw.getDate()).padStart(2, "0");
      setDate(`${yyyy}-${mm}-${dd}`);
      setTime("10:00");
      setTitle(target ? `Follow-up with ${target.name}` : "Follow-up check-in");
      setNotifyEmail(target?.email || "");
      setSendNotification(Boolean(target?.email));
      setRemindOneHourBefore(true);
      setError(null);
    }
  }, [open, target]);

  if (!open) return null;

  const localWallClock = date && time ? `${date}T${time}` : "";

  const applyQuickPreset = (daysOffset: number, presetTime: string, presetTitle: string) => {
    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    setDate(`${yyyy}-${mm}-${dd}`);
    setTime(presetTime);
    if (!title || title.startsWith("Follow-up with")) {
      setTitle(`${presetTitle} with ${target?.name || "contact"}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Please provide a reason or title for the follow-up.");
      return;
    }
    if (!date || !time) {
      setError("Please specify both date and time.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const wallClock = `${date}T${time}`;
      const utcIso = zonedWallToUtc(wallClock, timezone);

      const payload = {
        title: title.trim(),
        notes: notes.trim() || null,
        channel,
        priority,
        due_at: utcIso,
        timezone,
        reminder_minutes: remindOneHourBefore ? 60 : 0,
        lead_id: target?.type === "lead" ? target.id : null,
        client_id: target?.type === "client" ? target.id : null,
        send_notification: sendNotification,
        notify_email: sendNotification ? notifyEmail.trim() : null,
      };

      let res = await fetch(`${API_BASE_URL}/follow-ups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      // The notification email needs confirmation (lib/emailConfirm); if it was cancelled, still save the follow-up.
      const first = await res.clone().json().catch(() => ({}));
      if (res.ok && first?.cancelled) {
        res = await fetch(`${API_BASE_URL}/follow-ups`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, send_notification: false, notify_email: null }),
        });
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to schedule follow-up");
      }

      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/50 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                <CalendarClock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800 dark:text-zinc-100">Schedule Follow-up</h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400">
                  {target ? `${target.type === "lead" ? "Lead" : "Client"}: ${target.name}` : "Dedicated follow-up & reminder"}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form Content */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 text-xs font-semibold text-rose-700 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Target info badge */}
            {target && (
              <div className="flex items-center justify-between p-3 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/30 text-xs">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-indigo-500" />
                  <span className="font-bold text-slate-800 dark:text-zinc-200">{target.name}</span>
                </div>
                {target.salespersonName && (
                  <span className="text-[11px] text-slate-500 dark:text-zinc-400">
                    Rep: <span className="font-semibold text-slate-700 dark:text-zinc-300">{target.salespersonName}</span>
                  </span>
                )}
              </div>
            )}

            {/* Quick Presets */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                Quick Shortcuts
              </label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => applyQuickPreset(0, "16:00", "Afternoon Check-in")}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  Today 4 PM
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickPreset(1, "10:00", "Morning Follow-up")}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  Tomorrow 10 AM
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickPreset(3, "11:00", "Mid-week Check-in")}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  In 3 Days
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickPreset(7, "10:30", "Weekly Review")}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  Next Week
                </button>
              </div>
            </div>

            {/* Reason / Title */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300 mb-1">
                Reason / Title *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Discuss proposal pricing & next steps"
                className="w-full px-3.5 py-2.5 text-sm bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-slate-900 dark:text-zinc-100"
              />
            </div>

            {/* Date & Time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300 mb-1">
                  Follow-up Date *
                </label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-slate-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300 mb-1">
                  Follow-up Time *
                </label>
                <input
                  type="time"
                  required
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-slate-900 dark:text-zinc-100"
                />
              </div>
            </div>

            {/* Timezone */}
            <TimezonePicker
              value={timezone}
              onChange={setTimezone}
              localTime={localWallClock}
              label="Dedicated Timezone"
            />

            {/* Channel & Priority */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300 mb-1">
                  Channel
                </label>
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/30 text-slate-900 dark:text-zinc-100"
                >
                  <option value="Email">Email</option>
                  <option value="Call">Phone Call</option>
                  <option value="Meeting">Meeting</option>
                  <option value="WhatsApp">WhatsApp</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300 mb-1">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/30 text-slate-900 dark:text-zinc-100"
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Urgent">Urgent</option>
                </select>
              </div>
            </div>

            {/* Notification and Reminder Controls */}
            <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-800/40 p-3.5 space-y-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={remindOneHourBefore}
                  onChange={(e) => setRemindOneHourBefore(e.target.checked)}
                  className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                />
                <div>
                  <span className="text-xs font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-1.5">
                    <Bell className="w-3.5 h-3.5 text-indigo-500" />
                    Setup reminder mail 1 hour before follow-up
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                    Sends in-app alert and dedicated email reminder exactly 60 minutes before the scheduled time.
                  </p>
                </div>
              </label>

              <div className="border-t border-slate-200/60 dark:border-zinc-700/60 pt-2.5">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendNotification}
                    onChange={(e) => setSendNotification(e.target.checked)}
                    className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-emerald-500" />
                      Send notification email now
                    </span>
                    <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                      Sends immediate confirmation email with scheduled date, time, reason, and timezone details.
                    </p>
                  </div>
                </label>

                {sendNotification && (
                  <div className="mt-2.5 pl-6">
                    <input
                      type="email"
                      value={notifyEmail}
                      onChange={(e) => setNotifyEmail(e.target.value)}
                      placeholder="Recipient email address (e.g. contact@client.com)"
                      className="w-full px-3 py-1.5 text-xs bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/30 text-slate-800 dark:text-zinc-100"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-300 mb-1">
                Discussion Notes / Context (Optional)
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any specific context, agenda points, or discussion topics..."
                className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/30 text-slate-900 dark:text-zinc-100 resize-none"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-bold text-white shadow-md shadow-indigo-600/20 active:scale-95 transition-all disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarClock className="w-3.5 h-3.5" />}
                {submitting ? "Scheduling..." : "Schedule Follow-up"}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
