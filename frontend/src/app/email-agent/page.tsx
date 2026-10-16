"use client";

import React, { useState, useEffect, useRef, Fragment } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Send, Sparkles, Mail, Clock, User, Globe, ChevronDown, ChevronUp,
  CheckCircle, Building2, Briefcase, Target, AtSign, FileText, Copy, Check,
  TrendingUp, Zap, Package, UserPlus, Phone, Store, IndianRupee, MessageCircle, Trash2, Youtube,
  Save, X, Loader2, AlertTriangle, Settings, Search
} from "lucide-react";
import { API_BASE_URL } from "@/config";
import { useLanguage } from "@/context/LanguageContext";
import PageGuide from "@/components/PageGuide";
import { ResultCard, ResearchResultData, SendEmailResult, CopyButton } from "@/components/email-agent/ResultCard";
import EmailIntegrationSettings from "@/components/email-agent/EmailIntegrationSettings";
import ExcelCampaign from "@/components/email-agent/ExcelCampaign";
import { useRole } from "@/context/RoleContext";





interface ResearchResult {
  id: string;
  resultData: ResearchResultData;
  companyName: string;
  companyUrl: string;
}

interface EmailReplyData {
  id: number;
  from_address?: string | null;
  subject?: string | null;
  body_text?: string | null;
  body_text_full?: string | null;
  body_html?: string | null;
  received_at?: string | null;
}

interface ChatMessage {
  id: string;
  role: "ai" | "user";
  type: "text" | "loading";
  content?: string;
}

// One row of GET /sent-emails.
interface SentEmail {
  id: number;
  to_email: string;
  subject: string;
  company_name?: string | null;
  english_body?: string | null;
  spanish_body?: string | null;
  status?: string | null;
  manual?: boolean | null;
  sent_at?: string | null;
  replied_at?: string | null;
  reply_from?: string | null;
  reply_subject?: string | null;
  reply_body?: string | null;
  replies?: EmailReplyData[];
}

