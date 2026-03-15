import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

function parseEnv(contents) {
  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .reduce((env, line) => {
      const [key, ...rest] = line.split("=");
      env[key] = rest.join("=");
      return env;
    }, {});
}

async function loadEnv() {
  const envFile = await readFile(".env", "utf8");
  const env = parseEnv(envFile);
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in .env",
    );
  }

  return { url, key };
}

function randomString() {
  return Math.random().toString(36).slice(2, 10);
}

function makeEmail() {
  return `auth-${Date.now()}-${randomString()}@example.com`;
}

function makePassword() {
  return `AuthTest!${Date.now()}${randomString()}`;
}

function createMemoryStorage() {
  const state = new Map();

  return {
    async getItem(key) {
      return state.has(key) ? state.get(key) : null;
    },
    async removeItem(key) {
      state.delete(key);
    },
    async setItem(key, value) {
      state.set(key, value);
    },
    dump() {
      return Array.from(state.entries());
    },
  };
}

function createTestClient(url, key, storage) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: true,
      storage,
    },
  });
}

async function expectPass(name, fn) {
  await fn();
  console.log(`PASS ${name}`);
}

async function main() {
  const { url, key } = await loadEnv();
  const storage = createMemoryStorage();
  const email = makeEmail();
  const password = makePassword();

  const client1 = createTestClient(url, key, storage);

  let userId;

  await expectPass("sign up with email and password", async () => {
    const { data, error } = await client1.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: email.split("@")[0],
        },
      },
    });

    if (error) {
      throw new Error(`signUp failed: ${error.message}`);
    }

    userId = data.user?.id;

    if (!data.user?.id) {
      throw new Error("signUp returned no user");
    }
  });

  await expectPass("sign in with created credentials", async () => {
    const { data, error } = await client1.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw new Error(
        `signInWithPassword failed: ${error.message}. If email confirmation is enabled, disable it for dev or confirm the user first.`,
      );
    }

    if (data.user?.id !== userId) {
      throw new Error("signed in user does not match the created user");
    }
  });

  await expectPass("session is persisted into async storage", async () => {
    const storedEntries = storage.dump();
    if (storedEntries.length === 0) {
      throw new Error("no auth session was written to storage");
    }
  });

  await expectPass("session restores after client recreation", async () => {
    const client2 = createTestClient(url, key, storage);
    const { data, error } = await client2.auth.getSession();

    if (error) {
      throw new Error(`getSession failed: ${error.message}`);
    }

    if (data.session?.user.id !== userId) {
      throw new Error("restored session user does not match the original user");
    }
  });

  await expectPass("sign out clears the stored session", async () => {
    const { error } = await client1.auth.signOut();
    if (error) {
      throw new Error(`signOut failed: ${error.message}`);
    }

    const client3 = createTestClient(url, key, storage);
    const { data, error: sessionError } = await client3.auth.getSession();
    if (sessionError) {
      throw new Error(`post-signout getSession failed: ${sessionError.message}`);
    }

    if (data.session) {
      throw new Error("session still exists after signOut");
    }
  });

  console.log("Auth verification completed successfully.");
  console.log(`Temporary test user: ${email}`);
  console.log(
    "Note: the test user remains in Supabase Auth until you delete it manually.",
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
