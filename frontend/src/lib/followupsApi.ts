import { API_BASE_URL } from '@/config';
import { ApiError, errorMessage, post, query, request } from '@/lib/inboxApi';

// ─── Types (mirror routers/followups.py and routers/email_campaigns.py) ──────
export type FollowUpState = 'overdue' | 'today' | 'upcoming' | 'completed' | 'cancelled';
export type FollowUpView = 'all' | 'pending' | 'overdue' | 'today' | 'upcoming' | 'completed' | 'cancelled';
export type Channel = 'email' | 'call' | 'meeting' | 'whatsapp' | 'other';
export type Priority = 'high' | 'medium' | 'low';

export interface Ref { id: number; name: string }

export interface FollowUp {
  id: number;
  title: string;
  notes: string | null;
  channel: Channel;
  priority: Priority;
  status: 'Pending' | 'Completed' | 'Cancelled';
  state: FollowUpState;
  due_at: string;
  remind_at: string | null;
  lead: Ref | null;
  client: Ref | null;
  contact_name: string | null;
  contact_email: string | null;
  company_name: string | null;
  source: 'manual' | 'ai_suggested' | 'ai_auto' | 'campaign' | 'completed_chain';
  source_ref: string | null;
  ai_reason: string | null;
  assigned_to: Ref | null;
  created_by: Ref | null;
  email_subject: string | null;
  email_body: string | null;
  auto_send: boolean;
  email_sent_at: string | null;
  sent_email_id: number | null;
  last_error: string | null;
  reminder_sent_at: string | null;
  completed_at: string | null;
  completed_by: Ref | null;
  outcome: string | null;
  created_at: string;
  updated_at: string;
}

export interface FollowUpCounts {
  pending: number; overdue: number; today: number; upcoming: number; completed: number; completed_7d: number; upcoming_7d: number;
}

export interface Suggestion {
  should_follow_up: boolean;
  due_date: string | null;
  title: string;
  reason: string;
  quote: string;
  channel: Channel;
  priority: Priority;
  confidence: number;
  engine: 'ai' | 'rules';
}

export interface DraftEmail { subject: string; body: string; engine: 'ai' | 'template' }

export interface TimelineEvent {
  key: string;
  type: string;
  title: string | null;
  body: string | null;
  author: string | null;
  date: string | null;
  due_at?: string | null;
  status?: string | null;
  replies?: { content: string; author: string | null; date: string | null }[];
}

export interface RecordHistory {
  record: { type: 'lead' | 'client'; id: number; name: string; contact_name: string | null; contact_email: string | null; owner_id: number | null };
  recipients: { email: string; name: string | null; source: string }[];
  followups: FollowUp[];
  timeline: TimelineEvent[];
  ai_enabled: boolean;
}

export interface SenderStatus { configured: boolean; address: string | null; source: string | null; label: string | null; message?: string }

export interface FollowUpInput {
  lead_id?: number | null;
  client_id?: number | null;
  contact_name?: string | null;
  contact_email?: string | null;
  company_name?: string | null;
  title: string;
  notes?: string | null;
  channel?: Channel;
  priority?: Priority;
  due_at: string;
  remind_at?: string | null;
  assigned_to?: number | null;
  email_subject?: string | null;
  email_body?: string | null;
  auto_send?: boolean;
  source?: 'manual' | 'ai_suggested';
  source_ref?: string | null;
  ai_reason?: string | null;
}

/** JS getTimezoneOffset(): the backend uses it to decide what "today" / "overdue" mean for this viewer. */
export const tzOffset = () => new Date().getTimezoneOffset();

/** Responses of email-sending calls the user cancelled in the global "Confirm sending email" dialog. */
export interface Cancelled { cancelled: true }
export const wasCancelled = (r: unknown): r is Cancelled => !!r && typeof r === 'object' && (r as Cancelled).cancelled === true;

