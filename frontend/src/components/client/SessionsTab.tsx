import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import type { Session } from "../../types";
import { ErrorText, Field, fmtDate, Loading, Modal, StatusTag, toLocalInput } from "../ui";

function statusOf(s: Session): { label: string; tone: "muted" | "flag" | "pine" | "risk" } {
  if (s.status === "cancelled") return { label: "Cancelled", tone: "muted" };
  if (s.status === "no_show") return { label: "No-show", tone: "muted" };
  if (s.note_status === "signed") return { label: "Signed", tone: "pine" };
  if (s.status === "attended") return { label: "Note in draft", tone: "flag" };
  return new Date(s.scheduled_at) < new Date() ? { label: "Needs a note", tone: "flag" } : { label: "Scheduled", tone: "muted" };
}

export default function SessionsTab({ clientId }: { clientId: number }) {
  const nav = useNavigate();
  const [rows, setRows] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [when, setWhen] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7); d.setMinutes(0, 0, 0); return toLocalInput(d);
  });
  const [duration, setDuration] = useState(50);
  const [busy, setBusy] = useState(false);

  const load = () => api.sessions(clientId).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startNow() {
    setBusy(true);
    try {
      const now = new Date(); now.setSeconds(0, 0);
      const s = await api.createSession(clientId, { scheduled_at: toLocalInput(now), duration_min: 50 });
      nav(`/sessions/${s.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  async function schedule(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createSession(clientId, { scheduled_at: when, duration_min: duration });
      setScheduling(false);
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={startNow} disabled={busy}>Write a note for today</button>
        <button className="btn btn-quiet" onClick={() => setScheduling(true)}>Schedule a session</button>
      </div>
      <ErrorText error={error} />
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <p className="text-muted">No sessions yet.</p>}

      {rows && rows.length > 0 && (
        // The client's story as one continuous thread, newest first.
        <ol className="relative ml-2 border-l-2 border-line">
          {rows.map((s) => {
            const st = statusOf(s);
            const filled = s.note_status === "signed";
            return (
              <li key={s.id} className="relative pb-6 pl-6 last:pb-0">
                <span
                  aria-hidden
                  className={`absolute -left-[7px] top-2 size-3 rounded-full border-2 ${
                    filled ? "border-pine bg-pine" : s.status === "scheduled" ? "border-line bg-mist" : "border-flag bg-paper"
                  }`}
                />
                <Link to={`/sessions/${s.id}`} className="block rounded-lg px-3 py-2 hover:bg-paper hover:ring-1 hover:ring-line">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-bold">{fmtDate(s.scheduled_at, true)}</span>
                    <StatusTag tone={st.tone}>{st.label}</StatusTag>
                    {s.mood_rating && <span className="text-sm text-muted">Mood {s.mood_rating}/10</span>}
                    {s.addenda.length > 0 && <span className="text-sm text-muted">{s.addenda.length} {s.addenda.length > 1 ? "addenda" : "addendum"}</span>}
                  </div>
                  {s.data && <p className="note-text mt-1 line-clamp-2 text-ink/85">{s.data}</p>}
                  {s.homework && <p className="mt-1 text-sm text-muted">Homework: {s.homework}</p>}
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      <Modal open={scheduling} onClose={() => setScheduling(false)} title="Schedule a session">
        <form onSubmit={schedule} className="space-y-4">
          <Field label="Date and time">
            <input className="field" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
          </Field>
          <Field label="Length (minutes)">
            <input className="field" type="number" min={5} max={480} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
          </Field>
          <button className="btn btn-primary" disabled={busy}>Schedule</button>
        </form>
      </Modal>
    </div>
  );
}
