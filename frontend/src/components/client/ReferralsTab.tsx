import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { REFERRAL_STATUS, SERVICES } from "../../lib/africa";
import type { Referral } from "../../types";
import { ErrorText, Field, fmtDate, Loading, Modal, StatusTag } from "../ui";

const tone = (r: Referral) =>
  r.overdue ? "risk" : r.status === "attended" ? "pine" : ["not_attended", "declined"].includes(r.status) ? "flag" : "muted";

export function ReferralRow({ r, showClient, onChange }: { r: Referral; showClient?: boolean; onChange: (r: Referral) => void }) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(r.status);
  const [outcome, setOutcome] = useState(r.outcome ?? "");
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    try { onChange(await api.updateReferral(r.id, { status, outcome: outcome || null })); setEditing(false); }
    catch (err) { setError((err as Error).message); }
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {showClient && <Link to={`/clients/${r.client_id}?tab=referrals`} className="font-serif text-lg hover:underline">{r.client_name}</Link>}
        <span className="font-bold">{SERVICES[r.service] ?? r.service}</span>
        {r.to_organisation && <span className="text-muted">to {r.to_organisation}</span>}
        <StatusTag tone={tone(r)}>{r.overdue ? "Follow-up overdue" : REFERRAL_STATUS[r.status]}</StatusTag>
        {r.urgency !== "routine" && <StatusTag tone="risk">{r.urgency}</StatusTag>}
        <span className="ml-auto text-sm tabular-nums text-muted">{fmtDate(r.referred_on)}</span>
      </div>
      {r.reason && <p className="mt-1 text-sm text-ink/80">{r.reason}</p>}
      {r.outcome && <p className="mt-1 text-sm"><span className="text-muted">Outcome:</span> {r.outcome}</p>}
      {r.follow_up_on && ["made", "accepted"].includes(r.status) && (
        <p className="mt-1 text-xs text-muted">Follow up by {fmtDate(r.follow_up_on)}</p>
      )}
      {editing ? (
        <form onSubmit={save} className="mt-2 grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
          <select className="field" value={status} onChange={(e) => setStatus(e.target.value as Referral["status"])} aria-label="Status">
            {Object.entries(REFERRAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input className="field" placeholder="What happened?" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome" />
          <button className="btn btn-primary">Save</button>
          <ErrorText error={error} />
        </form>
      ) : (
        <button className="mt-1 text-sm text-pine underline underline-offset-2" onClick={() => setEditing(true)}>Update follow-up</button>
      )}
    </li>
  );
}

export default function ReferralsTab({ clientId }: { clientId: number }) {
  const [rows, setRows] = useState<Referral[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ service: "medical", to_organisation: "", to_contact: "", reason: "", urgency: "routine" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.clientReferrals(clientId).then(setRows).catch((e) => setError(e.message)); }, [clientId]);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api.createReferral(clientId, {
        service: form.service, to_organisation: form.to_organisation || null, to_contact: form.to_contact || null,
        reason: form.reason || null, urgency: form.urgency as Referral["urgency"],
      });
      setRows([r, ...(rows ?? [])]);
      setOpen(false);
      setForm({ service: "medical", to_organisation: "", to_contact: "", reason: "", urgency: "routine" });
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" onClick={() => setOpen(true)}>Make a referral</button>
        <span className="text-sm text-muted">Record where you referred the client, then confirm whether they got there.</span>
      </div>
      <ErrorText error={error} />
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <p className="text-muted">No referrals yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-paper">
          {rows.map((r) => <ReferralRow key={r.id} r={r} onChange={(u) => setRows(rows.map((x) => (x.id === u.id ? u : x)))} />)}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Make a referral">
        <form onSubmit={create} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Service">
              <select className="field" value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })}>
                {Object.entries(SERVICES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Urgency" hint="Sets the follow-up date: 1 day, 3 days or 2 weeks.">
              <select className="field" value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })}>
                <option value="routine">Routine</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option>
              </select>
            </Field>
          </div>
          <Field label="Referred to" hint="Facility, office or organisation."><input className="field" value={form.to_organisation} onChange={(e) => setForm({ ...form, to_organisation: e.target.value })} /></Field>
          <Field label="Contact person or number"><input className="field" value={form.to_contact} onChange={(e) => setForm({ ...form, to_contact: e.target.value })} /></Field>
          <Field label="Reason"><textarea className="field" rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
          <button className="btn btn-primary">Save referral</button>
        </form>
      </Modal>
    </div>
  );
}
