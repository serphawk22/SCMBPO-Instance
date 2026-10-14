"use client";

import { useState, useEffect } from "react";
import { useRole } from "@/context/RoleContext";
import { Loader2, ArrowRight, ArrowLeft, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import AuthThemeToggle from "@/components/AuthThemeToggle";

const REMEMBERED_EMAIL_KEY = "crm_remembered_email";

function ScmBpoMark() {
  return (
    <div className="flex flex-col">
      <div className="flex items-end gap-1.5">
        <span className="text-[26px] font-extrabold leading-none tracking-tight text-white">
          SCM
        </span>
        <span className="relative text-[26px] font-extrabold leading-none tracking-tight text-white">
          BPO
          <svg
            viewBox="0 0 40 14"
            className="absolute -top-2.5 left-1 h-3 w-9 text-white/90"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="3" cy="10" r="1.6" />
            <circle cx="9" cy="6.5" r="1.6" />
            <circle cx="15.5" cy="4" r="1.6" />
            <circle cx="22.5" cy="3" r="1.6" />
            <circle cx="29.5" cy="3.4" r="1.6" />
            <circle cx="36" cy="5" r="1.6" />
          </svg>
        </span>
      </div>
      <span className="mt-1.5 text-[8px] font-bold tracking-[0.22em] text-slate-300/90">
        SUPPLY CHAIN &amp; OPERATIONS
      </span>
    </div>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { login, isAuthenticated, loading: authLoading } = useRole();

  useEffect(() => {
    setMounted(true);
    try {
      const remembered = localStorage.getItem(REMEMBERED_EMAIL_KEY);
      if (remembered) setEmail(remembered);
    } catch {
      // Storage unavailable (private mode) - continue with a blank field.
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const result = await login(email, password);

      if (result.success) {
        try {
          if (rememberMe) {
            localStorage.setItem(REMEMBERED_EMAIL_KEY, email.trim());
          } else {
            localStorage.removeItem(REMEMBERED_EMAIL_KEY);
          }
        } catch {
          // Storage unavailable - login itself already succeeded.
        }
        window.location.href = "/";
      } else {
        setError(result.message || "Login failed");
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!mounted || authLoading) {
    return <div className="min-h-screen bg-white dark:bg-[#0a0a0b]" />;
  }

  // Already signed in - the RoleProvider effect redirects to the dashboard.
  if (isAuthenticated) return null;

  return (
    <div className="flex min-h-screen w-full flex-col bg-white font-sans dark:bg-[#0a0a0b] lg:flex-row">
      {/* ── Left panel: brand / welcome / stats ─────────────────────────── */}
      <section className="relative flex flex-col justify-between overflow-hidden bg-[#0d1a3d] px-7 py-8 text-white sm:px-12 lg:min-h-screen lg:w-[52%] lg:px-14 lg:py-10">
        {/* Soft radial glows */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl" />
          <div className="absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-blue-600/10 blur-3xl" />
        </div>

        {/* Top row: logo + back home */}
        <div className="relative z-10 flex items-start justify-between gap-4">
          <ScmBpoMark />
          <a
            href="/showcase"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/20"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Home
          </a>
        </div>

        {/* Middle: welcome copy + stats */}
        <div className="relative z-10 py-10 lg:py-0">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="inline-block rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3.5 py-1.5 text-[10px] font-bold tracking-[0.18em] text-emerald-300">
              SUPPLY CHAIN OPERATIONS
            </span>
            <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl">
              Welcome to Your
              <br />
              Operations Workspace.
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-slate-300/90">
              Manage freight forwarding, vendor coordination, customer
              commitments, and warehouse fulfillment from one connected
              platform.
            </p>

            <div className="mt-8 grid max-w-lg grid-cols-3 gap-2.5 sm:gap-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-4 sm:px-5">
                <div className="text-xl font-extrabold text-emerald-400 sm:text-2xl">
                  248
                </div>
                <div className="mt-1 text-[9px] font-bold tracking-[0.14em] text-slate-300/80 sm:text-[10px]">
                  ACTIVE LEADS
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-4 sm:px-5">
                <div className="text-xl font-extrabold text-emerald-400 sm:text-2xl">
                  42
                </div>
                <div className="mt-1 text-[9px] font-bold tracking-[0.14em] text-slate-300/80 sm:text-[10px]">
                  ENROLLMENTS
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-4 sm:px-5">
                <div className="text-xl font-extrabold text-emerald-400 sm:text-2xl">
                  100%
                </div>
                <div className="mt-1 text-[9px] font-bold tracking-[0.14em] text-slate-300/80 sm:text-[10px]">
                  PLACEMENT AIM
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Bottom footer */}
        <div className="relative z-10 flex items-center justify-between gap-3 border-t border-white/10 pt-5 text-[11px] text-slate-300/80 sm:text-xs">
          <span>SCM BPO &bull; Supply Chain &amp; Operations</span>
          <span>
            Powered by{" "}
            <span className="font-semibold text-sky-400">SERP Hawk CRM</span>
          </span>
        </div>
      </section>

      {/* ── Right panel: sign-in form ───────────────────────────────────── */}
      <section className="relative flex flex-1 items-center justify-center bg-white px-6 py-12 text-slate-900 dark:bg-[#0a0a0b] dark:text-zinc-100 sm:px-10">
        <div className="absolute right-5 top-5 sm:right-8 sm:top-7">
          <AuthThemeToggle />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-[460px]"
        >
          <h2 className="text-[26px] font-extrabold tracking-tight sm:text-3xl">
            Sign in to your account
          </h2>
          <p className="mt-2.5 text-[14px] text-slate-500 dark:text-zinc-400">
            Enter your work credentials to access the operations hub.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
            {/* Work email */}
            <div className="space-y-1.5">
              <label
                htmlFor="login-email"
                className="text-[13px] font-bold text-slate-800 dark:text-zinc-200"
              >
                Work Email Address
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 shadow-sm transition-all placeholder:text-slate-400 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/25 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-emerald-600"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label
                htmlFor="login-password"
                className="text-[13px] font-bold text-slate-800 dark:text-zinc-200"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 pr-11 text-sm text-slate-900 shadow-sm transition-all placeholder:text-slate-400 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/25 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-emerald-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-slate-700 dark:text-zinc-500 dark:hover:text-zinc-200"
                >
                  {showPassword ? (
                    <EyeOff className="h-[18px] w-[18px]" />
                  ) : (
                    <Eye className="h-[18px] w-[18px]" />
                  )}
                </button>
              </div>
            </div>

            {/* Remember me */}
            <div className="flex items-center">
              <label
                htmlFor="login-remember"
                className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-slate-600 dark:text-zinc-400"
              >
                <input
                  id="login-remember"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 cursor-pointer rounded accent-emerald-800"
                />
                Remember me
              </label>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400">
                    <ShieldCheck className="h-4 w-4 shrink-0" />
                    <span className="font-medium">{error}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0c5b3e] py-3.5 text-[15px] font-bold text-white shadow-md transition-all hover:bg-[#09492f] hover:shadow-lg active:scale-[0.99] disabled:opacity-70"
            >
              {isSubmitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  Sign In
                  <ArrowRight className="h-[18px] w-[18px]" />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-slate-400 dark:text-zinc-500">
            Protected under SCM BPO Enterprise Security
          </p>
        </motion.div>
      </section>
    </div>
  );
}
