import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { LETTER_KINDS } from "../components/client/LettersTab";
import { ErrorText, Field, fmtDate, Loading } from "../components/ui";
import type { Client, Letter } from "../types";

export default function LetterEditor() {
  const id = Number(useParams().id);
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [letter, setLetter] = useState<Letter | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [v, setV] = useState({ recipient: "", subject: "", body: "" });
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.letter(id).then((l) => {
      setLetter(l);
      setV({ recipient: l.recipient ?? "", subject: l.subject ?? "", body: l.body });
      api.client(l.client_id).then(setClient).catch(() => {});
    }).catch((e) => setError(e.message));
  }, [id]);

  if (error && !letter) return <ErrorText error={error} />;
  if (!letter) return <Loading />;

  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => { setV({ ...v, [k]: e.target.value }); setDirty(true); };

  async function save(): Promise<boolean> {
    setSaving(true); setError(null);
    try {
      setLetter(await api.updateLetter(id, { recipient: v.recipient || null, subject: v.subject || null, body: v.body }));
      setDirty(false);
      return true;
    } catch (e) { setError((e as Error).message); return false; } finally { setSaving(false); }
  }

  async function print() {
    if (dirty && !(await save())) return;
    nav(`/print/letter/${id}`);
  }

  async function remove() {
    if (!confirm("Delete this letter?")) return;
    await api.deleteLetter(id);
    nav(`/clients/${letter!.client_id}?tab=letters`);
  }

  return (
    <div className="max-w-3xl">
      <Link to={`/clients/${letter.client_id}?tab=letters`} className="text-sm text-muted hover:text-ink">
        {client ? client.preferred_name || client.full_name : "Client"}
      </Link>
      <header className="mt-2 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">{LETTER_KINDS[letter.kind].label}</h1>
          <p className="mt-1 text-muted">Last saved {fmtDate(letter.updated_at, true)}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-quiet" onClick={save} disabled={saving || !dirty}>{saving ? "Saving…" : dirty ? "Save" : "Saved"}</button>
          <button className="btn btn-primary" onClick={print}>Preview and print</button>
        </div>
      </header>

      {params.get("ai") && <p className="mb-4 rounded-md bg-sage px-3 py-2 text-sm text-pine-deep">Drafted with AI from signed notes. Check every sentence before sending.</p>}
      {params.get("note") && <p className="mb-4 rounded-md bg-flag-soft px-3 py-2 text-sm text-flag">{params.get("note")}</p>}
      <p className="mb-6 text-sm text-muted">Replace anything in [square brackets] before printing. Share only what the recipient needs.</p>

      <div className="space-y-5">
        <Field label="To"><textarea className="field" rows={3} value={v.recipient} onChange={set("recipient")} /></Field>
        <Field label="Subject"><input className="field" value={v.subject} onChange={set("subject")} /></Field>
        <Field label="Letter"><textarea className="field note-text" rows={18} value={v.body} onChange={set("body")} /></Field>
      </div>
      <ErrorText error={error} />
      <div className="mt-6 flex items-center gap-2 border-t border-line pt-4">
        <button className="btn btn-quiet" onClick={save} disabled={saving || !dirty}>{saving ? "Saving…" : dirty ? "Save" : "Saved"}</button>
        <button className="btn btn-primary" onClick={print}>Preview and print</button>
        <button className="ml-auto text-sm text-muted hover:text-risk" onClick={remove}>Delete letter</button>
      </div>
    </div>
  );
}
