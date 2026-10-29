import type {
  Assessment, AuditRow, AuthConfig, Brief, Checkin, Client, ClientListItem, Dashboard, Draft, Goal, Letter, LetterKind,
  LoginResult, Measure, PublicCheckin, Session, Therapist,
} from "./types";

// Empty in local dev (Vite proxies /api to the backend). On Netlify it's the Render URL.
export const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");

const TOKEN_KEY = "kumbuka.token";

export function getToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = opts.auth === false ? null : getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your internet connection and try again.");
  }
  if (res.status === 401 && token) {
    setToken(null);
    window.location.assign("/login?expired=1");
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail)) msg = j.detail.map((d: { msg: string; loc?: string[] }) => `${d.loc?.slice(-1)[0] ?? ""}: ${d.msg}`).join("; ");
    } catch { /* not json */ }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  health: () => req<{ ok: boolean }>("GET", "/health", undefined, { auth: false }),
  authConfig: () => req<AuthConfig>("GET", "/auth/config", undefined, { auth: false }),
  register: (b: { name: string; email: string; password: string }) =>
    req<{ token: string; therapist: Therapist }>("POST", "/auth/register", b, { auth: false }),
  login: (b: { email: string; password: string }) => req<LoginResult>("POST", "/auth/login", b, { auth: false }),
  loginMfa: (b: { mfa_token: string; code: string }) =>
    req<{ token: string; therapist: Therapist }>("POST", "/auth/login/mfa", b, { auth: false }),
  me: () => req<Therapist>("GET", "/auth/me"),
  updateMe: (b: Partial<Therapist>) => req<Therapist>("PATCH", "/auth/me", b),
  changePassword: (b: { current_password: string; new_password: string }) =>
    req<{ token: string; therapist: Therapist }>("POST", "/auth/me/password", b),
  logoutAll: () => req<void>("POST", "/auth/me/logout-all"),
  totpSetup: () => req<{ secret: string; otpauth_uri: string }>("POST", "/auth/me/2fa/setup"),
  totpEnable: (code: string) => req<{ recovery_codes: string[] }>("POST", "/auth/me/2fa/enable", { code }),
  totpNewCodes: (code: string) => req<{ recovery_codes: string[] }>("POST", "/auth/me/2fa/recovery-codes", { code }),
  totpDisable: (b: { password: string; code: string }) => req<Therapist>("POST", "/auth/me/2fa/disable", b),

  dashboard: () => req<Dashboard>("GET", "/dashboard"),
  audit: () => req<AuditRow[]>("GET", "/audit"),
  auditEvent: (b: { action: "print"; entity: "session" | "client" | "letter"; entity_id: number }) =>
    req<void>("POST", "/audit-events", b),

  clients: () => req<ClientListItem[]>("GET", "/clients"),
  client: (id: number) => req<Client>("GET", `/clients/${id}`),
  createClient: (b: Partial<Client>) => req<Client>("POST", "/clients", b),
  updateClient: (id: number, b: Partial<Client>) => req<Client>("PATCH", `/clients/${id}`, b),
  brief: (id: number, ai = true) => req<Brief>("GET", `/clients/${id}/brief?ai=${ai}`),
  exportClient: (id: number) => req<unknown>("GET", `/clients/${id}/export`),

  sessions: (clientId: number) => req<Session[]>("GET", `/clients/${clientId}/sessions`),
  createSession: (clientId: number, b: { scheduled_at: string; duration_min: number }) =>
    req<Session>("POST", `/clients/${clientId}/sessions`, b),
  session: (id: number) => req<Session>("GET", `/sessions/${id}`),
  updateSession: (id: number, b: Partial<Session>) => req<Session>("PATCH", `/sessions/${id}`, b),
  deleteSession: (id: number) => req<void>("DELETE", `/sessions/${id}`),
  signSession: (id: number) => req<Session>("POST", `/sessions/${id}/sign`),
  addAddendum: (id: number, text: string) => req<Session>("POST", `/sessions/${id}/addenda`, { text }),
  aiDraft: (id: number, dictation: string) => req<Draft>("POST", `/sessions/${id}/ai-draft`, { dictation }),

  measures: () => req<Measure[]>("GET", "/measures"),
  assessments: (clientId: number) => req<Assessment[]>("GET", `/clients/${clientId}/assessments`),
  addAssessment: (clientId: number, b: { kind: string; answers: number[]; taken_at?: string }) =>
    req<Assessment>("POST", `/clients/${clientId}/assessments`, b),
  deleteAssessment: (id: number) => req<void>("DELETE", `/assessments/${id}`),

  goals: (clientId: number) => req<Goal[]>("GET", `/clients/${clientId}/goals`),
  addGoal: (clientId: number, description: string) => req<Goal>("POST", `/clients/${clientId}/goals`, { description }),
  updateGoal: (id: number, b: Partial<Goal>) => req<Goal>("PATCH", `/goals/${id}`, b),
  deleteGoal: (id: number) => req<void>("DELETE", `/goals/${id}`),

  checkins: (clientId: number) => req<Checkin[]>("GET", `/clients/${clientId}/checkins`),
  createCheckin: (clientId: number, b: { kinds: string[]; days: number }) =>
    req<Checkin & { token: string }>("POST", `/clients/${clientId}/checkins`, b),
  revokeCheckin: (id: number) => req<Checkin>("DELETE", `/checkins/${id}`),
  publicCheckin: (token: string) => req<PublicCheckin>("GET", `/public/checkins/${encodeURIComponent(token)}`, undefined, { auth: false }),
  submitCheckin: (token: string, b: { answers: Record<string, number[]>; mood: number | null; message: string | null }) =>
    req<{ ok: boolean; show_support: boolean }>("POST", `/public/checkins/${encodeURIComponent(token)}`, b, { auth: false }),

  letters: (clientId: number) => req<Letter[]>("GET", `/clients/${clientId}/letters`),
  draftLetter: (clientId: number, b: { kind: LetterKind; recipient?: string; reason?: string; use_ai?: boolean }) =>
    req<{ subject: string; body: string; ai_used: boolean; message: string | null }>("POST", `/clients/${clientId}/letters/draft`, b),
  createLetter: (clientId: number, b: { kind: LetterKind; recipient: string | null; subject: string | null; body: string }) =>
    req<Letter>("POST", `/clients/${clientId}/letters`, b),
  letter: (id: number) => req<Letter>("GET", `/letters/${id}`),
  updateLetter: (id: number, b: Partial<Letter>) => req<Letter>("PATCH", `/letters/${id}`, b),
  deleteLetter: (id: number) => req<void>("DELETE", `/letters/${id}`),
};
