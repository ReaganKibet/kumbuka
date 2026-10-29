import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import type { PublicCheckin } from "../types";

// Shown to clients. Check these numbers periodically; last verified October 2026.
const SUPPORT_LINES = [
  { name: "Emergency services", number: "999", alt: "or 112", tel: "999", note: "If you are in danger right now" },
  { name: "Kenya Red Cross", number: "1199", tel: "1199", note: "Free call" },
  { name: "Befrienders Kenya", number: "+254 722 178 177", tel: "+254722178177", note: "Emotional support, 9am to 5pm" },
];

function SupportBox({ counselor, strong }: { counselor: string; strong: boolean }) {
  return (
    <section className={`rounded-xl p-5 ${strong ? "bg-risk-soft ring-1 ring-risk/30" : "bg-paper ring-1 ring-line"}`}>
      <h2 className="font-serif text-xl">{strong ? "You don't have to wait until your session" : "If you need to talk to someone sooner"}</h2>
      {strong && (
        <p className="mt-2">
          You mentioned thoughts of being better off dead or of hurting yourself. {counselor} will see this, but if those thoughts
          feel strong, please reach out now.
        </p>
      )}
      <ul className="mt-4 space-y-3">
        {SUPPORT_LINES.map((l) => (
          <li key={l.name}>
            <a href={`tel:${l.tel}`} className="flex items-baseline justify-between gap-3 rounded-lg bg-paper px-4 py-3 ring-1 ring-line">
              <span>
                <span className="block font-bold">{l.name}</span>
                <span className="text-sm text-muted">{l.note}</span>
              </span>
              <span className="whitespace-nowrap font-bold text-pine">{l.number}{l.alt ? <span className="font-normal text-muted"> {l.alt}</span> : null}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function CheckIn() {
  const token = useParams().token ?? "";
  const [data, setData] = useState<PublicCheckin | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, (number | null)[]>>({});
  const [mood, setMood] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ show_support: boolean } | null>(null);

  useEffect(() => {
    document.title = "Before your session";
    api.publicCheckin(token)
      .then((d) => {
        setData(d);
        setAnswers(Object.fromEntries(d.measures.map((m) => [m.kind, m.items.map(() => null)])));
      })
      .catch((e) => setGone(e.message));
  }, [token]);

  const total = useMemo(() => Object.values(answers).reduce((n, a) => n + a.length, 0), [answers]);
  const answered = useMemo(() => Object.values(answers).reduce((n, a) => n + a.filter((x) => x !== null).length, 0), [answers]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (answered < total) {
      setError(`Please answer all ${total} questions. ${total - answered} still to go.`);
      const firstEmpty = document.querySelector("[data-unanswered='true']");
      firstEmpty?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setBusy(true); setError(null);
    try {
      const r = await api.submitCheckin(token, {
        answers: answers as Record<string, number[]>, mood, message: message.trim() || null,
      });
      setDone(r);
      window.scrollTo(0, 0);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-mist">
      <div className="mx-auto max-w-xl px-4 pb-28 pt-8">{children}</div>
    </div>
  );

  if (gone) {
    return shell(
      <div className="pt-16">
        <p className="font-serif text-3xl">{gone}</p>
        <p className="mt-6 text-sm text-muted">If you are in danger right now, call 999 or 112.</p>
      </div>,
    );
  }
  if (!data) return shell(<p className="pt-16 text-muted">Loading…</p>);

  const counselorFirst = data.counselor_name.split(" ")[0];

  if (done) {
    return shell(
      <div className="space-y-8 pt-8">
        <div>
          <h1 className="font-serif text-4xl">Thank you, {data.first_name}.</h1>
          <p className="mt-3 text-lg">Your answers have been sent to {data.counselor_name}. You can close this page.</p>
        </div>
        <SupportBox counselor={counselorFirst} strong={done.show_support} />
      </div>,
    );
  }

  return shell(
    <form onSubmit={submit}>
      <header className="mb-8">
        {data.practice_name && <p className="text-sm text-muted">{data.practice_name}</p>}
        <h1 className="mt-1 font-serif text-4xl leading-tight">Hi {data.first_name}.</h1>
        <p className="mt-3 text-lg">
          {data.counselor_name} has asked you to answer a few questions before your next session. It takes about three minutes.
          There are no right or wrong answers.
        </p>
        <p className="mt-2 text-sm text-muted">Only {counselorFirst} sees your answers.</p>
      </header>

      <section className="mb-10">
        <h2 className="font-serif text-2xl">How are you feeling today?</h2>
        <p className="text-sm text-muted">1 is very low, 10 is very good. Optional.</p>
        <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-10" role="radiogroup" aria-label="Mood today">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n} type="button" role="radio" aria-checked={mood === n}
              onClick={() => setMood(mood === n ? null : n)}
              className={`h-12 rounded-lg text-lg tabular-nums ${mood === n ? "bg-pine font-bold text-white" : "bg-paper ring-1 ring-line"}`}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      {data.measures.map((m) => (
        <section key={m.kind} className="mb-10">
          <p className="mb-4 text-lg">{m.prompt}</p>
          <ol className="space-y-6">
            {m.items.map((item, i) => {
              const val = answers[m.kind]?.[i] ?? null;
              return (
                <li key={i} data-unanswered={val === null} className="rounded-xl bg-paper p-4 ring-1 ring-line">
                  <fieldset>
                    <legend className="note-text mb-3 text-lg">{item}</legend>
                    <div className="grid gap-2">
                      {m.options.map((o) => (
                        <label
                          key={o.value}
                          className={`flex min-h-12 cursor-pointer items-center rounded-lg px-4 ${
                            val === o.value ? "bg-pine font-bold text-white" : "bg-mist hover:bg-sage"
                          }`}
                        >
                          <input
                            type="radio" className="sr-only" name={`${m.kind}-${i}`} checked={val === o.value}
                            onChange={() => setAnswers({ ...answers, [m.kind]: answers[m.kind].map((a, j) => (j === i ? o.value : a)) })}
                          />
                          {o.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      <section className="mb-8">
        <label className="block">
          <span className="font-serif text-2xl">Anything you'd like {counselorFirst} to know?</span>
          <span className="block text-sm text-muted">Optional.</span>
          <textarea className="field note-text mt-3" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} />
        </label>
      </section>

      <p className="mb-6 text-sm text-muted">If you are in danger right now, call 999 or 112.</p>

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
          <span className="text-sm tabular-nums text-muted">{answered} of {total} answered</span>
          <button className="btn btn-primary px-6 py-3 text-base" disabled={busy}>{busy ? "Sending…" : "Send answers"}</button>
        </div>
        {error && <p role="alert" className="mx-auto mt-2 max-w-xl text-sm text-risk">{error}</p>}
      </div>
    </form>,
  );
}
