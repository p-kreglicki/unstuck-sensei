import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./useAuth";
import {
  completeTimerBlock,
  expireTimerCheckin,
  loadActiveTimerSession,
  loadLatestTimerBlock,
  stopTimerBlock,
} from "../lib/session-records";

type TimerCommandState = {
  currentBlockId: string | null;
  durationSecs: number | null;
  extended: boolean;
  remainingSecs: number | null;
  sessionId: string | null;
  status: "idle" | "running" | "awaiting_checkin";
  timerRevision: number | null;
};

type PendingTimerSync = {
  blockId: string | null;
  expectedRevision: number;
  id: string;
  kind: "complete_block" | "stop_block" | "expire_checkin";
  occurredAt: string;
  sessionId: string;
};

type TimerContextValue = {
  clearPendingSyncs(syncIds: string[]): Promise<void>;
  clearRuntime(): Promise<TimerCommandState>;
  extendTimer(input: TimerMutationInput): Promise<TimerCommandState>;
  getPendingSyncs(): Promise<PendingTimerSync[]>;
  hydrateAwaitingCheckin(input: AwaitingCheckinHydrationInput): Promise<TimerCommandState>;
  hydrateRunning(input: TimerMutationInput & { extended: boolean }): Promise<TimerCommandState>;
  refreshStatus(): Promise<TimerCommandState>;
  resolveCheckin(): Promise<TimerCommandState>;
  state: TimerCommandState;
  startTimer(input: TimerMutationInput): Promise<TimerCommandState>;
  stopTimer(): Promise<TimerCommandState>;
};

type TimerMutationInput = {
  blockId: string;
  durationSecs: number;
  sessionId: string;
  startedAt: string;
  timerRevision: number;
};

type AwaitingCheckinHydrationInput = {
  blockId: string;
  checkinStartedAt: string;
  durationSecs: number;
  extended: boolean;
  sessionId: string;
  timerRevision: number;
};

const TIMER_STATE_CHANGED_EVENT = "timer-state-changed";
const CHECKIN_GRACE_HOURS = 12;

const defaultTimerState: TimerCommandState = {
  currentBlockId: null,
  durationSecs: null,
  extended: false,
  remainingSecs: null,
  sessionId: null,
  status: "idle",
  timerRevision: null,
};

const TimerContext = createContext<TimerContextValue | null>(null);

function logTimerError(message: string, error: unknown) {
  if (import.meta.env.DEV) {
    console.warn(`[timer] ${message}`, error);
  }
}

function isCheckinGraceExpired(endedAt: string | null) {
  if (!endedAt) {
    return false;
  }

  return (
    Date.now() - new Date(endedAt).getTime() >= CHECKIN_GRACE_HOURS * 60 * 60 * 1000
  );
}

