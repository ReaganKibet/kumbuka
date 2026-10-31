export type Role = "owner" | "admin" | "supervisor" | "counsellor" | "lay_counsellor" | "me_officer";
export type OrgKind = "ngo" | "school" | "university" | "counselling_centre" | "private_practice" | "faith_based" | "government" | "other";

export type CrisisContact = { name: string; number: string; note?: string | null };

export type Org = {
  id: number; name: string; kind: OrgKind; country: string; review_all_notes: boolean;
  crisis_contacts: CrisisContact[] | null; is_demo: boolean;
};

export type Therapist = {
  id: number; name: string; email: string; role: Role; organization_id: number | null; supervisor_id: number | null;
  organization: Org | null;
  title: string | null; practice_name: string | null; phone: string | null; address: string | null; license_no: string | null;
  totp_enabled: boolean; recovery_codes_left: number;
  ai_available: boolean; can_transcribe: boolean;
};

export type AuthConfig = {
  registration_open: boolean; idle_lock_minutes: number; ai_enabled: boolean; demo_enabled: boolean;
  ai_provider: "gemini" | "anthropic" | null; ai_real_data: boolean;
};

export type Programme = { id: number; name: string; location: string | null; funder: string | null; active: boolean };

export type Member = {
  id: number; name: string; email: string; role: Role; title: string | null; supervisor_id: number | null;
  active: boolean; totp_enabled: boolean; caseload: number;
};

export type Invite = {
  id: number; email: string; name: string | null; role: Role; supervisor_id: number | null; expires_at: string;
  accepted_at: string | null; revoked_at: string | null; created_at: string; status: "pending" | "accepted" | "revoked" | "expired";
  token?: string;
};

export type Referral = {
  id: number; client_id: number; client_name: string | null; created_by_name: string | null; service: string;
  to_organisation: string | null; to_contact: string | null; reason: string | null; urgency: "routine" | "urgent" | "emergency";
  status: "made" | "accepted" | "attended" | "not_attended" | "declined" | "closed"; outcome: string | null;
  referred_on: string; follow_up_on: string | null; overdue: boolean; created_at: string; updated_at: string;
};

export type GroupSession = {
  id: number; title: string; topic: string | null; location: string | null; programme_id: number | null;
  programme_name: string | null; facilitator_id: number; facilitator_name: string | null; held_at: string;
  duration_min: number; status: "scheduled" | "held" | "cancelled"; notes: string | null;
  present_count: number; registered_count: number; can_edit: boolean;
  attendance: { client_id: number; client_name: string; present: boolean; note: string | null }[];
};

export type Count = number | "<5";
export type Breakdown = { label: string; count: Count }[];
export type Outcome = {
  measure: string; title: string; higher_is_better: boolean; screened_in_period: number; with_follow_up: number;
  improved: number; improved_pct: number | null; deteriorated: number; clinical_at_baseline: number; recovered: number;
  recovered_pct: number | null; mean_baseline: number | null; mean_latest: number | null; definition: string;
};
export type Report = {
  organization: string; programme: string; period: { start: string; end: string }; generated_at: string; suppressed: boolean;
  reach: {
    clients_served: number; new_clients: number; served_individually: number; served_in_groups: number; minors_served: Count;
    individual_sessions: number; no_shows: number; cancellations: number; no_show_rate_pct: number | null;
    group_sessions: number; group_attendances: number;
  };
  by_gender: Breakdown; by_age: Breakdown; by_location: Breakdown;
  by_programme: { label: string; location: string | null; funder: string | null; clients_served: Count; individual_sessions: number; group_sessions: number }[];
  outcomes: Outcome[];
  safeguarding: { high_risk_active: Count; medium_risk_active: Count; phq9_item9_flags: Count; escalations_raised: Count };
  referrals: { made: number; by_service: Breakdown; completed: number; completion_rate_pct: number | null; open: number; overdue_follow_up: number };
  documentation: { notes_signed: number; signed_within_48h_pct: number | null; awaiting_review: number; unsigned: number };
  iasc: {
    framework: string;
    focused_care: Record<"women" | "men" | "girls" | "boys" | "other_or_unknown" | "total", Count>;
    supervision: { delivering_staff: number; with_supervisor: number; supervised_in_period: number; pct: number | null };
    by_setting: { label: string; count: number }[];
    by_language: { label: string; count: number }[];
    interpreter_sessions: number;
    indicators: { code: string; indicator: string; value: string; note: string }[];
  };
};

export type SupervisionData = {
  pending_reviews: (Session & { client_id: number; client_name: string })[];
  escalations: { id: number; name: string; risk_level: RiskLevel; counsellor_name: string | null; escalated_at: string | null; escalation_note: string | null }[];
  high_risk: { id: number; name: string; risk_level: RiskLevel; counsellor_name: string | null }[];
  team: { id: number; name: string; role: Role; caseload: number; overdue_notes: number; sessions_30d: number }[];
};

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
  programme_id: number | null;
  gender: "female" | "male" | "other" | "undisclosed" | null;
  location: string | null;
  referral_source: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_consent: boolean;
  restricted: boolean;
  unhcr_case_no: string | null;
  primero_case_id: string | null;
  settlement: string | null;
  block: string | null;
  preferred_language: string | null;
  interpreter_needed: boolean;
  therapist_id: number;
  counsellor_name: string | null;
  programme_name: string | null;
  escalated_at: string | null;
  escalation_note: string | null;
  created_at: string;
  updated_at: string;
};

export type ClientListItem = {
  id: number;
  full_name: string;
  preferred_name: string | null;
  risk_level: RiskLevel;
  status: string;
  restricted: boolean;
  escalated: boolean;
  counsellor_name: string | null;
  programme_name: string | null;
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
  setting: "facility" | "home_visit" | "outreach" | "school" | "phone" | "online" | null;
  language: string | null;
  interpreter_used: boolean;
  dictation: string | null;
  data: string | null;
  assessment: string | null;
  plan: string | null;
  interventions: string | null;
  homework: string | null;
  risk_check: string | null;
  private_note: string | null;
  note_status: "draft" | "submitted" | "signed";
  signed_at: string | null;
  review_status: "none" | "pending" | "approved" | "returned";
  review_comment: string | null;
  reviewed_at: string | null;
  author_id: number | null;
  author_name: string | null;
  reviewer_name: string | null;
  can_edit: boolean;
  can_review: boolean;
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
  higher_is_better: boolean;
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
  counts: { active_clients: number; sessions_this_month: number; returned_notes: number };
  ai_enabled: boolean;
  supervision: { pending_reviews: number; escalations: number } | null;
};

export type AuditRow = { id: number; actor_name: string | null; action: string; entity: string; entity_id: number | null; detail: string | null; at: string };

export type Checkin = {
  id: number; kinds: string[]; expires_at: string; completed_at: string | null; revoked_at: string | null;
  mood: number | null; message: string | null; created_at: string;
  status: "pending" | "completed" | "expired" | "revoked";
  token?: string;
};

export type PublicCheckin = {
  first_name: string; counselor_name: string; practice_name: string | null; measures: Measure[]; expires_at: string;
  country: string; support_contacts: CrisisContact[];
};

export type LetterKind = "attendance" | "referral" | "general";

export type Letter = {
  id: number; client_id: number; kind: LetterKind; recipient: string | null; subject: string | null; body: string;
  created_at: string; updated_at: string;
};
