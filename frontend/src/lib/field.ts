// Offline field kit: an encrypted copy of a counsellor's caseload plus a queue of work done offline.
//
// - Everything sensitive is encrypted with AES-GCM under a key derived from the counsellor's PIN
//   (PBKDF2, 600,000 rounds). The key lives only in memory while the kit is unlocked.
// - Ten wrong PINs wipe the kit. It expires after 72 hours; after that only the queue survives,
//   so unsent work can still be uploaded.
// - Only a few harmless counters (expiry, number of queued items) are stored unencrypted, so the
//   app can say "3 records waiting to upload" without the PIN.
//
// A PIN-protected kit stops casual access to a lost phone. It is not proof against a determined
// attacker with the device, which is why the kit is small, short-lived and wiped after upload.

import { API_BASE, getToken } from "../api";
import type { Measure, RiskLevel } from "../types";

const DB_NAME = "kumbuka-field";
const STORE = "kv";
const ROUNDS = 600_000;
export const MAX_ATTEMPTS = 10;
export const SHELL_CACHE = "kumbuka-shell-v1";

export type PackClient = {
  id: number; full_name: string; preferred_name: string | null; age: number | null; gender: string | null;
  phone: string | null; location: string | null; settlement: string | null; block: string | null;
  unhcr_case_no: string | null; preferred_language: string | null; interpreter_needed: boolean;
  risk_level: RiskLevel; risk_notes: string | null; presenting_concern: string | null; consent_ai: boolean;
  guardian_name: string | null; guardian_phone: string | null; last_session_at: string | null;
  last_plan: string | null; last_homework: string | null; next_session_at: string | null;
};
export type PackGroup = {
  id: number; title: string; held_at: string; location: string | null;
  members: { client_id: number; name: string; present: boolean }[];
};
export type Pack = {
  generated_at: string; expires_at: string; counsellor: { id: number; name: string };
  organization: { name: string | null; country: string; crisis_contacts: { name: string; number: string; note?: string | null }[] };
  measures: (Measure & { multiplier: number })[]; programmes: { id: number; name: string }[];
  clients: PackClient[]; groups: PackGroup[];
};

export type OutboxItem = {
  offline_id: string;
  kind: "client" | "session" | "assessment" | "attendance";
  client_id?: number;
  client_offline_id?: string;
  data: Record<string, unknown>;
  label: string; // what the counsellor sees in the queue, e.g. "Session with Amina"
  created_at: string;
  error?: string;
};
export type Vault = { pack: Pack | null; outbox: OutboxItem[] };
export type Meta = {
  salt: string; created_at: string; expires_at: string; counsellor_name: string;
  attempts: number; outbox_count: number;
};

// ---------- IndexedDB (tiny key-value) ----------
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { resolve(req.result as T); db.close(); };
    tx.onerror = () => { reject(tx.error); db.close(); };
  });
}
const get = <T>(k: string) => idb<T | undefined>("readonly", (s) => s.get(k));
const put = (k: string, v: unknown) => idb("readwrite", (s) => s.put(v, k));

// ---------- crypto ----------
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ROUNDS },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}
async function seal(key: CryptoKey, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { iv: b64(iv), data: b64(new Uint8Array(data)) };
}
async function unseal<T>(key: CryptoKey, box: { iv: string; data: string }): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) as BufferSource }, key, unb64(box.data) as BufferSource);
  return JSON.parse(new TextDecoder().decode(plain));
}

// ---------- the kit ----------
export const supported = () => typeof indexedDB !== "undefined" && !!globalThis.crypto?.subtle;
export const getMeta = () => get<Meta>("meta");
export const expired = (m: Meta) => Date.now() > Date.parse(m.expires_at);
export const newId = () => crypto.randomUUID();

export async function wipe() {
  await idb("readwrite", (s) => s.clear());
}

export async function createKit(pin: string, pack: Pack): Promise<{ key: CryptoKey; vault: Vault }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pin, salt);
  const vault: Vault = { pack, outbox: [] };
  await put("vault", await seal(key, vault));
  await put("meta", {
    salt: b64(salt), created_at: new Date().toISOString(), expires_at: pack.expires_at,
    counsellor_name: pack.counsellor.name, attempts: 0, outbox_count: 0,
  } satisfies Meta);
  return { key, vault };
}

