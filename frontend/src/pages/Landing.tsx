import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Photo, PHOTO, type PhotoKey } from "../lib/photos";

const DEMO_ROLES = [
  { key: "director", title: "Programme director", sees: "Every programme, the team, and the funder report." },
  { key: "supervisor", title: "Clinical supervisor", sees: "Notes waiting for co-signature and cases escalated by lay counsellors." },
  { key: "counsellor", title: "Counsellor", sees: "A day of sessions, client histories and score trends." },
  { key: "lay", title: "Lay counsellor", sees: "A school wellbeing group register and notes that go to a supervisor." },
  { key: "me", title: "M&E officer", sees: "Anonymised outcomes by programme, age and gender, ready to export." },
] as const;

const SETTINGS: { k: PhotoKey; title: string; body: string }[] = [
  { k: "session", title: "Counselling centres", body: "One-to-one sessions, notes and score trends for every client." },
  { k: "group", title: "Community programmes", body: "Groups led by lay counsellors, with supervision built in." },
  { k: "school", title: "Schools", body: "Wellbeing circles and pastoral care, with guardian consent for minors." },
];

const WHO_SOURCE = "https://www.afro.who.int/sites/default/files/2026-05/Concept%20Note%202026%20Mental%20Health%20ICL%20Workshops%20Final%20%281%29.pdf";

const STEPS = [
  { title: "Document the session", body: "Record the session or a voice note, in English, Kiswahili or both, and get a transcript and a structured note. Or just type." },
  { title: "Supervise lay counsellors", body: "Notes by lay and trainee counsellors wait for a supervisor's co-signature. Worrying cases are escalated in one tap." },
  { title: "Check in on WhatsApp", body: "Clients answer PHQ-9, GAD-7 or WHO-5 from a link before their session. Nothing to install." },
  { title: "Report to funders", body: "Reach, outcomes and referrals by programme, age band and gender, calculated from the records with no names in them." },
];

