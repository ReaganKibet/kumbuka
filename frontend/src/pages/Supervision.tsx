import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ErrorText, fmtDate, Loading, RiskTag } from "../components/ui";
import { ROLES } from "../lib/africa";
import type { SupervisionData } from "../types";

export default function Supervision() {
  const [d, setD] = useState<SupervisionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.supervision().then(setD).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function decide(id: number, decision: "approve" | "return") {
    setBusy(true); setError(null);
    try {
      await api.review(id, decision, comment || undefined);
      setOpen(null); setComment("");
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function resolve(id: number) {
    await api.resolveEscalation(id);
    load();
  }

  if (error && !d) return <ErrorText error={error} />;
  if (!d) return <Loading />;

  return (
    <div>
      <h1 className="font-serif text-4xl tracking-tight">Supervision</h1>
      <p className="mt-1 text-muted">Notes waiting for your co-signature, cases your team has escalated, and how everyone is keeping up.</p>
      <ErrorText error={error} />

      <div className="mt-8 grid gap-10 lg:grid-cols-[3fr_2fr]">
        <section>
          <h2 className="font-serif text-2xl">Notes to review {d.pending_reviews.length > 0 && <span className="text-muted">({d.pending_reviews.length})</span>}</h2>
          {d.pending_reviews.length === 0 ? (
            <p className="mt-2 rounded-md border border-dashed border-line px-4 py-6 text-muted">Nothing waiting. Notes from lay counsellors appear here when they sign them.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {d.pending_reviews.map((s) => (
                <li key={s.id} className="rounded-lg bg-paper p-4 ring-1 ring-line">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p>
                      <Link to={`/clients/${s.client_id}`} className="font-serif text-lg hover:underline">{s.client_name}</Link>
                      <span className="ml-2 text-sm text-muted">by {s.author_name}, {fmtDate(s.scheduled_at, true)}</span>
                    </p>
                    <Link to={`/sessions/${s.id}`} className="text-sm text-muted underline underline-offset-2">Open full note</Link>
                  </div>
                  <p className="note-text mt-2 whitespace-pre-wrap">{s.data}</p>
                  <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[7rem_1fr]">
                    {s.assessment && <><dt className="text-muted">Assessment</dt><dd>{s.assessment}</dd></>}
                    {s.plan && <><dt className="text-muted">Plan</dt><dd>{s.plan}</dd></>}
                    <dt className="text-muted">Risk check</dt>
                    <dd className={s.risk_check ? "" : "font-bold text-flag"}>{s.risk_check || "Not recorded"}</dd>
                  </dl>
                  {open === s.id ? (
                    <div className="mt-3 space-y-2">
                      <textarea className="field" rows={3} value={comment} onChange={(e) => setComment(e.target.value)}
                        placeholder="Feedback for the counsellor (required when returning a note)" aria-label="Feedback" />
                      <div className="flex flex-wrap gap-2">
                        <button className="btn btn-primary" disabled={busy} onClick={() => decide(s.id, "approve")}>Co-sign note</button>
                        <button className="btn btn-quiet" disabled={busy || !comment.trim()} onClick={() => decide(s.id, "return")}>Return with feedback</button>
                        <button className="btn btn-quiet" onClick={() => { setOpen(null); setComment(""); }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button className="btn btn-primary" disabled={busy} onClick={() => decide(s.id, "approve")}>Co-sign</button>
                      <button className="btn btn-quiet" onClick={() => { setOpen(s.id); setComment(""); }}>Add feedback or return</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-8">
          <section>
            <h2 className="font-bold text-risk">Escalated to you</h2>
            {d.escalations.length === 0 ? <p className="mt-1 text-sm text-muted">No open escalations.</p> : (
              <ul className="mt-2 space-y-2">
                {d.escalations.map((c) => (
                  <li key={c.id} className="rounded-lg border-l-4 border-risk bg-risk-soft px-3 py-2 text-sm">
                    <Link to={`/clients/${c.id}`} className="font-bold hover:underline">{c.name}</Link>
                    <span className="text-ink/70">, from {c.counsellor_name}, {fmtDate(c.escalated_at, true)}</span>
                    <p className="note-text mt-1">{c.escalation_note}</p>
                    <button className="mt-1 text-xs font-bold underline underline-offset-2" onClick={() => resolve(c.id)}>Mark as handled</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-bold">High-risk clients</h2>
            {d.high_risk.length === 0 ? <p className="mt-1 text-sm text-muted">None in your team.</p> : (
              <ul className="mt-2 space-y-1 text-sm">
                {d.high_risk.map((c) => (
                  <li key={c.id}><Link to={`/clients/${c.id}`} className="font-bold hover:underline">{c.name}</Link> <RiskTag level={c.risk_level} /> <span className="text-muted">{c.counsellor_name}</span></li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-bold">Your team</h2>
            {d.team.length === 0 ? <p className="mt-1 text-sm text-muted">Nobody reports to you yet. Admins set supervisors on the Team page.</p> : (
              <table className="mt-2 w-full text-sm">
                <thead className="text-left text-muted">
                  <tr><th className="py-1 font-bold">Name</th><th className="font-bold">Clients</th><th className="font-bold">Sessions, 30 days</th><th className="font-bold">Late notes</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.team.map((t) => (
                    <tr key={t.id}>
                      <td className="py-1.5">{t.name}<span className="block text-xs text-muted">{ROLES[t.role]?.label}</span></td>
                      <td className="tabular-nums">{t.caseload}</td>
                      <td className="tabular-nums">{t.sessions_30d}</td>
                      <td className={`tabular-nums ${t.overdue_notes ? "font-bold text-flag" : ""}`}>{t.overdue_notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-1 text-xs text-muted">Late notes: sessions more than 2 days ago without a signed note.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
