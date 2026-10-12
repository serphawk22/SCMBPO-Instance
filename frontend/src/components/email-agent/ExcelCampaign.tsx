"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Bot, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Clock, Download,
  Eye, FileSpreadsheet, History, Loader2, Mail, RefreshCw, Send, Settings, Sparkles, StopCircle, Upload, Users, XCircle,
} from "lucide-react";
import { errorText } from "@/lib/inboxApi";
import {
  campaignsApi, wasCancelled,
  type Campaign, type CampaignPreview, type CampaignRecipient, type ColumnMapping, type ParsedSheet, type SenderStatus,
} from "@/lib/followupsApi";

const DEFAULT_SUBJECT = "Back-office support for {{company|your logistics team}}";
const DEFAULT_BODY = `Hi {{first_name}},

I came across {{company|your company}} and wanted to share how our logistics back-office team could take documentation, booking and tracking work off your desk.

Would you be open to a short call this week?

Best regards,
{{sender_name}}`;

const FIELD_LABELS: { key: keyof ColumnMapping; label: string; required?: boolean }[] = [
  { key: "email", label: "Email address", required: true },
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "name", label: "Full name" },
  { key: "company", label: "Company" },
];

const inputCls = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";
const labelCls = "mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-zinc-500";
const primaryBtn = "inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-indigo-500/20 transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryBtn = "inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";

const STATUS_STYLE: Record<string, string> = {
  Sent: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  Failed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  Skipped: "bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300",
  Pending: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  Sending: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  Queued: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  Completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  Cancelled: "bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300",
};

