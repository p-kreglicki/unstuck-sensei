import { act, renderHook, waitFor } from "@testing-library/react";
import { useSessionFlow } from "./useSessionFlow";
import type { SessionRow, SessionTimerBlockRow } from "../lib/session-records";

const {
  checkInTimerSessionMock,
  completeTimerBlockMock,
  createSessionDraftMock,
  expireTimerCheckinMock,
  revertExtensionStartMock,
  revertTimerStartMock,
  loadActiveTimerSessionMock,
  loadLatestTimerBlockMock,
  insertConversationMessageMock,
  loadActiveSessionDraftMock,
  loadConversationMessagesMock,
  loadRecentSessionSummariesMock,
  startExtensionBlockMock,
  startTimerBlockMock,
  stopTimerBlockMock,
  useTimerMock,
  updateSessionDraftMock,
  useAuthMock,
  useChatMock,
} = vi.hoisted(() => ({
  checkInTimerSessionMock: vi.fn(),
  completeTimerBlockMock: vi.fn(),
  createSessionDraftMock: vi.fn(),
  expireTimerCheckinMock: vi.fn(),
  revertExtensionStartMock: vi.fn(),
  revertTimerStartMock: vi.fn(),
  loadActiveTimerSessionMock: vi.fn(),
  loadLatestTimerBlockMock: vi.fn(),
  insertConversationMessageMock: vi.fn(),
  loadActiveSessionDraftMock: vi.fn(),
  loadConversationMessagesMock: vi.fn(),
  loadRecentSessionSummariesMock: vi.fn(),
  startExtensionBlockMock: vi.fn(),
  startTimerBlockMock: vi.fn(),
  stopTimerBlockMock: vi.fn(),
  useTimerMock: vi.fn(),
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

vi.mock("./useTimer", () => ({
  useTimer: () => useTimerMock(),
}));

vi.mock("../lib/session-records", () => ({
  checkInTimerSession: (...args: unknown[]) => checkInTimerSessionMock(...args),
  completeTimerBlock: (...args: unknown[]) => completeTimerBlockMock(...args),
  createSessionDraft: (...args: unknown[]) => createSessionDraftMock(...args),
  expireTimerCheckin: (...args: unknown[]) => expireTimerCheckinMock(...args),
  insertConversationMessage: (...args: unknown[]) =>
    insertConversationMessageMock(...args),
  loadActiveSessionDraft: (...args: unknown[]) => loadActiveSessionDraftMock(...args),
  loadActiveTimerSession: (...args: unknown[]) => loadActiveTimerSessionMock(...args),
  loadConversationMessages: (...args: unknown[]) =>
    loadConversationMessagesMock(...args),
  loadLatestTimerBlock: (...args: unknown[]) => loadLatestTimerBlockMock(...args),
  loadRecentSessionSummaries: (...args: unknown[]) =>
    loadRecentSessionSummariesMock(...args),
  readSessionSteps: (session: { steps?: unknown } | null) =>
    Array.isArray(session?.steps) ? session.steps : [],
  revertExtensionStart: (...args: unknown[]) => revertExtensionStartMock(...args),
  revertTimerStart: (...args: unknown[]) => revertTimerStartMock(...args),
  startExtensionBlock: (...args: unknown[]) => startExtensionBlockMock(...args),
  startTimerBlock: (...args: unknown[]) => startTimerBlockMock(...args),
  stopTimerBlock: (...args: unknown[]) => stopTimerBlockMock(...args),
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

function createChatState() {
  return {
    error: null,
    isStreaming: false,
    streamingText: "",
    structuredResult: null,
  };
}

const idleTimerState = {
  currentBlockId: null,
  durationSecs: null,
  extended: false,
  remainingSecs: null,
  sessionId: null,
  status: "idle" as const,
  timerRevision: null,
};

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

function createTimerHookValue(overrides: Record<string, unknown> = {}) {
  return {
    clearPendingSyncs: vi.fn(),
    clearRuntime: vi.fn().mockResolvedValue(idleTimerState),
    ensureCheckinDurable: vi.fn().mockResolvedValue({
      endedAt: null,
      timerRevision: 0,
    }),
    extendTimer: vi.fn(),
    getPendingSyncs: vi.fn().mockResolvedValue([]),
    hydrateAwaitingCheckin: vi.fn(),
    hydrateRunning: vi.fn(),
    refreshStatus: vi.fn().mockResolvedValue(idleTimerState),
    resolveCheckin: vi.fn(),
    startTimer: vi.fn(),
    state: idleTimerState,
    stopTimer: vi.fn(),
    ...overrides,
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
    useTimerMock.mockReturnValue(createTimerHookValue());
    loadActiveSessionDraftMock.mockResolvedValue(null);
    loadActiveTimerSessionMock.mockResolvedValue(null);
    loadConversationMessagesMock.mockResolvedValue([]);
    loadLatestTimerBlockMock.mockResolvedValue(null);
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

  it("reverts timer start with the durable post-start revision when local start fails", async () => {
    const activeSession = createSessionRow();
    const startTimerMock = vi.fn().mockRejectedValue(new Error("rust start failed"));

    useTimerMock.mockReturnValue(createTimerHookValue({
      startTimer: startTimerMock,
    }));
    loadActiveSessionDraftMock.mockResolvedValue(activeSession);
    startTimerBlockMock.mockResolvedValue({
      blockId: "block-1",
      durationSeconds: 1500,
      sessionId: "session-1",
      startedAt: "2026-03-17T10:10:00.000Z",
      status: "ok",
      timerRevision: 1,
    });
    revertTimerStartMock.mockResolvedValue({
      sessionId: "session-1",
      status: "ok",
      timerRevision: 2,
    });

    const { result } = renderHook(() => useSessionFlow({ locationState: null }));

    await waitFor(() => {
      expect(result.current.isBooting).toBe(false);
    });

    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(revertTimerStartMock).toHaveBeenCalledWith({
      expectedRevision: 1,
      sessionId: "session-1",
    });
    expect(result.current.sessionRow?.timer_revision).toBe(2);
    expect(result.current.sessionRow?.timer_started_at).toBeNull();
  });

  it("reverts extension start with the durable post-extension revision when local extend fails", async () => {
    const activeTimerSession = createSessionRow({
      timer_duration_seconds: 1500,
      timer_ended_at: "2026-03-17T10:35:00.000Z",
      timer_extended: false,
      timer_revision: 5,
      timer_started_at: "2026-03-17T10:10:00.000Z",
    });
    const extendTimerMock = vi.fn().mockRejectedValue(new Error("rust extend failed"));

    useTimerMock.mockReturnValue(createTimerHookValue({
      ensureCheckinDurable: vi.fn().mockResolvedValue({
        endedAt: "2026-03-17T10:35:00.000Z",
        timerRevision: 5,
      }),
      extendTimer: extendTimerMock,
      refreshStatus: vi.fn().mockResolvedValue({
        ...idleTimerState,
        status: "awaiting_checkin",
        timerRevision: 5,
      }),
      state: {
        ...idleTimerState,
        status: "awaiting_checkin",
        timerRevision: 5,
      },
    }));
    loadActiveTimerSessionMock.mockResolvedValue(activeTimerSession);
    loadLatestTimerBlockMock.mockResolvedValue(
      createTimerBlockRow({
        ended_at: "2026-03-17T10:35:00.000Z",
      }),
    );
    startExtensionBlockMock.mockResolvedValue({
      blockId: "block-2",
      durationSeconds: 1500,
      sessionId: "session-1",
      startedAt: "2026-03-17T10:35:01.000Z",
      status: "ok",
      timerRevision: 6,
    });
    revertExtensionStartMock.mockResolvedValue({
      sessionId: "session-1",
      status: "ok",
      timerRevision: 7,
    });

    const { result } = renderHook(() => useSessionFlow({ locationState: null }));

    await waitFor(() => {
      expect(result.current.isBooting).toBe(false);
    });

    await act(async () => {
      await result.current.handleExtendTimer();
    });

    expect(revertExtensionStartMock).toHaveBeenCalledWith({
      expectedRevision: 6,
      sessionId: "session-1",
    });
    expect(result.current.sessionRow?.timer_revision).toBe(7);
    expect(result.current.sessionRow?.timer_extended).toBe(false);
  });

  it("ignores duplicate timer starts before React rerenders", async () => {
    const activeSession = createSessionRow();
    const startBlockDeferred = createDeferred<{
      blockId: string;
      durationSeconds: number;
      sessionId: string;
      startedAt: string;
      status: "ok";
      timerRevision: number;
    }>();
    const startTimerMock = vi.fn().mockResolvedValue({
      currentBlockId: "block-1",
      durationSecs: 1500,
      extended: false,
      remainingSecs: 1500,
      sessionId: "session-1",
      status: "running",
      timerRevision: 1,
    });

    useTimerMock.mockReturnValue(createTimerHookValue({
      startTimer: startTimerMock,
    }));
    loadActiveSessionDraftMock.mockResolvedValue(activeSession);
    startTimerBlockMock.mockImplementation(() => startBlockDeferred.promise);

    const { result } = renderHook(() => useSessionFlow({ locationState: null }));

    await waitFor(() => {
      expect(result.current.isBooting).toBe(false);
    });

    let firstRun!: Promise<void>;
    let secondRun!: Promise<void>;

    act(() => {
      firstRun = result.current.handleConfirm();
      secondRun = result.current.handleConfirm();
    });

    expect(startTimerBlockMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      startBlockDeferred.resolve({
        blockId: "block-1",
        durationSeconds: 1500,
        sessionId: "session-1",
        startedAt: "2026-03-17T10:10:00.000Z",
        status: "ok",
        timerRevision: 1,
      });
      await Promise.all([firstRun, secondRun]);
    });

    expect(startTimerMock).toHaveBeenCalledTimes(1);
  });

  it("ignores duplicate check-ins before React rerenders", async () => {
    const activeTimerSession = createSessionRow({
      timer_duration_seconds: 1500,
      timer_ended_at: "2026-03-17T10:35:00.000Z",
      timer_extended: false,
      timer_revision: 5,
      timer_started_at: "2026-03-17T10:10:00.000Z",
    });
    const ensureCheckinDurableDeferred = createDeferred<{
      endedAt: string;
      timerRevision: number;
    }>();
    const ensureCheckinDurableMock = vi.fn().mockImplementation(
      () => ensureCheckinDurableDeferred.promise,
    );
    const resolveCheckinMock = vi.fn().mockResolvedValue(idleTimerState);

    useTimerMock.mockReturnValue(createTimerHookValue({
      ensureCheckinDurable: ensureCheckinDurableMock,
      resolveCheckin: resolveCheckinMock,
      state: {
        ...idleTimerState,
        status: "awaiting_checkin",
        timerRevision: 5,
      },
    }));
    loadActiveTimerSessionMock.mockResolvedValue(activeTimerSession);
    loadLatestTimerBlockMock.mockResolvedValue(
      createTimerBlockRow({
        ended_at: "2026-03-17T10:35:00.000Z",
      }),
    );
    checkInTimerSessionMock.mockResolvedValue({
      checkedInAt: "2026-03-17T10:36:00.000Z",
      feedback: "yes",
      sessionId: "session-1",
      status: "ok",
      timerRevision: 6,
    });

    const { result } = renderHook(() => useSessionFlow({ locationState: null }));

    await waitFor(() => {
      expect(result.current.isBooting).toBe(false);
    });

    let firstRun!: Promise<void>;
    let secondRun!: Promise<void>;

    act(() => {
      firstRun = result.current.handleCheckIn("yes");
      secondRun = result.current.handleCheckIn("yes");
    });

    expect(ensureCheckinDurableMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      ensureCheckinDurableDeferred.resolve({
        endedAt: "2026-03-17T10:35:00.000Z",
        timerRevision: 5,
      });
      await Promise.all([firstRun, secondRun]);
    });

    expect(checkInTimerSessionMock).toHaveBeenCalledTimes(1);
    expect(resolveCheckinMock).toHaveBeenCalledTimes(1);
  });

  it("prefers a pending local stop over rehydrating a running timer on bootstrap", async () => {
    const clearRuntimeMock = vi.fn().mockResolvedValue({
      currentBlockId: null,
      durationSecs: null,
      extended: false,
      remainingSecs: null,
      sessionId: null,
      status: "idle",
      timerRevision: null,
    });
    const hydrateRunningMock = vi.fn();

    useTimerMock.mockReturnValue(createTimerHookValue({
      clearRuntime: clearRuntimeMock,
      getPendingSyncs: vi.fn().mockResolvedValue([
        {
          blockId: "block-1",
          expectedRevision: 4,
          id: "sync-1",
          kind: "stop_block",
          occurredAt: "2026-03-17T10:20:00.000Z",
          sessionId: "session-1",
        },
      ]),
      hydrateRunning: hydrateRunningMock,
    }));
    loadActiveTimerSessionMock.mockResolvedValue(
      createSessionRow({
        timer_duration_seconds: 1500,
        timer_revision: 4,
        timer_started_at: "2026-03-17T10:10:00.000Z",
      }),
    );
    loadLatestTimerBlockMock.mockResolvedValue(createTimerBlockRow());

    const { result } = renderHook(() => useSessionFlow({ locationState: null }));

    await waitFor(() => {
      expect(result.current.isBooting).toBe(false);
    });

    expect(clearRuntimeMock).toHaveBeenCalled();
    expect(hydrateRunningMock).not.toHaveBeenCalled();
    expect(result.current.sessionRow).toBeNull();
    expect(result.current.currentStage).toBe("compose");
    expect(result.current.statusMessage).toBe(
      "The timer stopped locally. I’ll keep trying to save that change.",
    );
  });
});
