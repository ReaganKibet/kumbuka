import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import ClientForm from "../components/ClientForm";
import { ErrorText, Loading, RiskTag, StatusTag } from "../components/ui";
import Overview from "../components/client/Overview";
import SessionsTab from "../components/client/SessionsTab";
import MeasuresTab from "../components/client/MeasuresTab";
import GoalsTab from "../components/client/GoalsTab";
import LettersTab from "../components/client/LettersTab";
import type { Client } from "../types";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "sessions", label: "Sessions" },
  { id: "questionnaires", label: "Questionnaires" },
  { id: "goals", label: "Goals" },
  { id: "letters", label: "Letters" },
  { id: "profile", label: "Profile" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function age(dob: string | null) {
  if (!dob) return null;
  const b = new Date(dob), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--;
  return a;
}

export default function ClientPage() {
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "overview") as Tab;
  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.client(id).then(setClient).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorText error={error} />;
  if (!client) return <Loading />;

  const a = age(client.date_of_birth);

  async function exportRecord() {
    const data = await api.exportClient(id);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${client!.full_name.replace(/\s+/g, "-").toLowerCase()}-record.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <Link to="/clients" className="text-sm text-muted hover:text-ink">Clients</Link>

      <header className="mt-2 mb-6">
        <h1 className="font-serif text-5xl leading-tight tracking-tight">
          {client.preferred_name || client.full_name}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
          {client.preferred_name && <span>{client.full_name}</span>}
          {a !== null && <span>{a} years</span>}
          {client.phone && <span>{client.phone}</span>}
          <RiskTag level={client.risk_level} />
          {client.status !== "active" && <StatusTag>{client.status}</StatusTag>}
          {!client.consent_signed && <StatusTag tone="flag">Consent not recorded</StatusTag>}
        </p>
      </header>

      {(client.risk_level === "medium" || client.risk_level === "high") && (
        <div className="mb-6 rounded-lg border-l-4 border-risk bg-risk-soft px-4 py-3">
          <p className="font-bold text-risk">{client.risk_level === "high" ? "High" : "Medium"} risk</p>
          <p className="note-text mt-0.5 whitespace-pre-wrap">{client.risk_notes || "No safety plan recorded yet. Add one on the Profile tab."}</p>
        </div>
      )}

      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Client sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setParams(t.id === "overview" ? {} : { tab: t.id }, { replace: true })}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-bold ${
              tab === t.id ? "border-pine text-pine-deep" : "border-transparent text-muted hover:text-ink"
            }`}
            aria-current={tab === t.id ? "page" : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "overview" && <Overview client={client} />}
      {tab === "sessions" && <SessionsTab clientId={id} />}
      {tab === "questionnaires" && <MeasuresTab client={client} />}
      {tab === "goals" && <GoalsTab clientId={id} />}
      {tab === "letters" && <LettersTab client={client} />}
      {tab === "profile" && (
        <div className="max-w-3xl">
          <ClientForm
            full
            initial={client}
            submitLabel="Save changes"
            onSubmit={async (v) => { setClient(await api.updateClient(id, v)); }}
          />
          <div className="mt-10 border-t border-line pt-6">
            <h2 className="font-bold">Client's copy of their record</h2>
            <p className="mt-1 max-w-prose text-sm text-muted">
              Download everything held about this client, for an access request. Your private notes and raw dictation are left out.
            </p>
            <button className="btn btn-quiet mt-3" onClick={exportRecord}>Download record</button>
          </div>
        </div>
      )}
    </div>
  );
}
