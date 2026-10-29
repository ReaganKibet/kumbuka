import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorText, fmtDate, fmtTime, Loading, StatusTag } from "../components/ui";
import type { Dashboard, Session } from "../types";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function SessionRow({ s, showDate }: { s: Session; showDate?: boolean }) {
  const tone = s.note_status === "signed" ? "pine" : s.status === "scheduled" ? "muted" : "flag";
  const label =
    s.note_status === "signed" ? "Signed" :
    s.status === "scheduled" ? "Scheduled" :
    s.status === "attended" ? "Note in draft" : s.status.replace("_", "-");
  return (
    <li>
      <Link
        to={`/sessions/${s.id}`}
        className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 rounded-md px-3 py-2.5 hover:bg-sage/60"
      >
        <span className="text-sm tabular-nums text-muted">{showDate ? fmtDate(s.scheduled_at) : fmtTime(s.scheduled_at)}</span>
        <span className="font-serif text-lg">{s.client_name}</span>
        <StatusTag tone={tone}>{label}</StatusTag>
      </Link>
    </li>
  );
}

export default function Today() {
  const { me } = useAuth();
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.dashboard().then(setD).catch((e) => setError(e.message)); }, []);

  if (error) return <ErrorText error={error} />;
  if (!d) return <Loading />;

  const first = me?.name.split(" ")[0];

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-serif text-4xl tracking-tight">{greeting()}, {first}.</h1>
        <p className="mt-1 text-muted">
          {d.today.length === 0 ? "No sessions today." : `${d.today.length} session${d.today.length > 1 ? "s" : ""} today.`}{" "}
          {d.unsigned.length > 0 && `${d.unsigned.length} note${d.unsigned.length > 1 ? "s" : ""} waiting to be signed.`}
        </p>
      </header>

      {d.attention.length > 0 && (
        <section className="mb-8 rounded-lg border border-risk/30 bg-risk-soft/60 p-4" aria-label="Needs attention">
          <h2 className="font-bold text-risk">Check in on</h2>
          <ul className="mt-2 space-y-1.5">
            {d.attention.map((a, i) => (
              <li key={i} className="text-sm">
                <Link to={`/clients/${a.client_id}`} className="font-bold underline-offset-2 hover:underline">{a.client_name}</Link>
                <span className="text-ink/80"> — {a.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <section>
          <h2 className="mb-2 font-serif text-2xl">Today</h2>
          {d.today.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-4 py-6 text-muted">
              Nothing booked. Schedule sessions from a client's page.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-paper">{d.today.map((s) => <SessionRow key={s.id} s={s} />)}</ul>
          )}

          {d.checkins.length > 0 && (
            <>
              <h2 className="mb-2 mt-8 font-serif text-2xl">Check-ins from clients</h2>
              <ul className="divide-y divide-line rounded-lg border border-line bg-paper">
                {d.checkins.map((c, i) => (
                  <li key={i}>
                    <Link to={`/clients/${c.client_id}`} className="block px-3 py-2.5 hover:bg-sage/60">
                      <span className="flex flex-wrap items-baseline gap-x-3">
                        <span className="font-serif text-lg">{c.client_name}</span>
                        <span className="text-sm text-muted">{fmtDate(c.completed_at, true)}</span>
                        {c.flagged && <StatusTag tone="risk">Flagged</StatusTag>}
                      </span>
                      <span className="block text-sm text-ink/80">
                        {[...c.scores, c.mood ? `mood ${c.mood}/10` : null, c.has_message ? "left you a message" : null].filter(Boolean).join(", ")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h2 className="mb-2 mt-8 font-serif text-2xl">Next 7 days</h2>
          {d.upcoming.length === 0 ? (
            <p className="text-muted">No upcoming sessions.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-paper">{d.upcoming.map((s) => <SessionRow key={s.id} s={s} showDate />)}</ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 font-serif text-2xl">Notes to finish</h2>
          {d.unsigned.length === 0 ? (
            <p className="text-muted">All notes are signed.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-paper">{d.unsigned.map((s) => <SessionRow key={s.id} s={s} showDate />)}</ul>
          )}

          <dl className="mt-8 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted">Active clients</dt>
              <dd className="font-serif text-3xl">{d.counts.active_clients}</dd>
            </div>
            <div>
              <dt className="text-muted">Sessions this month</dt>
              <dd className="font-serif text-3xl">{d.counts.sessions_this_month}</dd>
            </div>
          </dl>
          {!d.ai_enabled && (
            <p className="mt-6 text-xs text-muted">
              AI drafting is off. Add an ANTHROPIC_API_KEY on the server to turn it on; everything else works without it.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
