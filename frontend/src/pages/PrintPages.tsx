import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import ScoreChart from "../components/client/ScoreChart";
import { Confidential, Letterhead, PrintShell, SetupHint } from "../components/Print";
import { ErrorText, fmtDate, Loading } from "../components/ui";
import type { Assessment, Client, Goal, Letter, Session } from "../types";

function longDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

const SECTIONS = [
  ["data", "Data"], ["assessment", "Assessment"], ["plan", "Plan"],
  ["interventions", "Interventions used"], ["homework", "Homework"], ["risk_check", "Risk check"],
] as const;

export function PrintSession() {
  const id = Number(useParams().id);
  const { me } = useAuth();
  const [s, setS] = useState<Session | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.session(id).then((x) => { setS(x); return api.client(x.client_id).then(setClient); }).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <div className="p-8"><ErrorText error={error} /></div>;
  if (!s || !client) return <Loading />;

  return (
    <>
      <SetupHint />
      <PrintShell title={`Session note ${client.full_name} ${s.scheduled_at.slice(0, 10)}`} entity="session" entityId={s.id}>
        <Letterhead />
        <h1 className="font-serif text-3xl">Session note</h1>
        <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted">Client</dt><dd className="font-bold">{client.full_name}</dd>
          {client.date_of_birth && <><dt className="text-muted">Date of birth</dt><dd>{longDate(client.date_of_birth)}</dd></>}
          <dt className="text-muted">Session</dt>
          <dd>{longDate(s.scheduled_at)}, {new Date(s.scheduled_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}, {s.duration_min} min</dd>
          <dt className="text-muted">Attendance</dt><dd className="capitalize">{s.status.replace("_", "-")}</dd>
          {s.mood_rating && <><dt className="text-muted">Client's mood</dt><dd>{s.mood_rating}/10</dd></>}
        </dl>

        <div className="mt-8 space-y-5">
          {SECTIONS.map(([k, label]) => (
            <section key={k} className="break-inside-avoid">
              <h2 className="text-sm font-bold text-muted">{label}</h2>
              <p className="note-text mt-1 whitespace-pre-wrap">{s[k] || "—"}</p>
            </section>
          ))}
        </div>

        {s.addenda.length > 0 && (
          <div className="mt-8 border-t border-line pt-4">
            {s.addenda.map((a) => (
              <section key={a.id} className="mb-3 break-inside-avoid">
                <h2 className="text-xs font-bold text-muted">Addendum, {fmtDate(a.created_at, true)}</h2>
                <p className="note-text whitespace-pre-wrap">{a.text}</p>
              </section>
            ))}
          </div>
        )}

        <p className="mt-10 text-sm">
          {s.note_status === "signed"
            ? <>Electronically signed by <span className="font-bold">{me?.name}</span>{me?.title ? `, ${me.title}` : ""} on {fmtDate(s.signed_at, true)}.</>
            : <span className="font-bold text-risk">Draft. This note has not been signed.</span>}
        </p>
        <Confidential />
      </PrintShell>
    </>
  );
}

export function PrintClient() {
  const id = Number(useParams().id);
  const [client, setClient] = useState<Client | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [scores, setScores] = useState<Assessment[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.client(id), api.sessions(id), api.assessments(id), api.goals(id)])
      .then(([c, s, a, g]) => { setClient(c); setSessions(s); setScores(a); setGoals(g); })
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <div className="p-8"><ErrorText error={error} /></div>;
  if (!client) return <Loading />;

  const attended = sessions.filter((s) => s.status === "attended").sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const missed = sessions.filter((s) => s.status === "cancelled" || s.status === "no_show").length;

  return (
    <>
      <SetupHint />
      <PrintShell title={`Client summary ${client.full_name}`} entity="client" entityId={client.id}>
        <Letterhead />
        <h1 className="font-serif text-3xl">Client summary</h1>
        <p className="text-sm text-muted">Prepared {longDate(new Date().toISOString())}</p>

        <dl className="mt-6 grid grid-cols-[9rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted">Name</dt><dd className="font-bold">{client.full_name}</dd>
          {client.date_of_birth && <><dt className="text-muted">Date of birth</dt><dd>{longDate(client.date_of_birth)}</dd></>}
          <dt className="text-muted">Sessions attended</dt>
          <dd>{attended.length}{attended.length > 0 && `, ${longDate(attended[0].scheduled_at)} to ${longDate(attended[attended.length - 1].scheduled_at)}`}</dd>
          {missed > 0 && <><dt className="text-muted">Missed or cancelled</dt><dd>{missed}</dd></>}
          <dt className="text-muted">Status</dt><dd className="capitalize">{client.status}</dd>
        </dl>

        <section className="mt-8 break-inside-avoid">
          <h2 className="font-serif text-xl">Presenting concern</h2>
          <p className="note-text mt-1 whitespace-pre-wrap">{client.presenting_concern || "—"}</p>
        </section>

        {goals.length > 0 && (
          <section className="mt-8 break-inside-avoid">
            <h2 className="font-serif text-xl">Goals</h2>
            <table className="mt-2 w-full text-sm">
              <tbody className="divide-y divide-line">
                {goals.map((g) => (
                  <tr key={g.id}>
                    <td className="py-1.5 pr-4">{g.description}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">{g.status === "achieved" ? "Achieved" : g.status === "dropped" ? "Set aside" : `${g.progress}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {scores.length > 0 && (
          <section className="mt-8 break-inside-avoid">
            <h2 className="font-serif text-xl">Questionnaire scores</h2>
            <div className="mt-2"><ScoreChart rows={scores} height={200} /></div>
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-muted"><tr><th className="py-1 font-bold">Date</th><th className="font-bold">Questionnaire</th><th className="font-bold">Score</th><th className="font-bold">Range</th></tr></thead>
              <tbody className="divide-y divide-line">
                {[...scores].reverse().map((a) => (
                  <tr key={a.id}><td className="py-1 tabular-nums">{fmtDate(a.taken_at)}</td><td>{a.kind}</td><td className="tabular-nums">{a.total}</td><td>{a.severity}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {client.risk_level !== "none" && (
          <section className="mt-8 break-inside-avoid">
            <h2 className="font-serif text-xl">Risk</h2>
            <p className="note-text mt-1 whitespace-pre-wrap"><span className="capitalize">{client.risk_level}</span>. {client.risk_notes}</p>
          </section>
        )}
        <Confidential />
      </PrintShell>
    </>
  );
}

export function PrintLetter() {
  const id = Number(useParams().id);
  const [letter, setLetter] = useState<Letter | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.letter(id).then(setLetter).catch((e) => setError(e.message)); }, [id]);
  if (error) return <div className="p-8"><ErrorText error={error} /></div>;
  if (!letter) return <Loading />;
  return (
    <>
      <SetupHint />
      <PrintShell title={letter.subject || "Letter"} entity="letter" entityId={letter.id}>
        <Letterhead />
        <p className="text-sm">{longDate(letter.updated_at)}</p>
        {letter.recipient && <p className="mt-6 whitespace-pre-line text-sm">{letter.recipient}</p>}
        {letter.subject && <p className="mt-6 font-bold">{letter.subject}</p>}
        <div className="note-text mt-4 whitespace-pre-wrap">{letter.body}</div>
        <Confidential />
      </PrintShell>
    </>
  );
}
