"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail,
  Server,
  ShieldCheck,
  Eye,
  EyeOff,
  Save,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  KeyRound,
} from "lucide-react";
import { API_BASE_URL } from "@/config";

type Security = "ssl" | "starttls" | "none";

interface IntegrationState {
  configured: boolean;
  email?: string;
  provider?: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_security?: string;
  imap_host?: string;
  imap_port?: number;
  imap_security?: string;
  is_active?: boolean;
  smtp_status?: string;
  imap_status?: string;
  last_tested_at?: string | null;
}

interface TestResult {
  smtp?: { ok: boolean; message: string } | null;
  imap?: { ok: boolean; message: string } | null;
  last_tested_at?: string | null;
}

const PRESETS: Record<string, { smtp_host: string; smtp_port: number; smtp_security: Security; imap_host: string; imap_port: number; imap_security: Security } | null> = {
  gmail: { smtp_host: "smtp.gmail.com", smtp_port: 587, smtp_security: "starttls", imap_host: "imap.gmail.com", imap_port: 993, imap_security: "ssl" },
  outlook: { smtp_host: "smtp.office365.com", smtp_port: 587, smtp_security: "starttls", imap_host: "outlook.office365.com", imap_port: 993, imap_security: "ssl" },
  yahoo: { smtp_host: "smtp.mail.yahoo.com", smtp_port: 465, smtp_security: "ssl", imap_host: "imap.mail.yahoo.com", imap_port: 993, imap_security: "ssl" },
  zoho: { smtp_host: "smtp.zoho.com", smtp_port: 465, smtp_security: "ssl", imap_host: "imap.zoho.com", imap_port: 993, imap_security: "ssl" },
  custom: null,
};

const PROVIDER_LABELS: Record<string, string> = {
  gmail: "Gmail",
  outlook: "Microsoft Outlook / Microsoft 365",
  yahoo: "Yahoo",
  zoho: "Zoho",
  custom: "Custom",
};

const SECURITY_OPTIONS: { value: Security; label: string }[] = [
  { value: "ssl", label: "SSL/TLS" },
  { value: "starttls", label: "STARTTLS" },
  { value: "none", label: "None" },
];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function StatusDot({ status }: { status?: string }) {
  const color =
    status === "connected" ? "#10b981" : status === "failed" ? "#ef4444" : "#94a3b8";
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
      style={{ background: color, boxShadow: status === "connected" ? "0 0 8px rgba(16,185,129,0.6)" : undefined }}
    />
  );
}

function IntegrationField({
  icon: Icon,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  right,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  right?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="min-w-0">
      <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--text-secondary)" }}>
        {label}
      </label>
      <div
        className="flex items-center gap-3 px-3.5 py-3 rounded-xl border transition-all duration-200"
        style={{
          borderColor: focused ? "#2563eb" : "var(--border)",
          background: "var(--background)",
          boxShadow: focused ? "0 0 0 3px rgba(37,99,235,0.1)" : undefined,
        }}
      >
        <Icon className="w-4 h-4 shrink-0" style={{ color: focused ? "#2563eb" : "var(--text-secondary)" }} />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-[13.5px] outline-none min-w-0"
          style={{ color: "var(--text-primary)" }}
        />
        {right}
      </div>
    </div>
  );
}

