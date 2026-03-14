import { NavLink, Outlet } from "react-router";
import { useAuth } from "../hooks/useAuth";

const navItems = [
  { label: "Session", to: "/" },
  { label: "History", to: "/history" },
  { label: "Settings", to: "/settings" },
];

export function Layout() {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-transparent px-4 py-5 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-md flex-col rounded-[32px] border border-white/10 bg-slate-950/70 p-5 shadow-2xl shadow-slate-950/50 backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">
              Unstuck Sensei
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-white">
              Foundation Shell
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Phase 1 wires auth, navigation, tray behavior, and the desktop app skeleton.
            </p>
          </div>
          <button
            className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-slate-200 transition hover:border-white/30 hover:bg-white/5"
            onClick={() => {
              void signOut();
            }}
            type="button"
          >
            Sign out
          </button>
        </div>

        <nav className="mt-6 grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/5 p-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [
                  "rounded-[18px] px-3 py-2 text-center text-sm font-medium transition",
                  isActive
                    ? "bg-teal-400 text-slate-950"
                    : "text-slate-300 hover:bg-white/5 hover:text-white",
                ].join(" ")
              }
              end={item.to === "/"}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-6 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
          <span className="truncate">{user?.email ?? "Not signed in"}</span>
          <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
            Phase 1
          </span>
        </div>

        <div className="mt-6 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
