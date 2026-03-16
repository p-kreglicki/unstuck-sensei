import { createClient } from "@supabase/supabase-js";
import { encodeSseEvent, parseSseFrames } from "../lib/chat-sse.js";
import {
  clampSteps,
  createSessionSteps,
  isEnergyLevel,
  isSessionSource,
  parseSessionSteps,
  STRUCTURED_RESPONSE_DELIMITER,
  type ChatRequestBody,
  type ChatRequestMode,
  type SessionSummary,
  type StructuredChatResponse,
} from "../lib/session-flow.js";
import {
  buildSessionSystemPrompt,
  buildSessionUserPrompt,
} from "../lib/prompts/session.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const HOURLY_RATE_LIMIT = 12;
const DAILY_RATE_LIMIT = 40;
const MAX_RECENT_SESSIONS = 3;
const MAX_STEPS = 5;
const MAX_TOKENS = 700;
const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS, POST",
  "Access-Control-Allow-Origin": "*",
};

type NormalizedRequest = ChatRequestBody & {
  authorizationToken: string;
};

type NormalizedStructuredResult =
  | {
      kind: "clarifying_question";
      question: string;
    }
  | {
      kind: "steps";
      steps: string[];
    };

type RecentSessionRow = {
  created_at: string;
  feedback: "no" | "somewhat" | "yes" | null;
  steps: unknown;
  stuck_on: string | null;
};

type StreamAttemptResult = {
  assistantText: string;
  structured: StructuredChatResponse;
};

type QueryCountResult = {
  count: number | null;
};

export const runtime = "nodejs";

export default async function handler(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: CORS_HEADERS,
      status: 204,
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(
      { error: "Method not allowed." },
      {
        headers: {
          Allow: "OPTIONS, POST",
        },
        status: 405,
      },
    );
  }

  return handleChatRequest(request);
}

