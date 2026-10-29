import { useEffect, useRef, type ReactNode } from "react";
import type { RiskLevel } from "../types";

export function fmtDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    weekday: withTime ? "short" : undefined, day: "numeric", month: "short",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** Value for <input type="datetime-local"> from a Date, in local time. */
export function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const riskStyle: Record<RiskLevel, string> = {
  none: "",
  low: "bg-sage text-pine-deep",
  medium: "bg-flag-soft text-flag",
  high: "bg-risk-soft text-risk",
};

export function RiskTag({ level }: { level: RiskLevel | string }) {
  if (level === "none") return null;
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-bold ${riskStyle[level as RiskLevel] ?? ""}`}>
      {level} risk
    </span>
  );
}

export function StatusTag({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "flag" | "pine" | "risk" }) {
  const t = {
    muted: "text-muted border-line",
    flag: "text-flag border-flag/40 bg-flag-soft",
    pine: "text-pine border-pine/30 bg-sage",
    risk: "text-risk border-risk/40 bg-risk-soft",
  }[tone];
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-xs font-bold ${t}`}>{children}</span>;
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <p role="alert" className="rounded-md bg-risk-soft px-3 py-2 text-sm text-risk">{error}</p>;
}

export function Loading() {
  return <p className="py-10 text-center text-muted">Loading…</p>;
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-xl border border-line bg-paper p-0 text-ink backdrop:bg-ink/40"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="font-serif text-xl">{title}</h2>
        <button className="rounded px-2 text-2xl leading-none text-muted hover:text-ink" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{open && children}</div>
    </dialog>
  );
}
