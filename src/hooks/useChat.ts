import { useRef, useState } from "react";
import { parseSseFrames } from "../lib/chat-sse";
import { supabase } from "../lib/supabase";
import {
  isStructuredChatResponse,
  type ChatRequestMode,
  type EnergyLevel,
  type SessionSource,
  type StructuredChatResponse,
} from "../lib/session-flow";

type ChatStage = "completed" | "error" | "idle" | "streaming";

export type ChatState = {
  error: string | null;
  finalAssistantText: string;
  isStreaming: boolean;
  stage: ChatStage;
  streamingText: string;
  structuredResult: StructuredChatResponse | null;
};

const defaultState: ChatState = {
  error: null,
  finalAssistantText: "",
  isStreaming: false,
  stage: "idle",
  streamingText: "",
  structuredResult: null,
};

type UseChatOptions = {
  sessionId: string | null;
};

type SendChatInput = {
  clarifyingAnswer?: string;
  energyLevel: EnergyLevel;
  mode: ChatRequestMode;
  source: SessionSource;
  stuckOn: string;
};

export function useChat({ sessionId }: UseChatOptions) {
  const [state, setState] = useState<ChatState>(defaultState);
  const abortRef = useRef<AbortController | null>(null);

  async function runChatRequest(
    input: SendChatInput,
  ): Promise<StructuredChatResponse> {
    if (!sessionId) {
      throw new Error("Session ID is required before starting chat.");
    }

    const baseUrl = import.meta.env.VITE_VERCEL_API_URL?.trim();

    if (!baseUrl) {
      throw new Error("VITE_VERCEL_API_URL is not configured.");
    }

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      throw new Error("Your session expired. Sign in again to continue.");
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      error: null,
      finalAssistantText: "",
      isStreaming: true,
      stage: "streaming",
      streamingText: "",
      structuredResult: null,
    });

    try {
      const response = await fetch(joinUrl(baseUrl, "/api/chat"), {
        body: JSON.stringify({
          clarifyingAnswer: input.clarifyingAnswer,
          energyLevel: input.energyLevel,
          mode: input.mode,
          sessionId,
          source: input.source,
          stuckOn: input.stuckOn,
        }),
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const errorMessage = await readChatError(response);
        throw new Error(errorMessage);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let structuredResult: StructuredChatResponse | null = null;
      let errorMessage: string | null = null;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const parsed = parseSseFrames(buffer);
        buffer = parsed.remainder;

        for (const event of parsed.events) {
          if (event.event === "text-delta") {
            const payload = parseJsonPayload<{ text: string }>(event.data);

            if (payload?.text) {
              setState((current) => ({
                ...current,
                streamingText: current.streamingText + payload.text,
              }));
            }

            continue;
          }

          if (event.event === "structured") {
            const payload = parseJsonPayload<StructuredChatResponse>(event.data);

            if (!payload || !isStructuredChatResponse(payload)) {
              throw new Error("The server returned an invalid coaching result.");
            }

            structuredResult = payload;
            setState((current) => ({
              ...current,
              finalAssistantText: payload.assistantText,
              structuredResult: payload,
            }));
            continue;
          }

          if (event.event === "error") {
            const payload = parseJsonPayload<{ message?: string }>(event.data);
            errorMessage = payload?.message ?? "The coaching stream failed.";
            setState((current) => ({
              ...current,
              error: errorMessage,
              stage: "error",
            }));
            continue;
          }

          if (event.event === "done") {
            break;
          }
        }
      }

      if (!structuredResult) {
        throw new Error(
          errorMessage ?? "The coaching stream ended before a result was returned.",
        );
      }

      setState((current) => ({
        ...current,
        error: null,
        finalAssistantText: structuredResult.assistantText,
        isStreaming: false,
        stage: "completed",
        structuredResult,
      }));

      return structuredResult;
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        const message = "The coaching request was canceled.";

        setState((current) => ({
          ...current,
          error: message,
          isStreaming: false,
          stage: "error",
        }));

        throw new Error(message);
      }

      const message =
        error instanceof Error
          ? error.message
          : "The coaching request failed.";

      setState((current) => ({
        ...current,
        error: message,
        isStreaming: false,
        stage: "error",
      }));

      throw new Error(message);
    } finally {
      abortRef.current = null;
      setState((current) => ({
        ...current,
        isStreaming: false,
      }));
    }
  }

  async function sendInitial(input: Omit<SendChatInput, "mode">) {
    return runChatRequest({ ...input, mode: "initial" });
  }

  async function sendClarification(
    input: Omit<SendChatInput, "mode"> & { clarifyingAnswer: string },
  ) {
    return runChatRequest({ ...input, mode: "clarification" });
  }

  async function retry(input: Omit<SendChatInput, "mode">) {
    return runChatRequest({ ...input, mode: "retry" });
  }

  function cancel() {
    abortRef.current?.abort();
  }

  return {
    cancel,
    retry,
    sendClarification,
    sendInitial,
    state,
  };
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function readChatError(response: Response) {
  try {
    const payload = await response.json();

    if (
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
    ) {
      return payload.error;
    }
  } catch {
    // Ignore invalid JSON responses.
  }

  return `The coaching request failed with status ${response.status}.`;
}

function parseJsonPayload<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
