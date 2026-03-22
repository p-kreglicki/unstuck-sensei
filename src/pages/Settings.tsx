import { useEffect, useState, type ReactNode } from "react";
import { useTimer } from "../hooks/useTimer";
import { useProfileSettings } from "../hooks/useProfileSettings";
import type { ProfileSettings } from "../lib/profile-settings";
import { PrivacyDashboard } from "../components/settings/PrivacyDashboard";
import { privacyBoundary } from "../lib/privacy-boundary";

type FeedbackTone = "error" | "success" | "warning";

type SectionFeedback = {
  message: string;
  tone: FeedbackTone;
};

const fieldClassName =
  "w-full rounded-[18px] border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300";
const buttonClassName =
  "rounded-[18px] bg-teal-400 px-4 py-3 font-medium text-slate-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60";

const feedbackToneStyles: Record<FeedbackTone, string> = {
  error: "border-rose-400/20 bg-rose-400/10 text-rose-100",
  success: "border-emerald-300/20 bg-emerald-300/10 text-emerald-100",
  warning: "border-amber-300/20 bg-amber-300/10 text-amber-100",
};

function SectionFeedbackMessage({ feedback }: { feedback: SectionFeedback | null }) {
  if (!feedback) {
    return null;
  }

  return (
    <p
      className={`rounded-[18px] border px-4 py-3 text-sm ${feedbackToneStyles[feedback.tone]}`}
      role={feedback.tone === "error" ? "alert" : "status"}
    >
      {feedback.message}
    </p>
  );
}

function SettingsSection(input: {
  children: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">
        {input.eyebrow}
      </p>
      <h2 className="mt-2 text-xl font-semibold text-white">{input.title}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-400">{input.description}</p>
      <div className="mt-5 space-y-4">{input.children}</div>
    </section>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange(nextValue: boolean): void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-[18px] border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-200">
      <span>{label}</span>
      <input
        checked={checked}
        className="h-4 w-4 accent-teal-400"
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
    </label>
  );
}

