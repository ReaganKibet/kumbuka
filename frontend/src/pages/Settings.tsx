import QRCode from "qrcode";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { api, setToken } from "../api";
import { useAuth } from "../auth";
import { ErrorText, Field } from "../components/ui";
import { OrgDetails, Programmes } from "../components/OrgSettings";
import { isAdmin } from "../lib/roles";

function Section({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line py-8 md:grid-cols-[16rem_1fr] md:gap-10">
      <div>
        <h2 className="font-serif text-2xl">{title}</h2>
        {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
      </div>
      <div className="max-w-xl">{children}</div>
    </section>
  );
}

function Profile() {
  const { me, setMe } = useAuth();
  const [v, setV] = useState({
    name: me?.name ?? "", title: me?.title ?? "", practice_name: me?.practice_name ?? "",
    phone: me?.phone ?? "", address: me?.address ?? "", license_no: me?.license_no ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const bind = (k: keyof typeof v) => ({
    value: v[k],
    onChange: (e: { target: { value: string } }) => { setV({ ...v, [k]: e.target.value }); setSaved(false); },
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try { setMe(await api.updateMe(v)); setSaved(true); } catch (err) { setError((err as Error).message); }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name"><input className="field" required {...bind("name")} /></Field>
        <Field label="Title" hint="e.g. Counselling Psychologist"><input className="field" {...bind("title")} /></Field>
        <Field label="Organisation name on letters" hint="Leave as your organisation, or your own practice name."><input className="field" {...bind("practice_name")} /></Field>
        <Field label="Registration number" hint="Your professional licence number."><input className="field" {...bind("license_no")} /></Field>
        <Field label="Practice phone"><input className="field" type="tel" {...bind("phone")} /></Field>
      </div>
      <Field label="Address"><textarea className="field" rows={2} {...bind("address")} /></Field>
      <ErrorText error={error} />
      <div className="flex items-center gap-3">
        <button className="btn btn-primary">Save details</button>
        {saved && <span className="text-sm text-pine">Saved</span>}
      </div>
    </form>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  function download() {
    const blob = new Blob([`Kumbuka recovery codes\nEach code works once.\n\n${codes.join("\n")}\n`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "kumbuka-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <div className="rounded-lg border border-flag/40 bg-flag-soft p-4">
      <p className="font-bold text-flag">Save these recovery codes now</p>
      <p className="mt-1 text-sm">If you lose your phone, each code lets you sign in once. They won't be shown again.</p>
      <ul className="mt-3 grid grid-cols-2 gap-1 font-mono text-sm tabular-nums">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <div className="mt-3 flex gap-2">
        <button className="btn btn-quiet bg-paper" onClick={download}>Download codes</button>
        <button className="btn btn-primary" onClick={onDone}>I've saved them</button>
      </div>
    </div>
  );
}

function TwoStep() {
  const { me, setMe } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "disable" | "renew">("idle");

  async function start() {
    setError(null);
    try {
      const s = await api.totpSetup();
      setSetup({ secret: s.secret, qr: await QRCode.toDataURL(s.otpauth_uri, { margin: 1, width: 200, color: { dark: "#1d2b2a", light: "#fbfcfb" } }) });
    } catch (e) { setError((e as Error).message); }
  }
  async function enable(e: FormEvent) {
    e.preventDefault(); setError(null);
    try { const r = await api.totpEnable(code); setCodes(r.recovery_codes); setSetup(null); setCode(""); setMe(await api.me()); }
    catch (err) { setError((err as Error).message); }
  }
  async function disable(e: FormEvent) {
    e.preventDefault(); setError(null);
    try { setMe(await api.totpDisable({ password, code })); setMode("idle"); setPassword(""); setCode(""); }
    catch (err) { setError((err as Error).message); }
  }
  async function renew(e: FormEvent) {
    e.preventDefault(); setError(null);
    try { const r = await api.totpNewCodes(code); setCodes(r.recovery_codes); setMode("idle"); setCode(""); setMe(await api.me()); }
    catch (err) { setError((err as Error).message); }
  }

  if (codes) return <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />;

  if (me?.totp_enabled) {
    return (
      <div className="space-y-4">
        <p className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-pine" aria-hidden /> On. You'll enter a code from your phone each time you sign in.</p>
        <p className="text-sm text-muted">{me.recovery_codes_left} recovery code{me.recovery_codes_left === 1 ? "" : "s"} left.</p>
        {mode === "idle" && (
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-quiet" onClick={() => setMode("renew")}>Get new recovery codes</button>
            <button className="btn btn-danger" onClick={() => setMode("disable")}>Turn off</button>
          </div>
        )}
        {mode === "renew" && (
          <form onSubmit={renew} className="space-y-3">
            <Field label="Current 6-digit code"><input className="field max-w-48" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required /></Field>
            <ErrorText error={error} />
            <div className="flex gap-2"><button className="btn btn-primary">Replace codes</button><button type="button" className="btn btn-quiet" onClick={() => setMode("idle")}>Cancel</button></div>
          </form>
        )}
        {mode === "disable" && (
          <form onSubmit={disable} className="space-y-3">
            <Field label="Password"><input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
            <Field label="6-digit code or a recovery code"><input className="field max-w-48" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required /></Field>
            <ErrorText error={error} />
            <div className="flex gap-2"><button className="btn btn-danger">Turn off two-step sign-in</button><button type="button" className="btn btn-quiet" onClick={() => setMode("idle")}>Cancel</button></div>
          </form>
        )}
      </div>
    );
  }

  if (setup) {
    return (
      <form onSubmit={enable} className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or similar).</li>
          <li>Scan this code, or type the key below into the app.</li>
          <li>Enter the 6-digit code the app shows.</li>
        </ol>
        <img src={setup.qr} alt="QR code for your authenticator app" width={200} height={200} className="rounded-md ring-1 ring-line" />
        <p className="break-all font-mono text-sm text-muted">{setup.secret.match(/.{1,4}/g)?.join(" ")}</p>
        <Field label="6-digit code"><input className="field max-w-48 text-lg tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode="numeric" required /></Field>
        <ErrorText error={error} />
        <div className="flex gap-2"><button className="btn btn-primary">Turn on</button><button type="button" className="btn btn-quiet" onClick={() => setSetup(null)}>Cancel</button></div>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <p>Off. Anyone with your password can open your clients' records.</p>
      <ErrorText error={error} />
      <button className="btn btn-primary" onClick={start}>Set up two-step sign-in</button>
    </div>
  );
}

function Password() {
  const { signIn } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault(); setError(null); setDone(false);
    try {
      const r = await api.changePassword({ current_password: current, new_password: next });
      signIn(r.token, r.therapist);
      setCurrent(""); setNext(""); setDone(true);
    } catch (err) { setError((err as Error).message); }
  }
  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Current password"><input className="field" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required /></Field>
      <Field label="New password" hint="At least 10 characters."><input className="field" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} required /></Field>
      <ErrorText error={error} />
      <div className="flex items-center gap-3">
        <button className="btn btn-primary">Change password</button>
        {done && <span className="text-sm text-pine">Changed. Other devices have been signed out.</span>}
      </div>
    </form>
  );
}

function Devices() {
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!confirm("Sign out of Kumbuka on every device, including this one?")) return;
    setBusy(true);
    try { await api.logoutAll(); } finally { setToken(null); window.location.assign("/login"); }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm">Use this if you signed in on a shared or lost device.</p>
      <button className="btn btn-quiet" onClick={go} disabled={busy}>Sign out everywhere</button>
    </div>
  );
}

export default function Settings() {
  const [params] = useSearchParams();
  const { config, me } = useAuth();
  const demo = !!me?.organization?.is_demo;
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return (
    <div>
      <h1 className="font-serif text-4xl tracking-tight">Settings</h1>
      {params.get("welcome") && (
        <p className="mt-4 max-w-2xl rounded-md bg-sage px-4 py-3 text-pine-deep">
          Welcome. {isAdmin(me) ? "Add your programmes and crisis lines, then invite your team from the Team page. " : ""}Add your details for printed notes and letters, then turn on two-step sign-in below.
        </p>
      )}
      <div className="mt-6">
        {isAdmin(me) && <Section title="Organisation" intro="Settings for everyone in your organisation."><OrgDetails /></Section>}
        {isAdmin(me) && <Section title="Programmes" intro="Funded programmes or service lines. Clients and groups belong to one, and reports can be filtered by it."><Programmes /></Section>}
        <Section title="Your details" intro="Shown on printed notes and letters you sign."><Profile /></Section>
        {demo ? (
          <Section title="Security"><p className="text-muted">Password and two-step sign-in are locked on shared demo accounts.</p></Section>
        ) : (
          <>
            <Section title="Two-step sign-in" intro="A code from your phone as well as your password. Strongly recommended for client records."><TwoStep /></Section>
            <Section title="Password"><Password /></Section>
            <Section title="Devices" intro={`Kumbuka also locks itself after ${config?.idle_lock_minutes ?? 15} minutes without activity.`}><Devices /></Section>
          </>
        )}
      </div>
    </div>
  );
}
