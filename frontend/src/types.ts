export type Therapist = {
  id: number; name: string; email: string;
  title: string | null; practice_name: string | null; phone: string | null; address: string | null; license_no: string | null;
  totp_enabled: boolean; recovery_codes_left: number;
};

export type AuthConfig = { registration_open: boolean; idle_lock_minutes: number; ai_enabled: boolean };

export type LoginResult = { token: string | null; therapist: Therapist | null; mfa_required: boolean; mfa_token: string | null };

export type RiskLevel = "none" | "low" | "medium" | "high";

export type Client = {
  id: number;
  full_name: string;
  preferred_name: string | null;
  date_of_birth: string | null;
  phone: string | null;
  email: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  presenting_concern: string | null;
  background: string | null;
  consent_signed: boolean;
  consent_ai: boolean;
  risk_level: RiskLevel;
  risk_notes: string | null;
  status: "active" | "paused" | "closed";
  created_at: string;
  updated_at: string;
};

export type ClientListItem = {
  id: number;
  full_name: string;
  preferred_name: string | null;
  risk_level: RiskLevel;
  status: string;
  last_session: string | null;
  next_session: string | null;
  session_count: number;
  unsigned_notes: number;
};

export type Addendum = { id: number; text: string; created_at: string };

export type Session = {
  id: number;
  client_id: number;
  scheduled_at: string;
  duration_min: number;
  status: "scheduled" | "attended" | "cancelled" | "no_show";
  mood_rating: number | null;
  dictation: string | null;
  data: string | null;
  assessment: string | null;
  plan: string | null;
  interventions: string | null;
  homework: string | null;
  risk_check: string | null;
  private_note: string | null;
  note_status: "draft" | "signed";
  signed_at: string | null;
  created_at: string;
  updated_at: string;
  addenda: Addendum[];
  client_name?: string;
};

export type Draft = {
  data: string; assessment: string; plan: string; interventions: string; homework: string;
  risk_indicators: string[]; ai_used: boolean; message: string | null;
};

export type Measure = {
  kind: string; title: string; prompt: string; items: string[];
  options: { value: number; label: string }[]; max: number; bands: { upTo: number; label: string }[];
};

export type Assessment = {
  id: number; kind: string; answers: number[]; total: number; severity: string; flags: string[]; taken_at: string;
  source: "counselor" | "client";
};

export type Goal = {
  id: number; description: string; status: "active" | "achieved" | "dropped"; progress: number;
  created_at: string; updated_at: string;
};

export type Brief = {
  summary: string | null;
  ai_used: boolean;
  message: string | null;
  last_session: string | null;
  last_plan: string | null;
  last_homework: string | null;
  active_goals: string[];
  latest_scores: { kind: string; total: number; severity: string; taken_at: string; change: number | null }[];
  risk_level: RiskLevel;
  risk_notes: string | null;
  open_flags: string[];
  latest_checkin: { completed_at: string; mood: number | null; message: string | null; kinds: string[] } | null;
};

export type Dashboard = {
  today: Session[];
  upcoming: Session[];
  unsigned: Session[];
  attention: { client_id: number; client_name: string; reason: string; level: string }[];
  checkins: { client_id: number; client_name: string; completed_at: string; mood: number | null; has_message: boolean; scores: string[]; flagged: boolean }[];
  counts: { active_clients: number; sessions_this_month: number };
  ai_enabled: boolean;
};

export type AuditRow = { id: number; action: string; entity: string; entity_id: number | null; detail: string | null; at: string };

export type Checkin = {
  id: number; kinds: string[]; expires_at: string; completed_at: string | null; revoked_at: string | null;
  mood: number | null; message: string | null; created_at: string;
  status: "pending" | "completed" | "expired" | "revoked";
  token?: string;
};

export type PublicCheckin = {
  first_name: string; counselor_name: string; practice_name: string | null; measures: Measure[]; expires_at: string;
};

export type LetterKind = "attendance" | "referral" | "general";

export type Letter = {
  id: number; client_id: number; kind: LetterKind; recipient: string | null; subject: string | null; body: string;
  created_at: string; updated_at: string;
};
