import { API_BASE_URL } from '@/config';

// ─── Types (mirror routers/inbox.py) ─────────────────────────────────────────
export type Direction = 'inbound' | 'outbound';
export type RecordKind = 'leads' | 'clients';

export interface InboxAI {
  category: string | null;
  priority: string | null;
  sentiment: string | null;
  needs_reply: boolean;
  summary: string | null;
}

export interface RecordRef { id: number; name: string }

export interface InboxItem {
  key: string;
  direction: Direction;
  from_name: string | null;
  from_address: string | null;
  to: string | null;
  subject: string;
  snippet: string | null;
  date: string | null;
  is_read: boolean;
  is_starred: boolean;
  is_archived: boolean;
  replied_at: string | null;
  has_attachments: boolean;
  status: string | null;
  open_count?: number;
  reply_count?: number;
  ai: InboxAI | null;
  lead: RecordRef | null;
  client: RecordRef | null;
}

export interface InboxMessage extends InboxItem {
  cc?: string | null;
  body_text: string | null;
  body_text_full: string | null;
  body_html: string | null;
  attachments: { filename: string; size: number | null; content_type: string }[];
  sent_by?: string | null;
  opened_at?: string | null;
  last_opened_at?: string | null;
}

export interface InboxFilters {
  folder: string;
  linked?: string | null;
  category?: string | null;
  priority?: string | null;
  q?: string | null;
}

export interface InboxCounts {
  unread: number;
  folders: Record<string, number>;
  linked: Record<string, number>;
  categories: Record<string, number>;
  high_priority: number;
  unclassified: number;
}

export interface InboxStatus {
  mailboxes: { address: string; own_settings: boolean; last_sync_at: string | null; last_error: string | null }[];
  sender: { address: string | null; configured: boolean; source?: string | null; label?: string | null; message?: string };
  ai_enabled: boolean;
  sync_interval_seconds: number;
  role: string;
  full_access: boolean;
}

export interface ViewSummary {
  summary: {
    headline: string;
    overview: string;
    key_points: string[];
    action_items: { key: string; text: string }[];
    highlights: { key: string; why: string }[];
  } | null;
  total: number;
  view: string;
  cached: boolean;
  generated_at?: string;
  message?: string;
  emails?: Record<string, { subject: string; who: string | null }>;
}

export interface ThreadSummary {
  summary: { summary: string; key_points: string[]; open_questions: string[]; next_step: string; sentiment: string };
  message_count: number;
  cached: boolean;
}

export interface AssistantTurn { role: 'user' | 'assistant'; text: string }

export interface AssistantResult {
  answer: string;
  keys: string[];
  items: InboxItem[];
  suggestions: string[];
  applied_filters: string[];
  relaxed: boolean;
  considered: number;
}

export interface Draft { subject: string; body: string }

export interface ComposerFollowup { key: string; source: string; title: string; detail?: string | null; due?: string | null; status?: string | null; date?: string | null }
export interface ComposerDeal { key: string; kind: string; title: string; status: string | null; amount: string | null; detail: string | null; date: string | null }
export interface ComposerConversation { key: string; type: string; title: string; description: string; date: string | null; author: string | null }
export interface ComposerNote { key: string; content: string; date: string | null; author: string | null }
export interface ComposerMeeting { key: string; title: string; type: string | null; status: string | null; date: string | null; outcome: string }

export interface ComposerContext {
  record: { type: 'lead' | 'client'; id: number; name: string; status: string | null; owner: { id: number; name: string } | null };
  recipients: { email: string; name: string | null; source: string }[];
  sender: { address: string | null; configured: boolean; source?: string | null; label?: string | null; user_name: string };
  context: {
    followups: ComposerFollowup[];
    deals: ComposerDeal[];
    conversations: ComposerConversation[];
    notes: ComposerNote[];
    meetings: ComposerMeeting[];
    emails: InboxItem[];
    research: { overview: string; pain_points: string } | null;
  };
  suggested_purpose: string;
  purposes: string[];
  tones: string[];
  ai_enabled: boolean;
}

export interface ComposerInclude {
  conversations: boolean; followups: boolean; deals: boolean; notes: boolean; meetings: boolean; emails: boolean; research: boolean;
}

export interface RecordHistory {
  items: InboxItem[];
  stats: { sent: number; opened: number; replied: number; received: number };
}

