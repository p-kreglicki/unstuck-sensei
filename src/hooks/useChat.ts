import { useEffect, useRef, useState } from "react";
import { parseSseFrames } from "../../shared/session/chat-sse.js";
import { createDisplayError } from "../lib/errors";
import {
  isStructuredChatResponse,
  type ChatRequestMode,
  type EnergyLevel,
  type SessionSource,
  type StructuredChatResponse,
} from "../../shared/session/session-protocol.js";

export type ChatState = {
  error: string | null;
  isStreaming: boolean;
  streamingText: string;
  structuredResult: StructuredChatResponse | null;
};

const defaultState: ChatState = {
  error: null,
  isStreaming: false,
  streamingText: "",
  structuredResult: null,
};

type UseChatOptions = {
  accessToken: string | null;
  sessionId: string | null;
};

type SendChatInput = {
  clarifyingAnswer?: string;
  energyLevel: EnergyLevel;
  mode: ChatRequestMode;
  source: SessionSource;
  stuckOn: string;
};

export function useChat({ accessToken, sessionId }: UseChatOptions) {
  const [state, setState] = useState<ChatState>(defaultState);
  const abortRef = useRef<AbortController | null>(null);
  const pendingStreamingTextRef = useRef("");
  const streamingFrameRef = useRef<number | null>(null);
  const streamingTextRef = useRef(defaultState.streamingText);

  useEffect(() => {
    return () => {
      if (streamingFrameRef.current !== null) {
        cancelAnimationFrame(streamingFrameRef.current);
      }

      abortRef.current?.abort();
    };
  }, []);

  function applyPendingStreamingText() {
    if (pendingStreamingTextRef.current.length === 0) {
      return;
    }

    const nextStreamingText =
      streamingTextRef.current + pendingStreamingTextRef.current;

    pendingStreamingTextRef.current = "";
    streamingTextRef.current = nextStreamingText;

    setState((current) => ({
      ...current,
      streamingText: nextStreamingText,
    }));
  }

  function flushStreamingText() {
    if (streamingFrameRef.current !== null) {
      cancelAnimationFrame(streamingFrameRef.current);
      streamingFrameRef.current = null;
    }

    applyPendingStreamingText();
  }

  function scheduleStreamingTextFlush() {
    if (streamingFrameRef.current !== null) {
      return;
    }

    streamingFrameRef.current = requestAnimationFrame(() => {
      streamingFrameRef.current = null;
      applyPendingStreamingText();
    });
  }

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

    if (!accessToken) {
      throw createDisplayError("Your session expired. Sign in again to continue.");
    }

    const controller = new AbortController();
    abortRef.current = controller;
    pendingStreamingTextRef.current = "";
    streamingTextRef.current = "";

    if (streamingFrameRef.current !== null) {
      cancelAnimationFrame(streamingFrameRef.current);
      streamingFrameRef.current = null;
    }

    setState({
      error: null,
      isStreaming: true,
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
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const errorMessage = await readChatError(response);
        throw createDisplayError(errorMessage);
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
            const text = readTextDeltaPayload(event.data);

            if (text) {
              pendingStreamingTextRef.current += text;
              scheduleStreamingTextFlush();
            }

            continue;
          }

          if (event.event === "structured") {
            const payload = parseJsonPayload(event.data);

            if (!payload || !isStructuredChatResponse(payload)) {
              throw createDisplayError("The server returned an invalid coaching result.");
            }

            flushStreamingText();
            structuredResult = payload;
            setState((current) => ({
              ...current,
              structuredResult: payload,
            }));
            continue;
          }

          if (event.event === "error") {
            errorMessage = readErrorPayload(event.data);
            flushStreamingText();
            setState((current) => ({
              ...current,
              error: errorMessage,
            }));
            continue;
          }

          if (event.event === "done") {
            break;
          }
        }
      }

      if (!structuredResult) {
        flushStreamingText();
        throw createDisplayError(
          errorMessage ?? "The coaching stream ended before a result was returned.",
        );
      }

      setState((current) => ({
        ...current,
        error: null,
        structuredResult,
      }));

      return structuredResult;
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        const message = "The coaching request was canceled.";

        flushStreamingText();
        setState((current) => ({
          ...current,
          error: message,
        }));

        throw createDisplayError(message);
      }

      const message =
        error instanceof Error
          ? error.message
          : "The coaching request failed.";

      flushStreamingText();
      setState((current) => ({
        ...current,
        error: message,
      }));

      throw error instanceof Error ? error : new Error(message);
    } finally {
      abortRef.current = null;
      flushStreamingText();
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

function parseJsonPayload(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readTextDeltaPayload(value: string) {
  const payload = parseJsonPayload(value);

  if (
    payload &&
    typeof payload === "object" &&
    "text" in payload &&
    typeof payload.text === "string"
  ) {
    return payload.text;
  }

  return null;
}

function readErrorPayload(value: string) {
  const payload = parseJsonPayload(value);

  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string" &&
    payload.message.trim().length > 0
  ) {
    return payload.message;
  }

  return "The coaching stream failed.";
}
