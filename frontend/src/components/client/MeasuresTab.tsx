import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../api";
import type { Assessment, Client, Measure } from "../../types";
import CheckinPanel from "./CheckinPanel";
import { ErrorText, Field, fmtDate, Loading, Modal, toLocalInput } from "../ui";
import ScoreChart from "./ScoreChart";

function MeasureForm({ clientId, measure, onDone }: { clientId: number; measure: Measure; onDone: (a: Assessment) => void }) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => measure.items.map(() => null));
  const [when, setWhen] = useState(() => toLocalInput(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = answers.reduce<number>((s, a) => s + (a ?? 0), 0);
  const done = answers.every((a) => a !== null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!done) { setError("Answer every question first."); return; }
    setBusy(true);
    try {
      onDone(await api.addAssessment(clientId, { kind: measure.kind, answers: answers as number[], taken_at: when }));
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <p className="text-sm text-muted">{measure.prompt}</p>
      <ol className="space-y-5">
        {measure.items.map((item, i) => (
          <li key={i}>
            <fieldset>
              <legend className="note-text mb-2">{i + 1}. {item}</legend>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {measure.options.map((o) => (
                  <label
                    key={o.value}
                    className={`cursor-pointer rounded-md border px-2 py-1.5 text-center text-sm ${
                      answers[i] === o.value ? "border-pine bg-sage font-bold text-pine-deep" : "border-line hover:bg-mist"
                    }`}
                  >
                    <input
                      type="radio" name={`q${i}`} className="sr-only" value={o.value} checked={answers[i] === o.value}
                      onChange={() => setAnswers(answers.map((a, j) => (j === i ? o.value : a)))}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      <Field label="Completed on">
        <input className="field" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </Field>
      <ErrorText error={error} />
      <div className="sticky bottom-0 -mx-5 flex items-center justify-between border-t border-line bg-paper px-5 py-3">
        <span className="text-sm">Total <span className="font-serif text-2xl tabular-nums">{total}</span><span className="text-muted"> / {measure.max}</span></span>
        <button className="btn btn-primary" disabled={busy || !done}>Save score</button>
      </div>
    </form>
  );
}

export default function MeasuresTab({ client }: { client: Client }) {
  const clientId = client.id;
  const [rows, setRows] = useState<Assessment[] | null>(null);
  const [measures, setMeasures] = useState<Measure[]>([]);
  const [open, setOpen] = useState<Measure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<Assessment | null>(null);

  useEffect(() => {
    api.assessments(clientId).then(setRows).catch((e) => setError(e.message));
    api.measures().then(setMeasures).catch(() => {});
  }, [clientId]);

  async function remove(a: Assessment) {
    if (!confirm(`Delete the ${a.kind} from ${fmtDate(a.taken_at)}?`)) return;
    await api.deleteAssessment(a.id);
    setRows((r) => r?.filter((x) => x.id !== a.id) ?? null);
  }

  return (
    <div>
      <CheckinPanel client={client} />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Or fill one in together:</span>
        {measures.map((m) => (
          <button key={m.kind} className="btn btn-quiet" onClick={() => { setJustSaved(null); setOpen(m); }}>
            Record {m.kind}
          </button>
        ))}
      </div>

      {justSaved && (
        <div className={`mb-6 rounded-lg px-4 py-3 ${justSaved.flags.length ? "bg-flag-soft text-flag" : "bg-sage text-pine-deep"}`}>
          <p className="font-bold">{justSaved.kind} saved: {justSaved.total} ({justSaved.severity})</p>
          {justSaved.flags.map((f, i) => <p key={i} className="text-sm">{f}</p>)}
        </div>
      )}

      <ErrorText error={error} />
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && (
        <p className="max-w-prose text-muted">
          No questionnaires yet. Recording a PHQ-9 (low mood) or GAD-7 (anxiety) every few sessions shows whether things are improving.
        </p>
      )}
      {rows && rows.length > 0 && (
        <>
          <ScoreChart rows={rows} />
          <div className="mt-8 overflow-x-auto rounded-lg border border-line bg-paper">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="border-b border-line text-muted">
                <tr>
                  <th className="px-4 py-2 font-bold">Date</th>
                  <th className="px-4 py-2 font-bold">Questionnaire</th>
                  <th className="px-4 py-2 font-bold">Score</th>
                  <th className="px-4 py-2 font-bold">Range</th>
                  <th className="px-4 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...rows].reverse().map((a) => (
                  <tr key={a.id} className="align-top">
                    <td className="px-4 py-2.5 tabular-nums">{fmtDate(a.taken_at)}</td>
                    <td className="px-4 py-2.5">
                      {a.kind}
                      {a.source === "client" && <span className="ml-2 text-xs text-muted">by client</span>}
                    </td>
                    <td className="px-4 py-2.5 font-bold tabular-nums">{a.total}</td>
                    <td className="px-4 py-2.5">
                      {a.severity}
                      {a.flags.map((f, i) => <p key={i} className="mt-1 text-xs text-flag">{f}</p>)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button className="text-xs text-muted hover:text-risk" onClick={() => remove(a)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.title ?? ""}>
        {open && (
          <MeasureForm
            clientId={clientId}
            measure={open}
            onDone={(a) => {
              setRows((r) => [...(r ?? []), a].sort((x, y) => x.taken_at.localeCompare(y.taken_at)));
              setJustSaved(a);
              setOpen(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
