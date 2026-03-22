import { MemoryRouter } from "react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import { Session } from "./Session";

const {
  loadActiveTimerSessionMock,
  loadLatestTimerBlockMock,
  loadActiveSessionDraftMock,
  loadConversationMessagesMock,
  loadRecentSessionSummariesMock,
  useTimerCountdownMock,
  useTimerMock,
  useAuthMock,
  useChatMock,
} = vi.hoisted(() => ({
  loadActiveTimerSessionMock: vi.fn(),
  loadLatestTimerBlockMock: vi.fn(),
  loadActiveSessionDraftMock: vi.fn(),
  loadConversationMessagesMock: vi.fn(),
  loadRecentSessionSummariesMock: vi.fn(),
  useTimerCountdownMock: vi.fn(),
  useTimerMock: vi.fn(),
  useAuthMock: vi.fn(),
  useChatMock: vi.fn(),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("../hooks/useChat", () => ({
  useChat: (input: unknown) => useChatMock(input),
}));

vi.mock("../hooks/useTimer", () => ({
  useTimerCountdown: () => useTimerCountdownMock(),
  useTimer: () => useTimerMock(),
}));

vi.mock("../lib/session-records", () => ({
    checkInTimerSession: vi.fn(),
    completeTimerBlock: vi.fn(),
    createSessionDraft: vi.fn(),
    expireTimerCheckin: vi.fn(),
    insertConversationMessage: vi.fn(),
    loadActiveSessionDraft: () => loadActiveSessionDraftMock(),
    loadActiveTimerSession: () => loadActiveTimerSessionMock(),
    loadConversationMessages: () => loadConversationMessagesMock(),
    loadLatestTimerBlock: () => loadLatestTimerBlockMock(),
    loadRecentSessionSummaries: () => loadRecentSessionSummariesMock(),
    readSessionSteps: (session: { steps?: unknown[] | null } | null) =>
      Array.isArray(session?.steps) ? session.steps : [],
    revertExtensionStart: vi.fn(),
    revertTimerStart: vi.fn(),
    startExtensionBlock: vi.fn(),
    startTimerBlock: vi.fn(),
    stopTimerBlock: vi.fn(),
    updateSessionDraft: vi.fn(),
}));

describe("Session", () => {
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
      state: {
        error: null,
        isStreaming: false,
        streamingText: "",
        structuredResult: null,
      },
    });
    useTimerMock.mockReturnValue({
      clearPendingSyncs: vi.fn(),
      clearRuntime: vi.fn(),
      extendTimer: vi.fn(),
      getPendingSyncs: vi.fn().mockResolvedValue([]),
      hydrateAwaitingCheckin: vi.fn(),
      hydrateRunning: vi.fn(),
      refreshStatus: vi.fn().mockResolvedValue({
        currentBlockId: null,
        durationSecs: null,
        extended: false,
        remainingSecs: null,
        sessionId: null,
        status: "idle",
        timerRevision: null,
      }),
      resolveCheckin: vi.fn(),
      startTimer: vi.fn(),
      state: {
        currentBlockId: null,
        durationSecs: null,
        extended: false,
        remainingSecs: null,
        sessionId: null,
        status: "idle",
        timerRevision: null,
      },
      stopTimer: vi.fn(),
      withPendingSyncLock: vi.fn((work: () => Promise<unknown>) => work()),
    });
    useTimerCountdownMock.mockReturnValue(null);
    loadActiveSessionDraftMock.mockResolvedValue(null);
    loadActiveTimerSessionMock.mockResolvedValue(null);
    loadConversationMessagesMock.mockResolvedValue([]);
    loadLatestTimerBlockMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the returning-user reminder when recent sessions exist", async () => {
    loadRecentSessionSummariesMock.mockResolvedValue([
      {
        createdAt: "2026-03-15T09:00:00.000Z",
        feedback: "yes",
        steps: [],
        stuckOn: "Shipping the onboarding email",
      },
    ]);

    render(
      <MemoryRouter>
        <Session />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          'Last time you made progress on "Shipping the onboarding email".',
        ),
      ).toBeInTheDocument();
    });
  });

  it("does not render the returning-user reminder when no recent sessions exist", async () => {
    loadRecentSessionSummariesMock.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <Session />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("What are you stuck on?")).toBeInTheDocument();
    });

    expect(screen.queryByText(/Last time you/)).not.toBeInTheDocument();
  });

  it("keeps the session screen usable when recent-session loading fails", async () => {
    loadRecentSessionSummariesMock.mockRejectedValue({
      message: 'column "feedback" does not exist',
    });

    render(
      <MemoryRouter>
        <Session />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("What are you stuck on?")).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/Unable to load your current session/i),
    ).not.toBeInTheDocument();
  });

  it("surfaces setup guidance when the sessions table is missing", async () => {
    loadActiveSessionDraftMock.mockRejectedValue({
      message: 'relation "public.sessions" does not exist',
    });
    loadRecentSessionSummariesMock.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <Session />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Database setup is incomplete. Run the Supabase migrations for this project and retry.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("does not render the raw chat hook error banner on its own", async () => {
    useChatMock.mockReturnValue({
      cancel: vi.fn(),
      retry: vi.fn(),
      sendClarification: vi.fn(),
      sendInitial: vi.fn(),
      state: {
        error: "The coaching request failed.",
        isStreaming: false,
        streamingText: "",
        structuredResult: null,
      },
    });
    loadRecentSessionSummariesMock.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <Session />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("What are you stuck on?")).toBeInTheDocument();
    });

    expect(
      screen.queryByText("The coaching request failed."),
    ).not.toBeInTheDocument();
  });

  it("renders the conversation shell as a labeled log with a docked composer", async () => {
    loadRecentSessionSummariesMock.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <Session />
      </MemoryRouter>,
    );

    const conversationLog = await screen.findByRole("log", {
      name: "Conversation",
    });

    expect(screen.getByText("Session chat")).toBeInTheDocument();
    expect(conversationLog).toHaveClass("overflow-y-auto");
    expect(within(conversationLog).getByText("What are you stuck on?")).toBeInTheDocument();
    expect(screen.getByLabelText("The sticky task")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep going" })).toBeInTheDocument();
  });

  it("renders energy selection inside the conversation shell", async () => {
    loadRecentSessionSummariesMock.mockResolvedValue([]);
    loadActiveSessionDraftMock.mockResolvedValue({
      checked_in_at: null,
      clarifying_answer: null,
      clarifying_question: null,
      created_at: "2026-03-22T09:00:00.000Z",
      energy_level: null,
      feedback: null,
      id: "session-1",
      source: "manual",
      status: "active",
      steps: null,
      stuck_on: "Ship the onboarding email",
      timer_extended: false,
      timer_revision: 0,
      updated_at: "2026-03-22T09:00:00.000Z",
      user_id: "user-1",
    });
    loadConversationMessagesMock.mockResolvedValue([
      {
        content: "Ship the onboarding email",
        created_at: "2026-03-22T09:00:01.000Z",
        id: "message-1",
        role: "user",
        session_id: "session-1",
      },
    ]);

    render(
      <MemoryRouter>
        <Session />
      </MemoryRouter>,
    );

    const conversationLog = await screen.findByRole("log", {
      name: "Conversation",
    });

    expect(
      within(conversationLog)
        .getAllByText("What kind of energy do you have right now?")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Break it down" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Low/ })).toBeInTheDocument();
  });

  it("keeps clarifying replies in the same shell composer", async () => {
    loadRecentSessionSummariesMock.mockResolvedValue([]);
    loadActiveSessionDraftMock.mockResolvedValue({
      checked_in_at: null,
      clarifying_answer: null,
      clarifying_question: "What part feels heaviest right now?",
      created_at: "2026-03-22T09:00:00.000Z",
      energy_level: "medium",
      feedback: null,
      id: "session-1",
      source: "manual",
      status: "active",
      steps: null,
      stuck_on: "Ship the onboarding email",
      timer_extended: false,
      timer_revision: 0,
      updated_at: "2026-03-22T09:00:00.000Z",
      user_id: "user-1",
    });
    loadConversationMessagesMock.mockResolvedValue([
      {
        content: "Ship the onboarding email",
        created_at: "2026-03-22T09:00:01.000Z",
        id: "message-1",
        role: "user",
        session_id: "session-1",
      },
      {
        content: "What part feels heaviest right now?",
        created_at: "2026-03-22T09:00:05.000Z",
        id: "message-2",
        role: "assistant",
        session_id: "session-1",
      },
    ]);

    render(
      <MemoryRouter>
        <Session />
      </MemoryRouter>,
    );

    const conversationLog = await screen.findByRole("log", {
      name: "Conversation",
    });

    expect(within(conversationLog).getByText("Ship the onboarding email")).toBeInTheDocument();
    expect(within(conversationLog).getByText("Medium")).toBeInTheDocument();
    expect(within(conversationLog).getByText("What part feels heaviest right now?")).toBeInTheDocument();
    expect(screen.getByText("Replying to: What part feels heaviest right now?")).toBeInTheDocument();
    expect(screen.getByLabelText("Clarifying reply")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Give me the steps" })).toBeInTheDocument();
  });
});
