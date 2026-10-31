import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";
import { ROLES } from "../lib/africa";
import { canReport, isAdmin, isClinical, isSupervisor } from "../lib/roles";

export default function Layout() {
  const { me, signOut } = useAuth();
  const org = me?.organization;

  const links = [
    { to: "/", label: "Today", end: true, show: isClinical(me) },
    { to: "/clients", label: "Clients", show: isClinical(me) },
    { to: "/groups", label: "Groups", show: isClinical(me) },
    { to: "/referrals", label: "Referrals", show: isClinical(me) },
    { to: "/supervision", label: "Supervision", show: isSupervisor(me) },
    { to: "/reports", label: "Reports", show: canReport(me) },
    { to: "/team", label: "Team", show: isAdmin(me) },
    { to: "/activity", label: "Activity log", show: true },
    { to: "/settings", label: "Settings", show: true },
  ].filter((l) => l.show);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[14rem_1fr]">
      <aside className="border-b border-line bg-paper md:sticky md:top-0 md:flex md:h-screen md:flex-col md:border-r md:border-b-0 print:hidden">
        <div className="flex items-center justify-between px-5 py-4 md:block md:py-6">
          <div>
            <p className="font-serif text-2xl tracking-tight text-pine">kumbuka</p>
            {org && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{org.name}</p>}
          </div>
          <button className="text-sm text-muted md:hidden" onClick={() => signOut()}>Sign out</button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:px-3 md:pb-0">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-3 py-2 text-sm font-bold ${
                  isActive ? "bg-sage text-pine-deep" : "text-muted hover:bg-mist hover:text-ink"
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden px-5 pb-6 md:mt-auto md:block">
          <p className="text-sm font-bold">{me?.name}</p>
          <p className="text-xs text-muted">{me ? ROLES[me.role]?.label : ""}</p>
          {me && !me.totp_enabled && !org?.is_demo && (
            <NavLink to="/settings" className="mt-1 block text-xs text-flag underline underline-offset-2">Two-step sign-in is off</NavLink>
          )}
          <button
            className="mt-2 text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
            onClick={() => signOut()}
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="min-w-0">
        {org?.is_demo && (
          <div className="border-b border-flag/30 bg-flag-soft px-4 py-2 text-center text-sm text-flag print:hidden">
            You're exploring a demo organization as <span className="font-bold">{ROLES[me!.role]?.label}</span>. Every person and record here is fictional, and the demo resets daily.{" "}
            <button className="font-bold underline underline-offset-2" onClick={() => signOut()}>Try another role</button>
          </div>
        )}
        <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-10 md:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
