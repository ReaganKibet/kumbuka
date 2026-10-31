import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { API_BASE, getToken } from "../api";
import LanguageList from "../components/LanguageList";
import { MeasureForm } from "../components/client/MeasuresTab";
import { ErrorText, Field as F, fmtDate, Loading, Modal, RiskTag, toLocalInput } from "../components/ui";
import { GENDERS, SETTINGS } from "../lib/africa";
import {
  createKit, expired, getMeta, MAX_ATTEMPTS, newId, precacheShell, save, scoreLocally, supported, sync, unlock, wipe,
  type Meta, type OutboxItem, type Pack, type PackClient, type Vault,
} from "../lib/field";

const LOCK_AFTER_MS = 10 * 60_000;

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

function Shell({ children, online, right }: { children: ReactNode; online: boolean; right?: ReactNode }) {
  return (
    <div className="min-h-screen bg-mist text-ink">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="font-serif text-2xl text-pine">kumbuka</Link>
            <span className="text-sm font-bold text-muted">Field kit</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${online ? "bg-sage text-pine-deep" : "bg-flag-soft text-flag"}`}>
              {online ? "Online" : "Offline"}
            </span>
          </div>
          {right}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}

// A person in the kit: someone from the downloaded caseload, or someone registered offline.
type Person = { ref: { client_id?: number; client_offline_id?: string }; key: string; name: string; c: Partial<PackClient>; isNew: boolean };

export default function FieldPage() {
  const online = useOnline();
  const [meta, setMeta] = useState<Meta | null | undefined>(undefined);
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [vault, setVault] = useState<Vault | null>(null);

  const refreshMeta = useCallback(() => getMeta().then((m) => setMeta(m ?? null)).catch(() => setMeta(null)), []);
  useEffect(() => { document.title = "Field kit · Kumbuka"; if (supported()) refreshMeta(); }, [refreshMeta]);

  const lock = useCallback(() => { setKey(null); setVault(null); refreshMeta(); }, [refreshMeta]);

  // Lock after inactivity: the key lives only in memory.
  const last = useRef(Date.now());
  useEffect(() => {
    if (!key) return;
    const bump = () => { last.current = Date.now(); };
    const evs = ["pointerdown", "keydown", "touchstart", "scroll"];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = window.setInterval(() => { if (Date.now() - last.current > LOCK_AFTER_MS) lock(); }, 15_000);
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); window.clearInterval(t); };
  }, [key, lock]);

  if (!supported()) {
    return <Shell online={online}><p>This browser can't keep an encrypted field kit. Use a recent Chrome, Edge, Firefox or Safari.</p></Shell>;
  }
  if (meta === undefined) return <Shell online={online}><Loading /></Shell>;
  if (!meta) return <Shell online={online}><Prepare online={online} onReady={(k, v) => { setKey(k); setVault(v); refreshMeta(); }} /></Shell>;
  if (!key || !vault) {
    return (
      <Shell online={online}>
        <Unlock meta={meta} onUnlocked={(k, v) => { setKey(k); setVault(v); refreshMeta(); }} onWiped={() => setMeta(null)} />
      </Shell>
    );
  }
  return (
    <Workspace
      online={online} meta={meta} keyRef={key} vault={vault}
      onChange={async (v) => { setVault(v); await save(key, v); refreshMeta(); }}
      onSynced={(v) => { setVault(v); refreshMeta(); }}
      onLock={lock}
      onWiped={() => { setKey(null); setVault(null); setMeta(null); }}
    />
  );
}

// ---------- prepare ----------
function Prepare({ online, onReady }: { online: boolean; onReady: (k: CryptoKey, v: Vault) => void }) {
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = !!getToken();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6,12}$/.test(pin)) { setError("Use a PIN of 6 to 12 digits."); return; }
    if (pin !== pin2) { setError("The two PINs don't match."); return; }
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/field/pack`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.detail === "string" ? j.detail : `Couldn't download the kit (${res.status}).`);
      }
      const pack: Pack = await res.json();
      const { key, vault } = await createKit(pin, pack);
      await precacheShell().catch(() => {});
      setPin(""); setPin2("");
      onReady(key, vault);
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <h1 className="font-serif text-4xl tracking-tight">Work without signal</h1>
      <p className="mt-2 max-w-xl text-ink/80">
        Before you go somewhere with no connection, download a field kit. You can then look up your clients, record
        sessions, questionnaires, group attendance and new people offline. Everything uploads when you're back online.
      </p>
      <ul className="mt-4 max-w-xl list-disc space-y-1 pl-5 text-sm text-ink/80">
        <li>The kit holds your own active clients and your groups for the next two weeks: names, ages, phone numbers, risk notes and last plans. Not full histories.</li>
        <li>It's encrypted on this device with a PIN you choose. Ten wrong PINs wipe it.</li>
        <li>It expires after 72 hours. Work you haven't uploaded is kept until you do.</li>
      </ul>
      {!signedIn ? (
        <p className="mt-6 rounded-md bg-flag-soft px-4 py-3 text-flag">
          <Link className="font-bold underline" to="/login">Sign in</Link> first, then come back here to download your kit.
        </p>
      ) : !online ? (
        <p className="mt-6 rounded-md bg-flag-soft px-4 py-3 text-flag">You're offline. Connect to download a field kit.</p>
      ) : (
        <form onSubmit={submit} className="mt-6 max-w-sm space-y-4 rounded-xl bg-paper p-5 ring-1 ring-line">
          <F label="Choose a PIN" hint="6 to 12 digits. You'll need it to open the kit in the field.">
            <input className="field text-lg tracking-widest" type="password" inputMode="numeric" autoComplete="new-password"
              value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} required />
          </F>
          <F label="Type it again">
            <input className="field text-lg tracking-widest" type="password" inputMode="numeric" autoComplete="new-password"
              value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} required />
          </F>
          <ErrorText error={error} />
          <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Downloading…" : "Download field kit"}</button>
        </form>
      )}
    </div>
  );
}