const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export const followupsApi = {
  list: (p: { view?: FollowUpView; lead_id?: number; client_id?: number; mine?: boolean; q?: string; limit?: number; offset?: number }) =>
    request<{ items: FollowUp[]; total: number }>(`/followups${query({ ...p, tz_offset: tzOffset() })}`),
  summary: (mine = false) =>
    request<{ counts: FollowUpCounts; next: FollowUp[] }>(`/followups/summary${query({ mine: mine || null, tz_offset: tzOffset() })}`),
  history: (kind: 'lead' | 'client', id: number | string) =>
    request<RecordHistory>(`/followups/history${query({ [`${kind}_id`]: id, tz_offset: tzOffset() })}`),
  sender: () => request<SenderStatus>('/followups/sender'),
  assignees: () => request<{ users: { id: number; name: string; role?: string }[] }>('/followups/assignees'),
  create: (input: FollowUpInput) => post<{ item: FollowUp }>('/followups', { ...input, tz_offset: tzOffset() }),
  update: (id: number, changes: Partial<FollowUpInput> & { status?: 'Pending' | 'Cancelled' }) =>
    patch<{ item: FollowUp }>(`/followups/${id}`, { ...changes, tz_offset: tzOffset() }),
  remove: (id: number) => request<{ ok: boolean }>(`/followups/${id}`, { method: 'DELETE' }),
  complete: (id: number, outcome: string, next?: { due_at: string; title?: string; channel?: Channel; notes?: string } | null) =>
    post<{ item: FollowUp; next: FollowUp | null }>(`/followups/${id}/complete`, { outcome, next: next || null, tz_offset: tzOffset() }),
  draftEmail: (id: number, tone = 'professional', instructions = '') =>
    post<DraftEmail>(`/followups/${id}/draft-email`, { tone, instructions, save: true }),
  sendEmail: (id: number, payload: { to: string; subject: string; body: string; complete: boolean; outcome?: string }) =>
    post<{ ok: true; item: FollowUp; from: string; message: string } | Cancelled>(`/followups/${id}/send-email`, { ...payload, tz_offset: tzOffset() }),
  suggest: (kind: 'lead' | 'client', id: number | string) =>
    post<{ suggestion: Suggestion; email: DraftEmail | null; record: { label: string; contact_name: string | null; contact_email: string | null } }>(
      '/followups/suggest', { [`${kind}_id`]: Number(id), include_email: true, tz_offset: tzOffset() }),
  scan: (kind: 'lead' | 'client', id: number | string) =>
    post<{ scanned: number; created: FollowUp[]; updated: FollowUp[]; matched_existing: number }>('/followups/scan', { [`${kind}_id`]: Number(id), tz_offset: tzOffset() }),
};

// ─── Excel / CSV campaigns ───────────────────────────────────────────────────
export interface ColumnMapping { email: string | null; name: string | null; first_name: string | null; last_name: string | null; company: string | null }

export interface ParsedSheet {
  filename: string;
  columns: string[];
  rows: Record<string, string>[];
  detected: ColumnMapping;
  stats: { rows: number; sendable: number; missing_email: number; invalid_email: number; duplicates: number };
  placeholders: string[];
}

export interface CampaignTemplate {
  columns: string[];
  rows: Record<string, string>[];
  mapping: ColumnMapping;
  subject: string;
  body: string;
  ai_personalize: boolean;
  ai_instructions?: string | null;
}

export interface CampaignPreview {
  previews: { row_number: number; email: string; name: string | null; company: string | null; subject: string; body: string; missing: string[]; note: string | null }[];
  sendable: number;
  rows_with_missing_values: number;
  skipped: { row_number: number; email: string; reason: string }[];
  ai_personalized: boolean;
  ai_available: boolean;
}

export interface Campaign {
  id: number;
  name: string;
  source_filename: string | null;
  status: 'Queued' | 'Sending' | 'Completed' | 'Cancelled' | 'Failed';
  subject_template: string;
  body_template: string;
  ai_personalize: boolean;
  ai_instructions: string | null;
  create_leads: boolean;
  followup_days: number | null;
  sender_email: string | null;
  sender_source: string | null;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  last_error: string | null;
  created_by: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface CampaignRecipient {
  id: number;
  row_number: number;
  email: string;
  name: string | null;
  company: string | null;
  status: 'Pending' | 'Sending' | 'Sent' | 'Failed' | 'Skipped';
  error: string | null;
  subject: string | null;
  body: string | null;
  sent_at: string | null;
  sent_email_id: number | null;
  lead_id: number | null;
  client_id: number | null;
  follow_up_id: number | null;
  data: Record<string, string>;
}

async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  // No Content-Type header: the browser sets the multipart boundary itself.
  const res = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(errorMessage(data, res.status), res.status);
  return data as T;
}

export const campaignsApi = {
  sender: () => request<SenderStatus>('/email-campaigns/sender'),
  parse: (file: File) => upload<ParsedSheet>('/email-campaigns/parse', file),
  preview: (t: CampaignTemplate, start = 0, count = 3) => post<CampaignPreview>('/email-campaigns/preview', { ...t, start, count }),
  create: (t: CampaignTemplate & { name: string; source_filename: string; create_leads: boolean; followup_days: number | null }) =>
    post<{ campaign: Campaign; message: string } | Cancelled>('/email-campaigns', t),
  list: () => request<{ items: Campaign[] }>('/email-campaigns'),
  get: (id: number, status?: string | null, q?: string | null) =>
    request<{ campaign: Campaign; recipients: CampaignRecipient[] }>(`/email-campaigns/${id}${query({ status, q, limit: 500 })}`),
  cancel: (id: number) => post<{ campaign: Campaign }>(`/email-campaigns/${id}/cancel`),
  retry: (id: number) => post<{ campaign: Campaign; requeued: number } | Cancelled>(`/email-campaigns/${id}/retry`),
  /** Download the send record as CSV (fetched, so the auth headers are attached). */
  downloadExport: async (id: number, name: string) => {
    const res = await fetch(`${API_BASE_URL}/email-campaigns/${id}/export`);
    if (!res.ok) throw new ApiError(errorMessage(await res.json().catch(() => ({})), res.status), res.status);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^\w-]+/g, '_') || 'campaign'}-send-record.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