function SecuritySelect({ label, value, onChange }: { label: string; value: Security; onChange: (v: Security) => void }) {
  return (
    <div className="min-w-0">
      <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--text-secondary)" }}>
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Security)}
        className="w-full px-3.5 py-3 rounded-xl border text-[13.5px] outline-none"
        style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text-primary)" }}
      >
        {SECURITY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function EmailIntegrationSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<null | "smtp" | "imap" | "all">(null);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const [provider, setProvider] = useState<string>("gmail");
  const [email, setEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [hasSavedPassword, setHasSavedPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("");
  const [smtpSecurity, setSmtpSecurity] = useState<Security>("starttls");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("");
  const [imapSecurity, setImapSecurity] = useState<Security>("ssl");

  const [status, setStatus] = useState<{ smtp?: string; imap?: string; last_tested_at?: string | null }>({});
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [fieldError, setFieldError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState<string>("");

  const showToast = (msg: string, type: "ok" | "err" = "ok") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  const snapshot = () =>
    JSON.stringify({ provider, email, smtpHost, smtpPort, smtpSecurity, imapHost, imapPort, imapSecurity });

  const applyIntegration = (data: IntegrationState) => {
    const configured = !!data.configured;
    setProvider(data.provider || "custom");
    setEmail(data.email || "");
    setSmtpHost(data.smtp_host || "");
    setSmtpPort(data.smtp_port ? String(data.smtp_port) : "");
    setSmtpSecurity((data.smtp_security as Security) || "starttls");
    setImapHost(data.imap_host || "");
    setImapPort(data.imap_port ? String(data.imap_port) : "");
    setImapSecurity((data.imap_security as Security) || "ssl");
    setHasSavedPassword(configured);
    setChangingPassword(false);
    setAppPassword("");
    setStatus({ smtp: data.smtp_status, imap: data.imap_status, last_tested_at: data.last_tested_at });
    setTestResult(null);
    setSavedSnapshot(
      JSON.stringify({
        provider: data.provider || "custom",
        email: data.email || "",
        smtpHost: data.smtp_host || "",
        smtpPort: data.smtp_port ? String(data.smtp_port) : "",
        smtpSecurity: (data.smtp_security as Security) || "starttls",
        imapHost: data.imap_host || "",
        imapPort: data.imap_port ? String(data.imap_port) : "",
        imapSecurity: (data.imap_security as Security) || "ssl",
      })
    );
    setDirty(false);
  };

  const loadIntegration = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/users/me/email-integration`);
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      applyIntegration(data.integration || { configured: false });
    } catch {
      showToast("Unable to load email integration settings.", "err");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIntegration();
  }, []);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const touch = () => setDirty(true);

  const applyPreset = (key: string) => {
    setProvider(key);
    const p = PRESETS[key];
    if (p) {
      setSmtpHost(p.smtp_host);
      setSmtpPort(String(p.smtp_port));
      setSmtpSecurity(p.smtp_security);
      setImapHost(p.imap_host);
      setImapPort(String(p.imap_port));
      setImapSecurity(p.imap_security);
    }
    touch();
  };

  const validate = (): string => {
    if (!email.trim() || !EMAIL_RE.test(email.trim())) return "Please enter a valid email address.";
    if (!smtpHost.trim()) return "SMTP server is required.";
    const sp = Number(smtpPort);
    if (!Number.isInteger(sp) || sp < 1 || sp > 65535) return "SMTP port must be a number between 1 and 65535.";
    if (!imapHost.trim()) return "IMAP server is required.";
    const ip = Number(imapPort);
    if (!Number.isInteger(ip) || ip < 1 || ip > 65535) return "IMAP port must be a number between 1 and 65535.";
    if (!hasSavedPassword && !appPassword) return "App password is required for a new configuration.";
    if (changingPassword && !appPassword) return "Please enter the new app password or cancel.";
    return "";
  };

  const handleSave = async () => {
    if (saving) return;
    const err = validate();
    setFieldError(err);
    if (err) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        email: email.trim(),
        provider,
        smtp_host: smtpHost.trim(),
        smtp_port: Number(smtpPort),
        smtp_security: smtpSecurity,
        imap_host: imapHost.trim(),
        imap_port: Number(imapPort),
        imap_security: imapSecurity,
      };
      if (appPassword) payload.app_password = appPassword;
      const res = await fetch(`${API_BASE_URL}/users/me/email-integration`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.detail === "string" ? data.detail : "save failed");
      }
      const data = await res.json();
      applyIntegration(data.integration);
      showToast("Email integration settings saved successfully.");
    } catch (e) {
      showToast(e instanceof Error && e.message && e.message !== "save failed" ? "Unable to save email integration settings. " + e.message : "Unable to save email integration settings.", "err");
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (scope: "smtp" | "imap" | "all") => {
    if (testing) return;
    const err = validate();
    setFieldError(err);
    if (err) return;
    setTesting(scope);
    setTestResult(null);
    try {
      const formValues = {
        email: email.trim(),
        provider,
        smtp_host: smtpHost.trim(),
        smtp_port: Number(smtpPort),
        smtp_security: smtpSecurity,
        imap_host: imapHost.trim(),
        imap_port: Number(imapPort),
        imap_security: imapSecurity,
      };
      // Test the SAVED configuration (so the backend can persist status) when
      // the form is unchanged and no new password is pending; otherwise test
      // the current form values without persisting anything.
      const pristine = snapshot() === savedSnapshot && !appPassword && hasSavedPassword;
      const payload: Record<string, unknown> = { scope };
      if (!pristine) {
        Object.assign(payload, formValues);
        if (appPassword) payload.app_password = appPassword;
      }
      const res = await fetch(`${API_BASE_URL}/users/me/email-integration/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof data.detail === "string" ? data.detail : "Test failed.";
        setTestResult({ smtp: scope !== "imap" ? { ok: false, message: msg } : null, imap: scope !== "smtp" ? { ok: false, message: msg } : null });
        return;
      }
      setTestResult(data);
      if (!pristine && data.last_tested_at == null) {
        // Overridden (unsaved) values were tested — statuses come from the result only.
        setStatus((s) => ({ ...s, smtp: data.smtp ? (data.smtp.ok ? "connected" : "failed") : s.smtp, imap: data.imap ? (data.imap.ok ? "connected" : "failed") : s.imap }));
      } else if (data.last_tested_at) {
        setStatus({
          smtp: data.smtp ? (data.smtp.ok ? "connected" : "failed") : status.smtp,
          imap: data.imap ? (data.imap.ok ? "connected" : "failed") : status.imap,
          last_tested_at: data.last_tested_at,
        });
      } else {
        setStatus((s) => ({ ...s, smtp: data.smtp ? (data.smtp.ok ? "connected" : "failed") : s.smtp, imap: data.imap ? (data.imap.ok ? "connected" : "failed") : s.imap }));
      }
    } catch {
      showToast("Unable to run the connection test.", "err");
    } finally {
      setTesting(null);
    }
  };

  const overallStatus = !hasSavedPassword
    ? { label: "Configuration Required", color: "#94a3b8" }
    : status.smtp === "connected" || status.imap === "connected"
    ? { label: "Connected", color: "#10b981" }
    : status.smtp === "failed" || status.imap === "failed"
    ? { label: "Connection failed", color: "#ef4444" }
    : { label: "Not tested", color: "#f59e0b" };

  if (loading) {
    return (
      <div className="rounded-2xl p-10 flex items-center justify-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--text-secondary)" }} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header + overall status */}
      <div className="rounded-2xl p-6 flex flex-wrap items-start justify-between gap-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div>
          <h2 className="text-[17px] font-extrabold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Mail className="w-5 h-5" style={{ color: "#2563eb" }} /> Email Integration
          </h2>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            Connect your email account to send and receive emails through the Email Agent.
          </p>
        </div>
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl" style={{ border: "1px solid var(--border)", background: "var(--background)" }}>
          <StatusDot status={hasSavedPassword ? (overallStatus.label === "Connected" ? "connected" : overallStatus.label === "Connection failed" ? "failed" : "not_tested") : "not_configured"} />
          <span className="text-[12px] font-bold" style={{ color: overallStatus.color }}>
            {overallStatus.label}
          </span>
        </div>
      </div>

      {/* EMAIL ACCOUNT */}
      <div className="rounded-2xl p-6 space-y-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Email Account</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="min-w-0">
            <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--text-secondary)" }}>
              Email Provider
            </label>
            <select
              value={provider}
              onChange={(e) => applyPreset(e.target.value)}
              className="w-full px-3.5 py-3 rounded-xl border text-[13.5px] outline-none"
              style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--text-primary)" }}
            >
              {Object.keys(PROVIDER_LABELS).map((k) => (
                <option key={k} value={k}>
                  {PROVIDER_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <IntegrationField icon={Mail} label="Email Address" value={email} onChange={(v) => { setEmail(v); touch(); }} placeholder="user@example.com" type="email" />
        </div>

        <div>
          <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--text-secondary)" }}>
            App Password
          </label>
          {hasSavedPassword && !changingPassword ? (
            <div className="flex flex-wrap items-center gap-3">
              <div
                className="flex items-center gap-3 px-3.5 py-3 rounded-xl border flex-1 min-w-[220px]"
                style={{ borderColor: "var(--border)", background: "var(--background)" }}
              >
                <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: "#10b981" }} />
                <span className="text-[13.5px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                  ••••••••••••••••
                </span>
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "#10b981" }}>
                  Saved securely
                </span>
              </div>
              <button
                onClick={() => { setChangingPassword(true); setAppPassword(""); setTimeout(() => passwordRef.current?.focus(), 50); }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12.5px] font-bold border transition-colors"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)", background: "var(--background)" }}
              >
                <KeyRound className="w-3.5 h-3.5" /> Change App Password
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--background)" }}>
              <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: "var(--text-secondary)" }} />
              <input
                ref={passwordRef}
                type={showPassword ? "text" : "password"}
                value={appPassword}
                onChange={(e) => { setAppPassword(e.target.value); touch(); }}
                placeholder="Enter app password"
                autoComplete="new-password"
                className="flex-1 bg-transparent text-[13.5px] outline-none"
                style={{ color: "var(--text-primary)" }}
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ color: "var(--text-secondary)" }} aria-label={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              {changingPassword && (
                <button
                  type="button"
                  onClick={() => { setChangingPassword(false); setAppPassword(""); }}
                  className="text-[11px] font-bold uppercase tracking-widest"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Cancel
                </button>
              )}
            </div>
          )}
          <p className="text-[11px] mt-1.5" style={{ color: "var(--text-secondary)" }}>
            Stored encrypted on the server. For Gmail, use an App Password from your Google Account.
          </p>
        </div>
      </div>

      {/* SMTP CONFIGURATION */}
      <div className="rounded-2xl p-6 space-y-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
            <Server className="w-3.5 h-3.5" /> SMTP Configuration
          </p>
          <button
            onClick={() => runTest("smtp")}
            disabled={testing !== null}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12.5px] font-bold transition-colors disabled:opacity-60"
            style={{ border: "1px solid var(--border)", color: "var(--text-primary)", background: "var(--background)" }}
          >
            {testing === "smtp" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Test SMTP
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <IntegrationField icon={Server} label="SMTP Server" value={smtpHost} onChange={(v) => { setSmtpHost(v); touch(); }} placeholder="smtp.gmail.com" />
          <IntegrationField icon={Server} label="SMTP Port" value={smtpPort} onChange={(v) => { setSmtpPort(v.replace(/[^0-9]/g, "")); touch(); }} placeholder="587" />
        </div>
        <SecuritySelect label="Security" value={smtpSecurity} onChange={(v) => { setSmtpSecurity(v); touch(); }} />
      </div>

      {/* IMAP CONFIGURATION */}
      <div className="rounded-2xl p-6 space-y-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
            <Mail className="w-3.5 h-3.5" /> IMAP Configuration
          </p>
          <button
            onClick={() => runTest("imap")}
            disabled={testing !== null}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12.5px] font-bold transition-colors disabled:opacity-60"
            style={{ border: "1px solid var(--border)", color: "var(--text-primary)", background: "var(--background)" }}
          >
            {testing === "imap" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Test IMAP
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <IntegrationField icon={Server} label="IMAP Server" value={imapHost} onChange={(v) => { setImapHost(v); touch(); }} placeholder="imap.gmail.com" />
          <IntegrationField icon={Server} label="IMAP Port" value={imapPort} onChange={(v) => { setImapPort(v.replace(/[^0-9]/g, "")); touch(); }} placeholder="993" />
        </div>
        <SecuritySelect label="Security" value={imapSecurity} onChange={(v) => { setImapSecurity(v); touch(); }} />
      </div>

      {/* CONNECTION STATUS */}
      <div className="rounded-2xl p-6 space-y-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Connection Status</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl" style={{ border: "1px solid var(--border)", background: "var(--background)" }}>
            <StatusDot status={status.smtp} />
            <span className="text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>SMTP:</span>
            <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
              {status.smtp === "connected" ? "Connected" : status.smtp === "failed" ? "Connection failed" : "Not tested"}
            </span>
          </div>
          <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl" style={{ border: "1px solid var(--border)", background: "var(--background)" }}>
            <StatusDot status={status.imap} />
            <span className="text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>IMAP:</span>
            <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
              {status.imap === "connected" ? "Connected" : status.imap === "failed" ? "Connection failed" : "Not tested"}
            </span>
          </div>
        </div>
        {status.last_tested_at && (
          <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
            Last tested: {new Date(status.last_tested_at).toLocaleString()}
          </p>
        )}

        <AnimatePresence>
          {testResult && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-2">
              {(["smtp", "imap"] as const).map((k) => {
                const r = testResult[k];
                if (!r) return null;
                return (
                  <div
                    key={k}
                    className="flex items-start gap-2 px-3.5 py-3 rounded-xl text-[13px]"
                    style={
                      r.ok
                        ? { background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", color: "#10b981" }
                        : { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#ef4444" }
                    }
                  >
                    {r.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                    <span>
                      <strong className="uppercase tracking-widest text-[11px]">{k}</strong> — {r.message}
                    </span>
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex justify-end">
          <button
            onClick={() => runTest("all")}
            disabled={testing !== null}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold transition-colors disabled:opacity-60"
            style={{ border: "1px solid var(--border)", color: "var(--text-primary)", background: "var(--background)" }}
          >
            {testing === "all" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Test All Connections
          </button>
        </div>
      </div>

      {/* Validation error + Save */}
      {fieldError && (
        <div className="flex items-center gap-2 px-3.5 py-3 rounded-xl text-sm" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#ef4444" }}>
          <AlertTriangle className="w-4 h-4 shrink-0" /> {fieldError}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {dirty && (
          <span className="text-[12px] font-bold" style={{ color: "#f59e0b" }}>
            You have unsaved changes.
          </span>
        )}
        <div className="ml-auto">
          <motion.button
            onClick={handleSave}
            disabled={saving}
            whileHover={{ scale: saving ? 1 : 1.02 }}
            whileTap={{ scale: 0.97 }}
            className="px-6 py-2.5 rounded-xl font-bold text-[13px] text-white flex items-center gap-2 transition-all disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, #2563eb, #6366f1)", boxShadow: "0 4px 16px rgba(37,99,235,0.25)" }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "Saving…" : "Save Configuration"}
          </motion.button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[300] flex items-center gap-2 px-4 py-3 rounded-xl shadow-xl text-sm font-semibold text-white ${toast.type === "ok" ? "bg-emerald-600" : "bg-red-600"}`}
        >
          {toast.type === "ok" ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
