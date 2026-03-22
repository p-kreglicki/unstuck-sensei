import { deriveThreadItems } from "./session-thread";
import type {
  ConversationMessageRow,
  SessionRow,
  SessionTimerBlockRow,
} from "./session-records";

function createSessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    checked_in_at: null,
    clarifying_answer: null,
    clarifying_question: null,
    created_at: "2026-03-17T10:00:00.000Z",
    energy_level: null,
    feedback: null,
    id: "session-1",
    source: "manual",
    status: "active",
    steps: null,
    stuck_on: "Ship the first build",
    timer_duration_seconds: null,
    timer_ended_at: null,
    timer_extended: null,
    timer_revision: 0,
    timer_started_at: null,
    updated_at: "2026-03-17T10:00:00.000Z",
    user_id: "user-1",
    ...overrides,
  };
}

function createConversationMessageRow(
  overrides: Partial<ConversationMessageRow> = {},
): ConversationMessageRow {
  return {
    content: "Ship the first build",
    created_at: "2026-03-17T10:01:00.000Z",
    id: "message-1",
    role: "user",
    session_id: "session-1",
    ...overrides,
  };
}

function createTimerBlockRow(
  overrides: Partial<SessionTimerBlockRow> = {},
): SessionTimerBlockRow {
  return {
    block_index: 1,
    created_at: "2026-03-17T10:10:00.000Z",
    duration_seconds: 1500,
    ended_at: null,
    id: "block-1",
    kind: "initial",
    session_id: "session-1",
    started_at: "2026-03-17T10:10:00.000Z",
    ...overrides,
  };
}

describe("deriveThreadItems", () => {
  it("returns only the opening prompt for a fresh compose state", () => {
    expect(
      deriveThreadItems({
        chatState: {
          isStreaming: false,
          streamingText: "",
        },
        currentStage: "compose",
        latestTimerBlock: null,
        messages: [],
        sessionRow: null,
        steps: [],
      }),
    ).toEqual([
      {
        content: "What are you stuck on?",
        id: "prompt:opening",
        kind: "prompt",
        prompt: "opening",
        role: "assistant",
        synthetic: true,
      },
    ]);
  });

  it("synthesizes missing early turns for older energy-stage drafts", () => {
    expect(
      deriveThreadItems({
        chatState: {
          isStreaming: false,
          streamingText: "",
        },
        currentStage: "energy",
        latestTimerBlock: null,
        messages: [],
        sessionRow: createSessionRow(),
        steps: [],
      }),
    ).toEqual([
      {
        content: "What are you stuck on?",
        id: "prompt:opening",
        kind: "prompt",
        prompt: "opening",
        role: "assistant",
        synthetic: true,
      },
      {
        content: "Ship the first build",
        id: "synthetic:user-opening",
        kind: "message",
        persisted: false,
        role: "user",
      },
      {
        content: "What kind of energy do you have right now?",
        id: "prompt:energy",
        kind: "prompt",
        prompt: "energy",
        role: "assistant",
        synthetic: true,
      },
      {
        control: "energy",
        id: "control:energy",
        kind: "control",
      },
    ]);
  });

  it("preserves persisted opening messages and adds the synthetic energy reply", () => {
    expect(
      deriveThreadItems({
        chatState: {
          isStreaming: false,
          streamingText: "",
        },
        currentStage: "steps",
        latestTimerBlock: null,
        messages: [
          createConversationMessageRow(),
          createConversationMessageRow({
            content: "Let’s keep this tiny.",
            id: "message-2",
            role: "assistant",
          }),
        ],
        sessionRow: createSessionRow({
          energy_level: "medium",
        }),
        steps: [{ id: "step-1", text: "Open the checklist." }],
      }),
    ).toEqual([
      {
        content: "What are you stuck on?",
        id: "prompt:opening",
        kind: "prompt",
        prompt: "opening",
        role: "assistant",
        synthetic: true,
      },
      {
        content: "Ship the first build",
        id: "message-1",
        kind: "message",
        persisted: true,
        role: "user",
      },
      {
        content: "What kind of energy do you have right now?",
        id: "prompt:energy",
        kind: "prompt",
        prompt: "energy",
        role: "assistant",
        synthetic: true,
      },
      {
        content: "Medium",
        id: "synthetic:user-energy",
        kind: "message",
        persisted: false,
        role: "user",
      },
      {
        content: "Let’s keep this tiny.",
        id: "message-2",
        kind: "message",
        persisted: true,
        role: "assistant",
      },
      {
        control: "steps",
        id: "control:steps",
        kind: "control",
      },
    ]);
  });

  it("falls back to a synthetic clarifying prompt when the assistant row is missing", () => {
    expect(
      deriveThreadItems({
        chatState: {
          isStreaming: false,
          streamingText: "",
        },
        currentStage: "clarifying",
        latestTimerBlock: null,
        messages: [createConversationMessageRow()],
        sessionRow: createSessionRow({
          clarifying_question: "What is the first move?",
          energy_level: "low",
        }),
        steps: [],
      }),
    ).toEqual([
      {
        content: "What are you stuck on?",
        id: "prompt:opening",
        kind: "prompt",
        prompt: "opening",
        role: "assistant",
        synthetic: true,
      },
      {
        content: "Ship the first build",
        id: "message-1",
        kind: "message",
        persisted: true,
        role: "user",
      },
      {
        content: "What kind of energy do you have right now?",
        id: "prompt:energy",
        kind: "prompt",
        prompt: "energy",
        role: "assistant",
        synthetic: true,
      },
      {
        content: "Low",
        id: "synthetic:user-energy",
        kind: "message",
        persisted: false,
        role: "user",
      },
      {
        content: "What is the first move?",
        id: "prompt:clarifying",
        kind: "prompt",
        prompt: "clarifying",
        role: "assistant",
        synthetic: true,
      },
    ]);
  });

  it("appends streaming output before the active timer control", () => {
    expect(
      deriveThreadItems({
        chatState: {
          isStreaming: true,
          streamingText: "Still thinking...",
        },
        currentStage: "timer",
        latestTimerBlock: createTimerBlockRow(),
        messages: [createConversationMessageRow()],
        sessionRow: createSessionRow({
          energy_level: "high",
        }),
        steps: [{ id: "step-1", text: "Open the checklist." }],
      }),
    ).toEqual([
      {
        content: "What are you stuck on?",
        id: "prompt:opening",
        kind: "prompt",
        prompt: "opening",
        role: "assistant",
        synthetic: true,
      },
      {
        content: "Ship the first build",
        id: "message-1",
        kind: "message",
        persisted: true,
        role: "user",
      },
      {
        content: "What kind of energy do you have right now?",
        id: "prompt:energy",
        kind: "prompt",
        prompt: "energy",
        role: "assistant",
        synthetic: true,
      },
      {
        content: "High",
        id: "synthetic:user-energy",
        kind: "message",
        persisted: false,
        role: "user",
      },
      {
        content: "Still thinking...",
        id: "message:streaming",
        kind: "message",
        persisted: false,
        role: "assistant",
        status: "streaming",
      },
      {
        control: "timer",
        id: "control:timer:block-1",
        kind: "control",
      },
    ]);
  });
});
