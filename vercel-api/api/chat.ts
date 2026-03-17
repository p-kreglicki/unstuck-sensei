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
import {
  CLARIFYING_ANSWER_MAX_LENGTH,
  STUCK_ON_MAX_LENGTH,
} from "../lib/session-input-limits.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_RECENT_SESSIONS = 3;
const MAX_STEPS = 5;
const MAX_TOKENS = 700;
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

type NormalizedRequestBodyResult =
  | {
      kind: "error";
      message: string;
    }
  | {
      kind: "success";
      value: Omit<NormalizedRequest, "authorizationToken">;
    };

type ConsumeChatRateLimitStatus =
  | "allowed"
  | "invalid_session"
  | "rate_limited"
  | "unauthorized";

type ChatRateLimitReservation = {
  reservationId: string | null;
  status: ConsumeChatRateLimitStatus;
};

type AnthropicErrorPayload = {
  error?: {
    message?: string;
    type?: string;
  };
};

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

    return handleChatRequest(request);
  },
};

export async function handleChatRequest(request: Request) {
  const environment = getRequiredEnvironment(request);

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
      request,
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

  let rateLimitReservation: ChatRateLimitReservation;

  try {
    rateLimitReservation = await consumeRateLimit(
      scopedClient,
      normalizedRequest.sessionId,
    );
  } catch (error) {
    console.error("[chat] rate limit reservation failed", {
      error: error instanceof Error ? error.message : String(error),
      sessionId: normalizedRequest.sessionId,
      userId: user.id,
    });

    return jsonResponse(
      { error: "Unable to start the chat right now." },
      request,
      { status: 500 },
    );
  }

  if (rateLimitReservation.status === "unauthorized") {
    return jsonResponse(
      { error: "Unauthorized. Sign in again and retry." },
      request,
      { status: 401 },
    );
  }

  if (rateLimitReservation.status === "invalid_session") {
    return jsonResponse(
      { error: "Save the task first, then try again." },
      request,
      { status: 400 },
    );
  }

  if (rateLimitReservation.status === "rate_limited") {
    return jsonResponse(
      { error: "Rate limit reached. Take a breath, then try again soon." },
      request,
      { status: 429 },
    );
  }

  if (!rateLimitReservation.reservationId) {
    console.error("[chat] rate limit reservation missing id", {
      sessionId: normalizedRequest.sessionId,
      userId: user.id,
    });

    return jsonResponse(
      { error: "Unable to start the chat right now." },
      request,
      { status: 500 },
    );
  }

  const recentSessions = await loadRecentSessions(
    scopedClient,
    user.id,
    normalizedRequest.sessionId,
  );
  const reservationId = rateLimitReservation.reservationId;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let bytesWritten = false;
      let streamResult: StreamAttemptResult | null = null;

      const writeEvent = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
        bytesWritten = true;
      };

      try {
        streamResult = await streamAnthropicResponse({
          anthropicApiKey: environment.anthropicApiKey,
          model: environment.anthropicModel,
          recentSessions,
          request: normalizedRequest,
          writeEvent,
        });

        await completeRateLimitReservation(scopedClient, reservationId);

        writeEvent("structured", streamResult.structured);
        writeEvent("done", { ok: true });
      } catch (error) {
        const hadWrittenBytes = bytesWritten;
        const message = formatServerError(error);

        if (!streamResult) {
          try {
            await releaseRateLimitReservation(scopedClient, reservationId);
          } catch (releaseError) {
            console.error("[chat] failed to release rate limit reservation", {
              error:
                releaseError instanceof Error
                  ? releaseError.message
                  : String(releaseError),
              reservationId,
              sessionId: normalizedRequest.sessionId,
              userId: user.id,
            });
          }
        } else {
          console.error("[chat] failed to finalize rate limit reservation", {
            error: error instanceof Error ? error.message : String(error),
            reservationId,
            sessionId: normalizedRequest.sessionId,
            userId: user.id,
          });
        }

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
      ...corsHeaders(request),
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
        throw await createAnthropicRequestError(upstreamResponse, input.model);
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

      if (error instanceof AnthropicRequestError) {
        logAnthropicRequestError(error, {
          attempt,
          bytesWrittenToClient,
        });
      }

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
  client: ReturnType<typeof createClient>,
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

  return data.map((session) => toSessionSummary(session));
}

