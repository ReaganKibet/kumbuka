import { useEffect, useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import type { Checkin, Client } from "../../types";
import { ErrorText, Field, fmtDate, Modal, StatusTag } from "../ui";

/** 07xx / 01xx / +254 / 254 → 2547xx… for wa.me links. */
export function waNumber(phone: string | null): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("0") && d.length === 10) d = "254" + d.slice(1);
  if ((d.startsWith("7") || d.startsWith("1")) && d.length === 9) d = "254" + d;
  return d.length >= 11 ? d : null;
}

const STATUS: Record<Checkin["status"], { label: string; tone: "muted" | "flag" | "pine" | "risk" }> = {
  pending: { label: "Waiting for the client", tone: "flag" },
  completed: { label: "Answered", tone: "pine" },
  expired: { label: "Expired", tone: "muted" },
  revoked: { label: "Cancelled", tone: "muted" },
};

export default function CheckinPanel({ client }: { client: Client }) {
  const { me } = useAuth();
  const [links, setLinks] = useState<Checkin[]>([]);
  const [open, setOpen] = useState(false);
  const [kinds, setKinds] = useState<string[]>(["PHQ-9", "GAD-7"]);
  const [days, setDays] = useState(3);
  const [created, setCreated] = useState<{ url: string; expires: string } | null>(null);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.checkins(client.id).then(setLinks).catch(() => {});
  useEffect(() => { load(); }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const first = (client.preferred_name || client.full_name).split(" ")[0];

  async function create() {
    setBusy(true); setError(null);
    try {
      const r = await api.createCheckin(client.id, { kinds, days });
      const url = `${window.location.origin}/checkin/${r.token}`;
      const by = me?.name.split(" ")[0] ?? "your counselor";
      setCreated({ url, expires: r.expires_at });
      setMessage(
        `Hi ${first}, it's ${by}. Before we next meet, please answer a few short questions here. It takes about 3 minutes:\n${url}\n` +
        `The link works once and expires on ${fmtDate(r.expires_at)}.`,
      );
      load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(message); setCopied(true); } catch { setCopied(false); }
  }

  async function revoke(c: Checkin) {
    if (!confirm("Cancel this link? The client won't be able to use it.")) return;
    await api.revokeCheckin(c.id);
    load();
  }

  function close() { setOpen(false); setCreated(null); setCopied(false); setError(null); }

  const wa = waNumber(client.phone);
  const pending = links.filter((l) => l.status === "pending");
  const recent = links.slice(0, 5);

  return (
    <section className="mb-8 rounded-lg bg-paper p-4 ring-1 ring-line">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold">Check-in before the session</h2>
          <p className="text-sm text-muted">Send {first} a link to answer questionnaires on their phone. Scores appear here automatically.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>Send a check-in link</button>
      </div>

      {recent.length > 0 && (
        <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
          {recent.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="tabular-nums text-muted">{fmtDate(l.created_at)}</span>
              <span>{l.kinds.join(" + ")}</span>
              <StatusTag tone={STATUS[l.status].tone}>{STATUS[l.status].label}</StatusTag>
              {l.status === "completed" && l.mood && <span className="text-muted">Mood {l.mood}/10</span>}
              {l.status === "pending" && (
                <button className="ml-auto text-xs text-muted hover:text-risk" onClick={() => revoke(l)}>Cancel link</button>
              )}
              {l.message && <p className="note-text basis-full text-ink/85">“{l.message}”</p>}
            </li>
          ))}
        </ul>
      )}
      {pending.length > 1 && <p className="mt-2 text-xs text-muted">{pending.length} links are still open. Cancel any you no longer need.</p>}

      <Modal open={open} onClose={close} title="Send a check-in link">
        {!created ? (
          <div className="space-y-5">
            <fieldset>
              <legend className="mb-2 text-sm font-bold">Questionnaires</legend>
              {["PHQ-9", "GAD-7"].map((k) => (
                <label key={k} className="flex items-center gap-2.5 py-1">
                  <input
                    type="checkbox" className="size-4 accent-pine" checked={kinds.includes(k)}
                    onChange={(e) => setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))}
                  />
                  {k === "PHQ-9" ? "PHQ-9 (low mood)" : "GAD-7 (anxiety)"}
                </label>
              ))}
              <p className="mt-1 text-xs text-muted">The client can also rate their mood and leave you a short message.</p>
            </fieldset>
            <Field label="Link expires after">
              <select className="field w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={1}>1 day</option><option value={3}>3 days</option><option value={7}>7 days</option>
              </select>
            </Field>
            <ErrorText error={error} />
            <button className="btn btn-primary" onClick={create} disabled={busy || kinds.length === 0}>
              {busy ? "Creating…" : "Create link"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">Edit the message if you like, then send it. For privacy it doesn't mention counseling.</p>
            <textarea className="field" rows={5} value={message} onChange={(e) => { setMessage(e.target.value); setCopied(false); }} aria-label="Message" />
            <div className="flex flex-wrap gap-2">
              {wa ? (
                <a className="btn btn-primary" href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer noopener">
                  Send on WhatsApp
                </a>
              ) : (
                <a className="btn btn-primary" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer noopener">
                  Share on WhatsApp
                </a>
              )}
              {client.phone && (
                <a className="btn btn-quiet" href={`sms:${client.phone.replace(/\s/g, "")}?&body=${encodeURIComponent(message)}`}>Send as SMS</a>
              )}
              <button className="btn btn-quiet" onClick={copy}>{copied ? "Copied" : "Copy message"}</button>
            </div>
            {!client.phone && <p className="text-xs text-muted">Add the client's phone number on their profile to send directly.</p>}
            <p className="text-xs text-muted">
              This link is shown only once. If it gets lost, cancel it and create a new one.
            </p>
            <button className="btn btn-quiet" onClick={close}>Done</button>
          </div>
        )}
      </Modal>
    </section>
  );
}