export async function handleChatRequest(request: Request) {
  const environment = getRequiredEnvironment();

  if ("response" in environment) {
    return environment.response;
  }

  const normalizedRequest = await normalizeRequest(request);

  if ("response" in normalizedRequest) {
    return normalizedRequest.response;
  }

  const adminClient = createClient(
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
  } = await adminClient.auth.getUser(normalizedRequest.authorizationToken);

  if (authError || !user) {
    return jsonResponse(
      { error: "Unauthorized. Sign in again and retry." },
      { status: 401 },
    );
  }

  const scopedClient = createClient(
    environment.supabaseUrl,
    environment.supabasePublishableKey,
    {
      accessToken: async () => normalizedRequest.authorizationToken,
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  const rateLimit = await checkRateLimit(scopedClient);

  if (rateLimit.exceeded) {
    return jsonResponse(
      { error: "Rate limit reached. Take a breath, then try again soon." },
      { status: 429 },
    );
  }

  const recentSessions = await loadRecentSessions(
    scopedClient,
    user.id,
    normalizedRequest.sessionId,
  );

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let bytesWritten = false;

      const writeEvent = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
        bytesWritten = true;
      };

      try {
        const result = await streamAnthropicResponse({
          anthropicApiKey: environment.anthropicApiKey,
          model: environment.anthropicModel,
          recentSessions,
          request: normalizedRequest,
          writeEvent,
        });

        writeEvent("structured", result.structured);
        writeEvent("done", { ok: true });
      } catch (error) {
        const hadWrittenBytes = bytesWritten;
        const message = formatServerError(error);

        writeEvent("error", {
          message,
          recoverable: true,
        });

        if (!hadWrittenBytes) {
          writeEvent("done", { ok: false });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
    status: 200,
  });
}

async function streamAnthropicResponse(input: {
  anthropicApiKey: string;
  model: string;
  recentSessions: SessionSummary[];
  request: NormalizedRequest;
  writeEvent(event: string, data: unknown): void;
}): Promise<StreamAttemptResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let bytesWrittenToClient = false;

    try {
      const upstreamResponse = await fetch(ANTHROPIC_API_URL, {
        body: JSON.stringify({
          max_tokens: MAX_TOKENS,
          messages: [
            {
              content: buildSessionUserPrompt({
                clarifyingAnswer: input.request.clarifyingAnswer,
                energyLevel: input.request.energyLevel,
                mode: input.request.mode,
                recentSessions: input.recentSessions,
                source: input.request.source,
                stuckOn: input.request.stuckOn,
              }),
              role: "user",
            },
          ],
          model: input.model,
          stream: true,
          system: buildSessionSystemPrompt(),
          temperature: 0.5,
        }),
        headers: {
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
          "x-api-key": input.anthropicApiKey,
        },
        method: "POST",
      });

      if (!upstreamResponse.ok || !upstreamResponse.body) {
        const message = await readUpstreamError(upstreamResponse);
        throw new RetryableError(message, {
          retryable: isRetryableStatus(upstreamResponse.status),
        });
      }

      const reader = upstreamResponse.body.getReader();
      const decoder = new TextDecoder();
      const outputAccumulator = new OutputAccumulator();
      let anthropicBuffer = "";
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        anthropicBuffer += decoder.decode(value, { stream: true });

        const { events, remainder } = parseSseFrames(anthropicBuffer);
        anthropicBuffer = remainder;

        for (const event of events) {
          const textDelta = readAnthropicTextDelta(event.event, event.data);

          if (!textDelta) {
            continue;
          }

          const visibleText = outputAccumulator.push(textDelta);

          if (visibleText.length > 0) {
            assistantText += visibleText;
            bytesWrittenToClient = true;
            input.writeEvent("text-delta", { text: visibleText });
          }
        }
      }

      const { assistantRemainder, structuredRaw } = outputAccumulator.finish();

      if (assistantRemainder.length > 0) {
        assistantText += assistantRemainder;
        bytesWrittenToClient = true;
        input.writeEvent("text-delta", { text: assistantRemainder });
      }

      if (!structuredRaw) {
        throw new RetryableError(
          "The model response ended before the structured result arrived.",
          {
            retryable: !bytesWrittenToClient,
          },
        );
      }

      const structured = normalizeStructuredResponse(
        structuredRaw,
        assistantText,
      );

      return {
        assistantText,
        structured,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (
        error instanceof RetryableError &&
        error.retryable &&
        attempt === 0 &&
        !bytesWrittenToClient
      ) {
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new Error("Unknown Anthropic streaming failure.");
}

async function loadRecentSessions(
  client: { from(table: string): any },
  userId: string,
  currentSessionId: string,
) {
  const { data, error } = await client
    .from("sessions")
    .select("created_at, feedback, steps, stuck_on")
    .eq("user_id", userId)
    .neq("id", currentSessionId)
    .order("created_at", { ascending: false })
    .limit(MAX_RECENT_SESSIONS);

  if (error || !data) {
    return [];
  }

  return (data as RecentSessionRow[]).map((session) => toSessionSummary(session));
}

async function checkRateLimit(client: { from(table: string): any }) {
  const now = new Date();
  const hourStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [{ count: hourlyCount }, { count: dailyCount }] = (await Promise.all([
    client
      .from("conversation_messages")
      .select("id", { count: "exact", head: true })
      .eq("role", "assistant")
      .gte("created_at", hourStart),
    client
      .from("conversation_messages")
      .select("id", { count: "exact", head: true })
      .eq("role", "assistant")
      .gte("created_at", dayStart),
  ])) as [QueryCountResult, QueryCountResult];

  return {
    exceeded:
      (hourlyCount ?? 0) >= HOURLY_RATE_LIMIT ||
      (dailyCount ?? 0) >= DAILY_RATE_LIMIT,
  };
}

function normalizeRequestBody(body: unknown): Omit<NormalizedRequest, "authorizationToken"> | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const candidate = body as Partial<ChatRequestBody>;

  if (
    !candidate.sessionId ||
    typeof candidate.sessionId !== "string" ||
    !candidate.stuckOn ||
    typeof candidate.stuckOn !== "string" ||
    !candidate.mode ||
    !isRequestMode(candidate.mode) ||
    !isEnergyLevel(candidate.energyLevel) ||
    !isSessionSource(candidate.source)
  ) {
    return null;
  }

  if (
    candidate.clarifyingAnswer !== undefined &&
    typeof candidate.clarifyingAnswer !== "string"
  ) {
    return null;
  }

  return {
    clarifyingAnswer: candidate.clarifyingAnswer?.trim() || undefined,
    energyLevel: candidate.energyLevel,
    mode: candidate.mode,
    sessionId: candidate.sessionId,
    source: candidate.source,
    stuckOn: candidate.stuckOn.trim(),
  };
}

async function normalizeRequest(
  request: Request,
): Promise<
  | { response: Response }
  | NormalizedRequest
> {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return {
      response: jsonResponse(
        { error: "Missing Authorization bearer token." },
        { status: 401 },
      ),
    };
  }

  let body: unknown = null;

  try {
    body = await request.json();
  } catch {
    return {
      response: jsonResponse(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      ),
    };
  }

  const normalizedBody = normalizeRequestBody(body);

  if (!normalizedBody) {
    return {
      response: jsonResponse(
        { error: "Invalid chat request payload." },
        { status: 400 },
      ),
    };
  }

  return {
    ...normalizedBody,
    authorizationToken: authorization.slice("Bearer ".length).trim(),
  };
}

export function normalizeStructuredResponse(
  rawStructured: string,
  assistantText: string,
): StructuredChatResponse {
  let parsed: unknown = null;

  try {
    parsed = JSON.parse(rawStructured.trim());
  } catch {
    throw new Error("The model returned malformed structured output.");
  }

  const normalized = normalizeRawStructuredResponse(parsed);
  const normalizedAssistantText = assistantText.trim();

  if (normalizedAssistantText.length === 0) {
    throw new Error("The model streamed no assistant copy.");
  }

  if (normalized.kind === "clarifying_question") {
    return {
      assistantText: normalizedAssistantText,
      kind: "clarifying_question",
      question: normalized.question,
    };
  }

  return {
    assistantText: normalizedAssistantText,
    kind: "steps",
    steps: clampSteps(createSessionSteps(normalized.steps)).slice(0, MAX_STEPS),
  };
}

