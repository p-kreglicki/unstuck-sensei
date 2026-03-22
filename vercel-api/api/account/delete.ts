import { createClient } from "@supabase/supabase-js";

const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS, POST",
  Vary: "Origin",
};
const ALLOWED_CORS_ORIGINS = new Set([
  "http://localhost:1420",
  "https://tauri.localhost",
  "tauri://localhost",
]);

export const runtime = "nodejs";

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders(request),
        status: 204,
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(
        { error: "Method not allowed." },
        request,
        {
          headers: {
            Allow: "OPTIONS, POST",
          },
          status: 405,
        },
      );
    }

    return handleDeleteAccountRequest(request);
  },
};

export async function handleDeleteAccountRequest(request: Request) {
  const environment = getRequiredEnvironment(request);

  if ("response" in environment) {
    return environment.response;
  }

  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(
      { error: "Missing Authorization bearer token." },
      request,
      { status: 401 },
    );
  }

  const token = authorization.slice("Bearer ".length).trim();
  const authClient = createClient(
    environment.supabaseUrl,
    environment.supabasePublishableKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(token);

  if (authError || !user) {
    return jsonResponse(
      { error: "Unauthorized. Sign in again and retry." },
      request,
      { status: 401 },
    );
  }

  const adminClient = createClient(
    environment.supabaseUrl,
    environment.supabaseServiceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);

  if (deleteError) {
    return jsonResponse(
      { error: "Unable to delete your account right now." },
      request,
      { status: 500 },
    );
  }

  return new Response(null, {
    headers: corsHeaders(request),
    status: 204,
  });
}

function corsHeaders(
  request: Request,
  extraHeaders: HeadersInit = {},
) {
  const origin = request.headers.get("origin");
  const headers = new Headers({
    ...BASE_CORS_HEADERS,
    ...extraHeaders,
  });

  if (origin && ALLOWED_CORS_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return headers;
}

function getRequiredEnvironment(request: Request) {
  const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;

  if (!supabasePublishableKey || !supabaseServiceRoleKey || !supabaseUrl) {
    return {
      response: jsonResponse(
        { error: "Server environment is not configured." },
        request,
        { status: 500 },
      ),
    };
  }

  return {
    supabasePublishableKey,
    supabaseServiceRoleKey,
    supabaseUrl,
  };
}

function jsonResponse(
  payload: unknown,
  request: Request,
  init: ResponseInit = {},
) {
  const headers = corsHeaders(request, init.headers);
  headers.set("Content-Type", "application/json");

  return new Response(JSON.stringify(payload), {
    ...init,
    headers,
  });
}