function Pill({ status }: { status: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${STATUS_STYLE[status] || STATUS_STYLE.Skipped}`}>{status}</span>;
}

function when(iso?: string | null) {
  return iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function downloadSample() {
  const csv = "First Name,Last Name,Email,Company,City,Notes\n"
    + "Jane,Doe,jane@example.com,Acme Freight Forwarders,Kochi,Asked about outsourcing documentation last month\n"
    + "Ravi,Kumar,ravi@example.com,Kumar Shipping Agency,Chennai,Wants help with shipment tracking updates\n";
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "email-campaign-template.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Sender account banner ───────────────────────────────────────────────────
function SenderBanner({ sender, onOpenSettings }: { sender: SenderStatus | null; onOpenSettings: () => void }) {
  if (!sender) return null;
  return sender.configured ? (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
      <Mail className="h-4 w-4" /> Emails will be sent from <b>{sender.address}</b> <span className="opacity-75">({sender.label})</span>
      <button onClick={onOpenSettings} className="ml-auto font-bold underline">Change</button>
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <AlertTriangle className="h-4 w-4 shrink-0" /> <span className="flex-1">{sender.message}</span>
      <button onClick={onOpenSettings} className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1 font-bold text-white"><Settings className="h-3 w-3" /> Configure email</button>
    </div>
  );
}

// ─── Campaign detail / progress ──────────────────────────────────────────────
function CampaignDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await campaignsApi.get(id, filter || null);
      setCampaign(r.campaign);
      setRecipients(r.recipients);
    } catch (e) {
      setError(errorText(e, "Could not load the campaign."));
    }
  }, [id, filter]);

  useEffect(() => { load(); }, [load]);
  const active = campaign?.status === "Sending" || campaign?.status === "Queued";
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [active, load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      if (!wasCancelled(r)) await load();
    } catch (e) {
      setError(errorText(e, "Action failed."));
    } finally {
      setBusy(false);
    }
  };

  if (!campaign) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-slate-400" /></div>;
  const done = campaign.sent + campaign.failed + campaign.skipped;
  const pct = campaign.total ? Math.round((done / campaign.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onBack} className={secondaryBtn}><ArrowLeft className="h-3.5 w-3.5" /> Back</button>
        <div className="mr-auto min-w-0">
          <p className="truncate text-base font-black text-slate-800 dark:text-zinc-100">{campaign.name}</p>
          <p className="text-[11px] text-slate-500 dark:text-zinc-400">
            {campaign.source_filename || "Upload"} · created {when(campaign.created_at)} · from {campaign.sender_email || "—"}
          </p>
        </div>
        <Pill status={campaign.status} />
        {active && <button className={secondaryBtn} disabled={busy} onClick={() => act(() => campaignsApi.cancel(id))}><StopCircle className="h-3.5 w-3.5" /> Stop</button>}
        {!active && (campaign.failed > 0 || campaign.pending > 0) && (
          <button className={secondaryBtn} disabled={busy} onClick={() => act(() => campaignsApi.retry(id))}><RefreshCw className="h-3.5 w-3.5" /> Retry {campaign.failed ? "failed" : "unsent"}</button>
        )}
        <button className={secondaryBtn} onClick={() => act(() => campaignsApi.downloadExport(id, campaign.name))}><Download className="h-3.5 w-3.5" /> Export CSV</button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-600 dark:text-zinc-300">
          <span>{active ? "Sending…" : "Finished"} {done} / {campaign.total}</span><span>{pct}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-zinc-800">
          <div className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[["Sent", campaign.sent, "text-emerald-600"], ["Failed", campaign.failed, "text-red-600"], ["Skipped", campaign.skipped, "text-slate-500"], ["Pending", campaign.pending, "text-amber-600"]].map(([l, v, c]) => (
            <button key={l as string} onClick={() => setFilter(filter === l ? "" : (l as string))}
              className={`rounded-xl border px-3 py-2 text-left transition ${filter === l ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-500/10" : "border-slate-100 hover:bg-slate-50 dark:border-zinc-800 dark:hover:bg-zinc-800"}`}>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{l}</p>
              <p className={`text-xl font-black ${c}`}>{v as number}</p>
            </button>
          ))}
        </div>
        {campaign.last_error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">{campaign.last_error}</p>}
        {campaign.followup_days && <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500"><CalendarClock className="h-3.5 w-3.5" /> A follow-up is scheduled {campaign.followup_days} days after each sent email.</p>}
      </div>
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400 dark:bg-zinc-950">
              <tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Recipient</th><th className="px-3 py-2">Company</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Sent at</th><th className="px-3 py-2">Note</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
              {recipients.map((r) => (
                <React.Fragment key={r.id}>
                  <tr className="cursor-pointer hover:bg-slate-50 dark:hover:bg-zinc-800/50" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td className="px-3 py-2 text-slate-400">{r.row_number}</td>
                    <td className="px-3 py-2"><p className="font-bold text-slate-700 dark:text-zinc-200">{r.name || "—"}</p><p className="text-slate-500">{r.email}</p></td>
                    <td className="px-3 py-2 text-slate-600 dark:text-zinc-300">{r.company || "—"}</td>
                    <td className="px-3 py-2"><Pill status={r.status} /></td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-500">{when(r.sent_at)}</td>
                    <td className="max-w-[260px] px-3 py-2 text-slate-500">{r.error || (r.follow_up_id ? "Follow-up scheduled" : "")}</td>
                  </tr>
                  {open === r.id && r.body && (
                    <tr><td colSpan={6} className="bg-slate-50 px-4 py-3 dark:bg-zinc-950">
                      <p className="text-xs font-bold text-slate-700 dark:text-zinc-200">Subject: {r.subject}</p>
                      <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600 dark:text-zinc-300">{r.body}</p>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
              {recipients.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No recipients{filter ? ` with status ${filter}` : ""}.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function ExcelCampaign({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [step, setStep] = useState<"upload" | "compose" | "review" | "detail">("upload");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({ email: null, name: null, first_name: null, last_name: null, company: null });
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [aiPersonalize, setAiPersonalize] = useState(false);
  const [aiInstructions, setAiInstructions] = useState("");
  const [createLeads, setCreateLeads] = useState(true);
  const [followupDays, setFollowupDays] = useState<number | null>(3);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [sender, setSender] = useState<SenderStatus | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [busy, setBusy] = useState<"" | "parse" | "preview" | "send">("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const lastFocus = useRef<"subject" | "body">("body");

  const loadCampaigns = useCallback(() => {
    campaignsApi.list().then((r) => setCampaigns(r.items)).catch(() => undefined);
  }, []);

  useEffect(() => {
    campaignsApi.sender().then(setSender).catch(() => setSender(null));
    loadCampaigns();
    const id = Number(new URLSearchParams(window.location.search).get("campaign"));
    if (id) { setDetailId(id); setStep("detail"); }
  }, [loadCampaigns]);

  const template = useMemo(() => sheet ? ({
    columns: sheet.columns, rows: sheet.rows, mapping, subject, body, ai_personalize: aiPersonalize, ai_instructions: aiInstructions || null,
  }) : null, [sheet, mapping, subject, body, aiPersonalize, aiInstructions]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy("parse");
    setError("");
    try {
      const parsed = await campaignsApi.parse(file);
      setSheet(parsed);
      setMapping(parsed.detected);
      setName(file.name.replace(/\.[^.]+$/, ""));
      setStep("compose");
    } catch (e) {
      setError(errorText(e, "Could not read the file."));
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const insertPlaceholder = (key: string) => {
    const token = `{{${key}}}`;
    const isSubject = lastFocus.current === "subject";
    const el = isSubject ? subjectRef.current : bodyRef.current;
    const value = isSubject ? subject : body;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    if (isSubject) setSubject(next); else setBody(next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + token.length, start + token.length); });
  };

  const loadPreview = async (start = 0) => {
    if (!template) return;
    setBusy("preview");
    setError("");
    try {
      const p = await campaignsApi.preview(template, start, 3);
      setPreview(p);
      setPreviewIdx(start);
      setStep("review");
    } catch (e) {
      setError(errorText(e, "Could not build the preview."));
    } finally {
      setBusy("");
    }
  };

  const send = async () => {
    if (!template || !sheet) return;
    setBusy("send");
    setError("");
    try {
      const r = await campaignsApi.create({ ...template, name: name.trim() || sheet.filename, source_filename: sheet.filename, create_leads: createLeads, followup_days: followupDays });
      if (wasCancelled(r)) return;
      setDetailId(r.campaign.id);
      setStep("detail");
      loadCampaigns();
    } catch (e) {
      setError(errorText(e, "The campaign could not be started."));
    } finally {
      setBusy("");
    }
  };

  const reset = () => {
    setSheet(null); setPreview(null); setStep("upload"); setDetailId(null); setError("");
    loadCampaigns();
  };

  const stepper = (
    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest">
      {[["upload", "1 · Upload"], ["compose", "2 · Personalize"], ["review", "3 · Preview & send"]].map(([k, l], i) => {
        const order = ["upload", "compose", "review", "detail"];
        const reached = order.indexOf(step) >= i;
        return <span key={k} className={reached ? "text-indigo-600 dark:text-indigo-400" : "text-slate-300 dark:text-zinc-600"}>{l}{i < 2 ? <ChevronRight className="ml-1 inline h-3 w-3" /> : null}</span>;
      })}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"><FileSpreadsheet className="h-5 w-5" /></div>
            <div>
              <h2 className="text-base font-black text-slate-800 dark:text-zinc-100">Excel upload → personalized emails</h2>
              <p className="text-xs text-slate-500 dark:text-zinc-400">Each row gets its own email with its name and details filled in, sent from your company email account.</p>
            </div>
          </div>
          {step !== "detail" && stepper}
        </div>

        <SenderBanner sender={sender} onOpenSettings={onOpenSettings} />
        {error && <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"><XCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}

        {step === "upload" && (
          <div className="mt-4">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
              onClick={() => fileRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${dragging ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-500/10" : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50"}`}>
              {busy === "parse" ? <Loader2 className="h-8 w-8 animate-spin text-indigo-500" /> : <Upload className="h-8 w-8 text-indigo-500" />}
              <p className="text-sm font-black text-slate-700 dark:text-zinc-200">{busy === "parse" ? "Reading your file…" : "Drop an Excel or CSV file here, or click to choose"}</p>
              <p className="text-xs text-slate-500 dark:text-zinc-400">.xlsx or .csv · first row = column names · needs at least an email column (name, company and any other columns can be used in the email)</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
            </div>
            <button onClick={downloadSample} className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:underline"><Download className="h-3.5 w-3.5" /> Download a sample template</button>
          </div>
        )}

        {step === "compose" && sheet && (
          <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-zinc-950 dark:text-zinc-300">
                <p className="font-bold text-slate-800 dark:text-zinc-100">{sheet.filename}</p>
                <p>{sheet.stats.rows} rows · <b className="text-emerald-600">{sheet.stats.sendable} with a valid email</b>
                  {sheet.stats.invalid_email ? ` · ${sheet.stats.invalid_email} invalid` : ""}{sheet.stats.duplicates ? ` · ${sheet.stats.duplicates} duplicates` : ""}{sheet.stats.missing_email ? ` · ${sheet.stats.missing_email} without email` : ""}</p>
                <button onClick={() => fileRef.current?.click()} className="mt-1 font-bold text-indigo-600 hover:underline">Choose a different file</button>
                <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
              </div>
              <div>
                <p className={labelCls}>Which column is which?</p>
                <div className="space-y-2">
                  {FIELD_LABELS.map((f) => (
                    <div key={f.key} className="grid grid-cols-[110px_1fr] items-center gap-2">
                      <span className="text-xs font-bold text-slate-600 dark:text-zinc-300">{f.label}{f.required && <span className="text-red-500"> *</span>}</span>
                      <select className={inputCls} value={mapping[f.key] || ""} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || null }))}>
                        <option value="">{f.required ? "Choose a column…" : "— not in file —"}</option>
                        {sheet.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-zinc-700">
                <p className="bg-slate-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 dark:bg-zinc-950">First rows</p>
                <div className="max-h-52 overflow-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead><tr>{sheet.columns.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1 font-bold text-slate-500">{c}</th>)}</tr></thead>
                    <tbody>{sheet.rows.slice(0, 6).map((r, i) => (
                      <tr key={i} className="border-t border-slate-100 dark:border-zinc-800">{sheet.columns.map((c) => <td key={c} className="max-w-[160px] truncate whitespace-nowrap px-2 py-1 text-slate-600 dark:text-zinc-300">{r[c]}</td>)}</tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className={labelCls}>Campaign name</label>
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Subject</label>
                <input ref={subjectRef} className={inputCls} value={subject} onFocus={() => { lastFocus.current = "subject"; }} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Email body</label>
                <textarea ref={bodyRef} className={`${inputCls} min-h-[220px] resize-y font-sans leading-relaxed`} value={body} onFocus={() => { lastFocus.current = "body"; }} onChange={(e) => setBody(e.target.value)} />
                <p className="mt-1.5 text-[11px] text-slate-500 dark:text-zinc-400">Click a field to insert it. Add a fallback with a pipe: <code className="rounded bg-slate-100 px-1 dark:bg-zinc-800">{"{{company|your business}}"}</code>. Your Email Agent signature is appended automatically.</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {sheet.placeholders.map((p) => (
                    <button key={p} type="button" onClick={() => insertPlaceholder(p)}
                      className="rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">
                      {`{{${p}}}`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-500/30 dark:bg-violet-500/5">
                <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-zinc-200">
                  <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-violet-600" checked={aiPersonalize} onChange={(e) => setAiPersonalize(e.target.checked)} />
                  <span><b className="inline-flex items-center gap-1"><Bot className="h-3.5 w-3.5" /> Let AI personalize each email</b><br />
                    <span className="text-slate-500 dark:text-zinc-400">AI tailors a sentence or two to each row’s details (e.g. a Notes or City column) while keeping your message.</span></span>
                </label>
                {aiPersonalize && <input className={`${inputCls} mt-2`} value={aiInstructions} onChange={(e) => setAiInstructions(e.target.value)} placeholder="Optional instructions, e.g. reference their Notes column, keep it under 120 words" />}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 text-xs text-slate-700 dark:border-zinc-700 dark:text-zinc-200">
                  <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-indigo-600" checked={createLeads} onChange={(e) => setCreateLeads(e.target.checked)} />
                  <span><b className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Add new contacts as leads</b><br /><span className="text-slate-500 dark:text-zinc-400">Existing leads/clients are matched by email.</span></span>
                </label>
                <div className="rounded-xl border border-slate-200 p-3 text-xs dark:border-zinc-700">
                  <p className="inline-flex items-center gap-1 font-bold text-slate-700 dark:text-zinc-200"><CalendarClock className="h-3.5 w-3.5" /> Schedule a follow-up</p>
                  <select className={`${inputCls} mt-1.5`} value={followupDays ?? ""} onChange={(e) => setFollowupDays(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">No follow-up</option>
                    {[2, 3, 5, 7, 14].map((d) => <option key={d} value={d}>{d} days after sending</option>)}
                  </select>
                </div>
              </div>
              <div className="flex justify-between gap-2 pt-1">
                <button className={secondaryBtn} onClick={reset}><ArrowLeft className="h-3.5 w-3.5" /> Start over</button>
                <button className={primaryBtn} onClick={() => loadPreview(0)} disabled={busy === "preview" || !mapping.email || !subject.trim() || !body.trim()}>
                  {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Preview emails
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "review" && preview && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-emerald-50 px-4 py-3 dark:bg-emerald-500/10"><p className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">Will be sent</p><p className="text-2xl font-black text-emerald-700 dark:text-emerald-300">{preview.sendable}</p></div>
              <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-zinc-950"><p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Skipped rows</p><p className="text-2xl font-black text-slate-700 dark:text-zinc-200">{preview.skipped.length}</p></div>
              <div className={`rounded-xl px-4 py-3 ${preview.rows_with_missing_values ? "bg-amber-50 dark:bg-amber-500/10" : "bg-slate-50 dark:bg-zinc-950"}`}><p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">Rows with empty fields</p><p className="text-2xl font-black text-amber-700 dark:text-amber-300">{preview.rows_with_missing_values}</p></div>
            </div>
            {preview.ai_personalized && <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300"><Sparkles className="h-3.5 w-3.5" /> These previews were personalized by AI — every email is personalized the same way when sent.</p>}
            {aiPersonalize && !preview.ai_available && <p className="text-xs font-semibold text-amber-700">AI is not configured on the server, so the merged template will be sent as-is.</p>}

            <div className="space-y-3">
              {preview.previews.map((p) => (
                <div key={p.row_number} className="rounded-2xl border border-slate-200 bg-white dark:border-zinc-700 dark:bg-zinc-950">
                  <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2 text-xs dark:border-zinc-800">
                    <span className="rounded bg-slate-100 px-1.5 font-mono text-[10px] text-slate-500 dark:bg-zinc-800">row {p.row_number}</span>
                    <span className="font-bold text-slate-700 dark:text-zinc-200">To: {p.name ? `${p.name} <${p.email}>` : p.email}</span>
                    {p.missing.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">empty: {p.missing.join(", ")}</span>}
                    {p.note && <span className="text-[10px] text-amber-600">{p.note}</span>}
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-sm font-bold text-slate-800 dark:text-zinc-100">{p.subject}</p>
                    <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600 dark:text-zinc-300">{p.body}</p>
                  </div>
                </div>
              ))}
              {preview.previews.length === 0 && <p className="text-center text-xs text-slate-400">No sendable rows to preview.</p>}
              <div className="flex items-center justify-center gap-2">
                <button className={secondaryBtn} disabled={previewIdx === 0 || busy === "preview"} onClick={() => loadPreview(Math.max(0, previewIdx - 3))}><ChevronLeft className="h-3.5 w-3.5" /> Previous</button>
                <span className="text-xs text-slate-500">{preview.sendable ? `${previewIdx + 1}–${Math.min(previewIdx + 3, preview.sendable)} of ${preview.sendable}` : ""}</span>
                <button className={secondaryBtn} disabled={previewIdx + 3 >= preview.sendable || busy === "preview"} onClick={() => loadPreview(previewIdx + 3)}>Next <ChevronRight className="h-3.5 w-3.5" /></button>
              </div>
            </div>

            {preview.skipped.length > 0 && (
              <details className="rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-zinc-700">
                <summary className="cursor-pointer font-bold text-slate-600 dark:text-zinc-300">Skipped rows ({preview.skipped.length})</summary>
                <ul className="mt-2 space-y-0.5 text-slate-500">{preview.skipped.map((s) => <li key={s.row_number}>Row {s.row_number}{s.email ? ` (${s.email})` : ""}: {s.reason}</li>)}</ul>
              </details>
            )}

            <div className="flex flex-wrap justify-between gap-2">
              <button className={secondaryBtn} onClick={() => setStep("compose")}><ArrowLeft className="h-3.5 w-3.5" /> Edit template</button>
              <button className={primaryBtn} onClick={send} disabled={busy === "send" || !preview.sendable || !sender?.configured}>
                {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send {preview.sendable} email{preview.sendable === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        )}

        {step === "detail" && detailId && (
          <div className="mt-4"><CampaignDetail id={detailId} onBack={reset} /></div>
        )}
      </div>

      {step !== "detail" && campaigns.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <p className="mb-3 flex items-center gap-2 text-sm font-black text-slate-800 dark:text-zinc-100"><History className="h-4 w-4 text-indigo-500" /> Campaign history</p>
          <div className="space-y-2">
            {campaigns.map((c) => (
              <button key={c.id} onClick={() => { setDetailId(c.id); setStep("detail"); }}
                className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-slate-100 px-3 py-2.5 text-left transition hover:border-indigo-200 hover:bg-indigo-50/40 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
                <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-700 dark:text-zinc-200">{c.name}</p>
                  <p className="text-[11px] text-slate-500"><Clock className="mr-1 inline h-3 w-3" />{when(c.created_at)} · from {c.sender_email || "—"}</p>
                </div>
                <span className="text-[11px] font-bold text-emerald-600"><CheckCircle2 className="mr-0.5 inline h-3 w-3" />{c.sent} sent</span>
                {c.failed > 0 && <span className="text-[11px] font-bold text-red-600">{c.failed} failed</span>}
                {c.skipped > 0 && <span className="text-[11px] font-bold text-slate-400">{c.skipped} skipped</span>}
                <Pill status={c.status} />
                <ArrowRight className="h-3.5 w-3.5 text-slate-300" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