// Renders one inbound reply: a "Clean" view (quote history stripped) by
// default, with a per-reply toggle to see the original formatted HTML
// (rendered in a sandboxed iframe — sandbox="" blocks script execution and
// form/top-navigation, since this is untrusted content from a prospect's
// mailbox) or the raw plain text including the quoted thread history.
function ReplyThreadItem({ reply, t }: { reply: EmailReplyData; t: (key: string) => string }) {
  const [view, setView] = useState<"clean" | "full" | "html">("clean");
  const displayText = view === "full" ? (reply.body_text_full || reply.body_text) : reply.body_text;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-1">
        <p className="text-[9px] font-black text-green-600 dark:text-green-400 uppercase tracking-widest flex items-center gap-1">
          <MessageCircle className="w-3 h-3" />
          {t('email_agent.reply_received')}
          {reply.from_address ? ` — ${reply.from_address}` : ''}
          {reply.received_at ? ` · ${new Date(reply.received_at).toLocaleString()}` : ''}
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setView("clean")}
            className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${view === "clean" ? "bg-green-600 text-white" : "bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400"}`}
          >
            {t('email_agent.view_clean')}
          </button>
          <button
            onClick={() => setView("full")}
            className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${view === "full" ? "bg-green-600 text-white" : "bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400"}`}
          >
            {t('email_agent.view_full_thread')}
          </button>
          {reply.body_html && (
            <button
              onClick={() => setView("html")}
              className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${view === "html" ? "bg-green-600 text-white" : "bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400"}`}
            >
              {t('email_agent.view_formatted')}
            </button>
          )}
          <CopyButton text={displayText || ""} />
        </div>
      </div>
      {reply.subject && (
        <p className="text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">{reply.subject}</p>
      )}
      {view === "html" && reply.body_html ? (
        <iframe
          sandbox=""
          srcDoc={reply.body_html}
          className="w-full h-72 bg-white rounded-xl border border-green-100 dark:border-green-500/20"
          title={`reply-${reply.id}`}
        />
      ) : (
        <div className="bg-green-50 dark:bg-green-500/10 border border-green-100 dark:border-green-500/20 rounded-xl p-4 text-[13px] text-slate-600 dark:text-zinc-300 whitespace-pre-wrap max-h-72 overflow-y-auto custom-scrollbar font-sans leading-relaxed">
          {displayText}
        </div>
      )}
    </div>
  );
}



function BottomUpFillMail() {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <div className="relative w-12 h-12">
        <Mail className="absolute inset-0 w-12 h-12 text-slate-400" strokeWidth={1} />
        <motion.div
          className="absolute bottom-0 left-0 right-0 overflow-hidden"
          initial={{ height: "0%" }}
          animate={{ height: "100%" }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          <div className="absolute bottom-0 left-0 w-12 h-12">
            <Mail className="w-12 h-12 text-slate-800 dark:text-zinc-100" strokeWidth={1} fill="white" />
          </div>
        </motion.div>
      </div>
      <p className="text-xs font-bold text-slate-500 dark:text-zinc-400 animate-pulse">{t('email_agent.researching')}</p>
    </div>
  );
}


interface CountryDialCode {
  name: string;
  nativeName?: string;
  code: string;
  dialCode: string;
  flag: string;
}

const COUNTRY_DIAL_CODES: CountryDialCode[] = [
  { name: "Spain", nativeName: "España", code: "ES", dialCode: "+34", flag: "🇪🇸" },
  { name: "India", nativeName: "Bharat", code: "IN", dialCode: "+91", flag: "🇮🇳" },
  { name: "United States", nativeName: "USA", code: "US", dialCode: "+1", flag: "🇺🇸" },
  { name: "United Kingdom", nativeName: "UK", code: "GB", dialCode: "+44", flag: "🇬🇧" },
  { name: "Canada", nativeName: "Canada", code: "CA", dialCode: "+1", flag: "🇨🇦" },
  { name: "Mexico", nativeName: "México", code: "MX", dialCode: "+52", flag: "🇲🇽" },
  { name: "Australia", nativeName: "Australia", code: "AU", dialCode: "+61", flag: "🇦🇺" },
  { name: "Germany", nativeName: "Deutschland", code: "DE", dialCode: "+49", flag: "🇩🇪" },
  { name: "France", nativeName: "France", code: "FR", dialCode: "+33", flag: "🇫🇷" },
  { name: "Italy", nativeName: "Italia", code: "IT", dialCode: "+39", flag: "🇮🇹" },
  { name: "Portugal", nativeName: "Portugal", code: "PT", dialCode: "+351", flag: "🇵🇹" },
  { name: "United Arab Emirates", nativeName: "UAE", code: "AE", dialCode: "+971", flag: "🇦🇪" },
  { name: "Saudi Arabia", nativeName: "KSA", code: "SA", dialCode: "+966", flag: "🇸🇦" },
  { name: "Singapore", nativeName: "Singapore", code: "SG", dialCode: "+65", flag: "🇸🇬" },
  { name: "Japan", nativeName: "Nihon", code: "JP", dialCode: "+81", flag: "🇯🇵" },
  { name: "China", nativeName: "China", code: "CN", dialCode: "+86", flag: "🇨🇳" },
  { name: "Brazil", nativeName: "Brasil", code: "BR", dialCode: "+55", flag: "🇧🇷" },
  { name: "Argentina", nativeName: "Argentina", code: "AR", dialCode: "+54", flag: "🇦🇷" },
  { name: "Colombia", nativeName: "Colombia", code: "CO", dialCode: "+57", flag: "🇨🇴" },
  { name: "Chile", nativeName: "Chile", code: "CL", dialCode: "+56", flag: "🇨🇱" },
  { name: "Peru", nativeName: "Perú", code: "PE", dialCode: "+51", flag: "🇵🇪" },
  { name: "Ecuador", nativeName: "Ecuador", code: "EC", dialCode: "+593", flag: "🇪🇨" },
  { name: "Netherlands", nativeName: "Nederland", code: "NL", dialCode: "+31", flag: "🇳🇱" },
  { name: "Switzerland", nativeName: "Schweiz", code: "CH", dialCode: "+41", flag: "🇨🇭" },
  { name: "Sweden", nativeName: "Sverige", code: "SE", dialCode: "+46", flag: "🇸🇪" },
  { name: "Norway", nativeName: "Norge", code: "NO", dialCode: "+47", flag: "🇳🇴" },
  { name: "Denmark", nativeName: "Danmark", code: "DK", dialCode: "+45", flag: "🇩🇰" },
  { name: "Finland", nativeName: "Suomi", code: "FI", dialCode: "+358", flag: "🇫🇮" },
  { name: "Ireland", nativeName: "Éire", code: "IE", dialCode: "+353", flag: "🇮🇪" },
  { name: "Belgium", nativeName: "België", code: "BE", dialCode: "+32", flag: "🇧🇪" },
  { name: "Austria", nativeName: "Österreich", code: "AT", dialCode: "+43", flag: "🇦🇹" },
  { name: "Poland", nativeName: "Polska", code: "PL", dialCode: "+48", flag: "🇵🇱" },
  { name: "Greece", nativeName: "Hellas", code: "GR", dialCode: "+30", flag: "🇬🇷" },
  { name: "Turkey", nativeName: "Türkiye", code: "TR", dialCode: "+90", flag: "🇹🇷" },
  { name: "South Africa", nativeName: "South Africa", code: "ZA", dialCode: "+27", flag: "🇿🇦" },
  { name: "Egypt", nativeName: "Misr", code: "EG", dialCode: "+20", flag: "🇪🇬" },
  { name: "Nigeria", nativeName: "Nigeria", code: "NG", dialCode: "+234", flag: "🇳🇬" },
  { name: "Kenya", nativeName: "Kenya", code: "KE", dialCode: "+254", flag: "🇰🇪" },
  { name: "Morocco", nativeName: "Maroc", code: "MA", dialCode: "+212", flag: "🇲🇦" },
  { name: "New Zealand", nativeName: "Aotearoa", code: "NZ", dialCode: "+64", flag: "🇳🇿" },
  { name: "South Korea", nativeName: "Hanguk", code: "KR", dialCode: "+82", flag: "🇰🇷" },
  { name: "Philippines", nativeName: "Pilipinas", code: "PH", dialCode: "+63", flag: "🇵🇭" },
  { name: "Malaysia", nativeName: "Malaysia", code: "MY", dialCode: "+60", flag: "🇲🇾" },
  { name: "Indonesia", nativeName: "Indonesia", code: "ID", dialCode: "+62", flag: "🇮🇩" },
  { name: "Thailand", nativeName: "Mueang Thai", code: "TH", dialCode: "+66", flag: "🇹🇭" },
  { name: "Vietnam", nativeName: "Việt Nam", code: "VN", dialCode: "+84", flag: "🇻🇳" },
  { name: "Pakistan", nativeName: "Pakistan", code: "PK", dialCode: "+92", flag: "🇵🇰" },
  { name: "Bangladesh", nativeName: "Bangladesh", code: "BD", dialCode: "+880", flag: "🇧🇩" },
  { name: "Sri Lanka", nativeName: "Sri Lanka", code: "LK", dialCode: "+94", flag: "🇱🇰" },
  { name: "Nepal", nativeName: "Nepal", code: "NP", dialCode: "+977", flag: "🇳🇵" },
  { name: "Qatar", nativeName: "Qatar", code: "QA", dialCode: "+974", flag: "🇶🇦" },
  { name: "Kuwait", nativeName: "Kuwait", code: "KW", dialCode: "+965", flag: "🇰🇼" },
  { name: "Oman", nativeName: "Oman", code: "OM", dialCode: "+968", flag: "🇴🇲" },
  { name: "Bahrain", nativeName: "Bahrain", code: "BH", dialCode: "+973", flag: "🇧🇭" },
  { name: "Israel", nativeName: "Yisra'el", code: "IL", dialCode: "+972", flag: "🇮🇱" },
  { name: "Jordan", nativeName: "Al-Urdun", code: "JO", dialCode: "+962", flag: "🇯🇴" },
  { name: "Lebanon", nativeName: "Lubnan", code: "LB", dialCode: "+961", flag: "🇱🇧" },
  { name: "Hong Kong", nativeName: "Hong Kong", code: "HK", dialCode: "+852", flag: "🇭🇰" },
  { name: "Taiwan", nativeName: "Taiwan", code: "TW", dialCode: "+886", flag: "🇹🇼" },
  { name: "Czech Republic", nativeName: "Česko", code: "CZ", dialCode: "+420", flag: "🇨🇿" },
  { name: "Romania", nativeName: "România", code: "RO", dialCode: "+40", flag: "🇷🇴" },
  { name: "Hungary", nativeName: "Magyarország", code: "HU", dialCode: "+36", flag: "🇭🇺" },
  { name: "Uruguay", nativeName: "Uruguay", code: "UY", dialCode: "+598", flag: "🇺🇾" },
  { name: "Costa Rica", nativeName: "Costa Rica", code: "CR", dialCode: "+506", flag: "🇨🇷" },
  { name: "Panama", nativeName: "Panamá", code: "PA", dialCode: "+507", flag: "🇵🇦" },
  { name: "Dominican Republic", nativeName: "República Dominicana", code: "DO", dialCode: "+1", flag: "🇩🇴" },
  { name: "Puerto Rico", nativeName: "Puerto Rico", code: "PR", dialCode: "+1", flag: "🇵🇷" },
  { name: "Croatia", nativeName: "Hrvatska", code: "HR", dialCode: "+385", flag: "🇭🇷" },
  { name: "Bulgaria", nativeName: "Bulgaria", code: "BG", dialCode: "+359", flag: "🇧🇬" },
  { name: "Ukraine", nativeName: "Ukraina", code: "UA", dialCode: "+380", flag: "🇺🇦" },
  { name: "Russia", nativeName: "Rossiya", code: "RU", dialCode: "+7", flag: "🇷🇺" },
];

function parsePhoneNumber(fullNumber: string, defaultCode = "+91"): { dialCode: string; nationalNumber: string } {
  if (!fullNumber || !fullNumber.trim()) {
    return { dialCode: defaultCode, nationalNumber: "" };
  }
  const clean = fullNumber.trim();
  const sorted = [...COUNTRY_DIAL_CODES].sort((a, b) => b.dialCode.length - a.dialCode.length);
  if (clean.startsWith("+")) {
    for (const c of sorted) {
      if (clean.startsWith(c.dialCode)) {
        const rest = clean.slice(c.dialCode.length).trim();
        return { dialCode: c.dialCode, nationalNumber: rest };
      }
    }
  } else {
    for (const c of sorted) {
      const rawDigits = c.dialCode.replace("+", "");
      if (clean.startsWith(rawDigits) && clean.length > rawDigits.length + 5) {
        const rest = clean.slice(rawDigits.length).trim();
        return { dialCode: c.dialCode, nationalNumber: rest };
      }
    }
  }
  return { dialCode: defaultCode, nationalNumber: clean.replace(/^\+/, "") };
}


export default function EmailAgentPage() {
  const { role } = useRole();
  const { t } = useLanguage();
  const [mode, setMode] = useState<"single" | "excel">("single");
  const [companyName, setCompanyName] = useState("");
  const [inputValue, setInputValue] = useState("");
  
  const [chatStep, setChatStep] = useState<"website_url" | "loading" | "idle">("website_url");
  
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "msg-1", role: "ai", type: "text", content: t("email_agent.chat_greeting") }
  ]);
  
  const [resultsHistory, setResultsHistory] = useState<ResearchResult[]>([]);

  const [sentEmails, setSentEmails] = useState<SentEmail[]>([]);
  const [emailTotals, setEmailTotals] = useState({ totalSent: 0, autoCount: 0, manualCount: 0 });
  const [emailsLoading, setEmailsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedCompanies, setExpandedCompanies] = useState<string[]>([]);
  const [selectedEmails, setSelectedEmails] = useState<number[]>([]);

  const [profile, setProfile] = useState<{ name: string; email: string; phone: string; signature: string } | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: "", email: "", phone: "" });
  const [selectedCountryCode, setSelectedCountryCode] = useState("+91");
  const [nationalPhone, setNationalPhone] = useState("");
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const countryDropdownRef = useRef<HTMLDivElement>(null);
  const [signatureText, setSignatureText] = useState("");
  const [autoAppend, setAutoAppend] = useState(true);
  const [autoAppendSaving, setAutoAppendSaving] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingSignature, setSavingSignature] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [signatureError, setSignatureError] = useState("");
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(e.target as Node)) {
        setCountryDropdownOpen(false);
      }
    };
    if (countryDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [countryDropdownOpen]);

  const selectedCountry = COUNTRY_DIAL_CODES.find(c => c.dialCode === selectedCountryCode) || COUNTRY_DIAL_CODES[0];

  const filteredCountries = COUNTRY_DIAL_CODES.filter(c =>
    c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
    (c.nativeName && c.nativeName.toLowerCase().includes(countrySearch.toLowerCase())) ||
    c.dialCode.includes(countrySearch) ||
    c.code.toLowerCase().includes(countrySearch.toLowerCase())
  );

  const showToast = (msg: string, type: "ok" | "err" = "ok") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const refreshProfile = async () => {
    setProfileError("");
    try {
      const res = await fetch(`${API_BASE_URL}/users/me/agent-profile`);
      if (!res.ok) throw new Error("Failed to fetch profile");
      const data = await res.json();
      const a = data.agent_profile || {};
      const rawPhone = a.agent_phone || "";
      const parsed = parsePhoneNumber(rawPhone, "+91");
      setSelectedCountryCode(parsed.dialCode);
      setNationalPhone(parsed.nationalNumber);
      setProfile({
        name: a.agent_name || "",
        email: a.agent_email || "",
        phone: rawPhone,
        signature: a.signature || "",
      });
      setProfileForm({ name: a.agent_name || "", email: a.agent_email || "", phone: rawPhone });
      setSignatureText(a.signature || "");
      setAutoAppend(a.auto_append_signature !== false);
    } catch {
      setProfileError("Failed to load profile data.");
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    refreshProfile();
  }, []);

  useEffect(() => {
    if (showProfile) refreshProfile();
  }, [showProfile]);

  // Deep link: /email-agent?settings=email opens Email Integration settings
  // (used by the "Configure Email Integration" send-error action).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("settings") === "email") setShowSettings(true);
    if (params.get("campaign") || params.get("mode") === "excel") setMode("excel");
  }, []);

  const handleSaveProfile = async () => {
    if (savingProfile) return;
    setProfileError("");

    if (!profileForm.name.trim()) {
      setProfileError("Full name is required.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(profileForm.email.trim())) {
      setProfileError("Please enter a valid email address.");
      return;
    }
    const combinedPhone = nationalPhone.trim() ? `${selectedCountryCode} ${nationalPhone.trim()}` : "";
    if (combinedPhone && !/^\+?[0-9\s\-()]{7,20}$/.test(combinedPhone)) {
      setProfileError("Please enter a valid phone number.");
      return;
    }

    setSavingProfile(true);
    try {
      const res = await fetch(`${API_BASE_URL}/users/me/agent-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_name: profileForm.name.trim(),
          agent_email: profileForm.email.trim(),
          agent_phone: combinedPhone,
          auto_append_signature: autoAppend,
        }),
      });
      if (!res.ok) throw new Error("Failed to update profile");
      const data = await res.json();
      const a = data.agent_profile || {};
      const parsed = parsePhoneNumber(a.agent_phone || "", selectedCountryCode);
      setSelectedCountryCode(parsed.dialCode);
      setNationalPhone(parsed.nationalNumber);
      setProfile({
        name: a.agent_name || "",
        email: a.agent_email || "",
        phone: a.agent_phone || "",
        signature: a.signature || "",
      });
      setProfileForm({ name: a.agent_name || "", email: a.agent_email || "", phone: a.agent_phone || "" });
      setSignatureText(a.signature || "");
      setAutoAppend(a.auto_append_signature !== false);
      showToast("Profile updated successfully. Email signature updated.");
    } catch {
      showToast("Unable to update profile. Please try again.", "err");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveSignature = async () => {
    if (savingSignature) return;
    setSignatureError("");
    setSavingSignature(true);
    try {
      const res = await fetch(`${API_BASE_URL}/users/me/agent-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: signatureText }),
      });
      if (!res.ok) throw new Error("Failed to update signature");
      const data = await res.json();
      const a = data.agent_profile || {};
      setProfile(prev => (prev ? { ...prev, signature: a.signature ?? signatureText } : prev));
      showToast("Email signature updated successfully.");
    } catch {
      setSignatureError("Unable to update email signature.");
      showToast("Unable to update email signature.", "err");
    } finally {
      setSavingSignature(false);
    }
  };

  const handleToggleAutoAppend = async () => {
    if (autoAppendSaving) return;
    const next = !autoAppend;
    setAutoAppend(next);
    setAutoAppendSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/users/me/agent-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_append_signature: next }),
      });
      if (!res.ok) throw new Error("Failed to update setting");
      const data = await res.json();
      const a = data.agent_profile || {};
      setAutoAppend(a.auto_append_signature !== false);
      showToast(next ? "Auto append signature enabled." : "Auto append signature disabled.");
    } catch {
      setAutoAppend(!next);
      showToast("Unable to update auto append setting.", "err");
    } finally {
      setAutoAppendSaving(false);
    }
  };

  // Added for Gmail Agent Migration: Allows user to dismiss a specific research result and refocuses on the input field seamlessly
  const handleRemoveResult = async (id: string) => {
    setResultsHistory(prev => prev.filter(r => r.id !== id));
    if (!id.startsWith("res-")) {
      try {
        await fetch(`${API_BASE_URL}/email-agent/results/${id}`, { method: 'DELETE' });
      } catch (e) {
        console.error("Failed to delete result from DB", e);
      }
    }
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  };

  const scrollToBottom = () => {
    // Updated for Gmail Agent Migration: Smoothly scrolls the specific chat container to the bottom instead of the whole page
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, chatStep]);



  useEffect(() => {
    const fetchEmailsData = () => {
      fetch(`${API_BASE_URL}/sent-emails?limit=30`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((data) => {
          let ts = 0, auto = 0, man = 0;
          let em: any[] = [];
          if (data && typeof data === 'object' && !Array.isArray(data) && 'totalSent' in data) {
             ts = data.totalSent; auto = data.autoCount; man = data.manualCount;
             em = data.emails || [];
          } else if (Array.isArray(data)) {
             ts = data.length; man = data.filter(e => e.manual).length; auto = data.length - man;
             em = data;
          } else if (data?.emails && Array.isArray(data.emails)) {
             ts = data.emails.length; man = data.emails.filter((e: any) => e.manual).length; auto = data.emails.length - man;
             em = data.emails;
          }
          
          if (role === 'Demo' && ts === 0) {
            ts = 1420; auto = 1150; man = 270;
          }
          
          setEmailTotals({ totalSent: ts, autoCount: auto, manualCount: man });
          setSentEmails(em);
        })
        .catch(() => setSentEmails([]))
        .finally(() => setEmailsLoading(false));
    };

    fetchEmailsData();
    const interval = setInterval(fetchEmailsData, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, []);

  const handleDeleteEmail = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    // Optimistic delete
    setSentEmails(prev => prev.filter(email => email.id !== id));
    setEmailTotals(prev => ({
      ...prev,
      totalSent: Math.max(0, prev.totalSent - 1)
    }));
    try {
      await fetch(`${API_BASE_URL}/sent-emails/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error("Failed to delete email", err);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedEmails.length === 0) return;
    const idsToDelete = [...selectedEmails];
    
    // Optimistic UI update
    setSentEmails(prev => prev.filter(email => !idsToDelete.includes(email.id)));
    setEmailTotals(prev => ({
      ...prev,
      totalSent: Math.max(0, prev.totalSent - idsToDelete.length)
    }));
    setSelectedEmails([]);

    // Background delete using bulk endpoint
    try {
      await fetch(`${API_BASE_URL}/sent-emails/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: idsToDelete })
      });
    } catch (err) {
      console.error("Failed to bulk delete emails", err);
    }
  };

  const handleSendInput = async () => {
    if (chatStep === "website_url") {
      const url = inputValue.trim();
      if (!url) return;
      setInputValue("");
      
      setMessages(prev => [
        ...prev,
        { id: `msg-${Date.now()}`, role: "user", type: "text", content: url },
        { id: `msg-${Date.now()+1}`, role: "ai", type: "loading" }
      ]);
      setChatStep("loading");
      
      const derivedName = url.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split('/')[0];
      await performResearch(derivedName, url);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSendInput();
    }
  };

  const performResearch = async (name: string, url: string) => {
    try {
      const cleanUrl = url.replace(/^https?:\/\//i, "");
      const res = await fetch(`${API_BASE_URL}/smart-research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: name,
          company_url: cleanUrl || null,
          owner_name: "Noushad C I",
        }),
      });
      
      if (!res.ok) {
        throw new Error("Research failed");
      }
      
      const data = await res.json();

      // If N8N is down or returned error, don't show a broken ResultCard — show chat error instead
      if (data._n8n_error) {
        setMessages(prev => {
          const filtered = prev.filter(m => m.type !== "loading");
          return [
            ...filtered,
            { id: `msg-${Date.now()}`, role: "ai", type: "text", content: data._error_message || t("email_agent.research_error") }
          ];
        });
        setChatStep("website_url");
        return;
      }
      
      setMessages(prev => {
        const filtered = prev.filter(m => m.type !== "loading");
        return [
          ...filtered,
          { id: `msg-${Date.now()}`, role: "ai", type: "text", content: `${t('email_agent.research_complete_prefix')} ${name} ${t('email_agent.research_complete_suffix')}` }
        ];
      });
      
      setResultsHistory([
        { id: data.db_id ? String(data.db_id) : `res-${Date.now()}`, resultData: data, companyName: name, companyUrl: url }
      ]);
      
      // Updated for Gmail Agent Migration: Moved step to 'website_url' (previously 'company_name') to enable multi-company sequential searches
      setChatStep("website_url");
      setCompanyName("");
      setTimeout(() => {
        setMessages(prev => [
          ...prev,
          { id: `msg-${Date.now()+2}`, role: "ai", type: "text", content: t("email_agent.research_next") }
        ]);
      }, 1000);

    } catch {
      setMessages(prev => {
        const filtered = prev.filter(m => m.type !== "loading");
        return [
          ...filtered,
          { id: `msg-${Date.now()}`, role: "ai", type: "text", content: t("email_agent.research_error") }
        ];
      });
      setChatStep("website_url");
    }
  };

  const handleSendManually = async (result: ResearchResultData, name: string, url: string, skip_send: boolean = false, action_type: string = "System"): Promise<SendEmailResult> => {
    const data = await sendEmail(result, name, url, true, skip_send, action_type);
    if (data?.lead_id) {
      setResultsHistory(prev => prev.map(item => item.resultData === result ? { ...item, resultData: { ...item.resultData, lead_id: data.lead_id } } : item));
    }
    return data;
  };

  const handleSendAutomatically = async (result: ResearchResultData, name: string, url: string): Promise<SendEmailResult> => {
    const data = await sendEmail(result, name, url, false, false, "System Auto");
    if (data?.lead_id) {
      setResultsHistory(prev => prev.map(item => item.resultData === result ? { ...item, resultData: { ...item.resultData, lead_id: data.lead_id } } : item));
    }
    return data;
  };

  const sendEmail = async (result: ResearchResultData, name: string, url: string, manual: boolean, skip_send: boolean = false, action_type: string = "System"): Promise<SendEmailResult> => {
    try {
      const serviceNames = (result.recommended_services || []).map((s) => (typeof s === 'string' ? s : s.service_name || '')).filter(Boolean).join(", ");
      const fallbackEmail = Array.isArray(result.company_info?.contacts) ? result.company_info.contacts[0]?.email : undefined;
      const extractedEmailsArray = Array.isArray(result.company_info?.extracted_emails) ? result.company_info.extracted_emails : (result.company_info?.extracted_emails?.split(",") || []);
      const extractedEmail = extractedEmailsArray[0]?.trim();
      const emailToSend = result.contact?.email || fallbackEmail || extractedEmail || undefined;
      if (!emailToSend) {
        throw new Error("No recipient email available to send.");
      }
      const res = await fetch(`${API_BASE_URL}/send-manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to_email: emailToSend,
          company_name: result.company_info?.company_name || name,
          subject: result.draft?.subject || "",
          english_body: result.draft?.english_body || result.draft?.body || "",
          spanish_body: result.draft?.spanish_body || "",
          whatsapp_body: result.draft?.whatsapp_draft || "",
          recommended_services: serviceNames,
          contact_name: result.contact?.name || null,
          contact_role: result.contact?.role || null,
          website_url: result.company_url || result.company_info?.website || url || null,
          phone_number: result.contact?.phone_number || null,
          manual,
          skip_send,
          action_type,
          email_agent_data: JSON.stringify(result),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        let message = text || "Failed to send email";
        let code: string | undefined;
        try {
          const parsed = JSON.parse(text);
          if (typeof parsed?.detail === "string") {
            message = parsed.detail;
          } else if (parsed?.detail?.message) {
            message = parsed.detail.message;
            code = parsed.detail.code;
          }
        } catch {}
        const err = new Error(message) as Error & { code?: string };
        if (code) err.code = code;
        throw err;
      }

      const data = await res.json();
      fetch(`${API_BASE_URL}/sent-emails?limit=30`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          if (d && typeof d === 'object' && !Array.isArray(d) && 'totalSent' in d) {
            setEmailTotals({
              totalSent: d.totalSent,
              autoCount: d.autoCount,
              manualCount: d.manualCount
            });
            return setSentEmails(d.emails || []);
          }
          if (Array.isArray(d)) {
            setEmailTotals({
              totalSent: d.length,
              manualCount: d.filter(e => e.manual).length,
              autoCount: d.length - d.filter(e => e.manual).length
            });
            return setSentEmails(d);
          }
          if (d?.emails && Array.isArray(d.emails)) {
            setEmailTotals({
              totalSent: d.emails.length,
              manualCount: d.emails.filter((e: any) => e.manual).length,
              autoCount: d.emails.length - d.emails.filter((e: any) => e.manual).length
            });
            return setSentEmails(d.emails);
          }
          return setSentEmails([]);
        })
        .catch(() => setSentEmails([]));
      return data;
    } catch (error: unknown) {
      console.error(error);
      throw error instanceof Error ? error : new Error("Email send failed");
    }
  };

  const handleSaveFollowUp = async (result: ResearchResultData, note: string, title: string): Promise<boolean> => {
    try {
      const leadId = (result as any).lead_id || (result.company_info as any)?.lead_id || (result as any).id;
      if (!leadId) {
        console.error("Cannot save follow-up without lead ID");
        return false;
      }
      const response = await fetch(`${API_BASE_URL}/leads/${leadId}/followup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: note,
          authorId: 1,
          isInternal: false,
          task_title: title,
          task_description: note,
          due_date: null,
          assigned_to: null,
          email_agent_data: JSON.stringify(result),
        }),
      });
      return response.ok;
    } catch (error: unknown) {
      console.error(error);
      return false;
    }
  };

  const { totalSent, manualCount, autoCount } = emailTotals;

  return (
    <div className="relative min-h-[calc(100vh-4rem)] flex flex-col items-center overflow-hidden rounded-3xl">
      {/* Video Background - NO BLUR OVERLAY FOR FULL CLARITY */}
      

      {/* Main Scrolling Container */}
      <div className="relative z-10 w-full max-w-5xl flex flex-col h-full mt-6 px-4 pb-20 overflow-y-auto">
        
        {/* Top Header - completely transparent, NO BLUR, white text */}
        <div className="bg-slate-50 dark:bg-zinc-950 rounded-2xl p-4 sm:px-6 sm:pt-6 sm:pb-3 flex flex-col md:flex-row md:items-center justify-between gap-3 mb-2">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 shadow-lg backdrop-blur-sm shrink-0">
                <Bot className="w-5 h-5 text-slate-800 dark:text-zinc-100" />
              </div>
              <div>
                <h1 className="text-xl font-black text-slate-800 dark:text-zinc-100">{t('email_agent.title')}</h1>
                <p className="text-slate-500 dark:text-zinc-400 text-xs font-medium">{t('email_agent.subtitle')}</p>
              </div>
            </div>
            <div className="flex flex-wrap bg-slate-200 dark:bg-zinc-800 p-1 rounded-lg sm:ml-4">
              <button
                onClick={() => setMode("single")}
                className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md text-xs font-bold transition-all ${mode === "single" ? "bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 shadow-sm" : "text-slate-500 dark:text-zinc-400 hover:text-slate-700"}`}
              >
                {t('email_agent.mode_single')}
              </button>
              <button
                onClick={() => setMode("excel")}
                className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md text-xs font-bold transition-all ${mode === "excel" ? "bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 shadow-sm" : "text-slate-500 dark:text-zinc-400 hover:text-slate-700"}`}
              >
                {t('email_agent.mode_excel')}
              </button>
            </div>
          </div>
          <div className="flex gap-4 hidden sm:flex">
            {[
              { label: t('email_agent.stat_total_sent'), value: totalSent },
              { label: t('email_agent.stat_auto'), value: autoCount },
              { label: t('email_agent.stat_manual'), value: manualCount },
            ].map((s) => (
              <div key={s.label} className="px-4 py-2 rounded-xl bg-slate-50 dark:bg-zinc-950 text-slate-800 dark:text-zinc-100 text-center">
                <p className="text-[9px] font-black uppercase tracking-widest opacity-80">{s.label}</p>
                <p className="text-lg font-black">{s.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-zinc-950 p-0 rounded-2xl mb-2">
          {/* PageGuide components uses white text on dark variants, but we will leave it as is if it handles its own styles, though it floats */}
        </div>

        <section className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 dark:border-emerald-900/60 dark:bg-emerald-950/20">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><p className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">Outreach profile</p><h2 className="text-lg font-black text-slate-900 dark:text-white">SCM BPO</h2></div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowProfile(v => !v)}
                className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-700 shadow-sm transition-colors hover:bg-emerald-100 dark:bg-zinc-900 dark:text-emerald-300 dark:hover:bg-zinc-800"
              >
                <User className="w-3 h-3" />
                Profile
              </button>
              <button
                onClick={() => setShowSettings(v => !v)}
                className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-700 shadow-sm transition-colors hover:bg-emerald-100 dark:bg-zinc-900 dark:text-emerald-300 dark:hover:bg-zinc-800"
              >
                <Settings className="w-3 h-3" />
                Settings
              </button>
              <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-700 shadow-sm dark:bg-zinc-900 dark:text-emerald-300">Logistics BPO</span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-3 text-xs text-slate-600 dark:text-zinc-300 sm:grid-cols-2 lg:grid-cols-3">
            <p><strong className="block text-[10px] uppercase tracking-widest text-slate-400">Legal company</strong>SCM SHIPPING SERVICES PVT LTD</p>
            <p><strong className="block text-[10px] uppercase tracking-widest text-slate-400">Industry</strong>Outsourcing</p>
            <p><strong className="block text-[10px] uppercase tracking-widest text-slate-400">Website</strong>www.scmbpo.com</p>
            <p><strong className="block text-[10px] uppercase tracking-widest text-slate-400">Primary contact</strong>{profileLoading ? "…" : (profile?.name || "Noushad C I, Founder")}</p>
            <p><strong className="block text-[10px] uppercase tracking-widest text-slate-400">Contact</strong>{profileLoading ? "…" : (profile?.phone || "+91-9947950099")}</p>
            <p><strong className="block text-[10px] uppercase tracking-widest text-slate-400">Email</strong>{profileLoading ? "…" : (profile?.email || "contact@scmbpo.com")}</p>
            <p className="sm:col-span-2 lg:col-span-3"><strong className="block text-[10px] uppercase tracking-widest text-slate-400">Address</strong>Koyenco Techpark, Kepip, Infopark P.O., Kakkanad, Cochin</p>
            <p className="sm:col-span-2 lg:col-span-3"><strong className="block text-[10px] uppercase tracking-widest text-slate-400">Services</strong>Logistics back-office support services (BPO)</p>
          </div>
        </section>

        {/* Chatbot Interface Top Box - HAS BLUR and WHITE TEXT */}
        {mode === "single" ? (
          <>
            <div className="relative bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-2xl w-full max-w-4xl mx-auto flex flex-col h-[400px] shadow-sm">
          <PageGuide
            pageKey="email-agent"
            title={t('email_agent.guide_title')}
            description={t('email_agent.guide_desc')}
            buttonClassName="absolute top-3 right-3 z-50 group"
            iconClassName="flex items-center justify-center w-8 h-8 rounded-full bg-blue-500 text-slate-800 dark:text-zinc-100 shadow-lg transition-transform group-hover:scale-110"
            steps={[
              { icon: <Building2 />, text: t('email_agent.guide_s1') },
              { icon: <Bot />, text: t('email_agent.guide_s2') },
              { icon: <Mail />, text: t('email_agent.guide_s3') },
              { icon: <TrendingUp />, text: t('email_agent.guide_s4') },
            ]}
          />
          <div className="p-4 border-b border-slate-100 dark:border-zinc-800 font-black text-sm text-slate-800 dark:text-zinc-100 flex items-center gap-2">
            <Bot className="w-4 h-4 text-slate-800 dark:text-zinc-100" /> {t('email_agent.ai_assistant')}
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar" ref={chatContainerRef}>
            <AnimatePresence initial={false}>
              {messages.map((msg) => (
                <motion.div 
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex w-full ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div className={`flex items-end gap-2 max-w-[85%] ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === "user" ? "bg-white dark:bg-zinc-900 text-black dark:text-white" : "bg-blue-500 text-slate-800 dark:text-zinc-100"}`}>
                      {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                    </div>
                    <div className={`p-4 rounded-2xl ${
                      msg.role === "user" 
                        ? "bg-slate-100 dark:bg-zinc-800 text-slate-800 dark:text-zinc-100 rounded-br-none border border-slate-100 dark:border-zinc-800" 
                        : "bg-slate-50 dark:bg-zinc-950 border-slate-200 dark:border-zinc-700 border border-slate-100 dark:border-zinc-800 shadow-sm rounded-bl-none text-slate-800 dark:text-zinc-100"
                    }`}>
                      {msg.type === "text" && <p className="text-sm font-medium">{msg.content}</p>}
                      {msg.type === "loading" && <BottomUpFillMail />}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>

          <div className="p-5 bg-slate-50 dark:bg-zinc-950/80 rounded-b-2xl border-t border-slate-100 dark:border-zinc-800 backdrop-blur-md">
            <div className="flex items-center gap-3 bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700 rounded-2xl p-2 border shadow-sm focus-within:ring-4 focus-within:ring-indigo-500/20 focus-within:border-indigo-400 transition-all">
              <div className="p-2 bg-indigo-50 rounded-xl">
                <Globe className="w-6 h-6 text-indigo-500" />
              </div>
              
              <input
                ref={inputRef}
                type="url"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="https://example.com"
                className="flex-1 bg-transparent border-none focus:ring-0 outline-none px-2 text-base font-bold text-slate-800 dark:text-zinc-100 placeholder-slate-400 h-12"
              />
              
              <button
                onClick={handleSendInput}
                disabled={!inputValue.trim() || chatStep === "loading"}
                className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm flex items-center gap-2 shadow-lg shadow-indigo-500/30 disabled:opacity-50 transition-all hover:-translate-y-0.5"
              >
                <Sparkles className="w-4 h-4" /> {t('email_agent.start_agent')}
              </button>
            </div>
          </div>
        </div>

        {/* Results Section Down Below */}
        {resultsHistory.length > 0 && (
          <div className="w-full mt-8 space-y-8">
            <h3 className="font-black text-xl text-slate-800 dark:text-zinc-100 bg-slate-50 dark:bg-zinc-950 border-slate-200 dark:border-zinc-700 backdrop-blur-md px-4 py-2 rounded-xl inline-block shadow-lg border border-slate-100 dark:border-zinc-800">{t('email_agent.research_results')}</h3>
            {resultsHistory.map(res => (
              <ResultCard key={res.id} historyId={res.id} result={res.resultData} companyName={res.companyName} companyUrl={res.companyUrl} onSendManually={handleSendManually} onSendAutomatically={handleSendAutomatically} onSaveFollowUp={handleSaveFollowUp} onRemove={handleRemoveResult} />
            ))}
          </div>
        )}
          </>
        ) : (
          <div className="w-full">
            <ExcelCampaign onOpenSettings={() => setShowSettings(true)} />
          </div>
        )}

        {/* Recent Outreach Section Down Below */}
        <div className="w-full mt-12 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-2xl p-6 md:p-8 relative overflow-hidden shadow-sm">
          <div className="flex items-center justify-between mb-6 relative z-10">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-800 dark:text-zinc-100 shadow-inner">
                <Mail className="w-4 h-4" />
              </div>
              <h3 className="font-black text-[15px] text-slate-800 dark:text-zinc-100">{t('email_agent.recent_outreach')}</h3>
              {sentEmails.length > 0 && (
                <div className="flex items-center gap-2 ml-4 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 px-3 py-1.5 rounded-lg shadow-sm">
                  <input 
                    type="checkbox"
                    checked={selectedEmails.length === sentEmails.length && sentEmails.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedEmails(sentEmails.map(email => email.id));
                      } else {
                        setSelectedEmails([]);
                      }
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-slate-600 dark:text-zinc-300">{t('email_agent.select_all')}</span>
                </div>
              )}
              {selectedEmails.length > 0 && (
                <button 
                  onClick={handleDeleteSelected}
                  className="ml-2 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-600 dark:bg-red-500/20 dark:hover:bg-red-500/30 dark:text-red-400 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t('email_agent.delete_label')} ({selectedEmails.length})
                </button>
              )}
            </div>
            <span className="text-[10px] font-black text-slate-500 dark:text-zinc-400 uppercase tracking-widest">
              {totalSent} {t('email_agent.total_suffix')}
            </span>
          </div>

          {emailsLoading ? (
            <div className="flex justify-center p-8"><Clock className="w-6 h-6 animate-spin text-slate-400" /></div>
          ) : sentEmails.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-slate-400 gap-3">
              <Mail className="w-10 h-10 opacity-30 text-gray-500" />
              <p className="font-bold text-sm text-slate-400">{t('email_agent.no_emails')}</p>
            </div>
          ) : (
                 <div className="w-full mt-4 space-y-4">
              {Object.entries(
                sentEmails.reduce((acc, email) => {
                  const key = email.company_name && email.company_name !== "Unknown Company" ? email.company_name : t('email_agent.fallback_prospect');
                  if (!acc[key]) acc[key] = [];
                  acc[key].push(email);
                  return acc;
                }, {} as Record<string, SentEmail[]>)
              ).map(([company, emails]) => {
                const isCompanyExpanded = expandedCompanies.includes(company);
                return (
                  <div key={company} className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-2xl overflow-hidden shadow-sm">
                    <div 
                      className="flex items-center justify-between px-6 py-4 bg-slate-50 dark:bg-zinc-950 border-b border-slate-100 dark:border-zinc-800 cursor-pointer hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors"
                      onClick={() => setExpandedCompanies(prev => prev.includes(company) ? prev.filter(c => c !== company) : [...prev, company])}
                    >
                      <div className="flex items-center gap-4">
                        <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/20">
                          <Building2 className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="font-black text-lg text-slate-800 dark:text-zinc-100">{company}</h4>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{emails.length} {t('email_agent.emails_extracted')}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                         <div className="flex items-center">
                           <input 
                              type="checkbox" 
                              checked={emails.every(e => selectedEmails.includes(e.id))}
                              onChange={(e) => {
                                e.stopPropagation();
                                if (e.target.checked) setSelectedEmails(prev => [...new Set([...prev, ...emails.map(em => em.id)])]);
                                else setSelectedEmails(prev => prev.filter(id => !emails.map(em => em.id).includes(id)));
                              }}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer w-4 h-4 mr-4"
                              title={t('email_agent.select_company')}
                           />
                         </div>
                         {isCompanyExpanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                      </div>
                    </div>

                    {isCompanyExpanded && (
                      <div className="p-6 bg-slate-50/30 dark:bg-zinc-950/30 space-y-4">
                        {emails.map(email => (
                          <div key={email.id} className="bg-white dark:bg-zinc-900 border border-slate-100 dark:border-zinc-800 rounded-xl p-5 shadow-sm relative group hover:border-indigo-200 transition-colors">
                            <div className="absolute top-5 right-5 flex items-center gap-2">
                              <input 
                                type="checkbox" 
                                checked={selectedEmails.includes(email.id)}
                                onChange={(e) => {
                                  if (e.target.checked) setSelectedEmails(prev => [...prev, email.id]);
                                  else setSelectedEmails(prev => prev.filter(id => id !== email.id));
                                }}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer w-4 h-4"
                              />
                              <button onClick={(e) => handleDeleteEmail(e, email.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors" title={t('email_agent.delete')}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            
                            <div className="flex flex-wrap items-center gap-6 mb-4 pr-20">
                              <div className="flex items-center gap-2 bg-slate-50 dark:bg-zinc-950 px-3 py-1.5 rounded-lg border border-slate-100 dark:border-zinc-800">
                                <Mail className="w-4 h-4 text-slate-400" />
                                <span className="text-sm font-black text-slate-700 dark:text-zinc-200">{email.to_email}</span>
                              </div>
                              <div className="flex flex-col justify-center">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{t('email_agent.status')}</p>
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${
                                  email.status === "Opened" ? "bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400" :
                                  email.status === "Replied" ? "bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400" :
                                  email.status === "Delivered" ? "bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400" :
                                  email.status === "Draft" ? "bg-slate-200 text-slate-600 dark:bg-zinc-700 dark:text-zinc-300" :
                                  "bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400"
                                }`}>
                                  {email.status || "Sent"}
                                </span>
                              </div>
                              <div className="flex flex-col justify-center">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{t('email_agent.subject')}</p>
                                <span className="text-sm font-bold text-slate-600 dark:text-zinc-300">{email.subject || t('email_agent.no_subject')}</span>
                              </div>
                              {email.sent_at && (
                                <div className="flex flex-col justify-center">
                                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{t('email_agent.sent_at')}</p>
                                  <span className="text-sm font-bold text-slate-600 dark:text-zinc-300">{new Date(email.sent_at).toLocaleString()}</span>
                                </div>
                              )}
                            </div>

                            {(email.english_body || email.spanish_body) && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {email.english_body && (
                                  <div>
                                    <div className="flex justify-between items-center mb-1">
                                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('email_agent.english_draft')}</p>
                                      <CopyButton text={email.english_body} />
                                    </div>
                                    <div className="bg-slate-50 dark:bg-zinc-950 border border-slate-100 dark:border-zinc-800 rounded-xl p-4 text-[13px] text-slate-600 dark:text-zinc-300 whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar font-sans leading-relaxed">
                                      {email.english_body}
                                    </div>
                                  </div>
                                )}
                                {email.spanish_body && (
                                  <div>
                                    <div className="flex justify-between items-center mb-1">
                                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('email_agent.spanish_draft')}</p>
                                      <CopyButton text={email.spanish_body} />
                                    </div>
                                    <div className="bg-slate-50 dark:bg-zinc-950 border border-slate-100 dark:border-zinc-800 rounded-xl p-4 text-[13px] text-slate-600 dark:text-zinc-300 whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar font-sans leading-relaxed">
                                      {email.spanish_body}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {Array.isArray(email.replies) && email.replies.length > 0 ? (
                              email.replies.map((reply: EmailReplyData) => (
                                <ReplyThreadItem key={reply.id} reply={reply} t={t} />
                              ))
                            ) : email.reply_body && (
                              // Legacy fallback: replies recorded before the replies[] array existed.
                              <div className="mt-4">
                                <div className="flex justify-between items-center mb-1">
                                  <p className="text-[9px] font-black text-green-600 dark:text-green-400 uppercase tracking-widest flex items-center gap-1">
                                    <MessageCircle className="w-3 h-3" />
                                    {t('email_agent.reply_received')}
                                    {email.reply_from ? ` — ${email.reply_from}` : ''}
                                    {email.replied_at ? ` · ${new Date(email.replied_at).toLocaleString()}` : ''}
                                  </p>
                                  <CopyButton text={email.reply_body} />
                                </div>
                                {email.reply_subject && (
                                  <p className="text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">{email.reply_subject}</p>
                                )}
                                <div className="bg-green-50 dark:bg-green-500/10 border border-green-100 dark:border-green-500/20 rounded-xl p-4 text-[13px] text-slate-600 dark:text-zinc-300 whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar font-sans leading-relaxed">
                                  {email.reply_body}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {/* Profile Settings Modal — in-page panel, stays on the Email Agent route */}
        <AnimatePresence>
          {showProfile && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[200] p-4"
              onClick={() => setShowProfile(false)}
            >
              <motion.div
                initial={{ scale: 0.92, y: 24, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                exit={{ scale: 0.92, y: 24, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-zinc-700 w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="px-6 py-5 border-b border-slate-100 dark:border-zinc-800 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-black text-slate-900 dark:text-white">Profile Settings</h2>
                    <p className="text-sm text-slate-500 dark:text-zinc-400 mt-0.5">Manage your sender information and email signature.</p>
                  </div>
                  <button
                    onClick={() => setShowProfile(false)}
                    className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                  {profileError && (
                    <div className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 dark:bg-red-500/10 rounded-xl border border-red-200 dark:border-red-500/20">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      {profileError}
                    </div>
                  )}
                  {signatureError && (
                    <div className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 dark:bg-red-500/10 rounded-xl border border-red-200 dark:border-red-500/20">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      {signatureError}
                    </div>
                  )}

                  {/* Personal Information */}
                  <div className="rounded-2xl border p-6 space-y-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Personal Information</p>

                    <div>
                      <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 dark:text-zinc-200 mb-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" /> Full Name
                      </label>
                      <input
                        type="text"
                        value={profileForm.name}
                        onChange={(e) => setProfileForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="Name"
                        className="w-full px-3 py-2 rounded-xl border text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        style={{ borderColor: "var(--border)", color: "var(--text-primary)", background: "var(--background)" }}
                      />
                    </div>

                    <div>
                      <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 dark:text-zinc-200 mb-1.5">
                        <Mail className="w-3.5 h-3.5 text-slate-400" /> Email Address
                      </label>
                      <input
                        type="email"
                        value={profileForm.email}
                        onChange={(e) => setProfileForm(f => ({ ...f, email: e.target.value }))}
                        placeholder="user@example.com"
                        className="w-full px-3 py-2 rounded-xl border text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        style={{ borderColor: "var(--border)", color: "var(--text-primary)", background: "var(--background)" }}
                      />
                      <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Sender address for outgoing emails — this does not change your login email.</p>
                    </div>

                    <div className="relative" ref={countryDropdownRef}>
                      <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 dark:text-zinc-200 mb-1.5">
                        <Phone className="w-3.5 h-3.5 text-slate-400" /> Phone Number
                      </label>
                      <div
                        className="flex items-center rounded-xl border transition-all focus-within:ring-2 focus-within:ring-blue-500 overflow-visible"
                        style={{ borderColor: "var(--border)", background: "var(--background)" }}
                      >
                        {/* Country Code Trigger Button */}
                        <button
                          type="button"
                          onClick={() => {
                            setCountryDropdownOpen(!countryDropdownOpen);
                            setCountrySearch("");
                          }}
                          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-r transition-colors hover:bg-slate-100 dark:hover:bg-zinc-800/60 rounded-l-xl shrink-0"
                          style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                          title={`${selectedCountry.name} (${selectedCountry.dialCode})`}
                        >
                          <span className="text-base leading-none">{selectedCountry.flag}</span>
                          <span className="text-xs font-semibold">{selectedCountry.dialCode}</span>
                          <ChevronDown className="w-3 h-3 text-slate-400" />
                        </button>

                        {/* National Phone Number Input */}
                        <input
                          type="tel"
                          value={nationalPhone}
                          onChange={(e) => {
                            const val = e.target.value;
                            setNationalPhone(val);
                            setProfileForm(f => ({
                              ...f,
                              phone: val.trim() ? `${selectedCountryCode} ${val.trim()}` : ""
                            }));
                          }}
                          placeholder={selectedCountry.code === "ES" ? "612 34 56 78" : selectedCountry.code === "IN" ? "98765 43210" : "555-0199"}
                          className="w-full px-3 py-2 bg-transparent text-sm outline-none rounded-r-xl"
                          style={{ color: "var(--text-primary)" }}
                        />
                      </div>

                      {/* Searchable Country Code Dropdown */}
                      {countryDropdownOpen && (
                        <div
                          className="absolute left-0 top-full mt-1.5 w-72 max-w-[90vw] rounded-2xl border shadow-2xl z-50 p-2 overflow-hidden bg-white dark:bg-zinc-900"
                          style={{ borderColor: "var(--border)" }}
                        >
                          {/* Search Input */}
                          <div
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl border mb-2 text-xs"
                            style={{ borderColor: "var(--border)", background: "var(--background)" }}
                          >
                            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <input
                              type="text"
                              value={countrySearch}
                              onChange={(e) => setCountrySearch(e.target.value)}
                              placeholder="Search country or code..."
                              className="w-full bg-transparent outline-none text-xs"
                              style={{ color: "var(--text-primary)" }}
                              autoFocus
                            />
                            {countrySearch && (
                              <button type="button" onClick={() => setCountrySearch("")} className="text-slate-400 hover:text-slate-600">
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>

                          {/* Country List */}
                          <div className="max-h-48 overflow-y-auto space-y-0.5 custom-scrollbar">
                            {filteredCountries.length > 0 ? (
                              filteredCountries.map((c) => (
                                <button
                                  key={`${c.code}-${c.dialCode}`}
                                  type="button"
                                  onClick={() => {
                                    setSelectedCountryCode(c.dialCode);
                                    setCountryDropdownOpen(false);
                                    setCountrySearch("");
                                    setProfileForm(f => ({
                                      ...f,
                                      phone: nationalPhone.trim() ? `${c.dialCode} ${nationalPhone.trim()}` : ""
                                    }));
                                  }}
                                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                                    selectedCountryCode === c.dialCode
                                      ? "bg-blue-600 text-white font-semibold"
                                      : "hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-200"
                                  }`}
                                >
                                  <div className="flex items-center gap-2 truncate">
                                    <span className="text-sm leading-none">{c.flag}</span>
                                    <span className="truncate">{c.name}</span>
                                  </div>
                                  <span className={`text-[11px] font-mono shrink-0 ml-2 ${selectedCountryCode === c.dialCode ? "text-blue-100" : "text-slate-400"}`}>
                                    {c.dialCode}
                                  </span>
                                </button>
                              ))
                            ) : (
                              <p className="text-xs text-slate-400 p-3 text-center">No country found</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end pt-2">
                      <button
                        onClick={handleSaveProfile}
                        disabled={savingProfile}
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                      >
                        {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save Changes
                      </button>
                    </div>
                  </div>

                  {/* Email Signature */}
                  <div className="rounded-2xl border p-6 space-y-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Email Signature</p>
                      <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Customize the signature that will be automatically used in your outgoing emails.</p>
                    </div>
                    <textarea
                      value={signatureText}
                      onChange={(e) => setSignatureText(e.target.value)}
                      rows={5}
                      placeholder={"Best Regards,\nName\nSCM BPO\n+91 XXXXX XXXXX"}
                      className="w-full px-3 py-2 rounded-xl border text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                      style={{ borderColor: "var(--border)", color: "var(--text-primary)", background: "var(--background)" }}
                    />

                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Preview</p>
                      <div
                        className="rounded-xl border p-4 text-sm whitespace-pre-wrap min-h-[3rem]"
                        style={{ borderColor: "var(--border)", color: "var(--text-primary)", background: "var(--background)" }}
                      >
                        {signatureText.trim() ? signatureText : <span className="text-slate-400 dark:text-zinc-500">No signature configured.</span>}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
                      <div>
                        <p className="text-sm font-bold text-slate-700 dark:text-zinc-200">Automatically append signature to emails</p>
                        <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">When enabled, your saved email signature will be automatically added to outgoing emails.</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${autoAppend ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-zinc-500"}`}>
                          {autoAppend ? "ON" : "OFF"}
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={autoAppend}
                          aria-label="Automatically append signature to emails"
                          onClick={handleToggleAutoAppend}
                          disabled={autoAppendSaving}
                          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${autoAppend ? "bg-emerald-500" : "bg-slate-300 dark:bg-zinc-700"}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${autoAppend ? "translate-x-6" : "translate-x-1"}`} />
                        </button>
                      </div>
                    </div>

                    <div className="flex justify-end pt-2">
                      <button
                        onClick={handleSaveSignature}
                        disabled={savingSignature}
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                      >
                        {savingSignature ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save Signature
                      </button>
                    </div>
                  </div>

                  {profileLoading && (
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading profile…
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Email Integration Settings — same component previously hosted in /admin/settings */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[200] p-4"
              onClick={() => setShowSettings(false)}
            >
              <motion.div
                initial={{ scale: 0.92, y: 24, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                exit={{ scale: 0.92, y: 24, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-zinc-700 w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="px-6 py-4 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between gap-3 shrink-0">
                  <h2 className="text-lg font-black text-slate-900 dark:text-white">Settings</h2>
                  <button
                    onClick={() => setShowSettings(false)}
                    className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                  <EmailIntegrationSettings />
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Toast */}
        {toast && (
          <div className={`fixed top-4 right-4 z-[300] flex items-center gap-2 px-4 py-3 rounded-xl shadow-xl text-sm font-semibold ${toast.type === "ok" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
            {toast.type === "ok" ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {toast.msg}
          </div>
        )}
      </div>
    </div>
  );
}