export default function Landing() {
  const { me, signIn, config } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState("/");

  useEffect(() => {
    document.title = "Kumbuka: counselling records and impact reporting for Africa";
    if (window.location.hash === "#demo") document.getElementById("demo")?.scrollIntoView();
  }, []);

  if (me) return <Navigate to={next} replace />;

  async function enterDemo(role: (typeof DEMO_ROLES)[number]["key"]) {
    setBusy(role);
    setError(null);
    try {
      const r = await api.demoLogin(role);
      setNext(role === "me" ? "/reports" : role === "supervisor" ? "/supervision" : role === "director" ? "/reports" : "/");
      signIn(r.token, r.therapist);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const demoOn = config?.demo_enabled !== false;

  return (
    <div className="min-h-screen bg-mist text-ink">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 md:px-8">
        <p className="font-serif text-2xl tracking-tight text-pine">kumbuka</p>
        <nav className="flex items-center gap-4 text-sm font-bold">
          {demoOn && <a href="#demo" className="hidden text-muted hover:text-ink sm:inline">Live demo</a>}
          <Link to="/login" className="btn btn-quiet bg-paper">Sign in</Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-6 md:grid-cols-[1.1fr_1fr] md:px-8 md:pt-14">
        <div>
          <h1 className="font-serif text-[2.6rem] leading-[1.08] tracking-tight md:text-[3.6rem]">
            Counselling records and impact reporting, built for Africa's schools, NGOs and counselling centres.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink/80">
            Kumbuka (Swahili for "remember") keeps every client's story, scores and referrals in one secure place, supports
            lay counsellors with real supervision, and turns everyday counselling work into the evidence funders ask for.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {demoOn && <a href="#demo" className="btn btn-primary px-5 py-3 text-base">Explore the live demo</a>}
            <Link to="/login?mode=register" className="btn btn-quiet bg-paper px-5 py-3 text-base">Set up your organisation</Link>
          </div>
        </div>

        {demoOn && (
          <div id="demo" className="scroll-mt-6 rounded-2xl bg-paper p-5 ring-1 ring-line md:p-6">
            <h2 className="font-serif text-2xl">Step inside a working organisation</h2>
            <p className="mt-1 text-sm text-muted">
              Tumaini Youth Wellbeing Trust is a fictional Kenyan NGO with two programmes, seven staff and four months of
              records. Choose who to be:
            </p>
            <ul className="mt-4 space-y-2">
              {DEMO_ROLES.map((r) => (
                <li key={r.key}>
                  <button
                    onClick={() => enterDemo(r.key)}
                    disabled={!!busy}
                    className="group flex w-full items-center justify-between gap-4 rounded-xl bg-mist px-4 py-3 text-left ring-1 ring-transparent hover:bg-sage hover:ring-pine/30 disabled:opacity-60"
                  >
                    <span>
                      <span className="block font-bold">{r.title}</span>
                      <span className="block text-sm text-muted">{r.sees}</span>
                    </span>
                    <span className="shrink-0 text-sm font-bold text-pine">{busy === r.key ? "Opening…" : "Enter"}</span>
                  </button>
                </li>
              ))}
            </ul>
            {busy && <p className="mt-3 text-sm text-muted">The first visit of the day can take up to a minute while the server wakes.</p>}
            {error && <p role="alert" className="mt-3 text-sm text-risk">{error}</p>}
          </div>
        )}
      </section>

      <section aria-label="Where Kumbuka is used" className="mx-auto max-w-6xl px-4 pb-16 md:px-8">
        <ul className="grid gap-4 md:grid-cols-3">
          {SETTINGS.map((x, i) => (
            <li key={x.k} className="overflow-hidden rounded-2xl bg-paper ring-1 ring-line">
              <div className="aspect-[4/3] overflow-hidden bg-sage">
                <Photo k={x.k} sizes="(min-width: 768px) 33vw, 100vw" eager={i === 0} />
              </div>
              <div className="p-4">
                <h2 className="font-bold">{x.title}</h2>
                <p className="mt-0.5 text-sm text-ink/75">{x.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-pine-deep text-mist">
        <div className="mx-auto max-w-6xl px-4 py-14 md:px-8">
          <h2 className="max-w-3xl font-serif text-3xl leading-tight md:text-4xl">
            Most mental health care in Africa is delivered by people who aren't psychiatrists.
          </h2>
          <dl className="mt-10 grid gap-8 md:grid-cols-3">
            {[
              ["≈150 million", "people in the WHO African Region live with a mental health condition"],
              ["2.2", "mental health workers per 100,000 people, against a global median of 13.5"],
              ["US$0.07", "spent on mental health per person in the region, against a global average of US$2.50"],
            ].map(([n, label]) => (
              <div key={n} className="flex flex-col-reverse">
                <dt className="mt-2 text-mist/80">{label}</dt>
                <dd className="font-serif text-4xl leading-none tabular-nums lg:text-5xl">{n}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-10 max-w-3xl text-lg leading-relaxed text-mist/90">
            The gap is filled by school counsellors, NGO staff and trained lay counsellors. Kumbuka gives them the records,
            supervision and evidence that clinics take for granted, so programmes that work can show it and grow.
          </p>
          <p className="mt-4 text-xs text-mist/60">
            Source: <a className="underline underline-offset-2" href={WHO_SOURCE} target="_blank" rel="noreferrer">WHO Regional Office for Africa, 2026</a>.
          </p>
        </div>
      </section>

      <section className="border-y border-line bg-paper">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-8">
          <h2 className="max-w-2xl font-serif text-3xl leading-tight md:text-4xl">From the counselling room to the funder report, without retyping anything.</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="font-serif text-4xl text-pine/70">{i + 1}</span>
                <h3 className="mt-2 font-bold">{s.title}</h3>
                <p className="mt-1 text-ink/75">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-16 md:grid-cols-[5fr_6fr] md:gap-14 md:px-8">
        <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-sage md:aspect-[4/5]">
          <Photo k="peers" sizes="(min-width: 768px) 45vw, 100vw" />
        </div>
        <div>
          <h2 className="font-serif text-3xl leading-tight">Made for how care is delivered here</h2>
          <ul className="mt-6 space-y-4 text-ink/85">
            <li><span className="font-bold">Task-sharing built in.</span> Roles for lay counsellors, supervisors, programme staff and M&E, each seeing only what they need.</li>
            <li><span className="font-bold">Groups, not just one-to-one.</span> Registers for school wellbeing circles and community support groups, with new members added on the spot.</li>
            <li><span className="font-bold">Referrals that close the loop.</span> Track every referral to a clinic, county children's office, GBV centre or legal aid, and whether the person got there.</li>
            <li><span className="font-bold">Speaks the way people speak.</span> Transcription handles sessions that move between English, Kiswahili and Sheng. Names and phone numbers are blanked out of the transcript.</li>
            <li><span className="font-bold">Phone-first.</span> Check-ins arrive by WhatsApp or SMS, and phone numbers work in all 54 African countries.</li>
            <li><span className="font-bold">Safeguarding for minors.</span> Guardian consent, restricted cases that only the counsellor and supervisor can open, and escalation to a clinician.</li>
          </ul>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-[6fr_5fr] md:gap-14 md:px-8">
        <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-sage md:order-2 md:aspect-[4/5]">
          <Photo k="family" sizes="(min-width: 768px) 45vw, 100vw" />
        </div>
        <div className="md:order-1">
          <h2 className="font-serif text-3xl leading-tight">Privacy you can explain to a parent</h2>
          <ul className="mt-6 space-y-4 text-ink/85">
            <li><span className="font-bold">Your records never train AI.</span> AI is optional and runs only with each client's consent, only through AI services that don't train on your data. Typed notes go without names, and recordings are transcribed then discarded, never stored.</li>
            <li><span className="font-bold">Reports protect small groups.</span> Any group of fewer than five people shows as "&lt;5", so nobody can be identified from a donor report.</li>
            <li><span className="font-bold">Every access is logged.</span> An activity log records who opened, changed, signed, printed or exported a record.</li>
            <li><span className="font-bold">Designed around Kenya's Data Protection Act.</span> Health data is treated as sensitive personal data, with two-step sign-in, automatic locking and signed records that can't be edited.</li>
          </ul>
        </div>
      </section>

      <section className="relative isolate overflow-hidden bg-pine text-mist">
        <div aria-hidden className="absolute inset-0 -z-10 opacity-25 mix-blend-luminosity">
          <Photo k="hands" sizes="100vw" />
        </div>
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-pine-deep via-pine/90 to-pine/70" />
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-16 md:px-8">
          <p className="max-w-2xl font-serif text-3xl leading-tight">Start with one programme and one team. Add the rest when you're ready.</p>
          <Link to="/login?mode=register" className="btn bg-mist px-5 py-3 text-base text-pine-deep">Set up your organisation</Link>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted md:px-8">
        <p>Kumbuka supports trained counsellors and supervisors. It does not diagnose, and it is not a crisis service. If someone is in danger, contact local emergency services.</p>
        <p className="mt-3 text-xs">
          Photos on{" "}
          <a className="underline underline-offset-2" href="https://unsplash.com/?utm_source=kumbuka&utm_medium=referral" target="_blank" rel="noreferrer">Unsplash</a>{" "}
          by{" "}
          {[...new Map(Object.values(PHOTO).map((p) => [p.user, p.by])).entries()].map(([user, by], i, all) => (
            <span key={user}>
              <a className="underline underline-offset-2" href={`https://unsplash.com/@${user}?utm_source=kumbuka&utm_medium=referral`} target="_blank" rel="noreferrer">{by}</a>
              {i < all.length - 2 ? ", " : i === all.length - 2 ? " and " : ""}
            </span>
          ))}
          . People shown are not Kumbuka clients.
        </p>
      </footer>
    </div>
  );
}
