import { act, render, waitFor } from "@testing-library/react";
import { TimerProvider, useTimer } from "./useTimer";

const {
  completeTimerBlockMock,
  expireTimerCheckinMock,
  invokeMock,
  isTauriMock,
  listenMock,
  loadActiveTimerSessionMock,
  loadLatestTimerBlockMock,
  stopTimerBlockMock,
  useAuthMock,
} = vi.hoisted(() => ({
  completeTimerBlockMock: vi.fn(),
  expireTimerCheckinMock: vi.fn(),
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
  listenMock: vi.fn(),
  loadActiveTimerSessionMock: vi.fn(),
  loadLatestTimerBlockMock: vi.fn(),
  stopTimerBlockMock: vi.fn(),
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
  completeTimerBlock: (...args: unknown[]) => completeTimerBlockMock(...args),
  expireTimerCheckin: (...args: unknown[]) => expireTimerCheckinMock(...args),
  loadActiveTimerSession: (...args: unknown[]) => loadActiveTimerSessionMock(...args),
  loadLatestTimerBlock: (...args: unknown[]) => loadLatestTimerBlockMock(...args),
  stopTimerBlock: (...args: unknown[]) => stopTimerBlockMock(...args),
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
  let latestTimer: ReturnType<typeof useTimer> | null;

  beforeEach(() => {
    latestTimer = null;
    timerStateChangedHandler = null;
    completeTimerBlockMock.mockReset();
    expireTimerCheckinMock.mockReset();
    invokeMock.mockReset();
    isTauriMock.mockReset();
    listenMock.mockReset();
    loadActiveTimerSessionMock.mockReset();
    loadLatestTimerBlockMock.mockReset();
    stopTimerBlockMock.mockReset();
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

  it("reuses the replay-owned timer refresh path on window focus", async () => {
    loadActiveTimerSessionMock.mockResolvedValue({
      checked_in_at: null,
      id: "session-1",
      status: "active",
      timer_extended: false,
      timer_revision: 1,
    });
    loadLatestTimerBlockMock.mockResolvedValue({
      duration_seconds: 1500,
      ended_at: null,
      id: "block-1",
    });

    render(
      <TimerProvider>
        <div>timer</div>
      </TimerProvider>,
    );

    await waitFor(() => {
      expect(loadLatestTimerBlockMock).toHaveBeenCalledTimes(1);
    });

    const getTimerStateCallsBeforeFocus = invokeMock.mock.calls.filter(
      ([command]) => command === "get_timer_state",
    ).length;

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    await waitFor(() => {
      const getTimerStateCallsAfterFocus = invokeMock.mock.calls.filter(
        ([command]) => command === "get_timer_state",
      ).length;

      expect(getTimerStateCallsAfterFocus).toBe(getTimerStateCallsBeforeFocus + 2);
    });
  });

  it("reuses the pending-sync serialization path for check-in durability", async () => {
    const completionDeferred = createDeferred<{
      endedAt: string;
      sessionId: string;
      status: "ok";
      timerRevision: number;
    }>();
    const pendingSync = {
      blockId: "block-1",
      expectedRevision: 1,
      id: "sync-1",
      kind: "complete_block" as const,
      occurredAt: "2026-03-21T10:25:00.000Z",
      sessionId: "session-1",
    };
    let latestBlock = {
      duration_seconds: 1500,
      ended_at: null as string | null,
      id: "block-1",
    };
    let pendingSyncs = [pendingSync];
    let currentTimerState: TimerStatePayload = {
      currentBlockId: "block-1",
      durationSecs: 1500,
      extended: false,
      remainingSecs: null,
      sessionId: "session-1",
      status: "running",
      timerRevision: 1,
    };

    function TimerConsumer() {
      latestTimer = useTimer();
      return null;
    }

    invokeMock.mockImplementation((command: string, args?: { syncIds?: string[] }) => {
      switch (command) {
        case "get_pending_timer_syncs":
          return Promise.resolve([...pendingSyncs]);
        case "get_timer_state":
          return Promise.resolve(currentTimerState);
        case "clear_pending_timer_syncs":
          pendingSyncs = pendingSyncs.filter(
            (sync) => !args?.syncIds?.includes(sync.id),
          );
          return Promise.resolve(undefined);
        case "hydrate_awaiting_checkin":
          currentTimerState = {
            currentBlockId: "block-1",
            durationSecs: 1500,
            extended: false,
            remainingSecs: null,
            sessionId: "session-1",
            status: "awaiting_checkin",
            timerRevision: 2,
          };
          return Promise.resolve(currentTimerState);
        case "clear_timer_state":
          currentTimerState = idleTimerState;
          return Promise.resolve(currentTimerState);
        default:
          return Promise.resolve(currentTimerState);
      }
    });
    loadActiveTimerSessionMock.mockResolvedValue({
      checked_in_at: null,
      status: "active",
      timer_extended: false,
      timer_revision: 1,
      id: "session-1",
    });
    loadLatestTimerBlockMock.mockImplementation(() => Promise.resolve({ ...latestBlock }));
    completeTimerBlockMock.mockImplementation(async () => {
      const result = await completionDeferred.promise;
      latestBlock = {
        ...latestBlock,
        ended_at: result.endedAt,
      };
      return result;
    });

    render(
      <TimerProvider>
        <TimerConsumer />
      </TimerProvider>,
    );

    await waitFor(() => {
      expect(completeTimerBlockMock).toHaveBeenCalledTimes(1);
      expect(latestTimer).not.toBeNull();
    });

    let ensurePromise!: Promise<{ endedAt: string | null; timerRevision: number }>;

    act(() => {
      ensurePromise = latestTimer!.ensureCheckinDurable({
        durationSecs: 1500,
        extended: false,
        fallbackEndedAt: null,
        fallbackRevision: 1,
        latestBlockId: "block-1",
        sessionId: "session-1",
      });
    });

    expect(completeTimerBlockMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      completionDeferred.resolve({
        endedAt: pendingSync.occurredAt,
        sessionId: "session-1",
        status: "ok",
        timerRevision: 2,
      });
      await ensurePromise;
    });

    await expect(ensurePromise).resolves.toEqual({
      endedAt: pendingSync.occurredAt,
      timerRevision: 2,
    });
    expect(completeTimerBlockMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("clear_pending_timer_syncs", {
      syncIds: ["sync-1"],
    });
  });
});
