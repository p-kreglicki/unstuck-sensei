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
import { supabase } from "../lib/supabase";

type AuthResult = {
  error: Error | null;
};

type AuthContextValue = {
  isLoading: boolean;
  session: Session | null;
  signIn(email: string, password: string): Promise<AuthResult>;
  signOut(): Promise<void>;
  signUp(email: string, password: string): Promise<AuthResult>;
  user: User | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      const { data, error } = await supabase.auth.getSession();

      if (!active) {
        return;
      }

      if (error) {
        setSession(null);
        setUser(null);
      } else {
        setSession(data.session);
        setUser(data.session?.user ?? null);
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
      setUser(nextSession?.user ?? null);
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

    void invoke("update_tray_auth_state", {
      signedIn: Boolean(session),
    }).catch(() => {
      // Tray sync is helpful for desktop UX but should not block auth flows.
    });
  }, [session]);

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
    } finally {
      setIsLoading(false);
    }
  }

  async function signOut(): Promise<void> {
    setIsLoading(true);

    try {
      await supabase.auth.signOut();
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
