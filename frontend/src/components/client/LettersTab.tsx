import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth";
import type { Client, Letter, LetterKind } from "../../types";
import { ErrorText, Field, fmtDate, Loading, Modal } from "../ui";

export const LETTER_KINDS: Record<LetterKind, { label: string; help: string }> = {
  attendance: { label: "Confirmation of attendance", help: "Confirms the client attended sessions, without disclosing content. For an employer, school or court." },
  referral: { label: "Referral letter", help: "Refers the client to a doctor, psychiatrist or another service." },
  general: { label: "Other letter", help: "A blank letter on your letterhead." },
};

export default function LettersTab({ client }: { client: Client }) {
  const nav = useNavigate();
  const { me } = useAuth();
  const [rows, setRows] = useState<Letter[] | null>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LetterKind>("attendance");
  const [recipient, setRecipient] = useState("");
  const [reason, setReason] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.letters(client.id).then(setRows).catch((e) => setError(e.message)); }, [client.id]);

  const aiPossible = kind === "referral" && !!me?.ai_available && client.consent_ai;

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const d = await api.draftLetter(client.id, {
        kind, recipient: recipient.trim() || undefined, reason: reason.trim() || undefined, use_ai: aiPossible && useAi,
      });
      const l = await api.createLetter(client.id, { kind, recipient: recipient.trim() || null, subject: d.subject, body: d.body });
      nav(`/letters/${l.id}${d.message ? `?note=${encodeURIComponent(d.message)}` : d.ai_used ? "?ai=1" : ""}`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={() => setOpen(true)}>Write a letter</button>
        <Link className="btn btn-quiet" to={`/print/client/${client.id}`}>Print client summary</Link>
      </div>
      <ErrorText error={error} />
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <p className="text-muted">No letters yet. Letters are written on your letterhead and kept here.</p>}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-paper">
          {rows.map((l) => (
            <li key={l.id}>
              <Link to={`/letters/${l.id}`} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 hover:bg-sage/50">
                <span>
                  <span className="font-serif text-lg">{l.subject || LETTER_KINDS[l.kind].label}</span>
                  {l.recipient && <span className="ml-2 text-sm text-muted">to {l.recipient.split("\n")[0]}</span>}
                </span>
                <span className="text-sm tabular-nums text-muted">{fmtDate(l.updated_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Write a letter">
        <form onSubmit={create} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-bold">Type of letter</legend>
            {(Object.keys(LETTER_KINDS) as LetterKind[]).map((k) => (
              <label key={k} className={`block cursor-pointer rounded-md border px-3 py-2 ${kind === k ? "border-pine bg-sage" : "border-line"}`}>
                <input type="radio" name="kind" className="sr-only" checked={kind === k} onChange={() => setKind(k)} />
                <span className="font-bold">{LETTER_KINDS[k].label}</span>
                <span className="block text-sm text-muted">{LETTER_KINDS[k].help}</span>
              </label>
            ))}
          </fieldset>
          <Field label="To" hint="Name on the first line, then organisation and address. Leave empty for 'To whom it may concern'.">
            <textarea className="field" rows={3} value={recipient} onChange={(e) => setRecipient(e.target.value)} />
          </Field>
          {kind !== "general" && (
            <Field label={kind === "referral" ? "Reason for referral" : "Anything to add (optional)"}>
              <textarea className="field" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          {kind === "referral" && (
            aiPossible ? (
              <label className="flex items-start gap-2.5">
                <input type="checkbox" className="mt-1 size-4 accent-pine" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
                <span>Draft the summary from signed notes with AI <span className="block text-sm text-muted">The client's name is never sent; you review everything before printing.</span></span>
              </label>
            ) : (
              <p className="text-xs text-muted">{!me?.ai_available ? "AI isn't available for your organisation, so you'll start from a template." : "This client hasn't consented to AI, so you'll start from a template."}</p>
            )
          )}
          <button className="btn btn-primary" disabled={busy}>{busy ? "Preparing draft…" : "Start the letter"}</button>
        </form>
      </Modal>
    </div>
  );
}
