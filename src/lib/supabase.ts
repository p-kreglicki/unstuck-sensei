import { createClient } from "@supabase/supabase-js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { Database } from "./database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  if (!import.meta.env.DEV) {
    throw new Error(
      "Supabase configuration is required in production builds. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  console.warn(
    "Supabase environment variables are missing. Auth flows will remain unavailable until VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are configured.",
  );
}

type AuthStorage = {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
};

const secureStorage: AuthStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const response = await invoke<{ data?: string | null }>(
        "plugin:secure-storage|get_item",
        {
          payload: {
            prefixedKey: key,
          },
        },
      );

      return response.data ?? null;
    } catch {
      return null;
    }
  },
  async removeItem(key: string): Promise<void> {
    try {
      await invoke("plugin:secure-storage|remove_item", {
        payload: {
          prefixedKey: key,
        },
      });
    } catch {
      // Missing keys are safe to ignore.
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    await invoke("plugin:secure-storage|set_item", {
      payload: {
        data: value,
        prefixedKey: key,
      },
    });
  },
};

const devStore = new LazyStore("auth-session.json", {
  autoSave: true,
  defaults: {},
});

const tauriDevStorage: AuthStorage = {
  async getItem(key: string): Promise<string | null> {
    const value = await devStore.get<string>(key);
    return typeof value === "string" ? value : null;
  },
  async removeItem(key: string): Promise<void> {
    await devStore.delete(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await devStore.set(key, value);
  },
};

const browserStorage: AuthStorage = {
  async getItem(key: string): Promise<string | null> {
    return globalThis.localStorage?.getItem(key) ?? null;
  },
  async removeItem(key: string): Promise<void> {
    globalThis.localStorage?.removeItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    globalThis.localStorage?.setItem(key, value);
  },
};

// The desktop dev loop should not hit macOS Keychain on every auth bootstrap.
const authStorage =
  isTauri() ? (import.meta.env.DEV ? tauriDevStorage : secureStorage) : browserStorage;

export const supabase = createClient<Database>(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabasePublishableKey ?? "placeholder-publishable-key",
  {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      persistSession: true,
      storage: authStorage,
    },
  },
);
