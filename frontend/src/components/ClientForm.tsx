import { useState, type FormEvent } from "react";
import type { Client } from "../types";
import { ErrorText, Field } from "./ui";

type Props = {
  initial?: Partial<Client>;
  submitLabel: string;
  onSubmit: (values: Partial<Client>) => Promise<void>;
  full?: boolean; // show risk + status fields (profile tab)
};

const empty = (v: string) => (v.trim() === "" ? null : v.trim());

export default function ClientForm({ initial = {}, submitLabel, onSubmit, full }: Props) {
  const [v, setV] = useState({
    full_name: initial.full_name ?? "",
    preferred_name: initial.preferred_name ?? "",
    date_of_birth: initial.date_of_birth ?? "",
    phone: initial.phone ?? "",
    email: initial.email ?? "",
    emergency_contact_name: initial.emergency_contact_name ?? "",
    emergency_contact_phone: initial.emergency_contact_phone ?? "",
    presenting_concern: initial.presenting_concern ?? "",
    background: initial.background ?? "",
    consent_signed: initial.consent_signed ?? false,
    consent_ai: initial.consent_ai ?? false,
    risk_level: initial.risk_level ?? "none",
    risk_notes: initial.risk_notes ?? "",
    status: initial.status ?? "active",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => { setV({ ...v, [k]: val }); setSaved(false); };
  const text = (k: keyof typeof v) => ({
    value: v[k] as string,
    onChange: (e: { target: { value: string } }) => set(k, e.target.value as never),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        ...v,
        full_name: v.full_name.trim(),
        preferred_name: empty(v.preferred_name),
        date_of_birth: empty(v.date_of_birth),
        phone: empty(v.phone),
        email: empty(v.email),
        emergency_contact_name: empty(v.emergency_contact_name),
        emergency_contact_phone: empty(v.emergency_contact_phone),
        presenting_concern: empty(v.presenting_concern),
        background: empty(v.background),
        risk_notes: empty(v.risk_notes),
      } as Partial<Client>);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name"><input className="field" required {...text("full_name")} /></Field>
        <Field label="Preferred name" hint="What they like to be called."><input className="field" {...text("preferred_name")} /></Field>
        <Field label="Date of birth"><input className="field" type="date" {...text("date_of_birth")} /></Field>
        <Field label="Phone"><input className="field" type="tel" {...text("phone")} /></Field>
        <Field label="Email"><input className="field" type="email" {...text("email")} /></Field>
        <span className="hidden sm:block" />
        <Field label="Emergency contact"><input className="field" {...text("emergency_contact_name")} /></Field>
        <Field label="Emergency contact phone"><input className="field" type="tel" {...text("emergency_contact_phone")} /></Field>
      </fieldset>

      <fieldset className="space-y-4">
        <Field label="Why they came" hint="The presenting concern, in their words where possible.">
          <textarea className="field note-text" rows={3} {...text("presenting_concern")} />
        </Field>
        <Field label="Background" hint="Relevant history: family, work or school, health, previous counseling.">
          <textarea className="field note-text" rows={4} {...text("background")} />
        </Field>
      </fieldset>

      <fieldset className="space-y-2 rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-bold">Consent</legend>
        <label className="flex items-start gap-2.5">
          <input type="checkbox" className="mt-1 size-4 accent-pine" checked={v.consent_signed} onChange={(e) => set("consent_signed", e.target.checked)} />
          <span>Informed consent signed, including the limits of confidentiality</span>
        </label>
        <label className="flex items-start gap-2.5">
          <input type="checkbox" className="mt-1 size-4 accent-pine" checked={v.consent_ai} onChange={(e) => set("consent_ai", e.target.checked)} />
          <span>
            Agrees to AI-assisted notes
            <span className="block text-sm text-muted">Session notes are drafted by an AI service. Names and contact details are never sent to it.</span>
          </span>
        </label>
      </fieldset>

      {full && (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <Field label="Risk level">
            <select className="field" value={v.risk_level} onChange={(e) => set("risk_level", e.target.value as never)}>
              <option value="none">None identified</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Field>
          <Field label="Status">
            <select className="field" value={v.status} onChange={(e) => set("status", e.target.value as never)}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="closed">Closed</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Risk notes" hint="What the risk is, the safety plan, and who to contact.">
              <textarea className="field note-text" rows={3} {...text("risk_notes")} />
            </Field>
          </div>
        </fieldset>
      )}

      <ErrorText error={error} />
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
        {saved && full && <span className="text-sm text-pine">Saved</span>}
      </div>
    </form>
  );
}