/** Throws "wrong" (with attempts left) or "wiped". Expired kits come back with pack = null. */
export async function unlock(pin: string): Promise<{ key: CryptoKey; vault: Vault }> {
  const meta = await getMeta();
  const box = await get<{ iv: string; data: string }>("vault");
  if (!meta || !box) throw new Error("No field kit on this device.");
  const key = await deriveKey(pin, unb64(meta.salt));
  let vault: Vault;
  try {
    vault = await unseal<Vault>(key, box);
  } catch {
    const attempts = meta.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await wipe();
      throw Object.assign(new Error("Too many wrong PINs. The field kit has been wiped from this device."), { code: "wiped" });
    }
    await put("meta", { ...meta, attempts });
    throw Object.assign(new Error(`Wrong PIN. ${MAX_ATTEMPTS - attempts} tries left before the kit is wiped.`), { code: "wrong" });
  }
  if (meta.attempts) await put("meta", { ...meta, attempts: 0 });
  if (vault.pack && expired(meta)) {
    vault = { pack: null, outbox: vault.outbox }; // client details go; unsent work stays
    await save(key, vault);
  }
  return { key, vault };
}

export async function save(key: CryptoKey, vault: Vault) {
  await put("vault", await seal(key, vault));
  const meta = await getMeta();
  if (meta) await put("meta", { ...meta, outbox_count: vault.outbox.length });
}

export type SyncOutcome = { sent: number; failed: number; needsSignIn: boolean; offline: boolean };

/** Upload the queue. Created and duplicate items leave it; failures stay with their reason. */
export async function sync(key: CryptoKey, vault: Vault): Promise<{ vault: Vault; outcome: SyncOutcome }> {
  const token = getToken();
  const pending = vault.outbox;
  if (!pending.length) return { vault, outcome: { sent: 0, failed: 0, needsSignIn: false, offline: false } };
  if (!token) return { vault, outcome: { sent: 0, failed: 0, needsSignIn: true, offline: false } };
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/field/sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ items: pending.map(({ offline_id, kind, client_id, client_offline_id, data }) =>
        ({ offline_id, kind, client_id, client_offline_id, data })) }),
    });
  } catch {
    return { vault, outcome: { sent: 0, failed: 0, needsSignIn: false, offline: true } };
  }
  if (res.status === 401) return { vault, outcome: { sent: 0, failed: 0, needsSignIn: true, offline: false } };
  if (!res.ok) throw new Error(`Upload failed (${res.status}). Your records are still saved on this device.`);
  const results: { offline_id: string; status: string; message: string | null }[] = await res.json();
  const byId = new Map(results.map((r) => [r.offline_id, r]));
  const outbox = pending
    .filter((i) => byId.get(i.offline_id)?.status === "error")
    .map((i) => ({ ...i, error: byId.get(i.offline_id)?.message ?? "Couldn't be saved." }));
  const next = { ...vault, outbox };
  await save(key, next);
  return { vault: next, outcome: { sent: pending.length - outbox.length, failed: outbox.length, needsSignIn: false, offline: false } };
}

/** Keep the app's own files so it opens with no connection. */
export async function precacheShell() {
  if (!("caches" in window)) return;
  const urls = new Set(["/index.html"]);
  for (const e of performance.getEntriesByType("resource")) {
    const u = new URL(e.name);
    if (u.origin === location.origin && u.pathname.startsWith("/assets/")) urls.add(u.pathname);
  }
  document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>("script[src], link[rel=stylesheet]").forEach((el) => {
    const u = new URL("src" in el && el.src ? el.src : (el as HTMLLinkElement).href);
    if (u.origin === location.origin) urls.add(u.pathname);
  });
  const c = await caches.open(SHELL_CACHE);
  await c.addAll([...urls]);
}

export function scoreLocally(m: Measure & { multiplier: number }, answers: number[]) {
  const total = answers.reduce((a, b) => a + b, 0) * (m.multiplier || 1);
  const band = m.bands.find((b) => total <= b.upTo)?.label ?? "";
  return { total, band };
}
