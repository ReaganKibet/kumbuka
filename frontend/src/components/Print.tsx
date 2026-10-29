import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

/** Page chrome for printable documents: a toolbar on screen, a clean A4 sheet on paper. */
export function PrintShell({ title, entity, entityId, children }: {
  title: string; entity: "session" | "client" | "letter"; entityId: number; children: ReactNode;
}) {
  const nav = useNavigate();
  useEffect(() => { const old = document.title; document.title = title; return () => { document.title = old; }; }, [title]);

  async function print() {
    api.auditEvent({ action: "print", entity, entity_id: entityId }).catch(() => {});
    window.print();
  }

  return (
    <div className="min-h-screen bg-mist print:bg-white">
      <div className="sticky top-0 z-10 border-b border-line bg-paper px-4 py-3 print:hidden">
        <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-3">
          <button className="text-sm text-muted hover:text-ink" onClick={() => (window.history.length > 1 ? nav(-1) : nav("/"))}>Back</button>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">Choose "Save as PDF" in the print dialog for a file.</span>
            <button className="btn btn-primary" onClick={print}>Print or save as PDF</button>
          </div>
        </div>
      </div>
      <article className="sheet mx-auto my-8 max-w-[210mm] bg-white px-[16mm] py-[18mm] text-ink shadow-sm ring-1 ring-line print:m-0 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        {children}
      </article>
    </div>
  );
}

export function Letterhead() {
  const { me } = useAuth();
  if (!me) return null;
  const contact = [me.phone, me.email].filter(Boolean).join("   ");
  return (
    <header className="mb-10 flex items-start justify-between gap-6 border-b-2 border-pine pb-4">
      <div>
        <p className="font-serif text-2xl text-pine">{me.practice_name || me.name}</p>
        {me.practice_name && <p className="text-sm">{me.name}{me.title ? `, ${me.title}` : ""}</p>}
        {!me.practice_name && me.title && <p className="text-sm">{me.title}</p>}
      </div>
      <div className="text-right text-xs leading-relaxed text-muted">
        {me.address && <p className="whitespace-pre-line">{me.address}</p>}
        {contact && <p>{contact}</p>}
        {me.license_no && <p>Reg. no. {me.license_no}</p>}
      </div>
    </header>
  );
}

export function Confidential() {
  return (
    <footer className="mt-12 border-t border-line pt-3 text-[10px] leading-snug text-muted">
      Confidential. This document contains private counseling information and is intended only for the named recipient.
      If you received it in error, please return or destroy it and inform the sender.
    </footer>
  );
}

export function SetupHint() {
  const { me } = useAuth();
  if (me?.practice_name || me?.title) return null;
  return (
    <p className="mx-auto mt-4 max-w-[210mm] rounded-md bg-flag-soft px-4 py-2 text-sm text-flag print:hidden">
      Add your practice name, title and registration number in Settings so they appear on the letterhead.
    </p>
  );
}