// ---------- unlock ----------
function Unlock({ meta, onUnlocked, onWiped }: { meta: Meta; onUnlocked: (k: CryptoKey, v: Vault) => void; onWiped: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { key, vault } = await unlock(pin);
      setPin("");
      onUnlocked(key, vault);
    } catch (err) {
      const c = (err as { code?: string }).code;
      setError((err as Error).message);
      setPin("");
      if (c === "wiped") onWiped();
    } finally { setBusy(false); }
  }

  async function forget() {
    const n = meta.outbox_count;
    if (!confirm(n ? `Wipe the kit? ${n} record${n === 1 ? "" : "s"} not yet uploaded will be lost.` : "Wipe the field kit from this device?")) return;
    await wipe();
    onWiped();
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="font-serif text-3xl">Open your field kit</h1>
      <p className="mt-1 text-sm text-muted">
        {meta.counsellor_name}'s kit.{" "}
        {expired(meta) ? "It has expired: you can still upload your work." : `Expires ${fmtDate(meta.expires_at, true)}.`}
        {meta.outbox_count > 0 && ` ${meta.outbox_count} record${meta.outbox_count === 1 ? "" : "s"} waiting to upload.`}
      </p>
      <form onSubmit={submit} className="mt-5 space-y-3">
        <input className="field text-center text-2xl tracking-[0.4em]" type="password" inputMode="numeric" autoFocus
          aria-label="PIN" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        <ErrorText error={error} />
        <button className="btn btn-primary w-full" disabled={busy || pin.length < 6}>{busy ? "Opening…" : "Open"}</button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Forgot the PIN? <button className="underline" onClick={forget}>Wipe this kit</button> and download a new one.
        {meta.attempts > 0 && ` ${MAX_ATTEMPTS - meta.attempts} tries left.`}
      </p>
    </div>
  );
}

