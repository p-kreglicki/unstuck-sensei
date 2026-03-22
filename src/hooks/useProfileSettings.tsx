import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createDisplayError, toDisplayError } from "../lib/errors";
import {
  hasDetectionSettingsPatch,
  loadProfileSettings,
  resolveLocalTimeZone,
  saveProfileSettings,
  type DetectionSensitivity,
  type ProfileSettings,
  type ProfileSettingsPatch,
} from "../lib/profile-settings";
import { supabase } from "../lib/supabase";
import { useDetection } from "./useDetection";
import { useAuth } from "./useAuth";

type MutationOptions = {
  fallbackMessage: string;
  optimistic?: boolean;
};

type MutationResult = {
  error: Error | null;
  profile: ProfileSettings | null;
  warning: string | null;
};

type ProfileSettingsContextValue = {
  changePassword(newPassword: string): Promise<{ error: Error | null }>;
  completeOnboarding(input: {
    detectionSensitivity: DetectionSensitivity;
    preferredTime: string;
  }): Promise<MutationResult>;
  deleteAccount(): Promise<{ error: Error | null }>;
  isLoading: boolean;
  loadError: string | null;
  profile: ProfileSettings | null;
  reload(): Promise<void>;
  resolveLocalTimeZone(): string;
  updateProfile(
    patch: ProfileSettingsPatch,
    options: MutationOptions,
  ): Promise<MutationResult>;
};

const ProfileSettingsContext = createContext<ProfileSettingsContextValue | null>(null);

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function readApiError(response: Response) {
  try {
    const payload = await response.json();

    if (
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
    ) {
      return payload.error;
    }
  } catch {
    // Ignore invalid JSON responses.
  }

  return `The request failed with status ${response.status}.`;
}

function toNetworkMessage(error: unknown, fallbackMessage: string) {
  if (!navigator.onLine) {
    return "You’re offline. Reconnect and try again.";
  }

  return toDisplayError(error, fallbackMessage);
}

function useProvideProfileSettings(): ProfileSettingsContextValue {
  const {
    cancelAccountDeletion,
    finishAccountDeletion,
    isAccountDeletionInProgress,
    session,
    startAccountDeletion,
    user,
  } = useAuth();
  const { syncConfig } = useDetection();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileSettings | null>(null);

  useEffect(() => {
    let active = true;

    async function run() {
      if (!user?.id) {
        if (active) {
          setProfile(null);
          setLoadError(null);
          setIsLoading(false);
        }
        return;
      }

      if (isAccountDeletionInProgress) {
        if (active) {
          setLoadError(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setLoadError(null);

      try {
        const nextProfile = await loadProfileSettings(user.id);

        if (!active) {
          return;
        }

        setProfile(nextProfile);
      } catch (error) {
        if (!active) {
          return;
        }

        setLoadError(
          toNetworkMessage(error, "Unable to load your settings right now."),
        );
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void run();

    return () => {
      active = false;
    };
  }, [isAccountDeletionInProgress, user?.id]);

  async function reload() {
    if (!user?.id || isAccountDeletionInProgress) {
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    try {
      const nextProfile = await loadProfileSettings(user.id);
      setProfile(nextProfile);
    } catch (error) {
      setLoadError(toNetworkMessage(error, "Unable to load your settings right now."));
    } finally {
      setIsLoading(false);
    }
  }

  async function updateProfile(
    patch: ProfileSettingsPatch,
    options: MutationOptions,
  ): Promise<MutationResult> {
    if (isAccountDeletionInProgress) {
      return {
        error: createDisplayError("Account deletion is in progress."),
        profile,
        warning: null,
      };
    }

    if (!user?.id) {
      return {
        error: createDisplayError("Sign in again and retry."),
        profile,
        warning: null,
      };
    }

    const optimistic = options.optimistic ?? true;
    const previousProfile = profile;

    if (optimistic && previousProfile) {
      setProfile({
        ...previousProfile,
        ...patch,
      });
    }

    try {
      const nextProfile = await saveProfileSettings(user.id, patch);
      let warning: string | null = null;

      setProfile(nextProfile);

      if (session && hasDetectionSettingsPatch(patch)) {
        try {
          await syncConfig({
            signedIn: true,
            enabled: nextProfile.detectionEnabled,
            sensitivity: nextProfile.detectionSensitivity,
          });
        } catch {
          warning =
            "Settings saved, but the desktop detection runtime did not refresh until the next sync.";
        }
      }

      return {
        error: null,
        profile: nextProfile,
        warning,
      };
    } catch (error) {
      if (optimistic) {
        setProfile(previousProfile);
      }

      return {
        error: createDisplayError(
          toNetworkMessage(error, options.fallbackMessage),
        ),
        profile: previousProfile,
        warning: null,
      };
    }
  }

  async function completeOnboarding(input: {
    detectionSensitivity: DetectionSensitivity;
    preferredTime: string;
  }) {
    return updateProfile(
      {
        detectionSensitivity: input.detectionSensitivity,
        onboardingCompletedAt: new Date().toISOString(),
        preferredTime: input.preferredTime,
        timezone: resolveLocalTimeZone(),
      },
      {
        fallbackMessage: "Unable to finish setup right now.",
        optimistic: false,
      },
    );
  }

  async function changePassword(newPassword: string) {
    if (isAccountDeletionInProgress) {
      return {
        error: createDisplayError("Account deletion is in progress."),
      };
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      return {
        error: error
          ? createDisplayError(error.message)
          : null,
      };
    } catch (error) {
      return {
        error: createDisplayError(
          toNetworkMessage(error, "Unable to change your password right now."),
        ),
      };
    }
  }

  async function deleteAccount() {
    if (isAccountDeletionInProgress) {
      return {
        error: createDisplayError("Account deletion is already in progress."),
      };
    }

    const baseUrl = import.meta.env.VITE_VERCEL_API_URL?.trim();

    if (!baseUrl) {
      return {
        error: createDisplayError("VITE_VERCEL_API_URL is not configured."),
      };
    }

    if (!session?.access_token) {
      return {
        error: createDisplayError("Your session expired. Sign in again to continue."),
      };
    }

    try {
      startAccountDeletion();

      const response = await fetch(joinUrl(baseUrl, "/api/account/delete"), {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        cancelAccountDeletion();
        return {
          error: createDisplayError(await readApiError(response)),
        };
      }

      try {
        const { error } = await supabase.auth.signOut({ scope: "local" });

        if (error && import.meta.env.DEV) {
          console.warn("[auth] local sign-out failed after account deletion:", error);
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn("[auth] local sign-out threw after account deletion:", error);
        }
      } finally {
        finishAccountDeletion();
      }

      return {
        error: null,
      };
    } catch (error) {
      cancelAccountDeletion();
      return {
        error: createDisplayError(
          toNetworkMessage(error, "Unable to delete your account right now."),
        ),
      };
    }
  }

  return {
    changePassword,
    completeOnboarding,
    deleteAccount,
    isLoading,
    loadError,
    profile,
    reload,
    resolveLocalTimeZone,
    updateProfile,
  };
}

export function ProfileSettingsProvider({ children }: { children: ReactNode }) {
  const value = useProvideProfileSettings();

  return (
    <ProfileSettingsContext.Provider value={value}>
      {children}
    </ProfileSettingsContext.Provider>
  );
}

export function useProfileSettings() {
  const value = useContext(ProfileSettingsContext);

  if (!value) {
    throw new Error("useProfileSettings must be used within a ProfileSettingsProvider.");
  }

  return value;
}
