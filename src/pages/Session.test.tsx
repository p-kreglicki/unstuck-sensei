import { MemoryRouter } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { Session } from "./Session";

const {
  loadActiveSessionDraftMock,
  loadConversationMessagesMock,
  loadRecentSessionSummariesMock,
  useAuthMock,
  useChatMock,
} = vi.hoisted(() => ({
  loadActiveSessionDraftMock: vi.fn(),
  loadConversationMessagesMock: vi.fn(),
  loadRecentSessionSummariesMock: vi.fn(),
  useAuthMock: vi.fn(),
  useChatMock: vi.fn(),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("../hooks/useChat", () => ({
  useChat: () => useChatMock(),
}));

vi.mock("../lib/session-records", () => ({
    createSessionDraft: vi.fn(),
    insertConversationMessage: vi.fn(),
    loadActiveSessionDraft: () => loadActiveSessionDraftMock(),
    loadConversationMessages: () => loadConversationMessagesMock(),
    loadRecentSessionSummaries: () => loadRecentSessionSummariesMock(),
    readSessionSteps: (session: { steps?: unknown[] | null } | null) =>
      Array.isArray(session?.steps) ? session.steps : [],
    updateSessionDraft: vi.fn(),
}));

describe("Session", () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({
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
    loadActiveSessionDraftMock.mockResolvedValue(null);
    loadConversationMessagesMock.mockResolvedValue([]);
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
          'Database setup is incomplete. relation "public.sessions" does not exist Run the Supabase migrations for this project and retry.',
        ),
      ).toBeInTheDocument();
    });
  });
});