function DeleteAccountDialog(input: {
  error: string | null;
  isOpen: boolean;
  isSubmitting: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  if (!input.isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
      <div
        aria-modal="true"
        className="w-full max-w-md rounded-[28px] border border-rose-400/20 bg-slate-950 p-5 text-slate-100 shadow-2xl"
        role="dialog"
      >
        <p className="text-xs uppercase tracking-[0.3em] text-rose-200/80">
          Permanent action
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Delete this account?</h2>
        <p className="mt-4 text-sm leading-6 text-slate-300">
          This removes your profile, saved sessions, transcript history, and timer
          blocks. The desktop app signs out immediately after the server confirms the
          deletion.
        </p>
        {input.error ? (
          <p className="mt-4 rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {input.error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-3">
          <button
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/10"
            onClick={input.onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-full bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={input.isSubmitting}
            onClick={input.onConfirm}
            type="button"
          >
            {input.isSubmitting ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatPasswordError(message: string) {
  if (/reauth|fresh|session/i.test(message)) {
    return "Supabase needs a fresher sign-in before changing your password. Sign out, sign back in, and retry.";
  }

  return message;
}

export function Settings() {
  const timer = useTimer();
  const {
    changePassword,
    deleteAccount,
    isLoading,
    loadError,
    profile,
    reload,
    resolveLocalTimeZone,
    updateProfile,
  } = useProfileSettings();
  const [displayName, setDisplayName] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [preferredTime, setPreferredTime] = useState("09:00");
  const [detectionEnabled, setDetectionEnabled] = useState(true);
  const [detectionSensitivity, setDetectionSensitivity] = useState<
    "high" | "low" | "medium"
  >("medium");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [focusFeedback, setFocusFeedback] = useState<SectionFeedback | null>(null);
  const [emailFeedback, setEmailFeedback] = useState<SectionFeedback | null>(null);
  const [accountFeedback, setAccountFeedback] = useState<SectionFeedback | null>(null);
  const [passwordFeedback, setPasswordFeedback] = useState<SectionFeedback | null>(null);
  const [deleteFeedback, setDeleteFeedback] = useState<string | null>(null);
  const [isSavingFocus, setIsSavingFocus] = useState(false);
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  function applyFocusDraft(nextProfile: ProfileSettings) {
    setDetectionEnabled(nextProfile.detectionEnabled);
    setDetectionSensitivity(nextProfile.detectionSensitivity);
  }

  function applyEmailDraft(nextProfile: ProfileSettings) {
    setEmailEnabled(nextProfile.emailEnabled);
    setPreferredTime(nextProfile.preferredTime);
  }

  function applyAccountDraft(nextProfile: ProfileSettings) {
    setDisplayName(nextProfile.displayName);
  }

  useEffect(() => {
    if (!profile) {
      return;
    }

    applyFocusDraft(profile);
    applyEmailDraft(profile);
    applyAccountDraft(profile);
  }, [profile]);

  async function handleFocusSave() {
    setIsSavingFocus(true);
    setFocusFeedback(null);

    const result = await updateProfile(
      {
        detectionEnabled,
        detectionSensitivity,
      },
      {
        fallbackMessage: "Unable to save focus settings right now.",
      },
    );

    setIsSavingFocus(false);

    if (result.profile) {
      applyFocusDraft(result.profile);
    }

    if (result.error) {
      setFocusFeedback({
        message: result.error.message,
        tone: "error",
      });
      return;
    }

    setFocusFeedback({
      message: result.warning ?? "Focus settings saved.",
      tone: result.warning ? "warning" : "success",
    });
  }

  async function handleEmailSave() {
    setIsSavingEmail(true);
    setEmailFeedback(null);

    const result = await updateProfile(
      {
        emailEnabled,
        preferredTime,
        timezone: resolveLocalTimeZone(),
      },
      {
        fallbackMessage: "Unable to save daily email settings right now.",
      },
    );

    setIsSavingEmail(false);

    if (result.profile) {
      applyEmailDraft(result.profile);
    }

    if (result.error) {
      setEmailFeedback({
        message: result.error.message,
        tone: "error",
      });
      return;
    }

    setEmailFeedback({
      message: "Daily email settings saved.",
      tone: "success",
    });
  }

  async function handleAccountSave() {
    setIsSavingAccount(true);
    setAccountFeedback(null);

    const result = await updateProfile(
      {
        displayName: displayName.trim(),
      },
      {
        fallbackMessage: "Unable to save account settings right now.",
      },
    );

    setIsSavingAccount(false);

    if (result.profile) {
      applyAccountDraft(result.profile);
    }

    if (result.error) {
      setAccountFeedback({
        message: result.error.message,
        tone: "error",
      });
      return;
    }

    setAccountFeedback({
      message: "Account settings saved.",
      tone: "success",
    });
  }

  async function handlePasswordSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordFeedback(null);

    if (!password || !passwordConfirmation) {
      setPasswordFeedback({
        message: "Enter the new password twice before saving.",
        tone: "error",
      });
      return;
    }

    if (password !== passwordConfirmation) {
      setPasswordFeedback({
        message: "The password confirmation does not match.",
        tone: "error",
      });
      return;
    }

    setIsSavingPassword(true);
    const result = await changePassword(password);
    setIsSavingPassword(false);

    if (result.error) {
      setPasswordFeedback({
        message: formatPasswordError(result.error.message),
        tone: "error",
      });
      return;
    }

    setPassword("");
    setPasswordConfirmation("");
    setPasswordFeedback({
      message: "Password updated.",
      tone: "success",
    });
  }

  async function handleDeleteAccount() {
    setIsDeletingAccount(true);
    setDeleteFeedback(null);

    const result = await deleteAccount();

    setIsDeletingAccount(false);

    if (result.error) {
      setDeleteFeedback(result.error.message);
      return;
    }

    setIsDeleteOpen(false);
  }

  if (isLoading && !profile) {
    return (
      <div className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-300">
        Loading settings…
      </div>
    );
  }

  if (loadError && !profile) {
    return (
      <div className="rounded-[24px] border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
        <p>{loadError}</p>
        <button
          className="mt-3 rounded-full border border-white/10 px-4 py-2 text-white transition hover:bg-white/10"
          onClick={() => void reload()}
          type="button"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5">
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-5">
          <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">Settings</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">Preferences and privacy</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Update the defaults that shape focus nudges, daily email timing, and
            account access without leaving the desktop flow.
          </p>
        </div>

        <SettingsSection
          description="Detection settings save to your profile and push into the desktop runtime immediately. An active timer still suppresses nudges until that timer resolves."
          eyebrow="Focus detection"
          title="Nudge behavior"
        >
          <Toggle
            checked={detectionEnabled}
            label="Detection enabled"
            onChange={setDetectionEnabled}
          />
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
          <p className="text-sm leading-6 text-slate-400">
            Detection uses {privacyBoundary.trackedLocally[0].toLowerCase()} and{" "}
            {privacyBoundary.trackedLocally[1].toLowerCase()}. It never stores{" "}
            {privacyBoundary.neverCollected[0].toLowerCase()} or{" "}
            {privacyBoundary.neverCollected[1].toLowerCase()}.
          </p>
          {timer.state.status !== "idle" ? (
            <p className="rounded-[18px] border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
              A timer is active or awaiting check-in, so runtime suppression still wins
              until this block finishes.
            </p>
          ) : null}
          <button
            className={buttonClassName}
            disabled={isSavingFocus}
            onClick={() => void handleFocusSave()}
            type="button"
          >
            {isSavingFocus ? "Saving…" : "Save focus settings"}
          </button>
          <SectionFeedbackMessage feedback={focusFeedback} />
        </SettingsSection>

        <SettingsSection
          description="These preferences power the Phase 6 daily email schedule, so saves also refresh the stored time zone."
          eyebrow="Daily email"
          title="Delivery defaults"
        >
          <Toggle
            checked={emailEnabled}
            label="Email reminders enabled"
            onChange={setEmailEnabled}
          />
          <label className="block">
            <span className="mb-2 block text-sm text-slate-300">Preferred work time</span>
            <input
              className={fieldClassName}
              onChange={(event) => setPreferredTime(event.currentTarget.value)}
              type="time"
              value={preferredTime}
            />
          </label>
          <div className="rounded-[18px] border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
            Current time zone: <span className="text-white">{resolveLocalTimeZone()}</span>
          </div>
          <button
            className={buttonClassName}
            disabled={isSavingEmail}
            onClick={() => void handleEmailSave()}
            type="button"
          >
            {isSavingEmail ? "Saving…" : "Save email settings"}
          </button>
          <SectionFeedbackMessage feedback={emailFeedback} />
        </SettingsSection>

        <SettingsSection
          description="Display name lives in your profile. Password changes go through the signed-in Supabase session."
          eyebrow="Account"
          title="Profile and access"
        >
          <label className="block">
            <span className="mb-2 block text-sm text-slate-300">Display name</span>
            <input
              className={fieldClassName}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
              placeholder="founder"
              type="text"
              value={displayName}
            />
          </label>
          <button
            className={buttonClassName}
            disabled={isSavingAccount}
            onClick={() => void handleAccountSave()}
            type="button"
          >
            {isSavingAccount ? "Saving…" : "Save account settings"}
          </button>
          <SectionFeedbackMessage feedback={accountFeedback} />

          <form className="space-y-4 rounded-[20px] border border-white/10 bg-slate-950/40 p-4" onSubmit={(event) => void handlePasswordSubmit(event)}>
            <h3 className="text-lg font-semibold text-white">Change password</h3>
            <label className="block">
              <span className="mb-2 block text-sm text-slate-300">New password</span>
              <input
                autoComplete="new-password"
                className={fieldClassName}
                onChange={(event) => setPassword(event.currentTarget.value)}
                type="password"
                value={password}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm text-slate-300">Confirm password</span>
              <input
                autoComplete="new-password"
                className={fieldClassName}
                onChange={(event) => setPasswordConfirmation(event.currentTarget.value)}
                type="password"
                value={passwordConfirmation}
              />
            </label>
            <button className={buttonClassName} disabled={isSavingPassword} type="submit">
              {isSavingPassword ? "Updating…" : "Update password"}
            </button>
            <SectionFeedbackMessage feedback={passwordFeedback} />
          </form>
        </SettingsSection>

        <SettingsSection
          description="The same privacy boundary shown during onboarding lives here, alongside the permanent delete-account action."
          eyebrow="Privacy"
          title="What the app does and does not collect"
        >
          <PrivacyDashboard />
          <div className="rounded-[20px] border border-rose-400/20 bg-rose-400/10 p-4">
            <h3 className="text-lg font-semibold text-white">Delete account</h3>
            <p className="mt-2 text-sm leading-6 text-rose-100">
              Permanently remove your auth account plus the profile, sessions,
              transcript history, and timer blocks linked to it.
            </p>
            <button
              className="mt-4 rounded-[18px] bg-rose-500 px-4 py-3 font-medium text-white transition hover:bg-rose-400"
              onClick={() => setIsDeleteOpen(true)}
              type="button"
            >
              Delete account
            </button>
          </div>
        </SettingsSection>
      </div>

      <DeleteAccountDialog
        error={deleteFeedback}
        isOpen={isDeleteOpen}
        isSubmitting={isDeletingAccount}
        onCancel={() => {
          if (isDeletingAccount) {
            return;
          }

          setIsDeleteOpen(false);
          setDeleteFeedback(null);
        }}
        onConfirm={() => void handleDeleteAccount()}
      />
    </>
  );
}
