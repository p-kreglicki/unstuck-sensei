import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  const profileRef = useRef<ProfileSettings | null>(null);
  const userId = user?.id ?? null;
  const accessToken = session?.access_token ?? null;
  const isSignedIn = session !== null;

  const setCurrentProfile = useCallback((nextProfile: ProfileSettings | null) => {
    profileRef.current = nextProfile;
    setProfile(nextProfile);
  }, []);

  useEffect(() => {
    let active = true;

    async function run() {
      if (!userId) {
        if (active) {
          setCurrentProfile(null);
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
        const nextProfile = await loadProfileSettings(userId);

        if (!active) {
          return;
        }

        setCurrentProfile(nextProfile);
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
  }, [isAccountDeletionInProgress, setCurrentProfile, userId]);

  const reload = useCallback(async () => {
    if (!userId || isAccountDeletionInProgress) {
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    try {
      const nextProfile = await loadProfileSettings(userId);
      setCurrentProfile(nextProfile);
    } catch (error) {
      setLoadError(toNetworkMessage(error, "Unable to load your settings right now."));
    } finally {
      setIsLoading(false);
    }
  }, [isAccountDeletionInProgress, setCurrentProfile, userId]);

  const updateProfile = useCallback(async (
    patch: ProfileSettingsPatch,
    options: MutationOptions,
  ): Promise<MutationResult> => {
    const previousProfile = profileRef.current;

    if (isAccountDeletionInProgress) {
      return {
        error: createDisplayError("Account deletion is in progress."),
        profile: previousProfile,
        warning: null,
      };
    }

    if (!userId) {
      return {
        error: createDisplayError("Sign in again and retry."),
        profile: previousProfile,
        warning: null,
      };
    }

    const optimistic = options.optimistic ?? true;

    if (optimistic && previousProfile) {
      setCurrentProfile({
        ...previousProfile,
        ...patch,
      });
    }

    try {
      const nextProfile = await saveProfileSettings(userId, patch);
      let warning: string | null = null;

      setCurrentProfile(nextProfile);

      if (isSignedIn && hasDetectionSettingsPatch(patch)) {
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
        setCurrentProfile(previousProfile);
      }

      return {
        error: createDisplayError(
          toNetworkMessage(error, options.fallbackMessage),
        ),
        profile: previousProfile,
        warning: null,
      };
    }
  }, [
    isAccountDeletionInProgress,
    isSignedIn,
    setCurrentProfile,
    syncConfig,
    userId,
  ]);

  const completeOnboarding = useCallback(async (input: {
    detectionSensitivity: DetectionSensitivity;
    preferredTime: string;
  }) => {
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
  }, [updateProfile]);

  const changePassword = useCallback(async (newPassword: string) => {
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
  }, [isAccountDeletionInProgress]);

  const deleteAccount = useCallback(async () => {
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

    if (!accessToken) {
      return {
        error: createDisplayError("Your session expired. Sign in again to continue."),
      };
    }

    try {
      startAccountDeletion();

      const response = await fetch(joinUrl(baseUrl, "/api/account/delete"), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
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
  }, [
    accessToken,
    cancelAccountDeletion,
    finishAccountDeletion,
    isAccountDeletionInProgress,
    startAccountDeletion,
  ]);

  const getLocalTimeZone = useCallback(() => resolveLocalTimeZone(), []);

  return useMemo<ProfileSettingsContextValue>(
    () => ({
      changePassword,
      completeOnboarding,
      deleteAccount,
      isLoading,
      loadError,
      profile,
      reload,
      resolveLocalTimeZone: getLocalTimeZone,
      updateProfile,
    }),
    [
      changePassword,
      completeOnboarding,
      deleteAccount,
      getLocalTimeZone,
      isLoading,
      loadError,
      profile,
      reload,
      updateProfile,
    ],
  );
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
