import { useEffect, useState } from "react";
import { api } from "../api";
import { ReferralRow } from "../components/client/ReferralsTab";
import { ErrorText, Loading } from "../components/ui";
import type { Referral } from "../types";

export default function Referrals() {
  const [rows, setRows] = useState<Referral[] | null>(null);
  const [openOnly, setOpenOnly] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setRows(null); api.referrals(openOnly).then(setRows).catch((e) => setError(e.message)); }, [openOnly]);

  const overdue = rows?.filter((r) => r.overdue) ?? [];
  const rest = rows?.filter((r) => !r.overdue) ?? [];
  const update = (u: Referral) => setRows((all) => all?.map((x) => (x.id === u.id ? u : x)) ?? null);

  return (
    <div className="max-w-4xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">Referrals</h1>
          <p className="mt-1 text-muted">Referrals to clinics, county offices, GBV centres and legal aid, and whether people got there.</p>
        </div>
        <select className="field w-auto" value={openOnly ? "open" : "all"} onChange={(e) => setOpenOnly(e.target.value === "open")} aria-label="Show">
          <option value="open">Waiting for follow-up</option>
          <option value="all">All referrals</option>
        </select>
      </header>
      <ErrorText error={error} />
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && (
        <p className="rounded-md border border-dashed border-line px-4 py-8 text-center text-muted">
          {openOnly ? "Nothing waiting for follow-up." : "No referrals yet. Make one from a client's Referrals tab."}
        </p>
      )}
      {overdue.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 font-bold text-risk">Follow-up overdue ({overdue.length})</h2>
          <ul className="divide-y divide-line rounded-lg border border-risk/30 bg-paper">{overdue.map((r) => <ReferralRow key={r.id} r={r} showClient onChange={update} />)}</ul>
        </section>
      )}
      {rest.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-paper">{rest.map((r) => <ReferralRow key={r.id} r={r} showClient onChange={update} />)}</ul>
      )}
    </div>
  );
}
