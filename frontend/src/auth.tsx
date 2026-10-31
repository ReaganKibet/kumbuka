import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";
import type { AuthConfig, Therapist } from "./types";

type AuthState = {
  me: Therapist | null;
  setMe: (t: Therapist) => void;
  config: AuthConfig | null;
  ready: boolean;
  signIn: (token: string, me: Therapist) => void;
  signOut: (reason?: "locked" | "manual" | "demo") => void;
};

const Ctx = createContext<AuthState | null>(null);

/** Pages with unsaved work listen for this and save before the app locks. */
export const LOCK_EVENT = "kumbuka:before-lock";
/** Counts as activity: a session recording keeps the app from auto-locking mid-session. */
export const ACTIVITY_EVENT = "kumbuka:activity";
const WARN_SECONDS = 60;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Therapist | null>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api.authConfig().then(setConfig).catch(() => {});
    if (!getToken()) { setReady(true); return; }
    api.me().then(setMe).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);

  const signOut = useCallback((reason: "locked" | "manual" | "demo" = "manual") => {
    const wasDemo = !!me?.organization?.is_demo;
    setToken(null);
    setMe(null);
    // Full reload clears every bit of client data held in memory.
    window.location.assign(
      reason === "locked" ? "/login?locked=1" : reason === "demo" || wasDemo ? "/welcome#demo" : "/login",
    );
  }, [me]);

  const value: AuthState = {
    me,
    setMe,
    config,
    ready,
    signIn: (token, therapist) => { setToken(token); setMe(therapist); },
    signOut,
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      {me && <IdleLock minutes={config?.idle_lock_minutes ?? 15} onLock={() => signOut("locked")} />}
    </Ctx.Provider>
  );
}

function IdleLock({ minutes, onLock }: { minutes: number; onLock: () => void }) {
  const last = useRef(Date.now());
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const locking = useRef(false);

  useEffect(() => {
    const bump = () => { if (!locking.current) { last.current = Date.now(); setSecondsLeft(null); } };
    const events = ["pointerdown", "keydown", "scroll", "touchstart", "mousemove", ACTIVITY_EVENT] as const;
    let lastMove = 0;
    const onEvent = (e: Event) => {
      if (e.type === "mousemove") { const n = Date.now(); if (n - lastMove < 5000) return; lastMove = n; }
      bump();
    };
    events.forEach((ev) => window.addEventListener(ev, onEvent, { passive: true }));

    const timer = window.setInterval(() => {
      const left = Math.round((last.current + minutes * 60_000 - Date.now()) / 1000);
      if (left <= 0 && !locking.current) {
        locking.current = true;
        window.dispatchEvent(new Event(LOCK_EVENT)); // let open notes save themselves
        window.setTimeout(onLock, 1500);
      } else if (left <= WARN_SECONDS) {
        setSecondsLeft(Math.max(0, left));
      }
    }, 1000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, onEvent));
      window.clearInterval(timer);
    };
  }, [minutes, onLock]);

  if (secondsLeft === null) return null;
  return (
    <div role="alertdialog" aria-live="assertive" className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-ink px-4 py-3 text-mist print:hidden">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
        <p>For privacy, Kumbuka locks in <span className="font-bold tabular-nums">{secondsLeft}s</span>. Drafts are saved first.</p>
        <button className="btn bg-mist text-ink" onClick={() => { last.current = Date.now(); setSecondsLeft(null); }}>
          Stay signed in
        </button>
      </div>
    </div>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