export async function consumeRateLimit(
  client: {
    rpc(fn: string, args: Record<string, unknown>): PromiseLike<{
      data: unknown;
      error: { message?: string } | null;
    }>;
  },
  sessionId: string,
) {
  const { data, error } = await client.rpc("consume_chat_rate_limit", {
    input_session_id: sessionId,
  });

  if (error) {
    throw new Error(error.message ?? "Rate limit reservation failed.");
  }

  if (!isChatRateLimitReservation(data)) {
    throw new Error("Rate limit reservation returned an invalid payload.");
  }

  return data;
}

async function completeRateLimitReservation(
  client: {
    rpc(fn: string, args: Record<string, unknown>): PromiseLike<{
      data: unknown;
      error: { message?: string } | null;
    }>;
  },
  reservationId: string,
) {
  const { data, error } = await client.rpc(
    "complete_chat_rate_limit_reservation",
    {
      input_log_id: reservationId,
    },
  );

  if (error) {
    throw new Error(error.message ?? "Rate limit finalization failed.");
  }

  if (data !== true) {
    throw new Error("Rate limit finalization returned an invalid result.");
  }
}

async function releaseRateLimitReservation(
  client: {
    rpc(fn: string, args: Record<string, unknown>): PromiseLike<{
      data: unknown;
      error: { message?: string } | null;
    }>;
  },
  reservationId: string,
) {
  const { data, error } = await client.rpc(
    "release_chat_rate_limit_reservation",
    {
      input_log_id: reservationId,
    },
  );

  if (error) {
    throw new Error(error.message ?? "Rate limit release failed.");
  }

  if (data !== true) {
    throw new Error("Rate limit release returned an invalid result.");
  }
}

