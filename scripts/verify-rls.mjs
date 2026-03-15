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

function makeEmail(label) {
  return `rls-${label}-${Date.now()}-${randomString()}@example.com`;
}

function makePassword() {
  return `RlsTest!${Date.now()}${randomString()}`;
}

async function createSignedInClient(url, key, label) {
  const client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const email = makeEmail(label);
  const password = makePassword();

  const signUpResult = await client.auth.signUp({ email, password });
  if (signUpResult.error) {
    throw new Error(`Failed to sign up ${label}: ${signUpResult.error.message}`);
  }

  let session = signUpResult.data.session;

  if (!session) {
    const signInResult = await client.auth.signInWithPassword({ email, password });
    if (signInResult.error) {
      throw new Error(
        `Created ${label} but could not sign in. Email confirmation may still be enabled: ${signInResult.error.message}`,
      );
    }
    session = signInResult.data.session;
  }

  if (!session?.user) {
    throw new Error(`No authenticated session available for ${label}`);
  }

  return { client, email, password, user: session.user };
}

async function expectPass(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function expectFailure(name, fn) {
  try {
    await fn();
    throw new Error("Expected failure but operation succeeded");
  } catch (error) {
    if (error.message === "Expected failure but operation succeeded") {
      console.error(`FAIL ${name}`);
      throw error;
    }
    console.log(`PASS ${name}`);
  }
}

async function main() {
  const { url, key } = await loadEnv();

  const anonClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const userA = await createSignedInClient(url, key, "a");
  const userB = await createSignedInClient(url, key, "b");

  console.log(`Created test users: ${userA.email} and ${userB.email}`);

  await expectPass("anonymous client sees no profiles", async () => {
    const { data, error } = await anonClient.from("profiles").select("*");
    if (error) {
      throw error;
    }
    if ((data ?? []).length !== 0) {
      throw new Error(`Expected 0 profiles, received ${data.length}`);
    }
  });

  await expectPass("user A can read own profile", async () => {
    const { data, error } = await userA.client
      .from("profiles")
      .select("*")
      .eq("id", userA.user.id)
      .single();
    if (error) {
      throw error;
    }
    if (data.id !== userA.user.id) {
      throw new Error("User A profile id mismatch");
    }
  });

  let sessionAId;

  await expectPass("user A can insert own session", async () => {
    const { data, error } = await userA.client
      .from("sessions")
      .insert({
        user_id: userA.user.id,
        stuck_on: "Verify RLS from the client",
        status: "active",
        source: "manual",
      })
      .select("id, user_id")
      .single();
    if (error) {
      throw error;
    }
    sessionAId = data.id;
  });

  await expectFailure("user A cannot insert a session for user B", async () => {
    const { error } = await userA.client.from("sessions").insert({
      user_id: userB.user.id,
      stuck_on: "Attempt cross-user insert",
      status: "active",
      source: "manual",
    });
    if (!error) {
      return;
    }
    throw error;
  });

  await expectPass("user B cannot read user A session", async () => {
    const { data, error } = await userB.client
      .from("sessions")
      .select("*")
      .eq("id", sessionAId);
    if (error) {
      throw error;
    }
    if ((data ?? []).length !== 0) {
      throw new Error("User B was able to read User A session");
    }
  });

  await expectPass("user A can insert own conversation message", async () => {
    const { error } = await userA.client.from("conversation_messages").insert({
      session_id: sessionAId,
      role: "user",
      content: "First verification message",
    });
    if (error) {
      throw error;
    }
  });

  await expectPass("user B cannot read user A conversation messages", async () => {
    const { data, error } = await userB.client
      .from("conversation_messages")
      .select("*")
      .eq("session_id", sessionAId);
    if (error) {
      throw error;
    }
    if ((data ?? []).length !== 0) {
      throw new Error("User B was able to read User A messages");
    }
  });

  console.log("RLS verification completed successfully.");
  console.log(
    "Note: temporary test users remain in Auth unless you delete them manually in the Supabase dashboard.",
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
