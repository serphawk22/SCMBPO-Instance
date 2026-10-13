"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Bot, PhoneCall, Sparkles, Mic, Volume2, Zap, ArrowRight,
  ShieldCheck, CheckCircle2, Radio, Headphones
} from "lucide-react";

export default function CallsPage() {
  const [notified, setNotified] = useState(false);

  return (
    <div className="min-h-[82vh] flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-4xl mx-auto">
        {/* Glow ambient background effects */}
        <div className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-gradient-to-b from-[var(--surface)] to-[var(--surface)]/60 p-8 sm:p-12 lg:p-16 shadow-2xl backdrop-blur-xl text-center">
          {/* Decorative ambient radial blurs */}
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-purple-500/15 rounded-full blur-3xl pointer-events-none" />

          {/* Top Pill Badge */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 border border-indigo-500/20 text-indigo-500 text-xs font-black tracking-wider uppercase mb-6"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
            </span>
            <Sparkles className="h-3.5 w-3.5" />
            <span>Autonomous AI Voice Agent • In Active Development</span>
          </motion.div>

          {/* Central Animated Holographic Voice Icon */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
            className="mx-auto mb-8 relative flex items-center justify-center w-24 h-24 sm:w-28 sm:h-28 rounded-3xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-600 text-white shadow-xl shadow-indigo-500/25"
          >
            <div className="absolute inset-0 rounded-3xl border-2 border-white/20 animate-pulse" />
            <PhoneCall className="h-12 w-12 sm:h-14 sm:w-14" />

            {/* Orbiting Audio Dots */}
            <div className="absolute -top-2 -right-2 p-1.5 rounded-full bg-emerald-500 text-white shadow-md">
              <Mic className="h-3.5 w-3.5" />
            </div>
            <div className="absolute -bottom-2 -left-2 p-1.5 rounded-full bg-purple-500 text-white shadow-md">
              <Volume2 className="h-3.5 w-3.5" />
            </div>
          </motion.div>

          {/* Title & Subtitle */}
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-[var(--text-primary)]"
          >
            Auto Calling Agent <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
              Coming Soon
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-4 text-sm sm:text-base text-[var(--text-secondary)] max-w-2xl mx-auto font-medium leading-relaxed"
          >
            Stay tuned! Our human-like conversational voice agent will autonomously dial prospects,
            deliver tailored pitch angles, handle objections in real time, and log audio transcripts
            directly into your CRM deals & leads.
          </motion.p>

          {/* Animated Audio Soundwave Simulation */}
          <div className="my-8 flex items-center justify-center gap-1.5 h-10">
            {[40, 65, 90, 45, 100, 70, 35, 80, 55, 95, 60, 40, 85, 50, 75, 30, 90, 60].map((h, i) => (
              <motion.span
                key={i}
                animate={{
                  height: [`${Math.max(15, h * 0.3)}%`, `${h}%`, `${Math.max(15, h * 0.4)}%`],
                }}
                transition={{
                  repeat: Infinity,
                  duration: 1.2 + (i % 5) * 0.2,
                  ease: "easeInOut",
                }}
                className="w-1 sm:w-1.5 rounded-full bg-gradient-to-t from-indigo-500 to-purple-400 opacity-70"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>

          {/* Feature Highlights Grid */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left my-8"
          >
            <div className="p-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/50 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-indigo-500 mb-1 font-bold text-xs">
                <Radio className="h-4 w-4" />
                <span>Ultra-Low Latency</span>
              </div>
              <p className="text-xs font-semibold text-[var(--text-primary)]">Sub-400ms Voice Synthesis</p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">Instant fluid dialogue without robotic lag or awkward pauses.</p>
            </div>

            <div className="p-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/50 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-purple-500 mb-1 font-bold text-xs">
                <Zap className="h-4 w-4" />
                <span>Autonomous Outreach</span>
              </div>
              <p className="text-xs font-semibold text-[var(--text-primary)]">Automated Dialing Queue</p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">Dispatches calls based on scheduled follow-ups and inbound leads.</p>
            </div>

            <div className="p-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/50 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-emerald-500 mb-1 font-bold text-xs">
                <ShieldCheck className="h-4 w-4" />
                <span>Full CRM Sync</span>
              </div>
              <p className="text-xs font-semibold text-[var(--text-primary)]">Automatic Summaries</p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">Logs recording audio, sentiment, and outcomes directly to deals.</p>
            </div>
          </motion.div>

          {/* Early Access Action */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="pt-2"
          >
            {notified ? (
              <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold text-xs shadow-sm">
                <CheckCircle2 className="h-4 w-4" />
                <span>You are on the VIP Early Access List! We will notify you the moment it deploys.</span>
              </div>
            ) : (
              <button
                onClick={() => setNotified(true)}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 text-white font-bold text-xs shadow-lg shadow-indigo-500/25 hover:opacity-95 transition-all transform hover:-translate-y-0.5 cursor-pointer"
              >
                <span>Notify Me on Launch</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
