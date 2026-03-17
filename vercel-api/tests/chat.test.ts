const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

import chatRoute, {
  consumeRateLimit,
  handleChatRequest,
  normalizeAnthropicError,
  normalizeRequestBody,
  normalizeStructuredResponse,
  OutputAccumulator,
} from "../api/chat.js";

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
          sessionId: "session-1",
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
          sessionId: "session-1",
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

    expect(response.status).toBe(500);
  });

  it("rejects oversized stuckOn input before any Supabase calls", async () => {
    const response = await handleChatRequest(
      new Request("https://example.com/api/chat", {
        body: JSON.stringify({
          energyLevel: "medium",
          mode: "initial",
          sessionId: "session-1",
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
      data: "rate_limited",
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

    expect(response.status).toBe(429);
    expect(rpcMock).toHaveBeenCalledWith("consume_chat_rate_limit", {
      input_session_id: "session-1",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normalizes invalid Anthropic model errors into deployment guidance", () => {
    expect(
      normalizeAnthropicError({
        message: "model: claude-3-5-haiku-latest",
        model: "claude-3-5-haiku-latest",
        status: 400,
        type: "invalid_request_error",
      }),
    ).toBe(
      'The configured Anthropic model "claude-3-5-haiku-latest" is unavailable. Check ANTHROPIC_MODEL against Anthropic\'s current models list.',
    );
  });

  it("normalizes Anthropic permission errors into key guidance", () => {
    expect(
      normalizeAnthropicError({
        message: "You do not have access to this model.",
        model: "claude-haiku-4-5",
        status: 403,
        type: "permission_error",
      }),
    ).toBe(
      'The configured Anthropic API key does not have access to model "claude-haiku-4-5". Check ANTHROPIC_API_KEY and ANTHROPIC_MODEL.',
    );
  });

  it("normalizes request bodies with trimmed fields and capped lengths", () => {
    expect(
      normalizeRequestBody({
        clarifyingAnswer: "  Need the first message drafted.  ",
        energyLevel: "medium",
        mode: "clarification",
        sessionId: "  session-1  ",
        source: "manual",
        stuckOn: "  Ship the first build  ",
      }),
    ).toEqual({
      kind: "success",
      value: {
        clarifyingAnswer: "Need the first message drafted.",
        energyLevel: "medium",
        mode: "clarification",
        sessionId: "session-1",
        source: "manual",
        stuckOn: "Ship the first build",
      },
    });
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
        "session-1",
      ),
    ).rejects.toThrow("invalid status");
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
