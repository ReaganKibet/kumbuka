import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorText, Field } from "../components/ui";
import { ROLES } from "../lib/africa";

export default function Join() {
  const token = useParams().token ?? "";
  const { signIn } = useAuth();
  const nav = useNavigate();
  const [info, setInfo] = useState<{ organization_name: string; email: string; name: string | null; role: string } | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.publicInvite(token).then((i) => { setInfo(i); setName(i.name ?? ""); }).catch((e) => setGone(e.message));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api.acceptInvite(token, { name, password });
      signIn(r.token, r.therapist);
      nav("/settings?welcome=1");
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-mist px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-paper p-8 ring-1 ring-line">
        <p className="font-serif text-3xl text-pine">kumbuka</p>
        {gone ? (
          <>
            <p className="mt-6 font-serif text-2xl">{gone}</p>
            <Link to="/login" className="btn btn-quiet mt-6">Go to sign in</Link>
          </>
        ) : !info ? (
          <p className="mt-6 text-muted">Checking your invitation…</p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <h1 className="font-serif text-2xl leading-snug">Join {info.organization_name}</h1>
            <p className="text-sm text-muted">
              You've been invited as <span className="font-bold text-ink">{ROLES[info.role]?.label ?? info.role}</span>. {ROLES[info.role]?.help}
            </p>
            <Field label="Email"><input className="field bg-mist" value={info.email} readOnly /></Field>
            <Field label="Your name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></Field>
            <Field label="Choose a password" hint="At least 10 characters.">
              <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required autoComplete="new-password" />
            </Field>
            <ErrorText error={error} />
            <button className="btn btn-primary w-full justify-center py-2.5" disabled={busy}>{busy ? "Joining…" : "Join"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
