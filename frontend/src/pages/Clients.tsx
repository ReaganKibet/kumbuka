import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import ClientForm from "../components/ClientForm";
import { ErrorText, fmtDate, Loading, Modal, RiskTag, StatusTag } from "../components/ui";
import type { ClientListItem } from "../types";

export default function Clients() {
  const nav = useNavigate();
  const [rows, setRows] = useState<ClientListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"active" | "all">("active");
  const [prog, setProg] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => { api.clients().then(setRows).catch((e) => setError(e.message)); }, []);

  const visible = useMemo(() => {
    if (!rows) return [];
    const term = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (show === "all" || r.status === "active") &&
        (!prog || r.programme_name === prog) &&
        (!term || r.full_name.toLowerCase().includes(term) || (r.preferred_name ?? "").toLowerCase().includes(term)),
    );
  }, [rows, q, show, prog]);
  const programmeNames = [...new Set((rows ?? []).map((r) => r.programme_name).filter(Boolean))] as string[];

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-serif text-4xl tracking-tight">Clients</h1>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>Add client</button>
      </header>

      <div className="mb-4 flex flex-wrap gap-3">
        <input className="field max-w-xs" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search clients" />
        <select className="field w-auto" value={show} onChange={(e) => setShow(e.target.value as "active" | "all")} aria-label="Filter">
          <option value="active">Active only</option>
          <option value="all">Everyone, including paused and closed</option>
        </select>
        {programmeNames.length > 0 && (
          <select className="field w-auto" value={prog} onChange={(e) => setProg(e.target.value)} aria-label="Programme">
            <option value="">All programmes</option>
            {programmeNames.map((p) => <option key={p}>{p}</option>)}
          </select>
        )}
      </div>

      <ErrorText error={error} />
      {!rows && !error && <Loading />}

      {rows && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-line px-6 py-12 text-center">
          <p className="font-serif text-xl">No clients yet.</p>
          <p className="mt-1 text-muted">Add your first client to start keeping notes.</p>
          <button className="btn btn-primary mt-4" onClick={() => setAdding(true)}>Add client</button>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-paper">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-4 py-2.5 font-bold">Name</th>
                <th className="px-4 py-2.5 font-bold">Counsellor</th>
                <th className="px-4 py-2.5 font-bold">Last seen</th>
                <th className="px-4 py-2.5 font-bold">Next session</th>
                <th className="px-4 py-2.5 font-bold">Sessions</th>
                <th className="px-4 py-2.5 font-bold"><span className="sr-only">Notes</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-sage/50" onClick={() => nav(`/clients/${r.id}`)}>
                  <td className="px-4 py-3">
                    <Link to={`/clients/${r.id}`} className="font-serif text-lg" onClick={(e) => e.stopPropagation()}>
                      {r.full_name}
                    </Link>
                    {r.preferred_name && <span className="ml-2 text-muted">“{r.preferred_name}”</span>}
                    <span className="ml-2 inline-flex gap-1.5 align-middle">
                      <RiskTag level={r.risk_level} />
                      {r.status !== "active" && <StatusTag>{r.status}</StatusTag>}
                      {r.restricted && <StatusTag tone="risk">Restricted</StatusTag>}
                      {r.escalated && <StatusTag tone="flag">Escalated</StatusTag>}
                    </span>
                    {r.programme_name && <span className="block text-xs text-muted">{r.programme_name}</span>}
                  </td>
                  <td className="px-4 py-3">{r.counsellor_name}</td>
                  <td className="px-4 py-3 tabular-nums">{fmtDate(r.last_session)}</td>
                  <td className="px-4 py-3 tabular-nums">{fmtDate(r.next_session, true)}</td>
                  <td className="px-4 py-3 tabular-nums">{r.session_count}</td>
                  <td className="px-4 py-3 text-right">
                    {r.unsigned_notes > 0 && <StatusTag tone="flag">{r.unsigned_notes} unsigned</StatusTag>}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No clients match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add client">
        <ClientForm
          submitLabel="Add client"
          onSubmit={async (values) => {
            const c = await api.createClient(values);
            nav(`/clients/${c.id}`);
          }}
        />
      </Modal>
    </div>
  );
}
