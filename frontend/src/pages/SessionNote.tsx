import { useEffect, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { LOCK_EVENT } from "../auth";
import { useDictation } from "../components/useDictation";
import { ErrorText, Field, fmtDate, Loading, Modal, StatusTag } from "../components/ui";
import type { Client, Draft, Session } from "../types";

const SECTIONS = [
  { key: "data", label: "Data", hint: "What the client reported and what you observed." },
  { key: "assessment", label: "Assessment", hint: "Your reading of progress, themes and how they responded." },
  { key: "plan", label: "Plan", hint: "Next steps and focus for next session." },
  { key: "interventions", label: "Interventions used", hint: "e.g. reflective listening, thought record, grounding." },
  { key: "homework", label: "Homework", hint: "What the client agreed to try before next time." },
  { key: "risk_check", label: "Risk check", hint: "Self-harm, harm to others, safeguarding. Note it even when denied." },
] as const;
type NoteKey = (typeof SECTIONS)[number]["key"];
type Form = Record<NoteKey | "dictation" | "private_note", string> & { mood_rating: number | null; status: Session["status"] };

function toForm(s: Session): Form {
  return {
    dictation: s.dictation ?? "", data: s.data ?? "", assessment: s.assessment ?? "", plan: s.plan ?? "",
    interventions: s.interventions ?? "", homework: s.homework ?? "", risk_check: s.risk_check ?? "",
    private_note: s.private_note ?? "", mood_rating: s.mood_rating, status: s.status,
  };
}

export default function SessionNote() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftInfo, setDraftInfo] = useState<Draft | null>(null);
  const [confirmSign, setConfirmSign] = useState(false);
  const [addendum, setAddendum] = useState("");
  const dictRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.session(id).then((s) => {
      setSession(s); setForm(toForm(s));
      api.client(s.client_id).then(setClient).catch(() => {});
    }).catch((e) => setError(e.message));
  }, [id]);

  const set = (patch: Partial<Form>) => { setForm((f) => (f ? { ...f, ...patch } : f)); setDirty(true); };

  const dict = useDictation((text) =>
    setForm((f) => { if (!f) return f; setDirty(true); return { ...f, dictation: f.dictation ? `${f.dictation.trimEnd()} ${text}` : text }; }),
  );

  // Don't lose unsaved writing.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state === "blocked") {
      if (confirm("You have unsaved changes. Leave without saving?")) blocker.proceed(); else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // When the app auto-locks for inactivity, save the draft first.
  const saveRef = useRef<() => Promise<unknown>>(async () => null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    const h = () => { if (dirtyRef.current) void saveRef.current(); };
    window.addEventListener(LOCK_EVENT, h);
    return () => window.removeEventListener(LOCK_EVENT, h);
  }, []);

  if (error && !session) return <ErrorText error={error} />;
  if (!session || !form) return <Loading />;

  const signed = session.note_status === "signed";
  const name = client ? client.preferred_name || client.full_name : "";

  async function save(): Promise<Session | null> {
    if (!form) return null;
    setSaving(true); setError(null);
    try {
      const body: Partial<Session> = signed
        ? { private_note: form.private_note || null }
        : {
            status: form.status, mood_rating: form.mood_rating, dictation: form.dictation || null,
            data: form.data || null, assessment: form.assessment || null, plan: form.plan || null,
            interventions: form.interventions || null, homework: form.homework || null,
            risk_check: form.risk_check || null, private_note: form.private_note || null,
          };
      const s = await api.updateSession(id, body);
      setSession(s); setForm(toForm(s)); setDirty(false);
      return s;
    } catch (e) { setError((e as Error).message); return null; } finally { setSaving(false); }
  }
  saveRef.current = save;

  async function draft() {
    if (!form) return;
    if (dict.listening) dict.stop();
    setDrafting(true); setError(null); setDraftInfo(null);
    try {
      const d = await api.aiDraft(id, form.dictation);
      const filled = SECTIONS.filter((s) => form[s.key].trim()).map((s) => s.label);
      if (filled.length && !confirm(`Replace what's already in ${filled.join(", ")} with the new draft?`)) return;
      set({
        data: d.data, assessment: d.assessment, plan: d.plan, interventions: d.interventions, homework: d.homework,
        risk_check: d.risk_indicators.length ? d.risk_indicators.join("\n") : form.risk_check,
        status: form.status === "scheduled" ? "attended" : form.status,
      });
      setDraftInfo(d);
    } catch (e) { setError((e as Error).message); } finally { setDrafting(false); }
  }

  async function sign() {
    setConfirmSign(false);
    const s = dirty ? await save() : session;
    if (!s) return;
    try {
      const signedS = await api.signSession(id);
      setSession(signedS); setForm(toForm(signedS)); setDirty(false); setDraftInfo(null);
    } catch (e) { setError((e as Error).message); }
  }

  async function remove() {
    if (!confirm("Delete this session and its draft note?")) return;
    await api.deleteSession(id);
    setDirty(false);
    nav(`/clients/${session!.client_id}?tab=sessions`);
  }

  async function addAddendum() {
    if (!addendum.trim()) return;
    try { const s = await api.addAddendum(id, addendum.trim()); setSession(s); setAddendum(""); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <div>
      <Link to={`/clients/${session.client_id}?tab=sessions`} className="text-sm text-muted hover:text-ink">{name || "Client"}</Link>
      <header className="mt-2 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">Session with {name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-3 text-muted">
            <span>{fmtDate(session.scheduled_at, true)}, {session.duration_min} min</span>
            {signed ? <StatusTag tone="pine">Signed {fmtDate(session.signed_at)}</StatusTag> : <StatusTag tone="flag">Draft</StatusTag>}
          </p>
        </div>
        {!signed ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-quiet" onClick={save} disabled={saving || !dirty}>{saving ? "Saving…" : dirty ? "Save draft" : "Saved"}</button>
            <button className="btn btn-primary" onClick={() => setConfirmSign(true)}>Sign note</button>
          </div>
        ) : (
          <Link className="btn btn-quiet" to={`/print/session/${id}`}>Print or save as PDF</Link>
        )}
      </header>

      <ErrorText error={error} />

      {signed ? (
        <div className="grid gap-10 lg:grid-cols-[3fr_2fr]">
          <article className="rounded-lg bg-paper p-6 ring-1 ring-line">
            {session.mood_rating && <p className="mb-4 text-sm text-muted">Client's mood: {session.mood_rating}/10</p>}
            {SECTIONS.map((s) => (
              <section key={s.key} className="mb-5 last:mb-0">
                <h2 className="text-sm font-bold text-muted">{s.label}</h2>
                <p className="note-text mt-0.5 whitespace-pre-wrap">{session[s.key] || "—"}</p>
              </section>
            ))}
            {session.addenda.length > 0 && (
              <div className="mt-6 border-t border-line pt-4">
                {session.addenda.map((a) => (
                  <div key={a.id} className="mb-3">
                    <p className="text-sm font-bold text-muted">Addendum, {fmtDate(a.created_at, true)}</p>
                    <p className="note-text whitespace-pre-wrap">{a.text}</p>
                  </div>
                ))}
              </div>
            )}
          </article>
          <aside className="space-y-8">
            <section>
              <h2 className="font-bold">Add an addendum</h2>
              <p className="text-sm text-muted">Signed notes can't be edited. Add corrections or later information here.</p>
              <textarea className="field note-text mt-2" rows={4} value={addendum} onChange={(e) => setAddendum(e.target.value)} />
              <button className="btn btn-quiet mt-2" onClick={addAddendum} disabled={!addendum.trim()}>Add addendum</button>
            </section>
            <PrivateNote value={form.private_note} onChange={(v) => set({ private_note: v })} onSave={save} dirty={dirty} saving={saving} />
          </aside>
        </div>
      ) : (
        <div className="grid gap-10 lg:grid-cols-[2fr_3fr]">
          {/* Left: get the session out of your head */}
          <section className="lg:sticky lg:top-6 lg:self-start">
            <h2 className="font-serif text-2xl">Your notes</h2>
            <p className="mt-1 text-sm text-muted">Talk or type freely about the session. Then turn it into a structured note.</p>

            <div className="mt-3 rounded-lg bg-paper ring-1 ring-line focus-within:ring-2 focus-within:ring-pine/40">
              <textarea
                ref={dictRef}
                className="note-text block min-h-56 w-full resize-y rounded-t-lg bg-transparent p-4 outline-none"
                placeholder="She arrived a little late, said the week was better. Slept well most nights after trying the wind-down routine…"
                value={form.dictation}
                onChange={(e) => set({ dictation: e.target.value })}
                aria-label="Your notes"
              />
              {dict.interim && <p className="px-4 pb-2 text-sm italic text-muted">{dict.interim}</p>}
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
                {dict.supported ? (
                  <button
                    className={`btn ${dict.listening ? "btn-danger" : "btn-quiet"}`}
                    onClick={() => (dict.listening ? dict.stop() : dict.start())}
                    aria-pressed={dict.listening}
                  >
                    <span aria-hidden className={`size-2.5 rounded-full ${dict.listening ? "animate-pulse bg-risk" : "bg-pine"}`} />
                    {dict.listening ? "Stop dictating" : "Dictate"}
                  </button>
                ) : (
                  <span className="text-xs text-muted">Dictation works in Chrome, Edge and Safari.</span>
                )}
                <button
                  className="btn btn-primary ml-auto"
                  onClick={draft}
                  disabled={drafting || form.dictation.trim().length < 10 || (client ? !client.consent_ai : false)}
                >
                  {drafting ? "Drafting…" : "Draft the note"}
                </button>
              </div>
            </div>
            {dict.error && <p className="mt-2 text-sm text-risk">{dict.error}</p>}
            {client && !client.consent_ai && (
              <p className="mt-2 text-sm text-flag">
                AI drafting is off for this client: no consent recorded.{" "}
                <Link className="underline" to={`/clients/${client.id}?tab=profile`}>Update consent</Link>
              </p>
            )}
            <p className="mt-2 text-xs text-muted">
              Dictation uses your browser's speech service. Drafting sends only these notes, never the client's name.
            </p>

            {draftInfo && (
              <div className="mt-4 space-y-2">
                {draftInfo.message && <p className="rounded-md bg-flag-soft px-3 py-2 text-sm text-flag">{draftInfo.message}</p>}
                {draftInfo.ai_used && !draftInfo.message && (
                  <p className="rounded-md bg-sage px-3 py-2 text-sm text-pine-deep">Draft ready. Read it through and correct anything before signing.</p>
                )}
                {draftInfo.risk_indicators.length > 0 && (
                  <div className="rounded-md border-l-4 border-risk bg-risk-soft px-3 py-2 text-sm">
                    <p className="font-bold text-risk">Risk mentioned. Copied into Risk check.</p>
                    <ul className="mt-1 list-disc pl-5">{draftInfo.risk_indicators.map((r, i) => <li key={i}>{r}</li>)}</ul>
                    {client && client.risk_level === "none" && (
                      <Link className="mt-1 inline-block underline" to={`/clients/${client.id}?tab=profile`}>Review the client's risk level</Link>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Right: the record */}
          <section>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Session">
                <select className="field" value={form.status} onChange={(e) => set({ status: e.target.value as Session["status"] })}>
                  <option value="scheduled">Scheduled</option>
                  <option value="attended">Attended</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="no_show">No-show</option>
                </select>
              </Field>
              <Field label="Client's mood today" hint="Their own rating, 1 is lowest.">
                <div className="flex gap-1" role="radiogroup" aria-label="Mood rating">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n} type="button" role="radio" aria-checked={form.mood_rating === n}
                      onClick={() => set({ mood_rating: form.mood_rating === n ? null : n })}
                      className={`h-9 flex-1 rounded text-sm tabular-nums ${
                        form.mood_rating === n ? "bg-pine font-bold text-white" : "bg-paper ring-1 ring-line hover:bg-sage"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            <div className="mt-6 space-y-5">
              {SECTIONS.map((s) => (
                <Field key={s.key} label={s.label} hint={s.hint}>
                  <textarea
                    className={`field note-text ${s.key === "risk_check" && form.risk_check ? "border-risk/50" : ""}`}
                    rows={s.key === "data" || s.key === "assessment" ? 5 : 3}
                    value={form[s.key]}
                    onChange={(e) => set({ [s.key]: e.target.value } as Partial<Form>)}
                  />
                </Field>
              ))}
            </div>

            <div className="mt-8">
              <PrivateNote value={form.private_note} onChange={(v) => set({ private_note: v })} />
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <button className="btn btn-quiet" onClick={save} disabled={saving || !dirty}>{saving ? "Saving…" : dirty ? "Save draft" : "Saved"}</button>
              <button className="btn btn-primary" onClick={() => setConfirmSign(true)}>Sign note</button>
              <button className="ml-auto text-sm text-muted hover:text-risk" onClick={remove}>Delete session</button>
            </div>
          </section>
        </div>
      )}

      <Modal open={confirmSign} onClose={() => setConfirmSign(false)} title="Sign this note?">
        <p className="max-w-prose">
          Once signed, the note becomes part of the client's record and can't be edited. You can still add an addendum later.
        </p>
        {!form.risk_check.trim() && form.status === "attended" && (
          <p className="mt-3 rounded-md bg-flag-soft px-3 py-2 text-sm text-flag">The risk check is empty. Consider noting it, even if risk was denied.</p>
        )}
        <div className="mt-5 flex gap-2">
          <button className="btn btn-primary" onClick={sign}>Sign note</button>
          <button className="btn btn-quiet" onClick={() => setConfirmSign(false)}>Keep editing</button>
        </div>
      </Modal>
    </div>
  );
}

function PrivateNote({ value, onChange, onSave, dirty, saving }: {
  value: string; onChange: (v: string) => void; onSave?: () => void; dirty?: boolean; saving?: boolean;
}) {
  return (
    <section className="rounded-lg border border-dashed border-line p-4">
      <h2 className="font-bold">Private reflections</h2>
      <p className="text-sm text-muted">Only for you. Not part of the record, never exported, never sent to AI.</p>
      <textarea className="field note-text mt-2" rows={3} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Private reflections" />
      {onSave && (
        <button className="btn btn-quiet mt-2" onClick={onSave} disabled={saving || !dirty}>{saving ? "Saving…" : dirty ? "Save" : "Saved"}</button>
      )}
    </section>
  );
}
