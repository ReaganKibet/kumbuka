import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";

const links = [
  { to: "/", label: "Today", end: true },
  { to: "/clients", label: "Clients", end: false },
  { to: "/activity", label: "Activity log", end: false },
  { to: "/settings", label: "Settings", end: false },
];

export default function Layout() {
  const { me, signOut } = useAuth();

  return (
    <div className="min-h-screen md:grid md:grid-cols-[13.5rem_1fr]">
      <aside className="border-b border-line bg-paper md:sticky md:top-0 md:h-screen md:border-r md:border-b-0 print:hidden">
        <div className="flex items-center justify-between px-5 py-4 md:block md:py-6">
          <p className="font-serif text-2xl tracking-tight text-pine">kumbuka</p>
          <p className="hidden text-xs text-muted md:mt-0.5 md:block">Session notes for counselors</p>
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
        <div className="hidden px-5 md:absolute md:bottom-6 md:block">
          <p className="text-sm font-bold">{me?.name}</p>
          {me && !me.totp_enabled && (
            <NavLink to="/settings" className="mt-1 block text-xs text-flag underline underline-offset-2">Two-step sign-in is off</NavLink>
          )}
          <button
            className="mt-1 text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
            onClick={() => signOut()}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-10 md:py-10">
        <Outlet />
      </main>
    </div>
  );
}
