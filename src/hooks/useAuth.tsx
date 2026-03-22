import { enable as enableAutostart } from "@tauri-apps/plugin-autostart";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type AuthResult = {
  error: Error | null;
};

function toAuthError(error: unknown, fallbackMessage: string): Error {
  return error instanceof Error ? error : new Error(fallbackMessage);
}

type AuthContextValue = {
  cancelAccountDeletion(): void;
  finishAccountDeletion(): void;
  isLoading: boolean;
  isAccountDeletionInProgress: boolean;
  session: Session | null;
  signIn(email: string, password: string): Promise<AuthResult>;
  signOut(): Promise<AuthResult>;
  signUp(email: string, password: string): Promise<AuthResult>;
  startAccountDeletion(): void;
  user: User | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccountDeletionInProgress, setIsAccountDeletionInProgress] = useState(false);
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
      if (!nextSession) {
        setIsAccountDeletionInProgress(false);
      }
      setIsLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function maybeEnableAutostart() {
    try {
      await enableAutostart();
    } catch {
      // Autostart is helpful but not required for auth to succeed.
    }
  }

  function startAccountDeletion() {
    setIsAccountDeletionInProgress(true);
  }

  function cancelAccountDeletion() {
    setIsAccountDeletionInProgress(false);
  }

  function finishAccountDeletion() {
    setSession(null);
    setIsAccountDeletionInProgress(false);
    setIsLoading(false);
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
        cancelAccountDeletion,
        finishAccountDeletion,
        isLoading,
        isAccountDeletionInProgress,
        session,
        signIn,
        signOut,
        signUp,
        startAccountDeletion,
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
