import { createClient } from "@supabase/supabase-js";
import { invoke } from "@tauri-apps/api/core";
import type { Database } from "./database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase environment variables are missing. Auth flows will remain unavailable until VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are configured.",
  );
}

const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return await invoke<string>("plugin:secure-storage|get", { key });
    } catch {
      return null;
    }
  },
  async removeItem(key: string): Promise<void> {
    try {
      await invoke("plugin:secure-storage|delete", { key });
    } catch {
      // Missing keys are safe to ignore.
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    await invoke("plugin:secure-storage|set", { key, value });
  },
};

export const supabase = createClient<Database>(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseAnonKey ?? "placeholder-anon-key",
  {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      persistSession: true,
      storage: secureStorage,
    },
  },
);
