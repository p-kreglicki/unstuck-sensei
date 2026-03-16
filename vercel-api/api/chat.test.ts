import { handleChatRequest, normalizeStructuredResponse, OutputAccumulator } from "./chat";

describe("chat route helpers", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "anthropic-key";
    process.env.ANTHROPIC_MODEL = "test-model";
    process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
    process.env.SUPABASE_URL = "https://example.supabase.co";
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_URL;
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