async function runTimerCommand(
  command:
    | "clear_timer_state"
    | "extend_timer"
    | "get_pending_timer_syncs"
    | "get_timer_state"
    | "hydrate_awaiting_checkin"
    | "hydrate_running_timer"
    | "resolve_checkin"
    | "start_timer"
    | "stop_timer",
  args?: Record<string, unknown>,
) {
  return invoke(command, args);
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<TimerCommandState>(defaultTimerState);
  const replayPendingSyncsInFlightRef = useRef<Promise<void> | null>(null);
  const replayPendingSyncsQueuedRef = useRef(false);

  const refreshStatus = useCallback(async (): Promise<TimerCommandState> => {
    if (!isTauri()) {
      setState(defaultTimerState);
      return defaultTimerState;
    }

    const nextState = await runTimerCommand(
      "get_timer_state",
    ) as TimerCommandState;
    setState(nextState);
    return nextState;
  }, []);

  const startTimer = useCallback(async (input: TimerMutationInput) => {
    if (!isTauri()) {
      setState(defaultTimerState);
      return defaultTimerState;
    }

    const nextState = await runTimerCommand("start_timer", {
      blockId: input.blockId,
      durationSecs: input.durationSecs,
      sessionId: input.sessionId,
      startedAt: input.startedAt,
      timerRevision: input.timerRevision,
    }) as TimerCommandState;
    setState(nextState);
    return nextState;
  }, []);

  const stopTimer = useCallback(async () => {
    if (!isTauri()) {
      setState(defaultTimerState);
      return defaultTimerState;
    }

    const nextState = await runTimerCommand("stop_timer") as TimerCommandState;
    setState(nextState);
    return nextState;
  }, []);

  const extendTimer = useCallback(async (input: TimerMutationInput) => {
    if (!isTauri()) {
      setState(defaultTimerState);
      return defaultTimerState;
    }

    const nextState = await runTimerCommand("extend_timer", {
      blockId: input.blockId,
      durationSecs: input.durationSecs,
      sessionId: input.sessionId,
      startedAt: input.startedAt,
      timerRevision: input.timerRevision,
    }) as TimerCommandState;
    setState(nextState);
    return nextState;
  }, []);

  const resolveCheckin = useCallback(async () => {
    if (!isTauri()) {
      setState(defaultTimerState);
      return defaultTimerState;
    }

    const nextState = await runTimerCommand("resolve_checkin") as TimerCommandState;
    setState(nextState);
    return nextState;
  }, []);

  const hydrateRunning = useCallback(async (
    input: TimerMutationInput & { extended: boolean },
  ) => {
    if (!isTauri()) {
      setState(defaultTimerState);
      return defaultTimerState;
    }

    const nextState = await runTimerCommand("hydrate_running_timer", {
      blockId: input.blockId,
      durationSecs: input.durationSecs,
      extended: input.extended,
      sessionId: input.sessionId,
      startedAt: input.startedAt,
      timerRevision: input.timerRevision,
    }) as TimerCommandState;
    setState(nextState);
    return nextState;
  }, []);

  const hydrateAwaitingCheckin = useCallback(async (
    input: AwaitingCheckinHydrationInput,
  ) => {
    if (!isTauri()) {
      setState(defaultTimerState);
      return defaultTimerState;
    }

    const nextState = await runTimerCommand("hydrate_awaiting_checkin", {
      blockId: input.blockId,
      checkinStartedAt: input.checkinStartedAt,
      durationSecs: input.durationSecs,
      extended: input.extended,
      sessionId: input.sessionId,
      timerRevision: input.timerRevision,
    }) as TimerCommandState;
    setState(nextState);
    return nextState;
  }, []);

  const clearRuntime = useCallback(async () => {
    if (!isTauri()) {
      setState(defaultTimerState);
      return defaultTimerState;
    }

    const nextState = await runTimerCommand("clear_timer_state") as TimerCommandState;
    setState(nextState);
    return nextState;
  }, []);

  const getPendingSyncs = useCallback(async () => {
    if (!isTauri()) {
      return [];
    }

    return await runTimerCommand("get_pending_timer_syncs") as PendingTimerSync[];
  }, []);

  const clearPendingSyncs = useCallback(async (syncIds: string[]) => {
    if (!isTauri() || syncIds.length === 0) {
      return;
    }

    await invoke("clear_pending_timer_syncs", {
      syncIds,
    });
  }, []);

  const replayPendingSyncsPass = useCallback(async () => {
    if (!isTauri() || !user?.id) {
      return;
    }

    const [runtimeState, pendingSyncs, activeTimerSession] = await Promise.all([
      runTimerCommand("get_timer_state") as Promise<TimerCommandState>,
      getPendingSyncs(),
      loadActiveTimerSession(user.id),
    ]);

    if (!activeTimerSession) {
      if (pendingSyncs.length > 0) {
        await clearPendingSyncs(pendingSyncs.map((sync) => sync.id));
      }

      if (runtimeState.status !== "idle") {
        await clearRuntime();
      }

      return;
    }

    const latestBlock = await loadLatestTimerBlock(activeTimerSession.id);

    if (!latestBlock) {
      if (pendingSyncs.length > 0) {
        await clearPendingSyncs(pendingSyncs.map((sync) => sync.id));
      }
      await clearRuntime();
      return;
    }

    if (
      latestBlock.ended_at &&
      !activeTimerSession.checked_in_at &&
      isCheckinGraceExpired(latestBlock.ended_at)
    ) {
      await expireTimerCheckin({
        expectedRevision: activeTimerSession.timer_revision,
        expiredAt: new Date().toISOString(),
        sessionId: activeTimerSession.id,
      }).catch((error) => {
        logTimerError("failed to expire stale timer check-in", error);
      });

      await clearRuntime();
      await clearPendingSyncs(pendingSyncs.map((sync) => sync.id));
      return;
    }

    const syncIdsToClear: string[] = [];
    let currentRevision = activeTimerSession.timer_revision;
    let currentStatus = activeTimerSession.status;
    let currentEndedAt = latestBlock.ended_at;

    for (const sync of [...pendingSyncs].sort((left, right) => {
      if (left.expectedRevision !== right.expectedRevision) {
        return left.expectedRevision - right.expectedRevision;
      }

      return left.occurredAt.localeCompare(right.occurredAt);
    })) {
      if (sync.kind === "complete_block") {
        if (currentEndedAt || sync.blockId !== latestBlock.id) {
          syncIdsToClear.push(sync.id);
          continue;
        }

        const result = await completeTimerBlock({
          blockId: sync.blockId,
          endedAt: sync.occurredAt,
          expectedRevision: sync.expectedRevision,
        });

        syncIdsToClear.push(sync.id);
        currentRevision = result.timerRevision;
        currentEndedAt = result.endedAt ?? sync.occurredAt;

        await hydrateAwaitingCheckin({
          blockId: latestBlock.id,
          checkinStartedAt: currentEndedAt,
          durationSecs: latestBlock.duration_seconds,
          extended: activeTimerSession.timer_extended ?? false,
          sessionId: activeTimerSession.id,
          timerRevision: currentRevision,
        });
        continue;
      }

      if (sync.kind === "stop_block") {
        if (currentStatus === "incomplete") {
          syncIdsToClear.push(sync.id);
          continue;
        }

        const result = await stopTimerBlock({
          blockId: sync.blockId ?? latestBlock.id,
          endedAt: sync.occurredAt,
          expectedRevision: sync.expectedRevision,
        });

        syncIdsToClear.push(sync.id);
        currentRevision = result.timerRevision;
        currentStatus = "incomplete";
        await clearRuntime();
        continue;
      }

      if (sync.kind === "expire_checkin") {
        if (currentStatus === "incomplete" || activeTimerSession.checked_in_at) {
          syncIdsToClear.push(sync.id);
          continue;
        }

        const result = await expireTimerCheckin({
          expectedRevision: sync.expectedRevision,
          expiredAt: sync.occurredAt,
          sessionId: sync.sessionId,
        });

        syncIdsToClear.push(sync.id);
        currentRevision = result.timerRevision;
        currentStatus = "incomplete";
        await clearRuntime();
      }
    }

    if (syncIdsToClear.length > 0) {
      await clearPendingSyncs(syncIdsToClear);
    }

    await refreshStatus();
  }, [
    clearPendingSyncs,
    clearRuntime,
    getPendingSyncs,
    hydrateAwaitingCheckin,
    refreshStatus,
    user?.id,
  ]);

  const replayPendingSyncs = useCallback(async () => {
    if (replayPendingSyncsInFlightRef.current) {
      replayPendingSyncsQueuedRef.current = true;
      return replayPendingSyncsInFlightRef.current;
    }

    const replayPromise = (async () => {
      try {
        do {
          replayPendingSyncsQueuedRef.current = false;
          await replayPendingSyncsPass();
        } while (replayPendingSyncsQueuedRef.current);
      } finally {
        replayPendingSyncsInFlightRef.current = null;
      }
    })();

    replayPendingSyncsInFlightRef.current = replayPromise;
    return replayPromise;
  }, [replayPendingSyncsPass]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let active = true;

    const applyStatus = (nextState: TimerCommandState) => {
      if (active) {
        setState(nextState);
      }
    };

    const unlistenPromise = listen<TimerCommandState>(
      TIMER_STATE_CHANGED_EVENT,
      (event) => {
        applyStatus(event.payload);

        if (event.payload.status === "awaiting_checkin") {
          void replayPendingSyncs().catch((error) => {
            logTimerError("failed to replay pending timer syncs after completion", error);
          });
        }
      },
    );

    void refreshStatus().catch((error) => {
      logTimerError("failed to load initial timer status", error);
    });

    const handleWindowFocus = () => {
      void refreshStatus().catch((error) => {
        logTimerError("failed to refresh timer status on focus", error);
      });
      void replayPendingSyncs().catch((error) => {
        logTimerError("failed to replay pending timer syncs on focus", error);
      });
    };

    window.addEventListener("focus", handleWindowFocus);

    return () => {
      active = false;
      window.removeEventListener("focus", handleWindowFocus);
      void unlistenPromise.then((unlisten) => {
        unlisten();
      });
    };
  }, [refreshStatus, replayPendingSyncs]);

  useEffect(() => {
    if (!user?.id) {
      setState(defaultTimerState);
      return;
    }

    void replayPendingSyncs().catch((error) => {
      logTimerError("failed to replay pending timer syncs after auth", error);
    });
  }, [replayPendingSyncs, user?.id]);

  const value = useMemo<TimerContextValue>(
    () => ({
      clearPendingSyncs,
      clearRuntime,
      extendTimer,
      getPendingSyncs,
      hydrateAwaitingCheckin,
      hydrateRunning,
      refreshStatus,
      resolveCheckin,
      startTimer,
      state,
      stopTimer,
    }),
    [
      clearPendingSyncs,
      clearRuntime,
      extendTimer,
      getPendingSyncs,
      hydrateAwaitingCheckin,
      hydrateRunning,
      refreshStatus,
      resolveCheckin,
      startTimer,
      state,
      stopTimer,
    ],
  );

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

export function useTimer() {
  const value = useContext(TimerContext);

  if (!value) {
    throw new Error("useTimer must be used within a TimerProvider.");
  }

  return value;
}
