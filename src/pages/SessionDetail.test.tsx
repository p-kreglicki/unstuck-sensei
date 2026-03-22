import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { SessionDetail } from "./SessionDetail";

const {
  loadConversationMessagesMock,
  loadSessionDetailMock,
  loadSessionRecordMock,
  loadTimerBlocksMock,
} = vi.hoisted(() => ({
  loadConversationMessagesMock: vi.fn(),
  loadSessionDetailMock: vi.fn(),
  loadSessionRecordMock: vi.fn(),
  loadTimerBlocksMock: vi.fn(),
}));

vi.mock("../lib/session-records", () => ({
  loadConversationMessages: (...args: unknown[]) =>
    loadConversationMessagesMock(...args),
  loadSessionDetail: (...args: unknown[]) => loadSessionDetailMock(...args),
  loadSessionRecord: (...args: unknown[]) => loadSessionRecordMock(...args),
  loadTimerBlocks: (...args: unknown[]) => loadTimerBlocksMock(...args),
}));

describe("SessionDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the summary visible when one section fails and retries that section locally", async () => {
    loadSessionDetailMock.mockResolvedValue({
      messages: {
        data: null,
        error: "Transcript temporarily unavailable.",
      },
      session: {
        data: {
          created_at: "2026-03-22T10:00:00.000Z",
          energy_level: "medium",
          feedback: "yes",
          id: "session-1",
          source: "manual",
          status: "completed",
          steps: [{ id: "step-1", text: "Ship the first slice" }],
          stuck_on: "Ship Phase 5",
          timer_ended_at: "2026-03-22T10:25:00.000Z",
          timer_started_at: "2026-03-22T10:00:00.000Z",
        },
        error: null,
      },
      timerBlocks: {
        data: [
          {
            block_index: 1,
            created_at: "2026-03-22T10:00:00.000Z",
            duration_seconds: 1500,
            ended_at: "2026-03-22T10:25:00.000Z",
            id: "block-1",
            kind: "initial",
            session_id: "session-1",
            started_at: "2026-03-22T10:00:00.000Z",
          },
        ],
        error: null,
      },
    });
    loadConversationMessagesMock.mockResolvedValue([
      {
        content: "You already know the smallest next step.",
        created_at: "2026-03-22T10:01:00.000Z",
        id: "message-1",
        role: "assistant",
        session_id: "session-1",
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/history/session-1"]}>
        <Routes>
          <Route path="/history/:sessionId" element={<SessionDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Ship Phase 5")).toBeInTheDocument();
    });

    expect(screen.getByText("Transcript temporarily unavailable.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry transcript" }));

    await waitFor(() => {
      expect(
        screen.getByText("You already know the smallest next step."),
      ).toBeInTheDocument();
    });
  });
});