/** A send the user backed out of in the global "Confirm sending email" dialog. */
export interface SendCancelled { cancelled: true }
export interface SendResult { ok: true; item: InboxItem; message?: string }

// ─── Transport ───────────────────────────────────────────────────────────────
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** FastAPI error bodies: {detail: "msg"} | {detail: {message}} | {detail: [{msg}]} | {message}. */
export function errorMessage(data: unknown, status: number): string {
  const body = (data && typeof data === 'object' ? data : {}) as { detail?: unknown; message?: unknown };
  const detail = body.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  if (Array.isArray(detail)) {
    const msgs = detail.map((d) => (d && typeof d === 'object' ? String((d as { msg?: unknown }).msg ?? '') : '')).filter(Boolean);
    if (msgs.length) return msgs.join('; ');
  }
  if (typeof body.message === 'string') return body.message;
  return status === 503 ? 'The server could not be reached.' : `Request failed (${status}).`;
}

export const errorText = (e: unknown, fallback: string): string => (e instanceof Error && e.message ? e.message : fallback);

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(errorMessage(data, res.status), res.status);
  return data as T;
}

export const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });

export function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== '') qs.set(k, String(v));
  });
  const s = qs.toString();
  return s ? `?${s}` : '';
}

// ─── Inbox ───────────────────────────────────────────────────────────────────
export const inboxApi = {
  list: (f: InboxFilters, limit = 50, offset = 0) =>
    request<{ items: InboxItem[]; total: number; view: string }>(`/inbox/messages${query({ ...f, limit, offset })}`),
  counts: () => request<InboxCounts>('/inbox/counts'),
  unreadCount: () => request<{ unread: number }>('/inbox/counts?only=unread'),
  status: () => request<InboxStatus>('/inbox/status'),
  sync: () => post<{ ok: boolean; results: { mailbox: string; created: number; error: string | null }[] }>('/inbox/sync'),
  message: (key: string) => request<{ message: InboxMessage; thread: InboxMessage[] }>(`/inbox/messages/${key}`),
  flags: (key: string, flags: Partial<Pick<InboxItem, 'is_read' | 'is_starred' | 'is_archived'>>) =>
    request<{ ok: boolean; item: InboxItem }>(`/inbox/messages/${key}`, { method: 'PATCH', body: JSON.stringify(flags) }),
  markViewRead: (f: InboxFilters) => post<{ updated: number }>('/inbox/mark-all-read', f),
  summarizeView: (f: InboxFilters, refresh = false) => post<ViewSummary>('/inbox/summary', { ...f, refresh }),
  summarizeThread: (key: string, refresh = false) => post<ThreadSummary>(`/inbox/messages/${key}/summarize${refresh ? '?refresh=true' : ''}`),
  ask: (question: string, history: AssistantTurn[]) => post<AssistantResult>('/inbox/assistant', { question, history }),
  draftReply: (key: string, instructions: string, tone: string) =>
    post<Draft>(`/inbox/messages/${key}/reply-draft`, { instructions, tone }),
  reply: (key: string, payload: { to?: string; cc?: string; subject: string; body: string }) =>
    post<SendResult | SendCancelled>(`/inbox/messages/${key}/reply`, payload),
};

// ─── Lead / client Email tab ─────────────────────────────────────────────────
export const composerApi = {
  context: (kind: RecordKind, id: string | number) => request<ComposerContext>(`/${kind}/${id}/email-composer/context`),
  history: (kind: RecordKind, id: string | number) => request<RecordHistory>(`/${kind}/${id}/email-composer/history`),
  draft: (kind: RecordKind, id: string | number, payload: {
    purpose: string; tone: string; instructions?: string; to?: string; include: ComposerInclude;
    focus_key?: string | null; reply_to_key?: string | null;
  }) => post<Draft & { purpose: string }>(`/${kind}/${id}/email-composer/draft`, payload),
  send: (kind: RecordKind, id: string | number, payload: {
    to: string; cc?: string; subject: string; body: string; purpose?: string; log_conversation: boolean; reply_to_key?: string | null;
  }) => post<SendResult | SendCancelled>(`/${kind}/${id}/email-composer/send`, payload),
};

export const isCancelled = (r: SendResult | SendCancelled): r is SendCancelled => (r as SendCancelled).cancelled === true;
