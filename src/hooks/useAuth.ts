import { enable as enableAutostart } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type AuthResult = {
  error: Error | null;
};

export function useAuth() {
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

  async function signIn(email: string, password: string): Promise<AuthResult> {
    setIsLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (!error) {
      try {
        await enableAutostart();
      } catch {
        // Autostart is helpful but not required for auth to succeed.
      }
    }

    setIsLoading(false);
    return { error };
  }

  async function signUp(email: string, password: string): Promise<AuthResult> {
    setIsLoading(true);
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
      try {
        await enableAutostart();
      } catch {
        // Autostart is helpful but not required for auth to succeed.
      }
    }

    setIsLoading(false);
    return { error };
  }

  async function signOut(): Promise<void> {
    await supabase.auth.signOut();
  }

  return {
    isLoading,
    session,
    signIn,
    signOut,
    signUp,
    user,
  };
}
