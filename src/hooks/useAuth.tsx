import { enable as enableAutostart } from "@tauri-apps/plugin-autostart";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { supabase } from "../lib/supabase";

type AuthResult = {
  error: Error | null;
};

function toAuthError(error: unknown, fallbackMessage: string): Error {
  return error instanceof Error ? error : new Error(fallbackMessage);
}

type AuthContextValue = {
  isLoading: boolean;
  session: Session | null;
  signIn(email: string, password: string): Promise<AuthResult>;
  signOut(): Promise<AuthResult>;
  signUp(email: string, password: string): Promise<AuthResult>;
  user: User | null;
};

type DetectionSensitivity = NonNullable<
  Database["public"]["Tables"]["profiles"]["Row"]["detection_sensitivity"]
>;

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadDetectionConfig(userId: string): Promise<{
  enabled: boolean;
  sensitivity: DetectionSensitivity;
}> {
  const { data, error } = await supabase
    .from("profiles")
    .select("detection_enabled, detection_sensitivity")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const profile = data as
    | {
        detection_enabled: boolean | null;
        detection_sensitivity: DetectionSensitivity | null;
      }
    | null;

  return {
    enabled: profile?.detection_enabled ?? true,
    sensitivity: profile?.detection_sensitivity ?? "medium",
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const user = session?.user ?? null;

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      const { data, error } = await supabase.auth.getSession();

      if (!active) {
        return;
      }

      if (error) {
        setSession(null);
      } else {
        setSession(data.session);
      }

      setIsLoading(false);
    }

    void restoreSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) {
        return;
      }

      setSession(nextSession);
      setIsLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let cancelled = false;

    async function syncDetectionConfig() {
      try {
        if (!session?.user.id) {
          await invoke("sync_detection_config", {
            signedIn: false,
            enabled: false,
            sensitivity: "medium",
          });
          return;
        }

        const { enabled, sensitivity } = await loadDetectionConfig(session.user.id);

        if (cancelled) {
          return;
        }

        await invoke("sync_detection_config", {
          signedIn: true,
          enabled,
          sensitivity,
        });
      } catch (error) {
        // Detection sync is helpful for desktop UX but should not block auth flows.
        if (import.meta.env.DEV) {
          console.warn("[detection] sync failed:", error);
        }
      }
    }

    void syncDetectionConfig();

    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  async function maybeEnableAutostart() {
    try {
      await enableAutostart();
    } catch {
      // Autostart is helpful but not required for auth to succeed.
    }
  }

  async function signIn(email: string, password: string): Promise<AuthResult> {
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (!error) {
        await maybeEnableAutostart();
      }

      return { error };
    } catch (error) {
      return {
        error: toAuthError(error, "Unable to sign in right now."),
      };
    } finally {
      setIsLoading(false);
    }
  }

  async function signUp(email: string, password: string): Promise<AuthResult> {
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: email.split("@")[0] ?? "founder",
          },
        },
      });

      if (!error) {
        await maybeEnableAutostart();
      }

      return { error };
    } catch (error) {
      return {
        error: toAuthError(error, "Unable to sign up right now."),
      };
    } finally {
      setIsLoading(false);
    }
  }

  async function signOut(): Promise<AuthResult> {
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.signOut();
      return { error };
    } catch (error) {
      return {
        error: toAuthError(error, "Unable to sign out right now."),
      };
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthContext.Provider
      value={{
        isLoading,
        session,
        signIn,
        signOut,
        signUp,
        user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }

  return value;
}
