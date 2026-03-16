import { renderHook, waitFor } from "@testing-library/react";
import { useChat } from "./useChat";
import { encodeSseEvent } from "../lib/chat-sse";

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
    },
  },
}));

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
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: "token-123",
        },
      },
      error: null,
    });
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

    const { result } = renderHook(() => useChat({ sessionId: "session-1" }));

    const response = await result.current.sendInitial({
      energyLevel: "medium",
      source: "manual",
      stuckOn: "Shipping the first build",
    });

    await waitFor(() => {
      expect(result.current.state.stage).toBe("completed");
    });

    expect(response.kind).toBe("steps");
    expect(result.current.state.streamingText).toContain("Let’s keep this tiny.");
    expect(result.current.state.structuredResult).toEqual(response);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/chat"),
      expect.objectContaining({
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

    const { result } = renderHook(() => useChat({ sessionId: "session-2" }));

    await expect(
      result.current.sendInitial({
        energyLevel: "low",
        source: "manual",
        stuckOn: "Starting the landing page rewrite",
      }),
    ).rejects.toThrow("ended before a result was returned");

    await waitFor(() => {
      expect(result.current.state.stage).toBe("error");
    });

    expect(result.current.state.streamingText).toContain(
      "Okay, let’s make this smaller.",
    );
    expect(result.current.state.error).toMatch(/ended before a result/);
  });
});
