import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { toDisplayError } from "../lib/errors";
import {
  hasCompletedOnboarding,
  loadProfileSettings,
} from "../lib/profile-settings";
import { useAuth } from "../hooks/useAuth";

type GateState = {
  error: string | null;
  isComplete: boolean;
  isLoading: boolean;
};

const initialState: GateState = {
  error: null,
  isComplete: false,
  isLoading: true,
};

export function OnboardingGate() {
  const { user } = useAuth();
  const location = useLocation();
  const [state, setState] = useState<GateState>(initialState);
  const [retryKey, setRetryKey] = useState(0);
  const isOnboardingRoute = location.pathname === "/onboarding";

  useEffect(() => {
    let active = true;

    async function run() {
      if (!user?.id) {
        if (active) {
          setState({
            error: null,
            isComplete: false,
            isLoading: false,
          });
        }
        return;
      }

      setState({
        error: null,
        isComplete: false,
        isLoading: true,
      });

      try {
        const profile = await loadProfileSettings(user.id);

        if (!active) {
          return;
        }

        setState({
          error: null,
          isComplete: hasCompletedOnboarding(profile),
          isLoading: false,
        });
      } catch (error) {
        if (!active) {
          return;
        }

        setState({
          error: toDisplayError(
            error,
            "Unable to verify your setup status right now.",
          ),
          isComplete: false,
          isLoading: false,
        });
      }
    }

    void run();

    return () => {
      active = false;
    };
  }, [retryKey, user?.id]);

  if (state.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm">
          Loading your setup…
        </div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
        <div className="w-full max-w-md rounded-[28px] border border-rose-400/20 bg-rose-400/10 p-5">
          <p className="text-xs uppercase tracking-[0.3em] text-rose-200/80">
            Setup blocked
          </p>
          <p className="mt-3 text-sm leading-6 text-rose-100">{state.error}</p>
          <button
            className="mt-4 rounded-full border border-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/10"
            onClick={() => setRetryKey((current) => current + 1)}
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!state.isComplete && !isOnboardingRoute) {
    return <Navigate replace to="/onboarding" />;
  }

  if (state.isComplete && isOnboardingRoute) {
    return <Navigate replace to="/" />;
  }

  return <Outlet />;
}