// ---------- workspace ----------
function Workspace({ online, meta, keyRef, vault, onChange, onSynced, onLock, onWiped }: {
  online: boolean; meta: Meta; keyRef: CryptoKey; vault: Vault;
  onChange: (v: Vault) => Promise<void>; onSynced: (v: Vault) => void; onLock: () => void; onWiped: () => void;
}) {
  const pack = vault.pack;
  const [tab, setTab] = useState<"people" | "groups" | "queue">(pack ? "people" : "queue");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Person | null>(null);
  const [modal, setModal] = useState<null | "session" | "measure" | "new" | { group: number }>(null);
  const [measureKind, setMeasureKind] = useState<string | null>(null);
  // Dialogs stack: the person stays open underneath a session or questionnaire.
  const modalRef = useRef(modal);
  modalRef.current = modal;
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const people: Person[] = useMemo(() => {
    const known = (pack?.clients ?? []).map((c) => ({
      // Full names: two people called Halima must never be confused in the field
      ref: { client_id: c.id }, key: `c${c.id}`, name: c.full_name, c, isNew: false,
    }));
    const added = vault.outbox.filter((i) => i.kind === "client").map((i) => ({
      ref: { client_offline_id: i.offline_id }, key: i.offline_id, name: String(i.data.full_name),
      c: i.data as Partial<PackClient>, isNew: true,
    }));
    return [...added, ...known];
  }, [pack, vault.outbox]);
  const shown = people.filter((p) => !q || `${p.name} ${p.c.full_name ?? ""} ${p.c.settlement ?? ""} ${p.c.unhcr_case_no ?? ""}`
    .toLowerCase().includes(q.toLowerCase()));

  async function queue(item: Omit<OutboxItem, "offline_id" | "created_at"> & { offline_id?: string }, message: string) {
    const full: OutboxItem = { ...item, offline_id: item.offline_id ?? newId(), created_at: new Date().toISOString() };
    await onChange({ ...vault, outbox: [...vault.outbox, full] });
    setNotice(message);
    return full;
  }

  const upload = useCallback(async () => {
    setSyncing(true); setError(null); setNotice(null);
    try {
      const { vault: v, outcome } = await sync(keyRef, vault);
      onSynced(v);
      if (outcome.needsSignIn) setError("Sign in again to upload. Your records stay safely on this device until you do.");
      else if (outcome.offline) setError("Couldn't reach the server. Your records are still saved on this device.");
      else setNotice(`${outcome.sent} uploaded.${outcome.failed ? ` ${outcome.failed} need attention (see To upload).` : ""}`);
    } catch (e) { setError((e as Error).message); } finally { setSyncing(false); }
  }, [keyRef, vault, onSynced]);

  // Upload automatically when the connection comes back.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current && vault.outbox.length && getToken()) void upload();
    wasOnline.current = online;
  }, [online, upload, vault.outbox.length]);

  async function endDay() {
    if (vault.outbox.length) {
      if (!online) { setError("Connect first so your records can upload before the kit is wiped."); return; }
      const { vault: v } = await sync(keyRef, vault);
      if (v.outbox.length) {
        onSynced(v);
        if (!confirm(`${v.outbox.length} record${v.outbox.length === 1 ? "" : "s"} couldn't upload. Wipe anyway and lose them?`)) return;
      }
    }
    await wipe();
    onWiped();
  }

  const measure = pack?.measures.find((m) => m.kind === measureKind) ?? null;
  const group = modal && typeof modal === "object" ? pack?.groups.find((g) => g.id === modal.group) : undefined;
  const signedIn = !!getToken();

  return (
    <Shell online={online} right={
      <div className="flex gap-2">
        <button className="btn btn-quiet" onClick={onLock}>Lock</button>
        <button className="btn btn-quiet" onClick={endDay}>End field day</button>
      </div>
    }>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-muted">
          {meta.counsellor_name}{pack?.organization.name ? `, ${pack.organization.name}` : ""}.{" "}
          {pack ? `Kit expires ${fmtDate(meta.expires_at, true)}.` : "Kit expired: client details were removed; your queued work is kept."}
        </p>
        <button className="btn btn-primary" onClick={upload} disabled={!online || syncing || !vault.outbox.length}>
          {syncing ? "Uploading…" : `Upload ${vault.outbox.length || ""}`.trim()}
        </button>
      </div>
      {!signedIn && vault.outbox.length > 0 && online && (
        <p className="mt-2 text-sm text-flag"><Link to="/login" className="font-bold underline">Sign in</Link> to upload, then open the Field kit again.</p>
      )}
      {notice && <p className="mt-3 rounded-md bg-sage px-3 py-2 text-sm text-pine-deep" aria-live="polite">{notice}</p>}
      <ErrorText error={error} />

      <nav className="mt-5 flex gap-1 border-b border-line" role="tablist">
        {([["people", `People (${people.length})`], ["groups", `Groups (${pack?.groups.length ?? 0})`], ["queue", `To upload (${vault.outbox.length})`]] as const)
          .filter(([k]) => pack || k === "queue")
          .map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-bold ${tab === k ? "border-pine text-ink" : "border-transparent text-muted"}`}>{label}</button>
          ))}
      </nav>

      {tab === "people" && pack && (
        <section className="mt-4">
          <div className="flex gap-2">
            <input className="field" placeholder="Search name, settlement or case number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            <button className="btn btn-quiet shrink-0" onClick={() => setModal("new")}>Register someone</button>
          </div>
          <ul className="mt-3 divide-y divide-line rounded-xl bg-paper ring-1 ring-line">
            {shown.map((p) => (
              <li key={p.key}>
                <button className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-mist" onClick={() => setOpen(p)}>
                  <span>
                    <span className="font-bold">{p.name}</span>
                    {p.isNew && <span className="ml-2 rounded bg-flag-soft px-1.5 text-xs font-bold text-flag">New, not uploaded</span>}
                    <span className="block text-sm text-muted">
                      {[p.c.age != null && `${p.c.age} yrs`, p.c.settlement, p.c.block, p.c.location].filter(Boolean).join(" · ") || "No details"}
                    </span>
                  </span>
                  {p.c.risk_level && p.c.risk_level !== "none" && <RiskTag level={p.c.risk_level} />}
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-4 py-6 text-muted">Nobody matches.</li>}
          </ul>
        </section>
      )}

      {tab === "groups" && pack && (
        <ul className="mt-4 space-y-2">
          {pack.groups.length === 0 && <li className="text-muted">No groups in the two weeks around this kit.</li>}
          {pack.groups.map((g) => (
            <li key={g.id}>
              <button className="w-full rounded-xl bg-paper px-4 py-3 text-left ring-1 ring-line hover:bg-mist" onClick={() => setModal({ group: g.id })}>
                <span className="font-bold">{g.title}</span>
                <span className="block text-sm text-muted">{fmtDate(g.held_at, true)}{g.location ? `, ${g.location}` : ""} · {g.members.length} registered</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {tab === "queue" && (
        <section className="mt-4">
          {vault.outbox.length === 0 ? <p className="text-muted">Nothing waiting. Everything you record offline appears here until it uploads.</p> : (
            <ul className="divide-y divide-line rounded-xl bg-paper ring-1 ring-line">
              {vault.outbox.map((i) => (
                <li key={i.offline_id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <span>
                    <span className="font-bold">{i.label}</span>
                    <span className="block text-xs text-muted">Recorded {fmtDate(i.created_at, true)}</span>
                    {i.error && <span className="block text-sm text-risk">Not uploaded: {i.error}</span>}
                  </span>
                  {i.error && (
                    <button className="text-sm underline" onClick={async () => {
                      if (confirm("Remove this record from the queue? It won't be uploaded.")) {
                        await onChange({ ...vault, outbox: vault.outbox.filter((x) => x.offline_id !== i.offline_id) });
                      }
                    }}>Remove</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Uploaded notes arrive as drafts: read them through and sign them in Kumbuka.</p>
        </section>
      )}

      {/* Person */}
      <Modal open={!!open} onClose={() => { if (!modalRef.current) setOpen(null); }} title={open?.name ?? ""}>
        {open && (
          <div className="space-y-4">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              {open.c.preferred_name && open.c.preferred_name !== open.name && <><dt className="text-muted">Likes to be called</dt><dd>{open.c.preferred_name}</dd></>}
              {open.c.age != null && <><dt className="text-muted">Age</dt><dd>{open.c.age}</dd></>}
              {open.c.phone && <><dt className="text-muted">Phone</dt><dd><a className="underline" href={`tel:${open.c.phone}`}>{open.c.phone}</a></dd></>}
              {(open.c.settlement || open.c.block) && <><dt className="text-muted">Where</dt><dd>{[open.c.settlement, open.c.block].filter(Boolean).join(", ")}</dd></>}
              {open.c.unhcr_case_no && <><dt className="text-muted">UNHCR no.</dt><dd>{open.c.unhcr_case_no}</dd></>}
              {open.c.preferred_language && <><dt className="text-muted">Language</dt><dd>{open.c.preferred_language}{open.c.interpreter_needed ? " (needs interpreter)" : ""}</dd></>}
              {open.c.guardian_name && <><dt className="text-muted">Guardian</dt><dd>{open.c.guardian_name} {open.c.guardian_phone}</dd></>}
              {open.c.last_session_at && <><dt className="text-muted">Last session</dt><dd>{fmtDate(open.c.last_session_at)}</dd></>}
            </dl>
            {open.c.risk_level && open.c.risk_level !== "none" && (
              <div className="rounded-md border-l-4 border-risk bg-risk-soft px-3 py-2 text-sm">
                <p className="font-bold text-risk">Risk: {open.c.risk_level}</p>
                {open.c.risk_notes && <p className="note-text mt-1">{open.c.risk_notes}</p>}
              </div>
            )}
            {open.c.presenting_concern && <p className="note-text text-sm"><span className="font-bold">Why they came: </span>{open.c.presenting_concern}</p>}
            {open.c.last_plan && <p className="note-text text-sm"><span className="font-bold">Last plan: </span>{open.c.last_plan}</p>}
            {open.c.last_homework && <p className="note-text text-sm"><span className="font-bold">Homework: </span>{open.c.last_homework}</p>}
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <button className="btn btn-primary" onClick={() => setModal("session")}>Record a session</button>
              {pack?.measures.map((m) => (
                <button key={m.kind} className="btn btn-quiet" onClick={() => { setMeasureKind(m.kind); setModal("measure"); }}>{m.kind}</button>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={modal === "session"} onClose={() => setModal(null)} title={`Session with ${open?.name ?? ""}`}>
        {open && <SessionForm person={open} onSave={async (data) => {
          await queue({ kind: "session", ...open.ref, data, label: `Session with ${open.name}` }, `Session with ${open.name} saved on this device.`);
          setModal(null); setOpen(null);
        }} />}
      </Modal>

      <Modal open={modal === "measure"} onClose={() => setModal(null)} title={measure ? `${measure.kind} for ${open?.name ?? ""}` : ""}>
        {open && measure && (
          <MeasureForm measure={measure} submitLabel="Save on this device" save={async (answers, when) => {
            const r = scoreLocally(measure, answers);
            await queue({ kind: "assessment", ...open.ref, data: { kind: measure.kind, answers, taken_at: when },
              label: `${measure.kind} for ${open.name}: ${r.total} (${r.band})` },
            `${measure.kind} saved: ${r.total}, ${r.band}.` + (measure.kind === "PHQ-9" && answers[8] > 0
              ? ` Question 9 was answered: check on their safety now.${pack?.organization.crisis_contacts.length
                ? ` Crisis lines: ${pack.organization.crisis_contacts.map((c) => `${c.name} ${c.number}`).join("; ")}.` : ""}` : ""));
            setModal(null); setOpen(null);
          }} />
        )}
      </Modal>

      <Modal open={modal === "new"} onClose={() => setModal(null)} title="Register someone new">
        {pack && <NewPerson programmes={pack.programmes} onSave={async (data) => {
          await queue({ kind: "client", data, label: `New person: ${data.full_name}` }, `${data.full_name} registered on this device.`);
          setModal(null);
        }} />}
      </Modal>

      <Modal open={!!group} onClose={() => setModal(null)} title={group?.title ?? ""}>
        {group && <Register group={group} people={people} onSave={async (data, count) => {
          await queue({ kind: "attendance", data, label: `${group.title}: ${count} present` }, `Register for ${group.title} saved on this device.`);
          setModal(null);
        }} />}
      </Modal>
    </Shell>
  );
}

function SessionForm({ person, onSave }: { person: Person; onSave: (data: Record<string, unknown>) => Promise<void> }) {
  const [v, setV] = useState({
    scheduled_at: toLocalInput(new Date()), status: "attended", setting: "outreach",
    language: person.c.preferred_language ?? "", interpreter_used: !!person.c.interpreter_needed,
    mood_rating: null as number | null, notes: "", risk_check: "", plan: "", homework: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof v>) => setV({ ...v, ...p });
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      await onSave({ ...v, language: v.language.trim() || null, notes: v.notes.trim() || null, risk_check: v.risk_check.trim() || null,
        plan: v.plan.trim() || null, homework: v.homework.trim() || null });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="When"><input className="field" type="datetime-local" value={v.scheduled_at} onChange={(e) => set({ scheduled_at: e.target.value })} required /></F>
        <F label="Session">
          <select className="field" value={v.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="attended">Attended</option><option value="no_show">Didn't come</option><option value="cancelled">Cancelled</option>
          </select>
        </F>
        <F label="Where">
          <select className="field" value={v.setting} onChange={(e) => set({ setting: e.target.value })}>
            {Object.entries(SETTINGS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </F>
        <F label="Language">
          <input className="field" list="kumbuka-languages" value={v.language} onChange={(e) => set({ language: e.target.value })} />
        </F>
      </div>
      <LanguageList />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-pine" checked={v.interpreter_used} onChange={(e) => set({ interpreter_used: e.target.checked })} /> An interpreter was used
      </label>
      {v.status === "attended" && (
        <>
          <F label="Their mood today (1 is lowest)">
            <div className="flex gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" onClick={() => set({ mood_rating: v.mood_rating === n ? null : n })}
                  className={`h-9 flex-1 rounded text-sm ${v.mood_rating === n ? "bg-pine font-bold text-white" : "bg-paper ring-1 ring-line"}`}>{n}</button>
              ))}
            </div>
          </F>
          <F label="Notes" hint="What happened, in your own words. You'll turn it into a full note when you're back online.">
            <textarea className="field note-text" rows={6} value={v.notes} onChange={(e) => set({ notes: e.target.value })} />
          </F>
          <F label="Risk check" hint="Self-harm, harm to others, safeguarding. Note it even when denied.">
            <textarea className="field note-text" rows={2} value={v.risk_check} onChange={(e) => set({ risk_check: e.target.value })} />
          </F>
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="Plan"><textarea className="field note-text" rows={2} value={v.plan} onChange={(e) => set({ plan: e.target.value })} /></F>
            <F label="Homework"><textarea className="field note-text" rows={2} value={v.homework} onChange={(e) => set({ homework: e.target.value })} /></F>
          </div>
        </>
      )}
      <button className="btn btn-primary w-full" disabled={busy}>Save on this device</button>
    </form>
  );
}

function NewPerson({ programmes, onSave }: { programmes: { id: number; name: string }[]; onSave: (d: Record<string, unknown> & { full_name: string }) => Promise<void> }) {
  const [v, setV] = useState({
    full_name: "", gender: "", date_of_birth: "", phone: "", settlement: "", block: "", location: "", unhcr_case_no: "",
    preferred_language: "", interpreter_needed: false, presenting_concern: "", consent_signed: false,
    guardian_name: "", guardian_phone: "", guardian_consent: false, programme_id: "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<typeof v>) => setV({ ...v, ...p });
  const age = v.date_of_birth ? Math.floor((Date.now() - Date.parse(v.date_of_birth)) / 31_557_600_000) : null;
  const t = (k: keyof typeof v) => ({ value: v[k] as string, onChange: (e: { target: { value: string } }) => set({ [k]: e.target.value }) });
  const opt = (s: string) => s.trim() || null;
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      if (!v.consent_signed) { setError("Record their consent to counselling before registering them."); return; }
      await onSave({
        full_name: v.full_name.trim(), gender: v.gender || null, date_of_birth: v.date_of_birth || null, phone: opt(v.phone),
        settlement: opt(v.settlement), block: opt(v.block), location: opt(v.location), unhcr_case_no: opt(v.unhcr_case_no),
        preferred_language: opt(v.preferred_language), interpreter_needed: v.interpreter_needed,
        presenting_concern: opt(v.presenting_concern), consent_signed: true, guardian_name: opt(v.guardian_name),
        guardian_phone: opt(v.guardian_phone), guardian_consent: v.guardian_consent,
        programme_id: v.programme_id ? Number(v.programme_id) : null,
      });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="Full name"><input className="field" required {...t("full_name")} /></F>
        <F label="Gender">
          <select className="field" {...t("gender")}><option value="">Not recorded</option>
            {Object.entries(GENDERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </F>
        <F label="Date of birth"><input className="field" type="date" {...t("date_of_birth")} /></F>
        <F label="Phone"><input className="field" type="tel" {...t("phone")} /></F>
        <F label="Camp, settlement or village"><input className="field" {...t("settlement")} /></F>
        <F label="Block or zone"><input className="field" {...t("block")} /></F>
        <F label="UNHCR case number (if any)"><input className="field" {...t("unhcr_case_no")} /></F>
        <F label="Language"><input className="field" list="kumbuka-languages" {...t("preferred_language")} /></F>
        {programmes.length > 0 && (
          <F label="Programme">
            <select className="field" {...t("programme_id")}><option value="">None</option>
              {programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </F>
        )}
      </div>
      <LanguageList />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-pine" checked={v.interpreter_needed} onChange={(e) => set({ interpreter_needed: e.target.checked })} /> Needs an interpreter</label>
      {age !== null && age < 18 && (
        <fieldset className="space-y-3 rounded-lg border border-flag/40 bg-flag-soft/40 p-3">
          <legend className="px-1 text-sm font-bold">Under 18: parent or guardian</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="Guardian's name"><input className="field" {...t("guardian_name")} /></F>
            <F label="Guardian's phone"><input className="field" type="tel" {...t("guardian_phone")} /></F>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-pine" checked={v.guardian_consent} onChange={(e) => set({ guardian_consent: e.target.checked })} /> Guardian consent recorded</label>
        </fieldset>
      )}
      <F label="Why they came"><textarea className="field note-text" rows={2} {...t("presenting_concern")} /></F>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 size-4 accent-pine" checked={v.consent_signed} onChange={(e) => set({ consent_signed: e.target.checked })} />
        <span>They agreed to counselling and to their information being recorded<span className="block text-sm text-muted">On paper or verbally, as your organisation requires.</span></span></label>
      <ErrorText error={error} />
      <button className="btn btn-primary w-full">Save on this device</button>
    </form>
  );
}

function Register({ group, people, onSave }: {
  group: Pack["groups"][number]; people: Person[];
  onSave: (data: Record<string, unknown>, count: number) => Promise<void>;
}) {
  const [present, setPresent] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(group.members.map((m) => [`c${m.client_id}`, m.present])));
  // People added to this register today: anyone from the kit, including people registered offline
  const [added, setAdded] = useState<string[]>(() => people.filter((p) => p.isNew).map((p) => p.key));
  const memberKeys = new Set(group.members.map((m) => `c${m.client_id}`));
  const byKey = new Map(people.map((p) => [p.key, p]));
  const rows = [
    ...group.members.map((m) => ({ key: `c${m.client_id}`, name: m.name, id: m.client_id as number | undefined, off: undefined as string | undefined })),
    ...added.filter((k) => !memberKeys.has(k) && byKey.has(k)).map((k) => {
      const p = byKey.get(k)!;
      return { key: k, name: p.name, id: p.ref.client_id, off: p.ref.client_offline_id };
    }),
  ];
  const addable = people.filter((p) => !memberKeys.has(p.key) && !added.includes(p.key));
  const count = rows.filter((r) => present[r.key]).length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{fmtDate(group.held_at, true)}{group.location ? `, ${group.location}` : ""}. Tick who came. People you registered today are listed too.</p>
      <ul className="divide-y divide-line rounded-lg ring-1 ring-line">
        {rows.map((r) => (
          <li key={r.key}>
            <label className="flex items-center gap-3 px-3 py-2.5">
              <input type="checkbox" className="size-5 accent-pine" checked={!!present[r.key]} onChange={(e) => setPresent({ ...present, [r.key]: e.target.checked })} />
              <span>{r.name}{r.off && <span className="ml-2 text-xs text-flag">new</span>}</span>
            </label>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="text-sm text-muted">Nobody is on this register yet. Add people below.</p>}
      {addable.length > 0 && (
        <select className="field" value="" aria-label="Add someone to this register"
          onChange={(e) => { const k = e.target.value; if (k) { setAdded([...added, k]); setPresent({ ...present, [k]: true }); } }}>
          <option value="">Add someone from your clients…</option>
          {addable.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </select>
      )}
      <button className="btn btn-primary w-full" onClick={() => onSave({
        group_id: group.id,
        present: rows.filter((r) => r.id && present[r.key]).map((r) => r.id),
        absent: rows.filter((r) => r.id && !present[r.key]).map((r) => r.id),
        present_offline: rows.filter((r) => r.off && present[r.key]).map((r) => r.off),
      }, count)}>Save register ({count} present)</button>
    </div>
  );
}
