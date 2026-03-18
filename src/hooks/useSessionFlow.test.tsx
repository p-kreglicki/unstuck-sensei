import { act, renderHook, waitFor } from "@testing-library/react";
import { useSessionFlow } from "./useSessionFlow";
import type { SessionRow } from "../lib/session-records";

const {
  createSessionDraftMock,
  insertConversationMessageMock,
  loadActiveSessionDraftMock,
  loadConversationMessagesMock,
  loadRecentSessionSummariesMock,
  updateSessionDraftMock,
  useAuthMock,
  useChatMock,
} = vi.hoisted(() => ({
  createSessionDraftMock: vi.fn(),
  insertConversationMessageMock: vi.fn(),
  loadActiveSessionDraftMock: vi.fn(),
  loadConversationMessagesMock: vi.fn(),
  loadRecentSessionSummariesMock: vi.fn(),
  updateSessionDraftMock: vi.fn(),
  useAuthMock: vi.fn(),
  useChatMock: vi.fn(),
}));

vi.mock("./useAuth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("./useChat", () => ({
  useChat: (input: unknown) => useChatMock(input),
}));

vi.mock("../lib/session-records", () => ({
  createSessionDraft: (...args: unknown[]) => createSessionDraftMock(...args),
  insertConversationMessage: (...args: unknown[]) =>
    insertConversationMessageMock(...args),
  loadActiveSessionDraft: (...args: unknown[]) => loadActiveSessionDraftMock(...args),
  loadConversationMessages: (...args: unknown[]) =>
    loadConversationMessagesMock(...args),
  loadRecentSessionSummaries: (...args: unknown[]) =>
    loadRecentSessionSummariesMock(...args),
  readSessionSteps: (session: { steps?: unknown } | null) =>
    Array.isArray(session?.steps) ? session.steps : [],
  updateSessionDraft: (...args: unknown[]) => updateSessionDraftMock(...args),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, reject, resolve };
}

function createSessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
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
    timer_started_at: null,
    updated_at: "2026-03-17T10:00:00.000Z",
    user_id: "user-1",
    ...overrides,
  };
}

function createChatState() {
  return {
    error: null,
    isStreaming: false,
    streamingText: "",
    structuredResult: null,
  };
}