export function normalizeRequestBody(body: unknown): NormalizedRequestBodyResult {
  if (!body || typeof body !== "object") {
    return {
      kind: "error",
      message: "Invalid chat request payload.",
    };
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
    return {
      kind: "error",
      message: "Invalid chat request payload.",
    };
  }

  if (
    candidate.clarifyingAnswer !== undefined &&
    typeof candidate.clarifyingAnswer !== "string"
  ) {
    return {
      kind: "error",
      message: "Invalid chat request payload.",
    };
  }

  const sessionId = candidate.sessionId.trim();
  const stuckOn = candidate.stuckOn.trim();

  if (sessionId.length === 0) {
    return {
      kind: "error",
      message: "Invalid chat request payload.",
    };
  }

  if (stuckOn.length === 0) {
    return {
      kind: "error",
      message: "stuckOn is required.",
    };
  }

  if (stuckOn.length > STUCK_ON_MAX_LENGTH) {
    return {
      kind: "error",
      message: `stuckOn must be ${STUCK_ON_MAX_LENGTH} characters or fewer.`,
    };
  }

  const clarifyingAnswer = candidate.clarifyingAnswer?.trim();

  if (
    clarifyingAnswer &&
    clarifyingAnswer.length > CLARIFYING_ANSWER_MAX_LENGTH
  ) {
    return {
      kind: "error",
      message: `clarifyingAnswer must be ${CLARIFYING_ANSWER_MAX_LENGTH} characters or fewer.`,
    };
  }

  return {
    kind: "success",
    value: {
      clarifyingAnswer: clarifyingAnswer || undefined,
      energyLevel: candidate.energyLevel,
      mode: candidate.mode,
      sessionId,
      source: candidate.source,
      stuckOn,
    },
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
        request,
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
        request,
        { status: 400 },
      ),
    };
  }

  const normalizedBody = normalizeRequestBody(body);

  if (normalizedBody.kind === "error") {
    return {
      response: jsonResponse(
        { error: normalizedBody.message },
        request,
        { status: 400 },
      ),
    };
  }

  return {
    ...normalizedBody.value,
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

function getRequiredEnvironment(
  request: Request,
):
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
        request,
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

function isConsumeChatRateLimitStatus(
  value: unknown,
): value is ConsumeChatRateLimitStatus {
  return (
    value === "allowed" ||
    value === "invalid_session" ||
    value === "rate_limited" ||
    value === "unauthorized"
  );
}

function isChatRateLimitReservation(
  value: unknown,
): value is ChatRateLimitReservation {
  return (
    !!value &&
    typeof value === "object" &&
    "status" in value &&
    isConsumeChatRateLimitStatus(value.status) &&
    "reservationId" in value &&
    (typeof value.reservationId === "string" || value.reservationId === null)
  );
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status === 529 || status >= 500;
}

async function readUpstreamError(response: Response) {
  const parsed = await readAnthropicErrorPayload(response);

  return {
    message:
      parsed?.error?.message?.trim() ||
      `Anthropic request failed with status ${response.status}.`,
    type: parsed?.error?.type?.trim() || null,
  };
}

async function readAnthropicErrorPayload(response: Response) {
  try {
    return (await response.json()) as AnthropicErrorPayload;
  } catch {
    return null;
  }
}

async function createAnthropicRequestError(response: Response, model: string) {
  const parsed = await readUpstreamError(response);
  const retryable = isRetryableStatus(response.status);

  return new AnthropicRequestError(
    normalizeAnthropicError({
      message: parsed.message,
      model,
      status: response.status,
      type: parsed.type,
    }),
    {
      model,
      rawMessage: parsed.message,
      retryable,
      status: response.status,
      type: parsed.type,
    },
  );
}

export function normalizeAnthropicError(input: {
  message: string;
  model: string;
  status: number;
  type: string | null;
}) {
  const message = input.message.trim();
  const lowerMessage = message.toLowerCase();

  if (
    input.type === "permission_error" ||
    lowerMessage.includes("permission") ||
    lowerMessage.includes("not authorized") ||
    lowerMessage.includes("not allowed") ||
    lowerMessage.includes("access")
  ) {
    return `The configured Anthropic API key does not have access to model "${input.model}". Check ANTHROPIC_API_KEY and ANTHROPIC_MODEL.`;
  }

  if (
    input.type === "invalid_request_error" &&
    lowerMessage.includes("model")
  ) {
    return `The configured Anthropic model "${input.model}" is unavailable. Check ANTHROPIC_MODEL against Anthropic's current models list.`;
  }

  return message || `Anthropic request failed with status ${input.status}.`;
}

function logAnthropicRequestError(
  error: AnthropicRequestError,
  input: {
    attempt: number;
    bytesWrittenToClient: boolean;
  },
) {
  console.error("[chat] anthropic request failed", {
    attempt: input.attempt + 1,
    message: error.message,
    model: error.model,
    provider: "anthropic",
    rawMessage: error.rawMessage,
    retryable: error.retryable,
    status: error.status,
    streamedToClient: input.bytesWrittenToClient,
    type: error.type,
  });
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");

  if (!origin || !ALLOWED_CORS_ORIGINS.has(origin)) {
    return BASE_CORS_HEADERS;
  }

  return {
    ...BASE_CORS_HEADERS,
    "Access-Control-Allow-Origin": origin,
  };
}

function jsonResponse(
  body: Record<string, unknown>,
  request: Request,
  init: ResponseInit,
) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...corsHeaders(request),
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

class AnthropicRequestError extends RetryableError {
  model: string;
  rawMessage: string;
  status: number;
  type: string | null;

  constructor(
    message: string,
    options: {
      model: string;
      rawMessage: string;
      retryable: boolean;
      status: number;
      type: string | null;
    },
  ) {
    super(message, { retryable: options.retryable });
    this.model = options.model;
    this.name = "AnthropicRequestError";
    this.rawMessage = options.rawMessage;
    this.status = options.status;
    this.type = options.type;
  }
}
