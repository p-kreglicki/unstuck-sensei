import { useState } from "react";
import { useNavigate } from "react-router";
import { useDetection } from "../hooks/useDetection";

function formatCommandError(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Command failed.";
}

export function DetectionNudgeBanner() {
  const navigate = useNavigate();
  const { dismissNudge, state } = useDetection();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!state.nudgeActive) {
    return null;
  }

  async function handleDismiss() {
    setError(null);
    setIsSubmitting(true);

    try {
      await dismissNudge();
    } catch (nextError) {
      setError(formatCommandError(nextError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleStartSession() {
    setError(null);
    setIsSubmitting(true);

    try {
      await dismissNudge();
      navigate("/");
    } catch (nextError) {
      setError(formatCommandError(nextError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="mt-4 rounded-[28px] border border-teal-300/20 bg-teal-400/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-teal-200/80">
            Stuck nudge
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">
            Looks like you were bouncing around. Want to talk it through?
          </h2>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="rounded-full bg-teal-300 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
          onClick={() => void handleStartSession()}
          type="button"
        >
          Start session
        </button>
        <button
          className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-100 transition hover:border-white/20 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
          onClick={() => void handleDismiss()}
          type="button"
        >
          Dismiss
        </button>
      </div>

      {error ? (
        <p className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </p>
      ) : null}
    </section>
  );
}
