import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorText, Loading } from "../components/ui";
import type { Breakdown, Count, Outcome, Programme, Report } from "../types";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const PRESETS = [
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 3 months", days: 90 },
  { key: "180", label: "Last 6 months", days: 180 },
  { key: "365", label: "Last 12 months", days: 365 },
  { key: "custom", label: "Custom dates", days: 0 },
];

function longDate(s: string) {
  return new Date(s + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);

function Tile({ value, label, sub }: { value: string | number; label: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-paper p-5 ring-1 ring-line">
      <p className="font-serif text-5xl leading-none tracking-tight tabular-nums">{value}</p>
      <p className="mt-2 font-bold">{label}</p>
      {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
    </div>
  );
}

/** Single-series horizontal bars; one hue, values labelled, "<5" shown without a length. */
function Bars({ rows, title }: { rows: Breakdown; title: string }) {
  const nums = rows.map((r) => (typeof r.count === "number" ? r.count : 0));
  const max = Math.max(1, ...nums);
  return (
    <figure>
      <figcaption className="mb-2 font-bold">{title}</figcaption>
      {rows.length === 0 ? <p className="text-sm text-muted">No one in this period.</p> : (
        <ul className="space-y-1.5 text-sm">
          {rows.map((r) => (
            <li key={r.label} className="grid grid-cols-[8.5rem_1fr_2.5rem] items-center gap-2">
              <span className="truncate" title={r.label}>{r.label}</span>
              <span className="h-3.5 rounded-r-[4px] bg-mist">
                {typeof r.count === "number" && (
                  <span className="block h-full rounded-r-[4px] bg-[#00876f]" style={{ width: `${(r.count / max) * 100}%` }} title={`${r.label}: ${r.count}`} />
                )}
              </span>
              <span className="text-right tabular-nums">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

function OutcomeCard({ o }: { o: Outcome }) {
  const better = o.higher_is_better ? "higher" : "lower";
  return (
    <div className="rounded-xl bg-paper p-5 ring-1 ring-line">
      <h3 className="font-bold">{o.title}</h3>
      {o.with_follow_up === 0 ? (
        <p className="mt-2 text-sm text-muted">
          {o.screened_in_period ? `${o.screened_in_period} people screened, but none with a follow-up score yet.` : "Not used in this period."}
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <p className="font-serif text-4xl tabular-nums">{pct(o.improved_pct)}</p>
              <p className="text-sm">improved <span className="text-muted">({o.improved} of {o.with_follow_up})</span></p>
            </div>
            <div>
              <p className="font-serif text-4xl tabular-nums">{pct(o.recovered_pct)}</p>
              <p className="text-sm">recovered <span className="text-muted">({o.recovered} of {o.clinical_at_baseline})</span></p>
            </div>
          </div>
          <p className="mt-3 text-sm">
            Average score <span className="tabular-nums font-bold">{o.mean_baseline}</span> at first assessment,{" "}
            <span className="tabular-nums font-bold">{o.mean_latest}</span> at latest ({better} is better).
            {o.deteriorated > 0 && <span className="text-flag"> {o.deteriorated} got worse.</span>}
          </p>
        </>
      )}
      <p className="mt-3 text-xs text-muted">{o.definition}</p>
    </div>
  );
}

const show = (c: Count) => c;

function Narrative({ start, end, programmeId }: { start: string; end: string; programmeId: number | "" }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setText(""); setError(null); }, [start, end, programmeId]);

  async function write() {
    setBusy(true); setError(null);
    try { setText((await api.reportNarrative({ start, end, programme_id: programmeId })).narrative); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <section className={`mt-8 rounded-xl bg-paper p-5 ring-1 ring-line ${text ? "" : "print:hidden"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3 print:hidden">
        <div>
          <h2 className="font-serif text-2xl">Narrative for your funder</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            A first draft of the write-up for a grant or board report, using only the anonymised figures on this page.
            No names or case notes are sent. Check every sentence before you use it.
          </p>
        </div>
        <div className="flex gap-2">
          {text && (
            <button className="btn btn-quiet" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          <button className="btn btn-primary" onClick={write} disabled={busy}>{busy ? "Writing…" : text ? "Write again" : "Draft the narrative"}</button>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-risk">{error}</p>}
      {text && (
        <>
          <textarea rows={11} className="field note-text mt-4 print:hidden" value={text} onChange={(e) => setText(e.target.value)} aria-label="Narrative" />
          <div className="hidden whitespace-pre-wrap leading-relaxed print:block">{text}</div>
          <p className="mt-2 text-xs text-muted print:hidden">AI-drafted from the figures below. Edit freely; it's included when you print.</p>
        </>
      )}
    </section>
  );
}

export default function Reports() {
  const { me, config } = useAuth();
  const [preset, setPreset] = useState("90");
  const [start, setStart] = useState(iso(new Date(Date.now() - 89 * 864e5)));
  const [end, setEnd] = useState(iso(new Date()));
  const [programmeId, setProgrammeId] = useState<number | "">("");
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.programmes().then(setProgrammes).catch(() => {}); }, []);
  useEffect(() => {
    setLoading(true); setError(null);
    api.report({ start, end, programme_id: programmeId }).then(setR).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [start, end, programmeId]);

  function choose(key: string) {
    setPreset(key);
    const p = PRESETS.find((x) => x.key === key)!;
    if (p.days) { setEnd(iso(new Date())); setStart(iso(new Date(Date.now() - (p.days - 1) * 864e5))); }
  }

  async function exportCsv() {
    try {
      const blob = await api.reportCsv({ start, end, programme_id: programmeId });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `kumbuka-report-${start}-to-${end}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { setError((e as Error).message); }
  }

  const phq = r?.outcomes.find((o) => o.measure === "PHQ-9");

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">Programme report</h1>
          <p className="mt-1 text-muted">Anonymised figures for funders, boards and M&E, calculated directly from your records.</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button className="btn btn-quiet" onClick={() => window.print()} disabled={!r}>Print or save as PDF</button>
          <button className="btn btn-primary" onClick={exportCsv} disabled={!r}>Export CSV</button>
        </div>
      </header>

      <div className="mt-6 flex flex-wrap items-end gap-3 rounded-lg bg-paper p-3 ring-1 ring-line print:hidden">
        <label className="text-sm"><span className="mb-1 block font-bold">Period</span>
          <select className="field w-auto" value={preset} onChange={(e) => choose(e.target.value)}>
            {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        {preset === "custom" && (
          <>
            <label className="text-sm"><span className="mb-1 block font-bold">From</span><input className="field w-auto" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="text-sm"><span className="mb-1 block font-bold">To</span><input className="field w-auto" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          </>
        )}
        <label className="text-sm"><span className="mb-1 block font-bold">Programme</span>
          <select className="field w-auto" value={programmeId} onChange={(e) => setProgrammeId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">All programmes</option>
            {programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        {loading && <span className="pb-2 text-sm text-muted">Updating…</span>}
      </div>

      <ErrorText error={error} />
      {!r && !error && <Loading />}

      {r && (
        <div className={loading ? "opacity-60" : ""}>
          <p className="mt-6 text-sm text-muted">
            {r.organization}, {r.programme}. {longDate(r.period.start)} to {longDate(r.period.end)}. Prepared by {me?.name}.
          </p>

          {config?.ai_enabled && <Narrative start={start} end={end} programmeId={programmeId} />}

          <section className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile value={r.reach.clients_served} label="People reached" sub={`${r.reach.new_clients} new in this period`} />
            <Tile value={r.reach.individual_sessions + r.reach.group_attendances} label="Session attendances"
              sub={`${r.reach.individual_sessions} one-to-one, ${r.reach.group_attendances} in ${r.reach.group_sessions} groups`} />
            <Tile value={phq && phq.with_follow_up ? pct(phq.improved_pct) : "—"} label="Improved on PHQ-9"
              sub={phq && phq.with_follow_up ? `of ${phq.with_follow_up} with a follow-up score` : "No follow-up scores yet"} />
            <Tile value={pct(r.referrals.completion_rate_pct)} label="Referrals completed"
              sub={`${r.referrals.made} referrals made, ${r.referrals.open} still open`} />
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-2xl">Who we reached</h2>
            <div className="mt-4 grid gap-8 rounded-xl bg-paper p-5 ring-1 ring-line md:grid-cols-3">
              <Bars title="Gender" rows={r.by_gender} />
              <Bars title="Age" rows={r.by_age} />
              <Bars title="Location" rows={r.by_location} />
            </div>
            <p className="mt-2 text-sm text-muted">
              {show(r.reach.minors_served)} under 18. {r.reach.served_individually} seen one-to-one, {r.reach.served_in_groups} in groups (some both).
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-2xl">Outcomes</h2>
            <p className="mt-1 text-sm text-muted">People whose latest score in this period can be compared with their first score.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">{r.outcomes.map((o) => <OutcomeCard key={o.measure} o={o} />)}</div>
          </section>

          <section className="mt-12 grid gap-10 md:grid-cols-2">
            <div>
              <h2 className="font-serif text-2xl">By programme</h2>
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-muted">
                  <tr><th className="py-1.5 font-bold">Programme</th><th className="font-bold">People</th><th className="font-bold">One-to-one</th><th className="font-bold">Groups</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {r.by_programme.map((p) => (
                    <tr key={p.label}>
                      <td className="py-2">{p.label}{(p.location || p.funder) && <span className="block text-xs text-muted">{[p.location, p.funder && `funded by ${p.funder}`].filter(Boolean).join(", ")}</span>}</td>
                      <td className="tabular-nums">{p.clients_served}</td>
                      <td className="tabular-nums">{p.individual_sessions}</td>
                      <td className="tabular-nums">{p.group_sessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h2 className="font-serif text-2xl">Referrals</h2>
              <p className="mt-1 text-sm">{r.referrals.completed} of the referrals with a known result ended with the person attending.{r.referrals.overdue_follow_up > 0 && <span className="text-flag"> {r.referrals.overdue_follow_up} follow-ups are overdue.</span>}</p>
              <div className="mt-3"><Bars title="By service" rows={r.referrals.by_service} /></div>
            </div>
          </section>

          <section className="mt-12 grid gap-10 md:grid-cols-2">
            <div>
              <h2 className="font-serif text-2xl">Safeguarding</h2>
              <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-2 text-sm">
                <dt>Active clients at high risk</dt><dd className="tabular-nums font-bold">{r.safeguarding.high_risk_active}</dd>
                <dt>Active clients at medium risk</dt><dd className="tabular-nums font-bold">{r.safeguarding.medium_risk_active}</dd>
                <dt>PHQ-9 answers indicating thoughts of self-harm</dt><dd className="tabular-nums font-bold">{r.safeguarding.phq9_item9_flags}</dd>
                <dt>Cases escalated to a supervisor</dt><dd className="tabular-nums font-bold">{r.safeguarding.escalations_raised}</dd>
              </dl>
            </div>
            <div>
              <h2 className="font-serif text-2xl">Quality of records</h2>
              <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-2 text-sm">
                <dt>Notes signed within 48 hours</dt><dd className="tabular-nums font-bold">{pct(r.documentation.signed_within_48h_pct)}</dd>
                <dt>Notes waiting for supervisor review</dt><dd className="tabular-nums font-bold">{r.documentation.awaiting_review}</dd>
                <dt>Sessions without a signed note</dt><dd className="tabular-nums font-bold">{r.documentation.unsigned}</dd>
                <dt>Missed appointments (no-show rate)</dt><dd className="tabular-nums font-bold">{pct(r.reach.no_show_rate_pct)}</dd>
              </dl>
            </div>
          </section>

          <p className="mt-12 border-t border-line pt-4 text-xs text-muted">
            Groups of fewer than five people are shown as "&lt;5" so nobody can be identified. No names or contact details appear in
            this report or its export. Generated {r.generated_at.replace("T", " at ")}.
          </p>
        </div>
      )}
    </div>
  );
}
