import { Navigate, Outlet, useLocation } from "react-router";
import { useProfileSettings } from "../hooks/useProfileSettings";
import { hasCompletedOnboarding } from "../lib/profile-settings";

export function OnboardingGate() {
  const location = useLocation();
  const { isLoading, loadError, profile, reload } = useProfileSettings();
  const isOnboardingRoute = location.pathname === "/onboarding";
  const isComplete = profile ? hasCompletedOnboarding(profile) : false;

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm">
          Loading your setup…
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
        <div className="w-full max-w-md rounded-[28px] border border-rose-400/20 bg-rose-400/10 p-5">
          <p className="text-xs uppercase tracking-[0.3em] text-rose-200/80">
            Setup blocked
          </p>
          <p className="mt-3 text-sm leading-6 text-rose-100">{loadError}</p>
          <button
            className="mt-4 rounded-full border border-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/10"
            onClick={() => void reload()}
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!isComplete && !isOnboardingRoute) {
    return <Navigate replace to="/onboarding" />;
  }

  if (isComplete && isOnboardingRoute) {
    return <Navigate replace to="/" />;
  }

  return <Outlet />;
}
