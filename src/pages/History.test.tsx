import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { History } from "./History";

const { loadSessionHistoryPageMock, useAuthMock } = vi.hoisted(() => ({
  loadSessionHistoryPageMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("../lib/session-records", () => ({
  loadSessionHistoryPage: (...args: unknown[]) => loadSessionHistoryPageMock(...args),
}));

describe("History", () => {
  let intersectionCallback:
    | ((entries: Array<{ isIntersecting: boolean }>) => void)
    | null = null;

  beforeEach(() => {
    vi.clearAllMocks();

    useAuthMock.mockReturnValue({
      user: {
        id: "user-1",
      },
    });

    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof intersectionCallback) {
          intersectionCallback = callback;
        }

        disconnect() {
          return undefined;
        }

        observe() {
          return undefined;
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the empty state when no saved sessions exist", async () => {
    loadSessionHistoryPageMock.mockResolvedValue({
      items: [],
      nextCursor: null,
    });

    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText("No sessions yet. Start your first work block from the Session tab."),
      ).toBeInTheDocument();
    });
  });

  it("loads the next history page when the sentinel intersects", async () => {
    loadSessionHistoryPageMock
      .mockResolvedValueOnce({
        items: [
          {
            created_at: "2026-03-22T10:00:00.000Z",
            energy_level: "medium",
            feedback: "yes",
            id: "session-1",
            source: "manual",
            status: "completed",
            stuck_on: "Ship the first screen",
            timer_ended_at: "2026-03-22T10:25:00.000Z",
            timer_started_at: "2026-03-22T10:00:00.000Z",
          },
        ],
        nextCursor: {
          createdAt: "2026-03-22T10:00:00.000Z",
          id: "session-1",
        },
      })
      .mockResolvedValueOnce({
        items: [
          {
            created_at: "2026-03-22T09:00:00.000Z",
            energy_level: "low",
            feedback: "somewhat",
            id: "session-2",
            source: "detection",
            status: "incomplete",
            stuck_on: "Write the follow-up tests",
            timer_ended_at: "2026-03-22T09:25:00.000Z",
            timer_started_at: "2026-03-22T09:00:00.000Z",
          },
        ],
        nextCursor: null,
      });

    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Ship the first screen")).toBeInTheDocument();
    });

    if (!intersectionCallback) {
      throw new Error("Expected IntersectionObserver to register a callback.");
    }

    await act(async () => {
      intersectionCallback?.([{ isIntersecting: true }]);
    });

    await waitFor(() => {
      expect(screen.getByText("Write the follow-up tests")).toBeInTheDocument();
    });

    expect(loadSessionHistoryPageMock).toHaveBeenNthCalledWith(2, {
      cursor: {
        createdAt: "2026-03-22T10:00:00.000Z",
        id: "session-1",
      },
      userId: "user-1",
    });
  });
});
