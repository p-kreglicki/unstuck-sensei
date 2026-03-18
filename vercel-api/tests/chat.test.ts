const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

import chatRoute, {
  consumeRateLimit,
  handleChatRequest,
  normalizeRequestBody,
  normalizeStructuredResponse,
  OutputAccumulator,
} from "../api/chat.js";

const VALID_SESSION_ID = "123e4567-e89b-12d3-a456-426614174000";

function createSessionsFromMock() {
  const limit = vi.fn().mockResolvedValue({
    data: [],
    error: null,
  });
  const order = vi.fn().mockReturnValue({ limit });
  const neq = vi.fn().mockReturnValue({ order });
  const eq = vi.fn().mockReturnValue({ neq });
  const select = vi.fn().mockReturnValue({ eq });

  return {
    from: vi.fn().mockReturnValue({ select }),
  };
}

function createAnthropicStreamResponse(frames: string[]) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
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

describe("chat route helpers", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "anthropic-key";
    process.env.ANTHROPIC_MODEL = "test-model";
    process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    createClientMock.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_URL;
    vi.unstubAllGlobals();
  });

  it("returns 401 when the authorization header is missing", async () => {
    const response = await handleChatRequest(
      new Request("https://example.com/api/chat", {
        body: JSON.stringify({
          energyLevel: "medium",
          mode: "initial",
          sessionId: VALID_SESSION_ID,
          source: "manual",
          stuckOn: "Ship the first build",
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
  });

  it("reflects allowed app origins in preflight responses", async () => {
    const response = await chatRoute.fetch(
      new Request("https://example.com/api/chat", {
        headers: {
          Origin: "http://localhost:1420",
        },
        method: "OPTIONS",
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:1420",
    );
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("does not allow unknown origins in preflight responses", async () => {
    const response = await chatRoute.fetch(
      new Request("https://example.com/api/chat", {
        headers: {
          Origin: "https://evil.example",
        },
        method: "OPTIONS",
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("includes the allowlisted origin on error responses", async () => {
    const response = await handleChatRequest(
      new Request("https://example.com/api/chat", {
        body: JSON.stringify({
          energyLevel: "medium",
          mode: "initial",
          sessionId: VALID_SESSION_ID,
          source: "manual",
          stuckOn: "Ship the first build",
        }),
        headers: {
          "Content-Type": "application/json",
          Origin: "https://tauri.localhost",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://tauri.localhost",
    );
  });

  it("returns 500 when required env is missing", async () => {
    delete process.env.ANTHROPIC_MODEL;

    const response = await handleChatRequest(
      new Request("https://example.com/api/chat", {
        body: JSON.stringify({
          energyLevel: "medium",
          mode: "initial",
          sessionId: VALID_SESSION_ID,
          source: "manual",
          stuckOn: "Ship the first build",
        }),
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(500);
  });

  it("rejects oversized stuckOn input before any Supabase calls", async () => {
    const response = await handleChatRequest(
      new Request("https://example.com/api/chat", {
        body: JSON.stringify({
          energyLevel: "medium",
          mode: "initial",
          sessionId: VALID_SESSION_ID,
          source: "manual",
          stuckOn: "x".repeat(2001),
        }),
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "stuckOn must be 2000 characters or fewer.",
    });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects oversized clarifyingAnswer input before any Supabase calls", async () => {
    const response = await handleChatRequest(
      new Request("https://example.com/api/chat", {
        body: JSON.stringify({
          clarifyingAnswer: "x".repeat(1001),
          energyLevel: "medium",
          mode: "clarification",
          sessionId: VALID_SESSION_ID,
          source: "manual",
          stuckOn: "Ship the first build",
        }),
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "clarifyingAnswer must be 1000 characters or fewer.",
    });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns 429 when the server-controlled rate limit is exhausted", async () => {
    const getUserMock = vi.fn().mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    const rpcMock = vi.fn().mockResolvedValue({
      data: {
        reservationId: null,
        status: "rate_limited",
      },
      error: null,
    });

    createClientMock
      .mockReturnValueOnce({
        auth: {
          getUser: getUserMock,
        },
      })
      .mockReturnValueOnce({
        rpc: rpcMock,
      });

    const response = await handleChatRequest(
      new Request("https://example.com/api/chat", {
        body: JSON.stringify({
          energyLevel: "medium",
          mode: "initial",
          sessionId: VALID_SESSION_ID,
          source: "manual",
          stuckOn: "Ship the first build",
        }),
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(429);
    expect(rpcMock).toHaveBeenCalledWith("consume_chat_rate_limit", {
      input_session_id: VALID_SESSION_ID,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normalizes request bodies with trimmed fields and capped lengths", () => {
    expect(
      normalizeRequestBody({
        clarifyingAnswer: "  Need the first message drafted.  ",
        energyLevel: "medium",
        mode: "clarification",
        sessionId: `  ${VALID_SESSION_ID}  `,
        source: "manual",
        stuckOn: "  Ship the first build  ",
      }),
    ).toEqual({
      kind: "success",
      value: {
        clarifyingAnswer: "Need the first message drafted.",
        energyLevel: "medium",
        mode: "clarification",
        sessionId: VALID_SESSION_ID,
        source: "manual",
        stuckOn: "Ship the first build",
      },
    });
  });

  it("rejects non-UUID sessionId values before any Supabase calls", async () => {
    const response = await handleChatRequest(
      new Request("https://example.com/api/chat", {
        body: JSON.stringify({
          energyLevel: "medium",
          mode: "initial",
          sessionId: "session-1",
          source: "manual",
          stuckOn: "Ship the first build",
        }),
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid chat request payload.",
    });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects oversized requests from Content-Length before parsing JSON", async () => {
    const response = await handleChatRequest(
      new Request("https://example.com/api/chat", {
        body: JSON.stringify({
          energyLevel: "medium",
          mode: "initial",
          sessionId: VALID_SESSION_ID,
          source: "manual",
          stuckOn: "Ship the first build",
        }),
        headers: {
          Authorization: "Bearer token",
          "Content-Length": "8193",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be 8192 bytes or fewer.",
    });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("surfaces invalid RPC responses from the rate-limit reservation helper", async () => {
    await expect(
      consumeRateLimit(
        {
          rpc: vi.fn().mockResolvedValue({
            data: "unexpected",
            error: null,
          }),
        },
        VALID_SESSION_ID,
      ),
    ).rejects.toThrow("invalid payload");
  });

  it("finalizes the rate-limit reservation after a successful stream", async () => {
    const getUserMock = vi.fn().mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    const rpcMock = vi.fn(async (fn: string) => {
      if (fn === "consume_chat_rate_limit") {
        return {
          data: {
            reservationId: "log-1",
            status: "allowed",
          },
          error: null,
        };
      }

      if (fn === "complete_chat_rate_limit_reservation") {
        return {
          data: true,
          error: null,
        };
      }

      throw new Error(`Unexpected RPC ${fn}`);
    });

    createClientMock
      .mockReturnValueOnce({
        auth: {
          getUser: getUserMock,
        },
      })
      .mockReturnValueOnce({
        ...createSessionsFromMock(),
        rpc: rpcMock,
      });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createAnthropicStreamResponse([
          "event: content_block_delta\n",
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Let\\u2019s keep this tiny.\\n<<<STRUCTURED_RESPONSE>>>\\n{\\"kind\\":\\"steps\\",\\"steps\\":[\\"Open the release checklist.\\",\\"Ship the smallest usable path.\\",\\"Send the beta invite.\\"]}"}}\n\n',
        ]),
      ),
    );

    const response = await handleChatRequest(
      new Request("https://example.com/api/chat", {
        body: JSON.stringify({
          energyLevel: "medium",
          mode: "initial",
          sessionId: VALID_SESSION_ID,
          source: "manual",
          stuckOn: "Ship the first build",
        }),
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("event: structured");
    expect(rpcMock).toHaveBeenCalledWith("complete_chat_rate_limit_reservation", {
      input_log_id: "log-1",
    });
  });

  it("releases the rate-limit reservation when the Anthropic request fails", async () => {
    const getUserMock = vi.fn().mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    const rpcMock = vi.fn(async (fn: string) => {
      if (fn === "consume_chat_rate_limit") {
        return {
          data: {
            reservationId: "log-1",
            status: "allowed",
          },
          error: null,
        };
      }

      if (fn === "release_chat_rate_limit_reservation") {
        return {
          data: true,
          error: null,
        };
      }

      throw new Error(`Unexpected RPC ${fn}`);
    });

    createClientMock
      .mockReturnValueOnce({
        auth: {
          getUser: getUserMock,
        },
      })
      .mockReturnValueOnce({
        ...createSessionsFromMock(),
        rpc: rpcMock,
      });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message: "Anthropic is unavailable.",
              type: "api_error",
            },
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
            status: 503,
          },
        ),
      ),
    );

    const response = await handleChatRequest(
      new Request("https://example.com/api/chat", {
        body: JSON.stringify({
          energyLevel: "medium",
          mode: "initial",
          sessionId: VALID_SESSION_ID,
          source: "manual",
          stuckOn: "Ship the first build",
        }),
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    const errorBody = await response.text();
    expect(errorBody).toContain("event: error");
    expect(rpcMock).toHaveBeenCalledWith("release_chat_rate_limit_reservation", {
      input_log_id: "log-1",
    });
  });

  it("marks missing structured output as recoverable when nothing reached the client", async () => {
    const getUserMock = vi.fn().mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    const rpcMock = vi.fn(async (fn: string) => {
      if (fn === "consume_chat_rate_limit") {
        return {
          data: {
            reservationId: "log-1",
            status: "allowed",
          },
          error: null,
        };
      }

      if (fn === "release_chat_rate_limit_reservation") {
        return {
          data: true,
          error: null,
        };
      }

      throw new Error(`Unexpected RPC ${fn}`);
    });

    createClientMock
      .mockReturnValueOnce({
        auth: {
          getUser: getUserMock,
        },
      })
      .mockReturnValueOnce({
        ...createSessionsFromMock(),
        rpc: rpcMock,
      });

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            createAnthropicStreamResponse([
            "event: content_block_delta\n",
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":""}}\n\n',
            ]),
          ),
        ),
    );

    const response = await handleChatRequest(
      new Request("https://example.com/api/chat", {
        body: JSON.stringify({
          energyLevel: "medium",
          mode: "initial",
          sessionId: VALID_SESSION_ID,
          source: "manual",
          stuckOn: "Ship the first build",
        }),
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("The coaching stream failed unexpectedly.");
    expect(body).toContain('event: done\ndata: {"ok":false}');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(rpcMock).toHaveBeenCalledWith("release_chat_rate_limit_reservation", {
      input_log_id: "log-1",
    });
  });

  it("marks missing structured output as non-recoverable after streaming text", async () => {
    const getUserMock = vi.fn().mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    const rpcMock = vi.fn(async (fn: string) => {
      if (fn === "consume_chat_rate_limit") {
        return {
          data: {
            reservationId: "log-1",
            status: "allowed",
          },
          error: null,
        };
      }

      if (fn === "release_chat_rate_limit_reservation") {
        return {
          data: true,
          error: null,
        };
      }

      throw new Error(`Unexpected RPC ${fn}`);
    });

    createClientMock
      .mockReturnValueOnce({
        auth: {
          getUser: getUserMock,
        },
      })
      .mockReturnValueOnce({
        ...createSessionsFromMock(),
        rpc: rpcMock,
      });

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          createAnthropicStreamResponse([
            "event: content_block_delta\n",
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Let\\u2019s keep this tiny."}}\n\n',
          ]),
        ),
    );

    const response = await handleChatRequest(
      new Request("https://example.com/api/chat", {
        body: JSON.stringify({
          energyLevel: "medium",
          mode: "initial",
          sessionId: VALID_SESSION_ID,
          source: "manual",
          stuckOn: "Ship the first build",
        }),
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('event: text-delta\ndata: {"text":"Let\u2019s keep this tiny."}');
    expect(body).toContain("The coaching stream failed unexpectedly.");
    expect(body).not.toContain('event: done\ndata: {"ok":false}');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("release_chat_rate_limit_reservation", {
      input_log_id: "log-1",
    });
  });

  it("does not leak unexpected streaming errors to the SSE client", async () => {
    const getUserMock = vi.fn().mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    const rpcMock = vi.fn(async (fn: string) => {
      if (fn === "consume_chat_rate_limit") {
        return {
          data: {
            reservationId: "log-1",
            status: "allowed",
          },
          error: null,
        };
      }

      if (fn === "release_chat_rate_limit_reservation") {
        return {
          data: true,
          error: null,
        };
      }

      throw new Error(`Unexpected RPC ${fn}`);
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    createClientMock
      .mockReturnValueOnce({
        auth: {
          getUser: getUserMock,
        },
      })
      .mockReturnValueOnce({
        ...createSessionsFromMock(),
        rpc: rpcMock,
      });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error('relation "private.audit" does not exist')),
    );

    const response = await handleChatRequest(
      new Request("https://example.com/api/chat", {
        body: JSON.stringify({
          energyLevel: "medium",
          mode: "initial",
          sessionId: VALID_SESSION_ID,
          source: "manual",
          stuckOn: "Ship the first build",
        }),
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("The coaching stream failed unexpectedly.");
    expect(body).not.toContain('relation "private.audit" does not exist');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[chat] unexpected streaming failure",
      expect.objectContaining({
        error: 'relation "private.audit" does not exist',
        reservationId: "log-1",
        sessionId: VALID_SESSION_ID,
        userId: "user-1",
      }),
    );
    consoleErrorSpy.mockRestore();
  });

  it("normalizes a valid structured steps response", () => {
    const response = normalizeStructuredResponse(
      JSON.stringify({
        kind: "steps",
        steps: [
          "Open the release checklist.",
          "Ship the smallest usable path.",
          "Send the beta invite.",
        ],
      }),
      "Let’s keep this tiny.",
    );

    expect(response).toEqual({
      assistantText: "Let’s keep this tiny.",
      kind: "steps",
      steps: [
        { id: "step-1", text: "Open the release checklist." },
        { id: "step-2", text: "Ship the smallest usable path." },
        { id: "step-3", text: "Send the beta invite." },
      ],
    });
  });

  it("buffers assistant text until the structured delimiter appears", () => {
    const accumulator = new OutputAccumulator();

    const visible = accumulator.push(
      'Let’s keep this tiny.\n<<<STRUCTURED_RESPONSE>>>\n{"kind":"steps","steps":["one","two","three"]}',
    );

    expect(visible).toBe("Let’s keep this tiny.");
    expect(accumulator.finish()).toEqual({
      assistantRemainder: "",
      structuredRaw: '{"kind":"steps","steps":["one","two","three"]}',
    });
  });
});
