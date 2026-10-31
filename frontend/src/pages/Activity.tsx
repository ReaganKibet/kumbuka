import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ErrorText, fmtDate, Loading } from "../components/ui";
import type { AuditRow } from "../types";
import { useAuth } from "../auth";
import { isAdmin } from "../lib/roles";

const VERBS: Record<string, string> = {
  login: "Signed in", register: "Created account", create: "Created", update: "Edited", view: "Opened",
  view_brief: "Viewed the overview of", ai_brief: "Generated an AI summary for", ai_draft: "Drafted a note with AI for",
  sign: "Signed", addendum: "Added an addendum to", delete: "Deleted", export: "Downloaded the record of",
  login_failed: "Failed sign-in attempt", locked: "Account locked after failed sign-ins",
  password_changed: "Changed password", logout_all: "Signed out on all devices",
  "2fa_enabled": "Turned on two-step sign-in", "2fa_disabled": "Turned off two-step sign-in",
  "2fa_codes_renewed": "Replaced recovery codes", print: "Printed", revoke: "Cancelled",
  checkin_completed: "Client answered a check-in:", ai_letter: "Drafted a letter with AI for",
  submit_for_review: "Submitted for review", review_approve: "Co-signed", review_return: "Returned with feedback",
  escalate: "Escalated", resolve_escalation: "Closed the escalation for", invite: "Invited", join: "Joined",
  update_member: "Changed team settings for", transfer_caseload: "Transferred the caseload of", attendance: "Took the register for",
  view_report: "Viewed the programme report", export_report: "Exported the programme report",
};

function link(r: AuditRow) {
  if (r.entity_id == null || r.action === "delete") return null;
  if (r.entity === "client") return `/clients/${r.entity_id}`;
  if (r.entity === "session") return `/sessions/${r.entity_id}`;
  if (r.entity === "letter") return `/letters/${r.entity_id}`;
  if (r.entity === "group") return `/groups/${r.entity_id}`;
  return null;
}

export default function Activity() {
  const { me } = useAuth();
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.audit().then(setRows).catch((e) => setError(e.message)); }, []);

  return (
    <div className="max-w-3xl">
      <h1 className="font-serif text-4xl tracking-tight">Activity log</h1>
      <p className="mt-1 text-muted">
        Every time a record is opened, changed, signed or exported. {isAdmin(me) ? "As an administrator you see the whole organisation." : "You see your own actions."}
      </p>
      <ErrorText error={error} />
      {!rows && !error && <Loading />}
      {rows && (
        <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-paper text-sm">
          {rows.map((r) => {
            const to = link(r);
            const what = ["therapist", "organization"].includes(r.entity) ? "" : `${r.entity} #${r.entity_id ?? ""}`;
            return (
              <li key={r.id} className="grid grid-cols-[8.5rem_1fr] gap-3 px-4 py-2">
                <span className="tabular-nums text-muted">{fmtDate(r.at, true)}</span>
                <span>
                  {isAdmin(me) && <span className="font-bold">{r.actor_name}: </span>}
                  {VERBS[r.action] ?? r.action}{" "}
                  {to ? <Link className="underline underline-offset-2" to={to}>{what}</Link> : what}
                  {r.detail && ["update", "login", "locked", "checkin_completed", "create"].includes(r.action) && (
                    <span className="text-muted"> ({r.detail.replaceAll("_", " ")})</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
