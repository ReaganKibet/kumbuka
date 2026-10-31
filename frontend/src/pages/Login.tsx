import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Photo } from "../lib/photos";
import { ErrorText, Field } from "../components/ui";
import { COUNTRIES, ORG_KINDS } from "../lib/africa";
import type { OrgKind } from "../types";

export default function Login() {
  const { me, signIn } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">(params.get("mode") === "register" ? "register" : "login");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [orgKind, setOrgKind] = useState<OrgKind>("ngo");
  const [country, setCountry] = useState("KE");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waking, setWaking] = useState(false);
  const [next, setNext] = useState("/");
  // null = still asking the server (it may be waking up), "offline" = couldn't reach it
  const [registration, setRegistration] = useState<boolean | null | "offline">(null);

  // A free server sleeps when idle. Wake it while the counselor types, and find out
  // whether this site still needs its first account. Retries cover a slow wake-up.
  useEffect(() => {
    let cancelled = false;
    const slow = window.setTimeout(() => setWaking(true), 2500);
    (async () => {
      for (let attempt = 0; attempt < 4 && !cancelled; attempt++) {
        try {
          const c = await api.authConfig();
          if (!cancelled) setRegistration(c.registration_open);
          break;
        } catch {
          if (attempt === 3 && !cancelled) setRegistration("offline");
          else await new Promise((r) => setTimeout(r, 5000));
        }
      }
      window.clearTimeout(slow);
      if (!cancelled) setWaking(false);
    })();
    return () => { cancelled = true; window.clearTimeout(slow); };
  }, []);

  if (me) return <Navigate to={next} replace />;

  const notice = params.get("locked")
    ? "Kumbuka locked after a period of inactivity. Sign in to carry on."
    : params.get("expired") ? "Your sign-in expired. Please sign in again." : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mfaToken) {
        const r = await api.loginMfa({ mfa_token: mfaToken, code });
        signIn(r.token, r.therapist);
        nav("/");
      } else if (mode === "register") {
        const r = await api.register({ name, email, password, organization_name: orgName, organization_kind: orgKind, country });
        setNext("/settings?welcome=1");
        signIn(r.token, r.therapist);
      } else {
        const r = await api.login({ email, password });
        if (r.mfa_required && r.mfa_token) { setMfaToken(r.mfa_token); setPassword(""); }
        else if (r.token && r.therapist) { signIn(r.token, r.therapist); nav("/"); }
      }
    } catch (err) {
      setError((err as Error).message);
      if (mfaToken && (err as Error).message.includes("expired")) { setMfaToken(null); setCode(""); }
    } finally {
      setBusy(false);
    }
  }

  const canRegister = registration === true;
  const heading = mfaToken ? "Enter your code" : mode === "login" ? "Sign in" : "Set up your organisation";

  return (
    <div className="grid min-h-screen md:grid-cols-[1fr_28rem]">
      <section className="relative isolate hidden flex-col justify-end overflow-hidden bg-pine p-12 text-mist md:flex">
        <div aria-hidden className="absolute inset-0 -z-10">
          <Photo k="group" sizes="60vw" eager />
        </div>
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-pine-deep via-pine-deep/75 to-pine-deep/10" />
        <Link to="/welcome" className="font-serif text-6xl leading-none tracking-tight">kumbuka</Link>
        <p className="mt-4 max-w-md font-serif text-xl leading-relaxed text-mist/85">
          Counselling records, supervision and impact reporting for Africa's schools, NGOs and counselling centres.
        </p>
      </section>

      <section className="flex flex-col justify-center bg-paper px-6 py-12 md:px-12">
        <Link to="/welcome" className="mb-8 font-serif text-4xl text-pine md:hidden">kumbuka</Link>
        {notice && !mfaToken && <p className="mb-6 rounded-md bg-sage px-3 py-2 text-sm text-pine-deep">{notice}</p>}
        <h1 className="font-serif text-3xl">{heading}</h1>
        {mode === "register" && !mfaToken && (
          <p className="mt-1 text-sm text-muted">You'll be the owner. Invite your counsellors, supervisors and M&E staff once you're in.</p>
        )}

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mfaToken ? (
            <Field label="6-digit code from your authenticator app" hint="Lost your phone? Enter one of your recovery codes instead.">
              <input
                className="field text-lg tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} required
                autoComplete="one-time-code" inputMode="text" autoFocus maxLength={20}
              />
            </Field>
          ) : (
            <>
              {mode === "register" && (
                <>
                  <Field label="Organisation name" hint="Your NGO, school, centre or practice.">
                    <input className="field" value={orgName} onChange={(e) => setOrgName(e.target.value)} required autoComplete="organization" />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Type">
                      <select className="field" value={orgKind} onChange={(e) => setOrgKind(e.target.value as OrgKind)}>
                        {Object.entries(ORG_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </Field>
                    <Field label="Country">
                      <select className="field" value={country} onChange={(e) => setCountry(e.target.value)}>
                        {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Your name">
                    <input className="field" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
                  </Field>
                </>
              )}
              <Field label="Email">
                <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </Field>
              <Field label="Password" hint={mode === "register" ? "At least 10 characters. A short sentence works well." : undefined}>
                <input
                  className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                  minLength={mode === "register" ? 10 : undefined}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </Field>
            </>
          )}
          <ErrorText error={error} />
          <button className="btn btn-primary w-full justify-center py-2.5" disabled={busy}>
            {busy ? "Please wait…" : mfaToken ? "Verify" : mode === "login" ? "Sign in" : "Create organisation"}
          </button>
          {waking && <p className="text-center text-sm text-muted">Waking the server up. The first sign-in of the day can take up to a minute.</p>}
        </form>

        {mfaToken ? (
          <button className="mt-6 text-sm text-muted underline underline-offset-2 hover:text-ink" onClick={() => { setMfaToken(null); setCode(""); setError(null); }}>
            Start again
          </button>
        ) : mode === "register" ? (
          <button className="mt-6 text-sm text-muted underline underline-offset-2 hover:text-ink" onClick={() => { setMode("login"); setError(null); }}>
            Already have an account? Sign in
          </button>
        ) : (
          <div className="mt-6 border-t border-line pt-5 text-sm">
            {registration === null && <p className="text-muted">Checking whether this site is set up…</p>}
            {canRegister && (
              <>
                <p className="text-muted">New to Kumbuka?</p>
                <button className="btn btn-quiet mt-2 w-full justify-center" onClick={() => { setMode("register"); setError(null); }}>
                  Set up your organisation
                </button>
              </>
            )}
            {registration === false && (
              <p className="text-muted">
                New organisations can't sign up here. If you work for an organisation that uses Kumbuka, ask its administrator for an invitation link.
              </p>
            )}
            {registration === "offline" && (
              <p className="text-muted">Can't reach the server right now. Check your connection and reload the page.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
