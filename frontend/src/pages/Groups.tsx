import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorText, Field, fmtDate, Loading, Modal, StatusTag, toLocalInput } from "../components/ui";
import { GENDERS } from "../lib/africa";
import type { ClientListItem, GroupSession, Programme } from "../types";

export function GroupsList() {
  const nav = useNavigate();
  const [rows, setRows] = useState<GroupSession[] | null>(null);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", topic: "", location: "", programme_id: "", held_at: toLocalInput(new Date()), duration_min: 60 });

  useEffect(() => {
    api.groups().then(setRows).catch((e) => setError(e.message));
    api.programmes().then((p) => setProgrammes(p.filter((x) => x.active))).catch(() => {});
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const g = await api.createGroup({
        title: form.title, topic: form.topic || null, location: form.location || null,
        programme_id: form.programme_id ? Number(form.programme_id) : null, held_at: form.held_at, duration_min: form.duration_min,
        status: new Date(form.held_at) > new Date() ? "scheduled" : "held",
      });
      nav(`/groups/${g.id}`);
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">Groups</h1>
          <p className="mt-1 text-muted">School wellbeing circles, support groups and psychoeducation sessions, with an attendance register for each.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>Record a group session</button>
      </header>
      <ErrorText error={error} />
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && (
        <p className="rounded-md border border-dashed border-line px-4 py-8 text-center text-muted">No group sessions yet.</p>
      )}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-paper">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-4 py-2.5 font-bold">Date</th>
                <th className="px-4 py-2.5 font-bold">Group</th>
                <th className="px-4 py-2.5 font-bold">Programme</th>
                <th className="px-4 py-2.5 font-bold">Facilitator</th>
                <th className="px-4 py-2.5 font-bold">Attended</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((g) => (
                <tr key={g.id} className="cursor-pointer hover:bg-sage/50" onClick={() => nav(`/groups/${g.id}`)}>
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap">{fmtDate(g.held_at, true)}</td>
                  <td className="px-4 py-3">
                    <Link to={`/groups/${g.id}`} className="font-serif text-lg" onClick={(e) => e.stopPropagation()}>{g.title}</Link>
                    {g.topic && <span className="block text-muted">{g.topic}</span>}
                  </td>
                  <td className="px-4 py-3">{g.programme_name ?? "—"}</td>
                  <td className="px-4 py-3">{g.facilitator_name}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {g.status === "held" ? `${g.present_count} of ${g.registered_count}` : <StatusTag>{g.status}</StatusTag>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Record a group session">
        <form onSubmit={create} className="space-y-4">
          <Field label="Group name" hint="e.g. Form 2 wellbeing circle, Women's support circle">
            <input className="field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </Field>
          <Field label="Topic this session"><input className="field" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date and time"><input className="field" type="datetime-local" value={form.held_at} onChange={(e) => setForm({ ...form, held_at: e.target.value })} required /></Field>
            <Field label="Length (minutes)"><input className="field" type="number" min={5} max={480} value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: Number(e.target.value) })} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Programme">
              <select className="field" value={form.programme_id} onChange={(e) => setForm({ ...form, programme_id: e.target.value })}>
                <option value="">None</option>
                {programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Venue"><input className="field" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          </div>
          <button className="btn btn-primary">Create and take the register</button>
        </form>
      </Modal>
    </div>
  );
}

type Row = { client_id: number; client_name: string; present: boolean; note: string | null };

export function GroupDetail() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const { me } = useAuth();
  const [g, setG] = useState<GroupSession | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [notes, setNotes] = useState("");
  const [q, setQ] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newMember, setNewMember] = useState({ full_name: "", gender: "", date_of_birth: "" });

  useEffect(() => {
    api.group(id).then((x) => { setG(x); setRows(x.attendance); setNotes(x.notes ?? ""); }).catch((e) => setError(e.message));
    api.clients().then(setClients).catch(() => {});
  }, [id]);

  const suggestions = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const inList = new Set(rows.map((r) => r.client_id));
    return clients.filter((c) => !inList.has(c.id) && c.full_name.toLowerCase().includes(term)).slice(0, 6);
  }, [q, clients, rows]);

  if (error && !g) return <ErrorText error={error} />;
  if (!g) return <Loading />;

  const edit = (r: Row[]) => { setRows(r); setDirty(true); setSaved(false); };

  async function save() {
    setError(null);
    try {
      const updated = await api.setAttendance(id, rows.map((r) => ({ client_id: r.client_id, present: r.present, note: r.note })));
      if (notes !== (g!.notes ?? "")) await api.updateGroup(id, { notes });
      setG({ ...updated, notes }); setRows(updated.attendance); setDirty(false); setSaved(true);
    } catch (e) { setError((e as Error).message); }
  }

  async function addNew(e: FormEvent) {
    e.preventDefault();
    try {
      const c = await api.quickMember(id, { full_name: newMember.full_name, gender: newMember.gender || null, date_of_birth: newMember.date_of_birth || null });
      setClients([...clients, c]);
      edit([...rows, { client_id: c.id, client_name: c.full_name, present: true, note: null }]);
      setNewMember({ full_name: "", gender: "", date_of_birth: "" });
      setAdding(false);
    } catch (err) { setError((err as Error).message); }
  }

  async function remove() {
    if (!confirm("Delete this group session and its register?")) return;
    await api.deleteGroup(id);
    nav("/groups");
  }

  const present = rows.filter((r) => r.present).length;

  return (
    <div className="max-w-4xl">
      <Link to="/groups" className="text-sm text-muted hover:text-ink">Groups</Link>
      <header className="mt-2 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">{g.title}</h1>
          <p className="mt-1 text-muted">
            {fmtDate(g.held_at, true)}, {g.duration_min} min{g.location ? `, ${g.location}` : ""}{g.programme_name ? `. ${g.programme_name}` : ""}. Facilitated by {g.facilitator_name}.
          </p>
          {g.topic && <p className="mt-1 font-serif text-lg">{g.topic}</p>}
        </div>
        {g.can_edit && (
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={save} disabled={!dirty && notes === (g.notes ?? "")}>Save register</button>
          </div>
        )}
      </header>
      <ErrorText error={error} />
      {saved && <p className="mb-4 rounded-md bg-sage px-3 py-2 text-sm text-pine-deep">Register saved: {present} present of {rows.length}.</p>}

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-2xl">Register <span className="text-muted">{present} of {rows.length} present</span></h2>
          {g.can_edit && rows.length > 0 && (
            <div className="flex gap-2 text-sm">
              <button className="text-muted underline underline-offset-2" onClick={() => edit(rows.map((r) => ({ ...r, present: true })))}>Mark all present</button>
            </div>
          )}
        </div>

        {g.can_edit && (
          <div className="relative mt-3">
            <input className="field" placeholder="Add a member: start typing a client's name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a client" />
            {suggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-lg border border-line bg-paper shadow-sm">
                {suggestions.map((c) => (
                  <li key={c.id}>
                    <button className="w-full px-3 py-2 text-left hover:bg-sage" onClick={() => {
                      edit([...rows, { client_id: c.id, client_name: c.full_name, present: true, note: null }]); setQ("");
                    }}>{c.full_name}{c.programme_name && <span className="ml-2 text-xs text-muted">{c.programme_name}</span>}</button>
                  </li>
                ))}
              </ul>
            )}
            <button className="mt-2 text-sm text-pine underline underline-offset-2" onClick={() => setAdding(true)}>Someone new? Register them</button>
          </div>
        )}

        {rows.length === 0 ? (
          <p className="mt-4 text-muted">No one on the register yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-paper">
            {rows.map((r, i) => (
              <li key={r.client_id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <label className="flex min-w-48 flex-1 items-center gap-3">
                  <input type="checkbox" className="size-5 accent-pine" checked={r.present} disabled={!g.can_edit}
                    onChange={(e) => edit(rows.map((x, j) => (j === i ? { ...x, present: e.target.checked } : x)))} />
                  <span className={r.present ? "" : "text-muted line-through"}>{r.client_name}</span>
                </label>
                {g.can_edit ? (
                  <>
                    <input className="field max-w-xs py-1 text-sm" placeholder="Note (optional)" value={r.note ?? ""} aria-label={`Note for ${r.client_name}`}
                      onChange={(e) => edit(rows.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
                    <button className="text-xs text-muted hover:text-risk" onClick={() => edit(rows.filter((_, j) => j !== i))}>Remove</button>
                  </>
                ) : r.note && <span className="text-sm text-muted">{r.note}</span>}
                {me && <Link to={`/clients/${r.client_id}`} className="text-xs text-muted underline underline-offset-2">Profile</Link>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-bold">Group notes</h2>
        <p className="text-sm text-muted">What was covered and how the group responded. Write anything about one person in their own record.</p>
        <textarea className="field note-text mt-2" rows={5} value={notes} disabled={!g.can_edit}
          onChange={(e) => { setNotes(e.target.value); setSaved(false); }} />
      </section>

      {g.can_edit && (
        <div className="mt-6 flex items-center gap-2 border-t border-line pt-4">
          <button className="btn btn-primary" onClick={save} disabled={!dirty && notes === (g.notes ?? "")}>Save register</button>
          <button className="ml-auto text-sm text-muted hover:text-risk" onClick={remove}>Delete group session</button>
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Register a new member">
        <form onSubmit={addNew} className="space-y-4">
          <p className="text-sm text-muted">They're added as a client of this group's facilitator and programme. You can fill in their full profile later.</p>
          <Field label="Full name"><input className="field" value={newMember.full_name} onChange={(e) => setNewMember({ ...newMember, full_name: e.target.value })} required /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Gender">
              <select className="field" value={newMember.gender} onChange={(e) => setNewMember({ ...newMember, gender: e.target.value })}>
                <option value="">Not recorded</option>
                {Object.entries(GENDERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Date of birth"><input className="field" type="date" value={newMember.date_of_birth} onChange={(e) => setNewMember({ ...newMember, date_of_birth: e.target.value })} /></Field>
          </div>
          <button className="btn btn-primary">Add to register</button>
        </form>
      </Modal>
    </div>
  );
}
