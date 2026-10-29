import { useEffect, useState } from "react";
import { api } from "../../api";
import type { Assessment, Brief, Client } from "../../types";
import { ErrorText, fmtDate } from "../ui";
import ScoreChart from "./ScoreChart";

export default function Overview({ client }: { client: Client }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [scores, setScores] = useState<Assessment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingAi, setLoadingAi] = useState(true);

  useEffect(() => {
    // Facts first (instant), then the AI summary.
    api.brief(client.id, false).then((b) => setBrief((prev) => prev ?? b)).catch((e) => setError(e.message));
    api.assessments(client.id).then(setScores).catch(() => {});
    api.brief(client.id, true).then(setBrief).catch(() => {}).finally(() => setLoadingAi(false));
  }, [client.id]);

  if (error) return <ErrorText error={error} />;

  return (
    <div className="grid gap-10 lg:grid-cols-[3fr_2fr]">
      <section>
        <h2 className="font-serif text-2xl">Before your next session</h2>
        <div className="mt-3 rounded-lg bg-paper p-5 ring-1 ring-line">
          {brief?.summary ? (
            <p className="note-text">{brief.summary}</p>
          ) : loadingAi ? (
            <p className="text-muted">Preparing a summary…</p>
          ) : brief?.message ? (
            <p className="text-sm text-muted">{brief.message}</p>
          ) : (
            <p className="text-muted">A summary appears here once there are signed notes or questionnaires.</p>
          )}

          {brief && (
            <dl className="mt-5 grid gap-4 border-t border-line pt-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">Last session</dt>
                <dd className="mt-0.5">{fmtDate(brief.last_session)}</dd>
              </div>
              <div>
                <dt className="text-muted">Homework set</dt>
                <dd className="note-text mt-0.5">{brief.last_homework || "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted">Plan from last time</dt>
                <dd className="note-text mt-0.5">{brief.last_plan || "—"}</dd>
              </div>
            </dl>
          )}
        </div>

        {brief?.latest_checkin && (brief.latest_checkin.message || brief.latest_checkin.mood) && (
          <figure className="mt-4 border-l-4 border-pine bg-sage/50 px-4 py-3">
            <figcaption className="text-sm text-muted">
              From {client.preferred_name || client.full_name.split(" ")[0]}'s check-in, {fmtDate(brief.latest_checkin.completed_at)}
              {brief.latest_checkin.mood ? `, mood ${brief.latest_checkin.mood}/10` : ""}
            </figcaption>
            {brief.latest_checkin.message && <blockquote className="note-text mt-1">“{brief.latest_checkin.message}”</blockquote>}
          </figure>
        )}

        {brief && brief.open_flags.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {brief.open_flags.map((f, i) => (
              <li key={i} className="rounded-md bg-flag-soft px-3 py-2 text-sm text-flag">{f}</li>
            ))}
          </ul>
        )}

        <h2 className="mt-10 font-serif text-2xl">Questionnaire scores</h2>
        <div className="mt-3">
          {scores.length === 0 ? (
            <p className="text-sm text-muted">No questionnaires yet. Add a PHQ-9 or GAD-7 from the Questionnaires tab.</p>
          ) : (
            <ScoreChart rows={scores} height={220} />
          )}
        </div>
      </section>

      <aside className="space-y-8">
        <section>
          <h2 className="font-bold">Why they came</h2>
          <p className="note-text mt-1 whitespace-pre-wrap">{client.presenting_concern || <span className="text-muted">Not recorded yet.</span>}</p>
        </section>

        {brief && brief.latest_scores.length > 0 && (
          <section>
            <h2 className="font-bold">Latest scores</h2>
            <ul className="mt-2 space-y-2">
              {brief.latest_scores.map((s) => (
                <li key={s.kind} className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
                  <span>{s.kind} <span className="text-sm text-muted">{fmtDate(s.taken_at)}</span></span>
                  <span className="text-right">
                    <span className="font-serif text-2xl tabular-nums">{s.total}</span>{" "}
                    <span className="text-sm text-muted">{s.severity}</span>
                    {s.change !== null && s.change !== 0 && (
                      <span className={`ml-2 text-sm font-bold ${s.change < 0 ? "text-pine" : "text-flag"}`}>
                        {s.change < 0 ? "▼" : "▲"} {Math.abs(s.change)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted">Lower scores mean fewer symptoms.</p>
          </section>
        )}

        <section>
          <h2 className="font-bold">Working on</h2>
          {brief && brief.active_goals.length > 0 ? (
            <ul className="mt-1 list-disc space-y-1 pl-5 note-text">
              {brief.active_goals.map((g, i) => <li key={i}>{g}</li>)}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted">No goals set. Add them on the Goals tab.</p>
          )}
        </section>
      </aside>
    </div>
  );
}
