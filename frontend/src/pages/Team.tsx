import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorText, Field, fmtDate, Loading, Modal, StatusTag } from "../components/ui";
import { ROLES } from "../lib/africa";
import type { Invite, Member, Role } from "../types";

const SUPERVISING: Role[] = ["owner", "admin", "supervisor"];
const ASSIGNABLE: Role[] = ["admin", "supervisor", "counsellor", "lay_counsellor", "me_officer"];

export default function Team() {
  const { me } = useAuth();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [created, setCreated] = useState<{ url: string; message: string } | null>(null);
  const [form, setForm] = useState<{ email: string; name: string; role: Role; supervisor_id: string }>({
    email: "", name: "", role: "counsellor", supervisor_id: "",
  });
  const [transfer, setTransfer] = useState<Member | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const isDemo = !!me?.organization?.is_demo;

  const load = () => {
    api.team().then(setMembers).catch((e) => setError(e.message));
    api.invites().then(setInvites).catch(() => {});
  };
  useEffect(load, []);

  const supervisors = (members ?? []).filter((m) => m.active && SUPERVISING.includes(m.role));
  const nameOf = (id: number | null) => members?.find((m) => m.id === id)?.name ?? "—";

  async function change(m: Member, b: Parameters<typeof api.updateMember>[1]) {
    setError(null);
    try {
      const updated = await api.updateMember(m.id, b);
      setMembers((all) => all?.map((x) => (x.id === m.id ? updated : x)) ?? null);
    } catch (e) { setError((e as Error).message); }
  }

  async function sendInvite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.createInvite({
        email: form.email, name: form.name || undefined, role: form.role,
        supervisor_id: form.supervisor_id ? Number(form.supervisor_id) : null,
      });
      const url = `${window.location.origin}/join/${r.token}`;
      setCreated({
        url,
        message: `Hi${form.name ? " " + form.name.split(" ")[0] : ""}, you've been invited to join ${me?.organization?.name} on Kumbuka as ${ROLES[form.role].label}. Set your password here (the link expires in 7 days):\n${url}`,
      });
      setForm({ email: "", name: "", role: "counsellor", supervisor_id: "" });
      load();
    } catch (err) { setError((err as Error).message); }
  }

  async function doTransfer() {
    if (!transfer || !transferTo) return;
    try {
      const r = await api.transferCaseload(transfer.id, Number(transferTo));
      setTransfer(null); setTransferTo("");
      alert(`${r.moved} client${r.moved === 1 ? "" : "s"} moved.`);
      load();
    } catch (e) { setError((e as Error).message); }
  }

  if (!members && !error) return <Loading />;

  const pending = invites.filter((i) => i.status === "pending");

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">Team</h1>
          <p className="mt-1 text-muted">Who can see what depends on their role. Lay counsellors' notes go to their supervisor for co-signing.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setCreated(null); setInviting(true); }} disabled={isDemo}
          title={isDemo ? "Invites are switched off in the demo" : undefined}>Invite someone</button>
      </header>
      <ErrorText error={error} />

      <div className="overflow-x-auto rounded-lg border border-line bg-paper">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead className="border-b border-line text-muted">
            <tr>
              <th className="px-4 py-2.5 font-bold">Name</th>
              <th className="px-4 py-2.5 font-bold">Role</th>
              <th className="px-4 py-2.5 font-bold">Supervisor</th>
              <th className="px-4 py-2.5 font-bold">Active clients</th>
              <th className="px-4 py-2.5 font-bold"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {members?.map((m) => (
              <tr key={m.id} className={m.active ? "" : "opacity-55"}>
                <td className="px-4 py-3">
                  <span className="font-bold">{m.name}</span>
                  {m.id === me?.id && <span className="ml-2 text-xs text-muted">you</span>}
                  <span className="block text-xs text-muted">{m.email}</span>
                  {!m.active && <StatusTag>Deactivated</StatusTag>}
                  {m.active && !m.totp_enabled && !isDemo && <span className="mt-0.5 block text-xs text-flag">Two-step sign-in off</span>}
                </td>
                <td className="px-4 py-3">
                  {m.role === "owner" && me?.role !== "owner" ? ROLES.owner.label : (
                    <select className="field w-auto py-1" value={m.role} disabled={m.id === me?.id}
                      onChange={(e) => change(m, { role: e.target.value as Role })} aria-label={`Role for ${m.name}`}>
                      {(me?.role === "owner" ? (["owner", ...ASSIGNABLE] as Role[]) : ASSIGNABLE).map((r) => (
                        <option key={r} value={r}>{ROLES[r].label}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-4 py-3">
                  {m.role === "me_officer" || m.role === "owner" ? <span className="text-muted">—</span> : (
                    <select className="field w-auto py-1" value={m.supervisor_id ?? ""} aria-label={`Supervisor for ${m.name}`}
                      onChange={(e) => change(m, e.target.value ? { supervisor_id: Number(e.target.value) } : { clear_supervisor: true })}>
                      <option value="">None</option>
                      {supervisors.filter((s) => s.id !== m.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums">{m.role === "me_officer" ? "—" : m.caseload}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {m.caseload > 0 && <button className="text-xs text-muted hover:text-ink" onClick={() => setTransfer(m)}>Transfer clients</button>}
                  {m.id !== me?.id && (
                    <button className="ml-3 text-xs text-muted hover:text-risk" onClick={() => change(m, { active: !m.active })}>
                      {m.active ? "Deactivate" : "Reactivate"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pending.length > 0 && (
        <section className="mt-8">
          <h2 className="font-bold">Waiting to join</h2>
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-paper text-sm">
            {pending.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="font-bold">{i.name || i.email}</span>
                <span className="text-muted">{ROLES[i.role]?.label}{i.supervisor_id ? `, supervised by ${nameOf(i.supervisor_id)}` : ""}</span>
                <span className="text-xs text-muted">expires {fmtDate(i.expires_at)}</span>
                <button className="ml-auto text-xs text-muted hover:text-risk" onClick={() => api.revokeInvite(i.id).then(load)}>Cancel</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10 max-w-3xl">
        <h2 className="font-serif text-2xl">What each role can do</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[11rem_1fr]">
          {Object.entries(ROLES).map(([k, r]) => (
            <div key={k} className="contents"><dt className="font-bold">{r.label}</dt><dd className="text-ink/80">{r.help}</dd></div>
          ))}
        </dl>
      </section>

      <Modal open={inviting} onClose={() => setInviting(false)} title="Invite someone">
        {created ? (
          <div className="space-y-4">
            <p className="text-sm">Send this link to them. It works once and is shown only now.</p>
            <textarea className="field" rows={5} readOnly value={created.message} aria-label="Invitation message" />
            <div className="flex flex-wrap gap-2">
              <a className="btn btn-primary" href={`https://wa.me/?text=${encodeURIComponent(created.message)}`} target="_blank" rel="noreferrer noopener">Share on WhatsApp</a>
              <a className="btn btn-quiet" href={`mailto:?subject=${encodeURIComponent("Your Kumbuka invitation")}&body=${encodeURIComponent(created.message)}`}>Email it</a>
              <button className="btn btn-quiet" onClick={() => navigator.clipboard.writeText(created.message)}>Copy</button>
            </div>
            <button className="btn btn-quiet" onClick={() => setCreated(null)}>Invite another person</button>
          </div>
        ) : (
          <form onSubmit={sendInvite} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email"><input className="field" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="Name (optional)"><input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            </div>
            <Field label="Role" hint={ROLES[form.role].help}>
              <select className="field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {(me?.role === "owner" ? (["owner", ...ASSIGNABLE] as Role[]) : ASSIGNABLE).map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}
              </select>
            </Field>
            {["counsellor", "lay_counsellor", "supervisor"].includes(form.role) && (
              <Field label="Supervisor" hint={form.role === "lay_counsellor" ? "Lay counsellors need a supervisor to co-sign their notes." : undefined}>
                <select className="field" value={form.supervisor_id} onChange={(e) => setForm({ ...form, supervisor_id: e.target.value })}
                  required={form.role === "lay_counsellor"}>
                  <option value="">None</option>
                  {supervisors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            )}
            <button className="btn btn-primary">Create invitation link</button>
          </form>
        )}
      </Modal>

      <Modal open={!!transfer} onClose={() => setTransfer(null)} title={`Transfer ${transfer?.name}'s clients`}>
        <p className="text-sm">All {transfer?.caseload} active and paused clients move to the counsellor you choose. Past notes keep their original author.</p>
        <Field label="Move to">
          <select className="field mt-2" value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
            <option value="">Choose…</option>
            {members?.filter((m) => m.active && m.id !== transfer?.id && m.role !== "me_officer").map((m) => (
              <option key={m.id} value={m.id}>{m.name} ({ROLES[m.role].label}, {m.caseload} clients)</option>
            ))}
          </select>
        </Field>
        <button className="btn btn-primary mt-4" disabled={!transferTo} onClick={doTransfer}>Transfer clients</button>
      </Modal>
    </div>
  );
}
