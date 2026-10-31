import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { GENDERS, ROLES } from "../lib/africa";
import LanguageList from "./LanguageList";
import { isSupervisor } from "../lib/roles";
import type { Client, Member, Programme } from "../types";
import { ErrorText, Field } from "./ui";

function ageOf(dob: string) {
  if (!dob) return null;
  const b = new Date(dob), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--;
  return a;
}

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
    programme_id: initial.programme_id ? String(initial.programme_id) : "",
    therapist_id: initial.therapist_id ? String(initial.therapist_id) : "",
    gender: initial.gender ?? "",
    location: initial.location ?? "",
    referral_source: initial.referral_source ?? "",
    guardian_name: initial.guardian_name ?? "",
    guardian_phone: initial.guardian_phone ?? "",
    guardian_consent: initial.guardian_consent ?? false,
    restricted: initial.restricted ?? false,
    unhcr_case_no: initial.unhcr_case_no ?? "",
    primero_case_id: initial.primero_case_id ?? "",
    settlement: initial.settlement ?? "",
    block: initial.block ?? "",
    preferred_language: initial.preferred_language ?? "",
    interpreter_needed: initial.interpreter_needed ?? false,
  });
  const hasField = !!(initial.unhcr_case_no || initial.primero_case_id || initial.settlement || initial.block
    || initial.preferred_language || initial.interpreter_needed);
  const { me } = useAuth();
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [team, setTeam] = useState<Member[]>([]);
  useEffect(() => {
    api.programmes().then((p) => setProgrammes(p.filter((x) => x.active || String(x.id) === v.programme_id))).catch(() => {});
    if (isSupervisor(me)) api.team().then((t) => setTeam(t.filter((m) => m.active && m.role !== "me_officer"))).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const age = ageOf(v.date_of_birth);
  const minor = age !== null && age < 18;
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
        programme_id: v.programme_id ? Number(v.programme_id) : null,
        therapist_id: v.therapist_id ? Number(v.therapist_id) : undefined,
        gender: (v.gender || null) as Client["gender"],
        location: empty(v.location),
        referral_source: empty(v.referral_source),
        guardian_name: empty(v.guardian_name),
        guardian_phone: empty(v.guardian_phone),
        unhcr_case_no: empty(v.unhcr_case_no),
        primero_case_id: empty(v.primero_case_id),
        settlement: empty(v.settlement),
        block: empty(v.block),
        preferred_language: empty(v.preferred_language),
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
        <Field label="Gender">
          <select className="field" value={v.gender} onChange={(e) => set("gender", e.target.value)}>
            <option value="">Not recorded</option>
            {Object.entries(GENDERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Emergency contact"><input className="field" {...text("emergency_contact_name")} /></Field>
        <Field label="Emergency contact phone"><input className="field" type="tel" {...text("emergency_contact_phone")} /></Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <Field label="Programme">
          <select className="field" value={v.programme_id} onChange={(e) => set("programme_id", e.target.value)}>
            <option value="">None</option>
            {programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Location" hint="County, area or school. Used in anonymised reports.">
          <input className="field" {...text("location")} />
        </Field>
        <Field label="Referred by" hint="e.g. teacher, self, health facility, chief, CHV">
          <input className="field" {...text("referral_source")} />
        </Field>
        {team.length > 0 && (
          <Field label="Counsellor">
            <select className="field" value={v.therapist_id} onChange={(e) => set("therapist_id", e.target.value)}>
              <option value="">{full ? "Unchanged" : "Me"}</option>
              {team.map((m) => <option key={m.id} value={m.id}>{m.name} ({ROLES[m.role]?.label})</option>)}
            </select>
          </Field>
        )}
      </fieldset>

      <details className="rounded-lg border border-line px-4 py-3" open={hasField}>
        <summary className="cursor-pointer font-bold">Field and humanitarian details <span className="font-normal text-muted">(optional)</span></summary>
        <p className="mt-1 text-sm text-muted">Links this record to agency systems such as UNHCR's proGres or Primero, without replacing them. Don't record legal or immigration status here.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="UNHCR case or individual number"><input className="field" {...text("unhcr_case_no")} /></Field>
          <Field label="Primero / CPIMS+ case ID"><input className="field" {...text("primero_case_id")} /></Field>
          <Field label="Camp, settlement or village"><input className="field" {...text("settlement")} /></Field>
          <Field label="Block, zone or section"><input className="field" {...text("block")} /></Field>
          <Field label="Preferred language" hint="e.g. Kiswahili, Somali, Arabic, Kinyarwanda">
            <input className="field" list="kumbuka-languages" {...text("preferred_language")} />
          </Field>
          <label className="flex items-center gap-2.5 self-end pb-2">
            <input type="checkbox" className="size-4 accent-pine" checked={v.interpreter_needed} onChange={(e) => set("interpreter_needed", e.target.checked)} />
            <span>Needs an interpreter</span>
          </label>
        </div>
        <LanguageList />
      </details>

      {minor && (
        <fieldset className="space-y-3 rounded-lg border border-flag/40 bg-flag-soft/40 p-4">
          <legend className="px-1 text-sm font-bold">Under 18: parent or guardian</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Guardian's name"><input className="field" {...text("guardian_name")} /></Field>
            <Field label="Guardian's phone"><input className="field" type="tel" {...text("guardian_phone")} /></Field>
          </div>
          <label className="flex items-start gap-2.5">
            <input type="checkbox" className="mt-1 size-4 accent-pine" checked={v.guardian_consent} onChange={(e) => set("guardian_consent", e.target.checked)} />
            <span>Guardian consent recorded<span className="block text-sm text-muted">Or note in Background why counselling went ahead without it (e.g. safeguarding).</span></span>
          </label>
        </fieldset>
      )}

      <fieldset className="space-y-4">
        <Field label="Why they came" hint="The presenting concern, in their words where possible.">
          <textarea className="field note-text" rows={3} {...text("presenting_concern")} />
        </Field>
        <Field label="Background" hint="Relevant history: family, work or school, health, previous counselling.">
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

      <label className="flex items-start gap-2.5">
        <input type="checkbox" className="mt-1 size-4 accent-pine" checked={v.restricted} onChange={(e) => set("restricted", e.target.checked)} />
        <span>
          Restricted case
          <span className="block text-sm text-muted">Only the assigned counsellor and their supervisor can open it, not other admins. Use for GBV, abuse or staff-related cases.</span>
        </span>
      </label>

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
