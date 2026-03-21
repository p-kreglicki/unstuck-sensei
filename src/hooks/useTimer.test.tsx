import { act, render, waitFor } from "@testing-library/react";
import { TimerProvider } from "./useTimer";

const {
  invokeMock,
  isTauriMock,
  listenMock,
  loadActiveTimerSessionMock,
  loadLatestTimerBlockMock,
  useAuthMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
  listenMock: vi.fn(),
  loadActiveTimerSessionMock: vi.fn(),
  loadLatestTimerBlockMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

vi.mock("./useAuth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("../lib/session-records", () => ({
  completeTimerBlock: vi.fn(),
  expireTimerCheckin: vi.fn(),
  loadActiveTimerSession: (...args: unknown[]) => loadActiveTimerSessionMock(...args),
  loadLatestTimerBlock: (...args: unknown[]) => loadLatestTimerBlockMock(...args),
  stopTimerBlock: vi.fn(),
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

const idleTimerState = {
  currentBlockId: null,
  durationSecs: null,
  extended: false,
  remainingSecs: null,
  sessionId: null,
  status: "idle" as const,
  timerRevision: null,
};

type TimerStatePayload = {
  currentBlockId: string | null;
  durationSecs: number | null;
  extended: boolean;
  remainingSecs: number | null;
  sessionId: string | null;
  status: "awaiting_checkin" | "idle" | "running";
  timerRevision: number | null;
};

describe("TimerProvider", () => {
  let timerStateChangedHandler: ((event: { payload: TimerStatePayload }) => void) | null;

  beforeEach(() => {
    timerStateChangedHandler = null;
    invokeMock.mockReset();
    isTauriMock.mockReset();
    listenMock.mockReset();
    loadActiveTimerSessionMock.mockReset();
    loadLatestTimerBlockMock.mockReset();
    useAuthMock.mockReset();

    isTauriMock.mockReturnValue(true);
    useAuthMock.mockReturnValue({
      user: {
        id: "user-1",
      },
    });
    listenMock.mockImplementation(async (_event, handler) => {
      timerStateChangedHandler = handler as (event: { payload: TimerStatePayload }) => void;
      return vi.fn();
    });
    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "get_pending_timer_syncs":
          return Promise.resolve([]);
        case "get_timer_state":
        case "clear_timer_state":
          return Promise.resolve(idleTimerState);
        case "clear_pending_timer_syncs":
          return Promise.resolve(undefined);
        default:
          return Promise.resolve(idleTimerState);
      }
    });
    loadActiveTimerSessionMock.mockResolvedValue(null);
    loadLatestTimerBlockMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("serializes replay triggers and reruns once after the current pass finishes", async () => {
    const firstReplay = createDeferred<null>();
    let pendingSyncReads = 0;

    invokeMock.mockImplementation((command: string, args?: { syncIds?: string[] }) => {
      switch (command) {
        case "get_pending_timer_syncs":
          pendingSyncReads += 1;
          return Promise.resolve(
            pendingSyncReads === 1
              ? []
              : [
                  {
                    blockId: "block-2",
                    expectedRevision: 2,
                    id: "sync-2",
                    kind: "stop_block",
                    occurredAt: "2026-03-21T10:00:00.000Z",
                    sessionId: "session-2",
                  },
                ],
          );
        case "get_timer_state":
        case "clear_timer_state":
          return Promise.resolve(idleTimerState);
        case "clear_pending_timer_syncs":
          return Promise.resolve(args?.syncIds);
        default:
          return Promise.resolve(idleTimerState);
      }
    });
    loadActiveTimerSessionMock
      .mockImplementationOnce(() => firstReplay.promise)
      .mockResolvedValueOnce(null);

    render(
      <TimerProvider>
        <div>timer</div>
      </TimerProvider>,
    );

    await waitFor(() => {
      expect(loadActiveTimerSessionMock).toHaveBeenCalledTimes(1);
    });
    expect(timerStateChangedHandler).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      timerStateChangedHandler?.({
        payload: {
          ...idleTimerState,
          status: "awaiting_checkin",
        },
      });
      await Promise.resolve();
    });

    expect(loadActiveTimerSessionMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstReplay.resolve(null);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(loadActiveTimerSessionMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("clear_pending_timer_syncs", {
        syncIds: ["sync-2"],
      });
    });
  });
});
