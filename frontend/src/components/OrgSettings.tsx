import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { COUNTRIES, ORG_KINDS } from "../lib/africa";
import type { CrisisContact, Org, OrgKind, Programme } from "../types";
import { ErrorText, Field } from "./ui";

export function OrgDetails() {
  const { me, setMe } = useAuth();
  const [org, setOrg] = useState<Org | null>(me?.organization ?? null);
  const [contacts, setContacts] = useState<CrisisContact[]>(me?.organization?.crisis_contacts ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!org || !me) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null); setSaved(false);
    try {
      const body = org!.is_demo
        ? { country: org!.country, review_all_notes: org!.review_all_notes, crisis_contacts: contacts.filter((c) => c.name && c.number) }
        : { name: org!.name, kind: org!.kind, country: org!.country, review_all_notes: org!.review_all_notes,
            crisis_contacts: contacts.filter((c) => c.name && c.number) };
      const updated = await api.updateOrg(body);
      setOrg(updated);
      setMe({ ...me!, organization: updated });
      setSaved(true);
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Organisation name">
        <input className="field" value={org.name} disabled={org.is_demo} onChange={(e) => setOrg({ ...org, name: e.target.value })} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          <select className="field" value={org.kind} disabled={org.is_demo} onChange={(e) => setOrg({ ...org, kind: e.target.value as OrgKind })}>
            {Object.entries(ORG_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Country" hint="Used for phone numbers and default crisis lines.">
          <select className="field" value={org.country} onChange={(e) => setOrg({ ...org, country: e.target.value })}>
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <label className="flex items-start gap-2.5">
        <input type="checkbox" className="mt-1 size-4 accent-pine" checked={org.review_all_notes}
          onChange={(e) => setOrg({ ...org, review_all_notes: e.target.checked })} />
        <span>
          Supervisors co-sign every counsellor's notes
          <span className="block text-sm text-muted">Lay counsellors' notes are always co-signed. Turn this on for trainee-heavy teams.</span>
        </span>
      </label>

      <fieldset className="rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-bold">Crisis lines shown to clients</legend>
        <p className="text-sm text-muted">
          Clients see these after a check-in, and prominently if they report thoughts of self-harm.
          {org.country === "KE" ? " Leave empty to use the built-in Kenyan lines (999/112, Red Cross 1199, Befrienders Kenya)." : " Please add your country's emergency and support numbers."}
        </p>
        <ul className="mt-3 space-y-2">
          {contacts.map((c, i) => (
            <li key={i} className="grid gap-2 sm:grid-cols-[1fr_10rem_1fr_auto]">
              <input className="field" placeholder="Name, e.g. Childline" value={c.name} aria-label="Line name"
                onChange={(e) => setContacts(contacts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className="field" placeholder="Number" value={c.number} aria-label="Number"
                onChange={(e) => setContacts(contacts.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))} />
              <input className="field" placeholder="Note, e.g. Free, 24 hours" value={c.note ?? ""} aria-label="Note"
                onChange={(e) => setContacts(contacts.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
              <button type="button" className="text-sm text-muted hover:text-risk" onClick={() => setContacts(contacts.filter((_, j) => j !== i))}>Remove</button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-quiet mt-3" onClick={() => setContacts([...contacts, { name: "", number: "", note: "" }])}>Add a line</button>
      </fieldset>

      <ErrorText error={error} />
      <div className="flex items-center gap-3">
        <button className="btn btn-primary">Save organisation</button>
        {saved && <span className="text-sm text-pine">Saved</span>}
      </div>
    </form>
  );
}

export function Programmes() {
  const [rows, setRows] = useState<Programme[]>([]);
  const [draft, setDraft] = useState({ name: "", location: "", funder: "" });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.programmes().then(setRows).catch((e) => setError(e.message)); }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      const p = await api.createProgramme({ name: draft.name, location: draft.location || null, funder: draft.funder || null });
      setRows([...rows, p]);
      setDraft({ name: "", location: "", funder: "" });
    } catch (err) { setError((err as Error).message); }
  }
  async function toggle(p: Programme) {
    const u = await api.updateProgramme(p.id, { active: !p.active });
    setRows(rows.map((x) => (x.id === p.id ? u : x)));
  }

  return (
    <div className="space-y-4">
      {rows.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-paper text-sm">
          {rows.map((p) => (
            <li key={p.id} className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 ${p.active ? "" : "opacity-60"}`}>
              <span className="font-bold">{p.name}</span>
              {p.location && <span className="text-muted">{p.location}</span>}
              {p.funder && <span className="text-muted">Funded by {p.funder}</span>}
              <button className="ml-auto text-xs text-muted hover:text-ink" onClick={() => toggle(p)}>{p.active ? "Archive" : "Restore"}</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
        <input className="field" placeholder="Programme name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required aria-label="Programme name" />
        <input className="field" placeholder="Site or county" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} aria-label="Location" />
        <input className="field" placeholder="Funder (optional)" value={draft.funder} onChange={(e) => setDraft({ ...draft, funder: e.target.value })} aria-label="Funder" />
        <button className="btn btn-primary justify-center">Add</button>
      </form>
      <ErrorText error={error} />
    </div>
  );
}
