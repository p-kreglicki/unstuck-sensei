import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { OnboardingShell } from "../components/OnboardingShell";
import { useProfileSettings } from "../hooks/useProfileSettings";
import { privacyBoundary, privacyBoundaryIntro } from "../lib/privacy-boundary";

const fieldClassName =
  "w-full rounded-[18px] border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300";
const submitClassName =
  "w-full rounded-[18px] bg-teal-400 px-4 py-3 font-medium text-slate-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60";

export function Onboarding() {
  const navigate = useNavigate();
  const {
    completeOnboarding,
    isLoading,
    loadError,
    profile,
    reload,
    resolveLocalTimeZone,
  } = useProfileSettings();
  const [preferredTime, setPreferredTime] = useState("09:00");
  const [detectionSensitivity, setDetectionSensitivity] = useState<
    "high" | "low" | "medium"
  >("medium");
  const [feedback, setFeedback] = useState<{
    message: string;
    tone: "error" | "warning";
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!profile) {
      return;
    }

    setPreferredTime(profile.preferredTime);
    setDetectionSensitivity(profile.detectionSensitivity);
  }, [profile]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    setIsSaving(true);

    const result = await completeOnboarding({
      detectionSensitivity,
      preferredTime,
    });

    setIsSaving(false);

    if (result.error) {
      setFeedback({
        message: result.error.message,
        tone: "error",
      });
      return;
    }

    if (result.warning) {
      setFeedback({
        message: result.warning,
        tone: "warning",
      });
    }

    navigate("/", { replace: true });
  }

  return (
    <OnboardingShell>
      <div className="rounded-[28px] border border-white/10 bg-white/5 p-5">
        {loadError ? (
          <div className="rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            <p>{loadError}</p>
            <button
              className="mt-3 rounded-full border border-white/10 px-4 py-2 text-white transition hover:bg-white/10"
              onClick={() => void reload()}
              type="button"
            >
              Retry
            </button>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
            <label className="block">
              <span className="mb-2 block text-sm text-slate-300">
                Preferred work time
              </span>
              <input
                className={fieldClassName}
                disabled={isLoading || isSaving}
                onChange={(event) => setPreferredTime(event.currentTarget.value)}
                type="time"
                value={preferredTime}
              />
            </label>

            <fieldset>
              <legend className="mb-2 block text-sm text-slate-300">
                Default detection sensitivity
              </legend>
              <div className="grid grid-cols-3 gap-2 rounded-[18px] border border-white/10 bg-slate-900/60 p-1">
                {(["low", "medium", "high"] as const).map((value) => (
                  <button
                    key={value}
                    className={[
                      "rounded-[14px] px-3 py-2 text-sm font-medium capitalize transition",
                      detectionSensitivity === value
                        ? "bg-teal-400 text-slate-950"
                        : "text-slate-300 hover:bg-white/5 hover:text-white",
                    ].join(" ")}
                    onClick={() => setDetectionSensitivity(value)}
                    type="button"
                  >
                    {value}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Low is calmer. High nudges faster when you start bouncing.
              </p>
            </fieldset>

            <section className="rounded-[20px] border border-white/10 bg-slate-950/40 p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">
                Privacy boundary
              </p>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {privacyBoundaryIntro}
              </p>
              <div className="mt-4 grid gap-4">
                <div>
                  <h2 className="text-sm font-medium text-white">Tracked locally</h2>
                  <ul className="mt-2 space-y-2 text-sm text-slate-400">
                    {privacyBoundary.trackedLocally.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h2 className="text-sm font-medium text-white">Never collected</h2>
                  <ul className="mt-2 space-y-2 text-sm text-slate-400">
                    {privacyBoundary.neverCollected.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            <div className="rounded-[18px] border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
              Time zone detected: <span className="text-white">{resolveLocalTimeZone()}</span>
            </div>

            <button
              className={submitClassName}
              disabled={isLoading || isSaving}
              type="submit"
            >
              {isSaving ? "Saving setup…" : "Enter the session flow"}
            </button>

            {feedback ? (
              <p
                className={[
                  "rounded-[18px] border px-4 py-3 text-sm",
                  feedback.tone === "warning"
                    ? "border-amber-400/20 bg-amber-400/10 text-amber-100"
                    : "border-rose-400/20 bg-rose-400/10 text-rose-100",
                ].join(" ")}
                role={feedback.tone === "error" ? "alert" : "status"}
              >
                {feedback.message}
              </p>
            ) : null}
          </form>
        )}
      </div>
    </OnboardingShell>
  );
}