function normalizeRawStructuredResponse(
  value: unknown,
): NormalizedStructuredResult {
  if (!value || typeof value !== "object" || !("kind" in value)) {
    throw new Error("The model returned an unsupported structured payload.");
  }

  if (
    value.kind === "clarifying_question" &&
    "question" in value &&
    typeof value.question === "string" &&
    value.question.trim().length > 0
  ) {
    return {
      kind: "clarifying_question",
      question: value.question.trim(),
    };
  }

  if (
    value.kind === "steps" &&
    "steps" in value &&
    Array.isArray(value.steps) &&
    value.steps.length >= 3 &&
    value.steps.length <= MAX_STEPS &&
    value.steps.every((step) => typeof step === "string" && step.trim().length > 0)
  ) {
    return {
      kind: "steps",
      steps: value.steps.map((step) => step.trim()),
    };
  }

  throw new Error("The model returned an invalid structured payload.");
}

export function readAnthropicTextDelta(eventName: string, data: string) {
  if (eventName !== "content_block_delta") {
    return null;
  }

  let parsed: unknown = null;

  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "type" in parsed &&
    parsed.type === "content_block_delta" &&
    "delta" in parsed &&
    parsed.delta &&
    typeof parsed.delta === "object" &&
    "type" in parsed.delta &&
    parsed.delta.type === "text_delta" &&
    "text" in parsed.delta &&
    typeof parsed.delta.text === "string"
  ) {
    return parsed.delta.text;
  }

  return null;
}

function toSessionSummary(session: RecentSessionRow): SessionSummary {
  return {
    createdAt: session.created_at,
    feedback: session.feedback,
    steps: parseSessionSteps(session.steps),
    stuckOn: session.stuck_on,
  };
}

function getRequiredEnvironment():
  | {
      anthropicApiKey: string;
      anthropicModel: string;
      supabasePublishableKey: string;
      supabaseUrl: string;
    }
  | { response: Response } {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const anthropicModel = process.env.ANTHROPIC_MODEL;
  const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;

  if (
    !anthropicApiKey ||
    !anthropicModel ||
    !supabasePublishableKey ||
    !supabaseUrl
  ) {
    return {
      response: jsonResponse(
        { error: "Server configuration is incomplete." },
        { status: 500 },
      ),
    };
  }

  return {
    anthropicApiKey,
    anthropicModel,
    supabasePublishableKey,
    supabaseUrl,
  };
}

function isRequestMode(value: unknown): value is ChatRequestMode {
  return value === "clarification" || value === "initial" || value === "retry";
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status === 529 || status >= 500;
}

async function readUpstreamError(response: Response) {
  try {
    const body = await response.json();

    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      body.error &&
      typeof body.error === "object" &&
      "message" in body.error &&
      typeof body.error.message === "string"
    ) {
      return body.error.message;
    }
  } catch {
    // Ignore JSON parsing failures and fall through to the status-based message.
  }

  return `Anthropic request failed with status ${response.status}.`;
}

function jsonResponse(
  body: Record<string, unknown>,
  init: ResponseInit,
) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

function formatServerError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "The coaching stream failed unexpectedly.";
}

export class OutputAccumulator {
  private delimiterFound = false;
  private pendingVisibleBuffer = "";
  private structuredBuffer = "";

  push(chunk: string) {
    if (this.delimiterFound) {
      this.structuredBuffer += chunk;
      return "";
    }

    const combined = this.pendingVisibleBuffer + chunk;
    const delimiterIndex = combined.indexOf(STRUCTURED_RESPONSE_DELIMITER);

    if (delimiterIndex >= 0) {
      const visibleText = combined.slice(0, delimiterIndex);
      this.delimiterFound = true;
      this.pendingVisibleBuffer = "";
      this.structuredBuffer = combined.slice(
        delimiterIndex + STRUCTURED_RESPONSE_DELIMITER.length,
      );

      return visibleText;
    }

    const safeVisibleLength = Math.max(
      0,
      combined.length - (STRUCTURED_RESPONSE_DELIMITER.length - 1),
    );
    const visibleText = combined.slice(0, safeVisibleLength);
    this.pendingVisibleBuffer = combined.slice(safeVisibleLength);

    return visibleText;
  }

  finish() {
    if (!this.delimiterFound) {
      return {
        assistantRemainder: this.pendingVisibleBuffer,
        structuredRaw: "",
      };
    }

    return {
      assistantRemainder: "",
      structuredRaw: this.structuredBuffer,
    };
  }
}

class RetryableError extends Error {
  retryable: boolean;

  constructor(message: string, options: { retryable: boolean }) {
    super(message);
    this.name = "RetryableError";
    this.retryable = options.retryable;
  }
}
