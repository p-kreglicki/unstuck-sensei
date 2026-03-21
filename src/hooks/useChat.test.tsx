import { act, renderHook, waitFor } from "@testing-library/react";
import { useChat } from "./useChat";
import { toDisplayError } from "../lib/errors";
import { encodeSseEvent } from "../../shared/session/chat-sse.js";

function createStreamingResponse(frames: string[]) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) {
          controller.enqueue(encoder.encode(frame));
        }

        controller.close();
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
      },
      status: 200,
    },
  );
}

describe("useChat", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_VERCEL_API_URL", "https://api.example.com");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("parses streaming assistant text and the final structured result", async () => {
    vi.mocked(fetch).mockResolvedValue(
      createStreamingResponse([
        encodeSseEvent("text-delta", { text: "Let’s keep this tiny. " }),
        encodeSseEvent("text-delta", { text: "Start with the first move." }),
        encodeSseEvent("structured", {
          assistantText: "Let’s keep this tiny. Start with the first move.",
          kind: "steps",
          steps: [
            { id: "step-1", text: "Open the deploy checklist." },
            { id: "step-2", text: "Ship the smallest working version." },
            { id: "step-3", text: "Message the first tester." },
          ],
        }),
        encodeSseEvent("done", { ok: true }),
      ]),
    );

    const { result } = renderHook(() =>
      useChat({ accessToken: "token-123", sessionId: "session-1" }),
    );

    const response = await result.current.sendInitial({
      energyLevel: "medium",
      source: "manual",
      stuckOn: "Shipping the first build",
    });

    await waitFor(() => {
      expect(result.current.state.isStreaming).toBe(false);
      expect(result.current.state.structuredResult).toEqual(response);
    });

    expect(response.kind).toBe("steps");
    expect(result.current.state.streamingText).toContain("Let’s keep this tiny.");
    expect(result.current.state.error).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/chat"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-123",
        }),
        method: "POST",
      }),
    );
  });

  it("keeps streamed text and surfaces an error when the stream ends before a structured result", async () => {
    vi.mocked(fetch).mockResolvedValue(
      createStreamingResponse([
        encodeSseEvent("text-delta", { text: "Okay, let’s make this smaller." }),
      ]),
    );

    const { result } = renderHook(() =>
      useChat({ accessToken: "token-123", sessionId: "session-2" }),
    );

    await expect(
      result.current.sendInitial({
        energyLevel: "low",
        source: "manual",
        stuckOn: "Starting the landing page rewrite",
      }),
    ).rejects.toThrow("ended before a result was returned");

    await waitFor(() => {
      expect(result.current.state.isStreaming).toBe(false);
      expect(result.current.state.error).toMatch(/ended before a result/);
    });

    expect(result.current.state.streamingText).toContain(
      "Okay, let’s make this smaller.",
    );
    expect(result.current.state.structuredResult).toBeNull();
  });

  it("buffers multiple deltas behind a single animation-frame flush", async () => {
    const requestAnimationFrameMock = vi.fn<(callback: FrameRequestCallback) => number>();
    const cancelAnimationFrameMock = vi.fn<(handle: number) => void>();

    requestAnimationFrameMock.mockImplementation(() => 1);

    vi.stubGlobal("requestAnimationFrame", requestAnimationFrameMock);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);
    vi.mocked(fetch).mockResolvedValue(
      createStreamingResponse([
        encodeSseEvent("text-delta", { text: "First chunk. " }),
        encodeSseEvent("text-delta", { text: "Second chunk." }),
        encodeSseEvent("structured", {
          assistantText: "First chunk. Second chunk.",
          kind: "steps",
          steps: [{ id: "step-1", text: "Ship it." }],
        }),
        encodeSseEvent("done", { ok: true }),
      ]),
    );

    const { result } = renderHook(() =>
      useChat({ accessToken: "token-123", sessionId: "session-3" }),
    );

    await result.current.sendInitial({
      energyLevel: "high",
      source: "manual",
      stuckOn: "Finishing the launch note",
    });

    await waitFor(() => {
      expect(result.current.state.streamingText).toBe("First chunk. Second chunk.");
    });

    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrameMock).toHaveBeenCalledWith(1);
  });

  it("surfaces server error responses before trying to read the stream", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "Rate limit reached." }), {
        headers: {
          "Content-Type": "application/json",
        },
        status: 429,
      }),
    );

    const { result } = renderHook(() =>
      useChat({ accessToken: "token-123", sessionId: "session-4" }),
    );

    let error: unknown;

    try {
      await result.current.sendInitial({
        energyLevel: "medium",
        source: "manual",
        stuckOn: "Trying the same thing again",
      });
    } catch (caughtError) {
      error = caughtError;
    }

    expect(error).toBeInstanceOf(Error);
    expect(toDisplayError(error, "fallback")).toBe("Rate limit reached.");

    await waitFor(() => {
      expect(result.current.state.error).toBe("Rate limit reached.");
      expect(result.current.state.isStreaming).toBe(false);
    });
  });

  it("fails before fetch when the access token is missing", async () => {
    const { result } = renderHook(() =>
      useChat({ accessToken: null, sessionId: "session-5" }),
    );

    await expect(
      result.current.sendInitial({
        energyLevel: "medium",
        source: "manual",
        stuckOn: "Trying to continue after auth expired",
      }),
    ).rejects.toThrow("Your session expired. Sign in again to continue.");

    expect(fetch).not.toHaveBeenCalled();
  });

  it("supports clarifying-question structured responses", async () => {
    vi.mocked(fetch).mockResolvedValue(
      createStreamingResponse([
        encodeSseEvent("text-delta", { text: "Need one detail first." }),
        encodeSseEvent("structured", {
          assistantText: "Need one detail first.",
          kind: "clarifying_question",
          question: "What is blocking the first step?",
        }),
        encodeSseEvent("done", { ok: true }),
      ]),
    );

    const { result } = renderHook(() =>
      useChat({ accessToken: "token-123", sessionId: "session-6" }),
    );

    const response = await result.current.sendInitial({
      energyLevel: "medium",
      source: "manual",
      stuckOn: "Opening the draft",
    });

    expect(response).toEqual({
      assistantText: "Need one detail first.",
      kind: "clarifying_question",
      question: "What is blocking the first step?",
    });
  });

  it("sends clarification and retry requests with the expected modes", async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(
        createStreamingResponse([
          encodeSseEvent("structured", {
            assistantText: "Start here.",
            kind: "steps",
            steps: [{ id: "step-1", text: "Open the draft." }],
          }),
          encodeSseEvent("done", { ok: true }),
        ]),
      ),
    );

    const { result } = renderHook(() =>
      useChat({ accessToken: "token-123", sessionId: "session-7" }),
    );

    await act(async () => {
      await result.current.sendClarification({
        clarifyingAnswer: "Write the intro",
        energyLevel: "medium",
        source: "manual",
        stuckOn: "Finishing the launch note",
      });
    });

    await act(async () => {
      await result.current.retry({
        energyLevel: "medium",
        source: "manual",
        stuckOn: "Finishing the launch note",
      });
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          clarifyingAnswer: "Write the intro",
          energyLevel: "medium",
          mode: "clarification",
          sessionId: "session-7",
          source: "manual",
          stuckOn: "Finishing the launch note",
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          energyLevel: "medium",
          mode: "retry",
          sessionId: "session-7",
          source: "manual",
          stuckOn: "Finishing the launch note",
        }),
      }),
    );
  });

  it("aborts an in-flight request when cancel is called", async () => {
    vi.mocked(fetch).mockImplementation(
      (_input, init) =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                init?.signal?.addEventListener("abort", () => {
                  controller.error(new DOMException("Aborted", "AbortError"));
                });
              },
            }),
            {
              headers: {
                "Content-Type": "text/event-stream",
              },
              status: 200,
            },
          ),
        ),
    );

    const { result } = renderHook(() =>
      useChat({ accessToken: "token-123", sessionId: "session-8" }),
    );

    let requestPromise!: Promise<unknown>;

    act(() => {
      requestPromise = result.current.sendInitial({
        energyLevel: "medium",
        source: "manual",
        stuckOn: "Cancelling a long response",
      });
    });

    act(() => {
      result.current.cancel();
    });

    await expect(requestPromise).rejects.toThrow(
      "The coaching request was canceled.",
    );

    await waitFor(() => {
      expect(result.current.state.error).toBe("The coaching request was canceled.");
      expect(result.current.state.isStreaming).toBe(false);
    });
  });
});