describe("useSessionFlow", () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({
      session: {
        access_token: "token-123",
      },
      user: {
        id: "user-1",
      },
    });
    useChatMock.mockReturnValue({
      cancel: vi.fn(),
      retry: vi.fn(),
      sendClarification: vi.fn(),
      sendInitial: vi.fn(),
      state: createChatState(),
    });
    loadActiveSessionDraftMock.mockResolvedValue(null);
    loadConversationMessagesMock.mockResolvedValue([]);
    loadRecentSessionSummariesMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("starts the draft update and first user message insert together before generating steps", async () => {
    const activeSession = createSessionRow();
    const updatedSession = createSessionRow({ energy_level: "medium" });
    const finalSession = createSessionRow({
      energy_level: "medium",
      steps: [{ id: "step-1", text: "Open the checklist." }],
    });
    const updateDeferred = createDeferred<SessionRow>();
    const sendInitialMock = vi.fn().mockResolvedValue({
      assistantText: "Let’s keep this tiny.",
      kind: "steps",
      steps: [{ id: "step-1", text: "Open the checklist." }],
    });

    useChatMock.mockReturnValue({
      cancel: vi.fn(),
      retry: vi.fn(),
      sendClarification: vi.fn(),
      sendInitial: sendInitialMock,
      state: createChatState(),
    });
    loadActiveSessionDraftMock.mockResolvedValue(activeSession);
    updateSessionDraftMock
      .mockImplementationOnce(() => updateDeferred.promise)
      .mockResolvedValueOnce(finalSession);
    insertConversationMessageMock
      .mockResolvedValueOnce({
        content: "Ship the first build",
        created_at: "2026-03-17T10:01:00.000Z",
        id: "message-1",
        role: "user",
        session_id: "session-1",
      })
      .mockResolvedValueOnce({
        content: "Let’s keep this tiny.",
        created_at: "2026-03-17T10:02:00.000Z",
        id: "message-2",
        role: "assistant",
        session_id: "session-1",
      });

    const { result } = renderHook(() => useSessionFlow({ locationState: null }));

    await waitFor(() => {
      expect(result.current.isBooting).toBe(false);
    });

    expect(useChatMock).toHaveBeenCalledWith({
      accessToken: "token-123",
      sessionId: "session-1",
    });

    act(() => {
      result.current.setEnergyLevel("medium");
    });

    let work!: Promise<void>;

    act(() => {
      work = result.current.handleGenerateSteps();
    });

    await waitFor(() => {
      expect(updateSessionDraftMock).toHaveBeenNthCalledWith(1, "session-1", {
        energy_level: "medium",
      });
      expect(insertConversationMessageMock).toHaveBeenNthCalledWith(1, {
        content: "Ship the first build",
        role: "user",
        sessionId: "session-1",
      });
    });
    expect(sendInitialMock).not.toHaveBeenCalled();

    await act(async () => {
      updateDeferred.resolve(updatedSession);
      await work;
    });

    expect(sendInitialMock).toHaveBeenCalledWith({
      energyLevel: "medium",
      source: "manual",
      stuckOn: "Ship the first build",
    });
  });

  it("starts the clarifying draft update and user message insert together", async () => {
    const activeSession = createSessionRow({
      clarifying_question: "What is the first move?",
      energy_level: "medium",
    });
    const updatedSession = createSessionRow({
      clarifying_answer: "Draft the headline",
      clarifying_question: "What is the first move?",
      energy_level: "medium",
    });
    const finalSession = createSessionRow({
      clarifying_answer: "Draft the headline",
      energy_level: "medium",
      steps: [{ id: "step-1", text: "Draft the headline" }],
    });
    const updateDeferred = createDeferred<SessionRow>();
    const sendClarificationMock = vi.fn().mockResolvedValue({
      assistantText: "Good. Start there.",
      kind: "steps",
      steps: [{ id: "step-1", text: "Draft the headline" }],
    });

    useChatMock.mockReturnValue({
      cancel: vi.fn(),
      retry: vi.fn(),
      sendClarification: sendClarificationMock,
      sendInitial: vi.fn(),
      state: createChatState(),
    });
    loadActiveSessionDraftMock.mockResolvedValue(activeSession);
    updateSessionDraftMock
      .mockImplementationOnce(() => updateDeferred.promise)
      .mockResolvedValueOnce(finalSession);
    insertConversationMessageMock
      .mockResolvedValueOnce({
        content: "Draft the headline",
        created_at: "2026-03-17T10:01:00.000Z",
        id: "message-1",
        role: "user",
        session_id: "session-1",
      })
      .mockResolvedValueOnce({
        content: "Good. Start there.",
        created_at: "2026-03-17T10:02:00.000Z",
        id: "message-2",
        role: "assistant",
        session_id: "session-1",
      });

    const { result } = renderHook(() => useSessionFlow({ locationState: null }));

    await waitFor(() => {
      expect(result.current.isBooting).toBe(false);
    });

    act(() => {
      result.current.setClarifyingAnswer("Draft the headline");
    });

    let work!: Promise<void>;

    act(() => {
      work = result.current.handleClarifyingSubmit();
    });

    await waitFor(() => {
      expect(updateSessionDraftMock).toHaveBeenNthCalledWith(1, "session-1", {
        clarifying_answer: "Draft the headline",
      });
      expect(insertConversationMessageMock).toHaveBeenNthCalledWith(1, {
        content: "Draft the headline",
        role: "user",
        sessionId: "session-1",
      });
    });
    expect(sendClarificationMock).not.toHaveBeenCalled();

    await act(async () => {
      updateDeferred.resolve(updatedSession);
      await work;
    });

    expect(sendClarificationMock).toHaveBeenCalledWith({
      clarifyingAnswer: "Draft the headline",
      energyLevel: "medium",
      source: "manual",
      stuckOn: "Ship the first build",
    });
  });

  it("starts the assistant message insert and session update together when retrying", async () => {
    const activeSession = createSessionRow({
      energy_level: "medium",
    });
    const finalSession = createSessionRow({
      energy_level: "medium",
      steps: [{ id: "step-1", text: "Open the checklist." }],
    });
    const updateDeferred = createDeferred<SessionRow>();
    const retryMock = vi.fn().mockResolvedValue({
      assistantText: "Let’s keep this tiny.",
      kind: "steps",
      steps: [{ id: "step-1", text: "Open the checklist." }],
    });

    useChatMock.mockReturnValue({
      cancel: vi.fn(),
      retry: retryMock,
      sendClarification: vi.fn(),
      sendInitial: vi.fn(),
      state: createChatState(),
    });
    loadActiveSessionDraftMock.mockResolvedValue(activeSession);
    updateSessionDraftMock.mockImplementationOnce(() => updateDeferred.promise);
    insertConversationMessageMock.mockResolvedValueOnce({
      content: "Let’s keep this tiny.",
      created_at: "2026-03-17T10:01:00.000Z",
      id: "message-2",
      role: "assistant",
      session_id: "session-1",
    });

    const { result } = renderHook(() => useSessionFlow({ locationState: null }));

    await waitFor(() => {
      expect(result.current.isBooting).toBe(false);
    });

    let work!: Promise<void>;

    act(() => {
      work = result.current.handleRetry();
    });

    await waitFor(() => {
      expect(retryMock).toHaveBeenCalledWith({
        energyLevel: "medium",
        source: "manual",
        stuckOn: "Ship the first build",
      });
      expect(updateSessionDraftMock).toHaveBeenCalledWith("session-1", {
        steps: [{ id: "step-1", text: "Open the checklist." }],
      });
      expect(insertConversationMessageMock).toHaveBeenCalledWith({
        content: "Let’s keep this tiny.",
        role: "assistant",
        sessionId: "session-1",
      });
    });

    await act(async () => {
      updateDeferred.resolve(finalSession);
      await work;
    });
  });
});
