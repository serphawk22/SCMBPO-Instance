"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { API_BASE_URL } from "@/config";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, Send, CheckCircle, Download, Building2, User2, Loader2, ArrowRight } from "lucide-react";

interface QuoteItem {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

interface ProposalComment {
  id: number;
  author_name: string;
  author_type: string;
  content: string;
  created_at: string;
}

interface Proposal {
  quote_number: string;
  title: string;
  status: string;
  grand_total: number;
  currency: string;
  valid_until: string | null;
  notes: string | null;
  terms: string | null;
  client_name: string | null;
  lead_name: string | null;
  items: QuoteItem[];
  comments: ProposalComment[];
}

function currSymbol(c: string) {
  if (c === "INR") return "₹";
  if (c === "EUR") return "€";
  if (c === "GBP") return "£";
  return "$";
}

function fmtMoney(v: number, c: string) {
  return `${currSymbol(c)}${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PublicProposalPage() {
  const { uuid } = useParams();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [commentText, setCommentText] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  
  const [authorName, setAuthorName] = useState("");
  
  const fetchProposal = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/public/proposals/${uuid}`);
      if (!res.ok) throw new Error("Proposal not found or expired.");
      const data = await res.json();
      setProposal(data);
      if (!authorName) {
         setAuthorName(data.client_name || data.lead_name || "Client");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if(uuid) fetchProposal();
  }, [uuid]);

  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    setSendingComment(true);
    try {
      await fetch(`${API_BASE_URL}/public/proposals/${uuid}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author_name: authorName,
          author_type: "client",
          content: commentText
        })
      });
      setCommentText("");
      fetchProposal();
    } catch (err) {
      console.error(err);
    } finally {
      setSendingComment(false);
    }
  };

  const handleAccept = async () => {
    if (!confirm("Are you sure you want to digitally sign and accept this proposal?")) return;
    try {
      await fetch(`${API_BASE_URL}/public/proposals/${uuid}/accept`, { method: "POST" });
      alert("Proposal accepted! Thank you for your business.");
      fetchProposal();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return <div className="flex h-screen items-center justify-center bg-slate-50"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>;
  }
  
  if (error || !proposal) {
    return <div className="flex h-screen items-center justify-center bg-slate-50 text-red-500 font-bold">{error || "Not found"}</div>;
  }

  const isAccepted = proposal.status === "Accepted";

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 font-sans text-slate-900 dark:text-zinc-100 flex justify-center p-4 sm:p-8">
      <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-8 items-start">
        
        {/* PROPOSAL DOCUMENT */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl overflow-hidden border border-slate-200 dark:border-zinc-800">
          <div className="p-8 md:p-12">
            <div className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-100 dark:border-zinc-800 pb-8">
              <div>
                <img src="/logo.png" alt="SCM BPO" className="h-12 mb-4 object-contain" />
                <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">{proposal.title}</h1>
                <p className="text-slate-500 font-mono mt-2">{proposal.quote_number}</p>
              </div>
              <div className="text-right">
                <div className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-bold shadow-sm ${
                  isAccepted ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                }`}>
                  {isAccepted && <CheckCircle className="w-4 h-4" />}
                  {proposal.status.toUpperCase()}
                </div>
                {proposal.valid_until && (
                  <p className="text-xs text-slate-400 mt-3 font-semibold uppercase tracking-widest">Valid until: {proposal.valid_until}</p>
                )}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-8 py-8 border-b border-slate-100 dark:border-zinc-800">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Prepared For</p>
                <div className="flex items-start gap-2">
                  <Building2 className="w-5 h-5 text-indigo-500 mt-0.5" />
                  <p className="text-lg font-semibold text-slate-800 dark:text-zinc-200">{proposal.client_name || proposal.lead_name || "Valued Client"}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Prepared By</p>
                <p className="text-base font-semibold text-slate-800 dark:text-zinc-200">SCM BPO Solutions</p>
                <p className="text-sm text-slate-500 mt-1">contact@scmbpo.com</p>
              </div>
            </div>

            <div className="py-8">
              <h3 className="text-lg font-bold mb-6 flex items-center gap-2"><FileText className="w-5 h-5 text-indigo-500"/> Pricing Breakdown</h3>
              
              <div className="bg-slate-50 dark:bg-zinc-800/50 rounded-2xl border border-slate-100 dark:border-zinc-800 overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-100 dark:bg-zinc-800 border-b border-slate-200 dark:border-zinc-700">
                    <tr>
                      <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-wider text-xs">Description</th>
                      <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-wider text-xs text-center">Qty</th>
                      <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-wider text-xs text-right">Unit Price</th>
                      <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-wider text-xs text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                    {proposal.items.map((item, i) => (
                      <tr key={i}>
                        <td className="px-6 py-4 font-medium">{item.description}</td>
                        <td className="px-6 py-4 text-center text-slate-500">{item.quantity}</td>
                        <td className="px-6 py-4 text-right text-slate-500">{fmtMoney(item.unit_price, proposal.currency)}</td>
                        <td className="px-6 py-4 text-right font-bold text-slate-800 dark:text-zinc-100">{fmtMoney(item.unit_price * item.quantity, proposal.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end mt-6">
                <div className="w-64">
                  <div className="flex justify-between items-center py-3 border-t-2 border-slate-900 dark:border-white mt-4">
                    <span className="text-lg font-black uppercase tracking-wider text-slate-900 dark:text-white">Grand Total</span>
                    <span className="text-2xl font-black text-indigo-600">{fmtMoney(proposal.grand_total, proposal.currency)}</span>
                  </div>
                </div>
              </div>
            </div>

            {(proposal.notes || proposal.terms) && (
              <div className="py-8 border-t border-slate-100 dark:border-zinc-800">
                {proposal.notes && (
                  <div className="mb-6">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Notes</p>
                    <p className="text-sm text-slate-600 dark:text-zinc-400 whitespace-pre-wrap">{proposal.notes}</p>
                  </div>
                )}
                {proposal.terms && (
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Terms & Conditions</p>
                    <p className="text-sm text-slate-600 dark:text-zinc-400 whitespace-pre-wrap leading-relaxed">{proposal.terms}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* SIDEBAR: ACTIONS & NEGOTIATION */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-6 border border-slate-200 dark:border-zinc-800">
            <h3 className="text-lg font-bold mb-4">Actions</h3>
            {!isAccepted ? (
              <button 
                onClick={handleAccept}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-emerald-500/25 transition-all active:scale-95"
              >
                <CheckCircle className="w-5 h-5" /> Accept & Sign
              </button>
            ) : (
              <div className="w-full flex items-center justify-center gap-2 bg-emerald-100 text-emerald-700 font-bold py-3.5 px-4 rounded-xl border border-emerald-200">
                <CheckCircle className="w-5 h-5" /> Proposal Accepted
              </div>
            )}
            
            <button className="w-full mt-3 flex items-center justify-center gap-2 bg-white dark:bg-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 font-bold py-3 px-4 rounded-xl border border-slate-200 dark:border-zinc-700 shadow-sm transition-all active:scale-95">
              <Download className="w-4 h-4" /> Download PDF
            </button>
          </div>

          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-slate-200 dark:border-zinc-800 flex flex-col h-[500px]">
            <div className="p-4 border-b border-slate-100 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/50 rounded-t-2xl">
              <h3 className="font-bold flex items-center gap-2 text-slate-800 dark:text-zinc-200">
                💬 Negotiation & Comments
              </h3>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {proposal.comments.length === 0 ? (
                <div className="text-center text-slate-400 text-sm mt-10">
                  <p>No comments yet.</p>
                  <p className="mt-1">Have a question? Ask here!</p>
                </div>
              ) : (
                proposal.comments.map(c => (
                  <div key={c.id} className={`flex flex-col ${c.author_type === 'client' ? 'items-end' : 'items-start'}`}>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1 px-1">
                      {c.author_name}
                    </span>
                    <div className={`px-4 py-2.5 rounded-2xl max-w-[90%] text-sm ${
                      c.author_type === 'client' 
                        ? 'bg-indigo-600 text-white rounded-br-sm' 
                        : 'bg-slate-100 dark:bg-zinc-800 text-slate-800 dark:text-zinc-200 rounded-bl-sm'
                    }`}>
                      {c.content}
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <form onSubmit={handleSendComment} className="p-4 border-t border-slate-100 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/50 rounded-b-2xl">
              <div className="flex gap-2 relative">
                <input 
                  type="text" 
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  placeholder="Ask for a revision..."
                  className="w-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-12"
                />
                <button 
                  type="submit"
                  disabled={sendingComment || !commentText.trim()}
                  className="absolute right-1.5 top-1.5 bottom-1.5 bg-indigo-600 hover:bg-indigo-700 text-white p-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {sendingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
}
