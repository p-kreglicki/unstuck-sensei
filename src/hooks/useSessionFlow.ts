import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./useAuth";
import { useChat } from "./useChat";
import { useTimer } from "./useTimer";
import { toDisplayError } from "../lib/errors";
import {
  CLARIFYING_ANSWER_MAX_LENGTH,
  STUCK_ON_MAX_LENGTH,
} from "../../shared/session/session-input-limits.js";
import {
  checkInTimerSession,
  completeTimerBlock,
  createSessionDraft,
  expireTimerCheckin,
  insertConversationMessage,
  loadActiveSessionDraft,
  loadActiveTimerSession,
  loadConversationMessages,
  loadLatestTimerBlock,
  loadRecentSessionSummaries,
  revertExtensionStart,
  revertTimerStart,
  startExtensionBlock,
  startTimerBlock,
  stopTimerBlock,
  updateSessionDraft,
  type ConversationMessageRow,
  type SessionRow,
  type SessionTimerBlockRow,
} from "../lib/session-records";
import {
  isEnergyLevel,
  isSessionSource,
  parseSessionSteps,
  type EnergyLevel,
  type SessionSource,
  type SessionStep,
  type StructuredChatResponse,
} from "../../shared/session/session-protocol.js";
import { formatSessionReminder, moveStep } from "../lib/session-flow";

const TIMER_DURATION_SECONDS = 25 * 60;
const CHECKIN_GRACE_HOURS = 12;
const LOCAL_STOP_PENDING_MESSAGE =
  "The timer stopped locally. I’ll keep trying to save that change.";

type SessionStage =
  | "clarifying"
  | "checkin"
  | "compose"
  | "energy"
  | "steps"
  | "timer";

type SessionLocationState = {
  sessionSource?: SessionSource;
};

type RecentSessionSummaries = Awaited<
  ReturnType<typeof loadRecentSessionSummaries>
>;

export type TranscriptRow = {
  content: string;
  id: string;
  role: "assistant" | "user";
};

type UseSessionFlowOptions = {
  locationState: unknown;
};

async function persistSessionPatch(input: {
  currentSession: SessionRow;
  patch: Parameters<typeof updateSessionDraft>[1];
  userMessage?: {
    content: string;
    role: "user";
  };
}) {
  const nextSessionPromise = updateSessionDraft(input.currentSession.id, input.patch);
  const userMessagePromise = input.userMessage
    ? insertConversationMessage({
        content: input.userMessage.content,
        role: input.userMessage.role,
        sessionId: input.currentSession.id,
      })
    : Promise.resolve(null);

  const [nextSession, userMessage] = await Promise.all([
    nextSessionPromise,
    userMessagePromise,
  ]);

  return {
    nextSession,
    userMessage,
  };
}

function isCheckinGraceExpired(endedAt: string | null) {
  if (!endedAt) {
    return false;
  }

  return (
    Date.now() - new Date(endedAt).getTime() >= CHECKIN_GRACE_HOURS * 60 * 60 * 1000
  );
}

function requireBlockId(
  blockId: string | undefined,
  fallbackMessage: string,
): string {
  if (!blockId) {
    throw new Error(fallbackMessage);
  }

  return blockId;
}

export function useSessionFlow({ locationState }: UseSessionFlowOptions) {
  const { session, user } = useAuth();
  const timer = useTimer();
  const {
    clearPendingSyncs,
    clearRuntime,
    extendTimer,
    getPendingSyncs,
    hydrateAwaitingCheckin,
    hydrateRunning,
    refreshStatus,
    resolveCheckin,
    startTimer,
    stopTimer,
  } = timer;
  const requestedSource = readRequestedSource(locationState);
  const [isBooting, setIsBooting] = useState(true);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isSubmittingTimerAction, setIsSubmittingTimerAction] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [sessionRow, setSessionRow] = useState<SessionRow | null>(null);
  const [latestTimerBlock, setLatestTimerBlock] = useState<SessionTimerBlockRow | null>(
    null,
  );
  const [messages, setMessages] = useState<ConversationMessageRow[]>([]);
  const [recentSessions, setRecentSessions] = useState<RecentSessionSummaries>([]);
  const [stuckOnInput, setStuckOnInput] = useState("");
  const [energyLevel, setEnergyLevel] = useState<EnergyLevel | null>(null);
  const [clarifyingAnswer, setClarifyingAnswer] = useState("");
  const [steps, setSteps] = useState<SessionStep[]>([]);
  const chat = useChat({
    accessToken: session?.access_token ?? null,
    sessionId: sessionRow?.id ?? null,
  });

  const currentStage = deriveStage({
    latestTimerBlock,
    sessionRow,
    steps,
    timerStatus: timer.state.status,
  });
  const helperText =
    requestedSource === "detection" && !sessionRow
      ? "The nudge noticed you were bouncing around. Name the task you were dodging."
      : null;
  const reminder = formatSessionReminder(recentSessions[0] ?? null);
  const transcriptRows = useMemo(
    () =>
      messages.map((message) => ({
        content: message.content,
        id: message.id,
        role: message.role,
      })),
    [messages],
  );
  const streamingTranscriptRow =
    chat.state.isStreaming && chat.state.streamingText.length > 0
      ? {
          content: chat.state.streamingText,
          id: "streaming",
          role: "assistant" as const,
        }
      : null;

  useEffect(() => {
    let active = true;

    async function bootstrapSession() {
      if (!user?.id) {
        return;
      }

      setIsBooting(true);
      setStatusMessage(null);

      try {
        const [rustTimerState, pendingSyncs, activeTimerSession] = await Promise.all([
          refreshStatus(),
          getPendingSyncs(),
          loadActiveTimerSession(user.id),
        ]);
        const activeDraftSession = activeTimerSession
          ? null
          : await loadActiveSessionDraft(user.id);
        const activeSession = activeTimerSession ?? activeDraftSession;

        const [recent, sessionMessages, latestBlock] = await Promise.all([
          loadRecentSessionSummaries(user.id, activeSession?.id).catch((error) => {
            if (import.meta.env.DEV) {
              console.warn("[session] recent summaries failed:", error);
            }

            return [];
          }),
          activeSession
            ? loadConversationMessages(activeSession.id).catch((error) => {
                if (import.meta.env.DEV) {
                  console.warn("[session] conversation load failed:", error);
                }

                return [];
              })
            : Promise.resolve([]),
          activeTimerSession
            ? loadLatestTimerBlock(activeTimerSession.id).catch((error) => {
                if (import.meta.env.DEV) {
                  console.warn("[session] latest timer block load failed:", error);
                }

                return null;
              })
            : Promise.resolve(null),
        ]);

        const pendingStopSync =
          activeTimerSession && latestBlock && !latestBlock.ended_at
            ? pendingSyncs.find(
                (sync) =>
                  sync.kind === "stop_block" &&
                  sync.sessionId === activeTimerSession.id &&
                  (sync.blockId === null || sync.blockId === latestBlock.id),
              )
            : null;

        if (pendingStopSync) {
          await clearRuntime();

          const draftSession = await loadActiveSessionDraft(user.id);
          const draftMessages = draftSession
            ? await loadConversationMessages(draftSession.id).catch(() => [])
            : [];

          if (!active) {
            return;
          }

          setRecentSessions(recent);
          setSessionRow(draftSession);
          setLatestTimerBlock(null);
          setMessages(draftMessages);
          setStatusMessage(LOCAL_STOP_PENDING_MESSAGE);
          setStuckOnInput(
            draftSession?.stuck_on ??
              (requestedSource === "detection"
                ? "I was bouncing between apps and avoiding "
                : ""),
          );
          setEnergyLevel(
            isEnergyLevel(draftSession?.energy_level)
              ? draftSession.energy_level
              : null,
          );
          setClarifyingAnswer(draftSession?.clarifying_answer ?? "");
          setSteps(parseSessionSteps(draftSession?.steps));
          return;
        }

        if (!active) {
          return;
        }

        setRecentSessions(recent);
        setSessionRow(activeSession);
        setLatestTimerBlock(latestBlock);
        setMessages(sessionMessages);

        if (activeSession) {
          setStuckOnInput(activeSession.stuck_on ?? "");
          setEnergyLevel(
            isEnergyLevel(activeSession.energy_level)
              ? activeSession.energy_level
              : null,
          );
          setClarifyingAnswer(activeSession.clarifying_answer ?? "");
          setSteps(parseSessionSteps(activeSession.steps));
        } else {
          setEnergyLevel(null);
          setClarifyingAnswer("");
          setSteps([]);
          setStuckOnInput(
            requestedSource === "detection"
              ? "I was bouncing between apps and avoiding "
              : "",
          );
        }

        if (!activeTimerSession || !latestBlock) {
          return;
        }

        if (latestBlock.ended_at && !activeTimerSession.checked_in_at) {
          if (isCheckinGraceExpired(latestBlock.ended_at)) {
            await expireTimerCheckin({
              expectedRevision: activeTimerSession.timer_revision,
              expiredAt: new Date().toISOString(),
              sessionId: activeTimerSession.id,
            }).catch((error) => {
              if (import.meta.env.DEV) {
                console.warn("[session] stale timer expiry failed:", error);
              }
            });
            await clearRuntime();

            const draftSession = await loadActiveSessionDraft(user.id);
            const draftMessages = draftSession
              ? await loadConversationMessages(draftSession.id).catch(() => [])
              : [];

            if (!active) {
              return;
            }

            setSessionRow(draftSession);
            setLatestTimerBlock(null);
            setMessages(draftMessages);
            setStatusMessage(null);
            setStuckOnInput(
              draftSession?.stuck_on ??
                (requestedSource === "detection"
                  ? "I was bouncing between apps and avoiding "
                  : ""),
            );
            setEnergyLevel(
              isEnergyLevel(draftSession?.energy_level)
                ? draftSession.energy_level
                : null,
            );
            setClarifyingAnswer(draftSession?.clarifying_answer ?? "");
            setSteps(parseSessionSteps(draftSession?.steps));
            return;
          }

          if (rustTimerState.status !== "awaiting_checkin") {
            await hydrateAwaitingCheckin({
              blockId: latestBlock.id,
              checkinStartedAt: latestBlock.ended_at,
              durationSecs: latestBlock.duration_seconds,
              extended: activeTimerSession.timer_extended ?? false,
              sessionId: activeTimerSession.id,
              timerRevision: activeTimerSession.timer_revision,
            });
          }

          return;
        }

        if (!latestBlock.ended_at && rustTimerState.status !== "running") {
          await hydrateRunning({
            blockId: latestBlock.id,
            durationSecs: latestBlock.duration_seconds,
            extended: activeTimerSession.timer_extended ?? false,
            sessionId: activeTimerSession.id,
            startedAt: latestBlock.started_at,
            timerRevision: activeTimerSession.timer_revision,
          });
        }
      } catch (error) {
        if (!active) {
          return;
        }

        setStatusMessage(toDisplayError(error, "Unable to load your current session."));
      } finally {
        if (active) {
          setIsBooting(false);
        }
      }
    }

    void bootstrapSession();

    return () => {
      active = false;
    };
  }, [
    requestedSource,
    clearRuntime,
    getPendingSyncs,
    hydrateAwaitingCheckin,
    hydrateRunning,
    refreshStatus,
    user?.id,
  ]);

  async function handleSaveStuckTask() {
    if (!user?.id) {
      return;
    }

    const stuckOn = stuckOnInput.trim();

    if (!stuckOn) {
      setStatusMessage("Add the task you keep circling first.");
      return;
    }

    if (stuckOn.length > STUCK_ON_MAX_LENGTH) {
      setStatusMessage(`Keep the task under ${STUCK_ON_MAX_LENGTH} characters.`);
      return;
    }

    setIsSavingDraft(true);
    setStatusMessage(null);

    try {
      const nextSession = sessionRow
        ? await updateSessionDraft(sessionRow.id, {
            source: sessionRow.source ?? requestedSource,
            stuck_on: stuckOn,
          })
        : await createSessionDraft({
            source: requestedSource,
            stuckOn,
            userId: user.id,
          });

      setSessionRow(nextSession);
      setStuckOnInput(nextSession.stuck_on ?? stuckOn);
    } catch (error) {
      setStatusMessage(toDisplayError(error, "Unable to save your draft session."));
    } finally {
      setIsSavingDraft(false);
    }
  }

  async function handleGenerateSteps() {
    const stuckOn = stuckOnInput.trim();

    if (!sessionRow || !stuckOn) {
      setStatusMessage("Save the task first so I know what we’re working on.");
      return;
    }

    if (stuckOn.length > STUCK_ON_MAX_LENGTH) {
      setStatusMessage(`Keep the task under ${STUCK_ON_MAX_LENGTH} characters.`);
      return;
    }

    if (!energyLevel) {
      setStatusMessage("Pick your current energy before we break it down.");
      return;
    }

    setStatusMessage(null);

    try {
      const { nextSession, userMessage } = await persistSessionPatch({
        currentSession: sessionRow,
        patch: {
          energy_level: energyLevel,
        },
        userMessage:
          messages.length === 0
            ? {
                content: stuckOn,
                role: "user",
              }
            : undefined,
      });

      setSessionRow(nextSession);

      if (userMessage) {
        setMessages((current) => [...current, userMessage]);
      }

      const structured = await chat.sendInitial({
        energyLevel,
        source: nextSession.source ?? requestedSource,
        stuckOn,
      });

      await commitStructuredResult(nextSession, structured);
    } catch (error) {
      setStatusMessage(toDisplayError(error, "Unable to generate your first steps."));
    }
  }

  async function handleClarifyingSubmit() {
    const answer = clarifyingAnswer.trim();

    if (!sessionRow || !answer || !energyLevel) {
      return;
    }

    if (answer.length > CLARIFYING_ANSWER_MAX_LENGTH) {
      setStatusMessage(
        `Keep your answer under ${CLARIFYING_ANSWER_MAX_LENGTH} characters.`,
      );
      return;
    }

    setStatusMessage(null);

    try {
      const { nextSession, userMessage } = await persistSessionPatch({
        currentSession: sessionRow,
        patch: {
          clarifying_answer: answer,
        },
        userMessage: {
          content: answer,
          role: "user",
        },
      });

      setSessionRow(nextSession);

      if (userMessage) {
        setMessages((current) => [...current, userMessage]);
      }

      const structured = await chat.sendClarification({
        clarifyingAnswer: answer,
        energyLevel,
        source: nextSession.source ?? requestedSource,
        stuckOn: nextSession.stuck_on ?? stuckOnInput.trim(),
      });

      await commitStructuredResult(nextSession, structured);
    } catch (error) {
      setStatusMessage(toDisplayError(error, "Unable to refine the session."));
    }
  }

  async function handleRetry() {
    if (!sessionRow || !energyLevel) {
      return;
    }

    const stuckOn = sessionRow.stuck_on ?? stuckOnInput.trim();

    if (!stuckOn || stuckOn.length > STUCK_ON_MAX_LENGTH) {
      setStatusMessage(`Keep the task under ${STUCK_ON_MAX_LENGTH} characters.`);
      return;
    }

    setIsRetrying(true);
    setStatusMessage(null);

    try {
      const structured = await chat.retry({
        energyLevel,
        source: sessionRow.source ?? requestedSource,
        stuckOn,
      });

      await commitStructuredResult(sessionRow, structured);
    } catch (error) {
      setStatusMessage(toDisplayError(error, "Unable to try again right now."));
    } finally {
      setIsRetrying(false);
    }
  }

  async function handleMoveStep(fromIndex: number, toIndex: number) {
    if (!sessionRow) {
      return;
    }

    const nextSteps = moveStep(steps, fromIndex, toIndex);
    setSteps(nextSteps);

    try {
      const nextSession = await updateSessionDraft(sessionRow.id, {
        steps: nextSteps,
      });
      setSessionRow(nextSession);
    } catch (error) {
      setStatusMessage(toDisplayError(error, "Unable to save the new step order."));
      setSteps(steps);
    }
  }

  async function handleConfirm() {
    if (!sessionRow) {
      return;
    }

    setIsSubmittingTimerAction(true);
    setStatusMessage(null);

    const startedAt = new Date().toISOString();

    try {
      const result = await startTimerBlock({
        durationSeconds: TIMER_DURATION_SECONDS,
        expectedRevision: sessionRow.timer_revision,
        sessionId: sessionRow.id,
        startedAt,
      });
      const blockId = requireBlockId(
        result.blockId,
        "Timer start did not return a block id.",
      );

      try {
        await startTimer({
          blockId,
          durationSecs: result.durationSeconds ?? TIMER_DURATION_SECONDS,
          sessionId: sessionRow.id,
          startedAt: result.startedAt ?? startedAt,
          timerRevision: result.timerRevision,
        });
      } catch (error) {
        const revertResult = await revertTimerStart({
          expectedRevision: result.timerRevision,
          sessionId: sessionRow.id,
        }).catch(() => null);

        if (revertResult) {
          setSessionRow((current) =>
            current
              ? {
                  ...current,
                  timer_duration_seconds: null,
                  timer_ended_at: null,
                  timer_extended: false,
                  timer_revision: revertResult.timerRevision,
                  timer_started_at: null,
                }
              : current,
          );
        }

        throw error;
      }

      setSessionRow((current) =>
        current
          ? {
              ...current,
              timer_duration_seconds: result.durationSeconds ?? TIMER_DURATION_SECONDS,
              timer_ended_at: null,
              timer_extended: false,
              timer_revision: result.timerRevision,
              timer_started_at: result.startedAt ?? startedAt,
            }
          : current,
      );
      setLatestTimerBlock({
        block_index: 1,
        created_at: result.startedAt ?? startedAt,
        duration_seconds: result.durationSeconds ?? TIMER_DURATION_SECONDS,
        ended_at: null,
        id: blockId,
        kind: "initial",
        session_id: sessionRow.id,
        started_at: result.startedAt ?? startedAt,
      });
    } catch (error) {
      setStatusMessage(toDisplayError(error, "Unable to start the timer."));
    } finally {
      setIsSubmittingTimerAction(false);
    }
  }

  async function ensureCheckinDurable(currentSession: SessionRow) {
    const pendingSync = (await getPendingSyncs()).find(
      (sync) =>
        sync.kind === "complete_block" &&
        sync.sessionId === currentSession.id &&
        (!latestTimerBlock || sync.blockId === latestTimerBlock.id),
    );

    if (!pendingSync) {
      return {
        endedAt: latestTimerBlock?.ended_at ?? currentSession.timer_ended_at,
        timerRevision: timer.state.timerRevision ?? currentSession.timer_revision,
      };
    }

    const blockId = pendingSync.blockId ?? latestTimerBlock?.id;

    if (!blockId) {
      throw new Error("Timer completion sync is missing a block id.");
    }

    const result = await completeTimerBlock({
      blockId,
      endedAt: pendingSync.occurredAt,
      expectedRevision: pendingSync.expectedRevision,
    });

    await clearPendingSyncs([pendingSync.id]);
    await hydrateAwaitingCheckin({
      blockId,
      checkinStartedAt: result.endedAt ?? pendingSync.occurredAt,
      durationSecs: latestTimerBlock?.duration_seconds ?? TIMER_DURATION_SECONDS,
      extended: currentSession.timer_extended ?? false,
      sessionId: currentSession.id,
      timerRevision: result.timerRevision,
    });

    setSessionRow((current) =>
      current
        ? {
            ...current,
            timer_ended_at: result.endedAt ?? pendingSync.occurredAt,
            timer_revision: result.timerRevision,
          }
        : current,
    );
    setLatestTimerBlock((current) =>
      current
        ? {
            ...current,
            ended_at: result.endedAt ?? pendingSync.occurredAt,
          }
        : current,
    );

    return {
      endedAt: result.endedAt ?? pendingSync.occurredAt,
      timerRevision: result.timerRevision,
    };
  }

  function resetSessionFlow(summaryMessage: string, feedback?: SessionRow["feedback"]) {
    if (feedback && sessionRow) {
      setRecentSessions((current) => [
        {
          createdAt: new Date().toISOString(),
          feedback,
          steps,
          stuckOn: sessionRow.stuck_on,
        },
        ...current,
      ].slice(0, 3));
    }

    setSessionRow(null);
    setLatestTimerBlock(null);
    setMessages([]);
    setSteps([]);
    setEnergyLevel(null);
    setClarifyingAnswer("");
    setStuckOnInput("");
    setStatusMessage(summaryMessage);
  }

  async function handleStopTimer() {
    if (!sessionRow || !latestTimerBlock) {
      return;
    }

    const endedAt = new Date().toISOString();
    const expectedRevision = timer.state.timerRevision ?? sessionRow.timer_revision;

    setIsSubmittingTimerAction(true);
    setStatusMessage(null);

    try {
      await stopTimer();
      await stopTimerBlock({
        blockId: latestTimerBlock.id,
        endedAt,
        expectedRevision,
      }).catch((error) => {
        if (import.meta.env.DEV) {
          console.warn("[session] durable timer stop will replay later:", error);
        }

        throw error;
      });

      const pending = await getPendingSyncs();
      await clearPendingSyncs(
        pending
          .filter(
            (sync) =>
              sync.kind === "stop_block" &&
              sync.sessionId === sessionRow.id &&
              sync.blockId === latestTimerBlock.id,
          )
          .map((sync) => sync.id),
      );

      resetSessionFlow("Session stopped. Start another round when you're ready.");
    } catch (error) {
      resetSessionFlow(
        toDisplayError(
          error,
          LOCAL_STOP_PENDING_MESSAGE,
        ),
      );
    } finally {
      setIsSubmittingTimerAction(false);
    }
  }

  async function handleCheckIn(feedback: NonNullable<SessionRow["feedback"]>) {
    if (!sessionRow) {
      return;
    }

    setIsSubmittingTimerAction(true);
    setStatusMessage(null);

    try {
      const checkinState = await ensureCheckinDurable(sessionRow);
      const checkedInAt = new Date().toISOString();

      await checkInTimerSession({
        checkedInAt,
        expectedRevision: checkinState.timerRevision,
        feedback,
        sessionId: sessionRow.id,
      });

      await resolveCheckin();
      await clearPendingSyncs(
        (await getPendingSyncs())
          .filter((sync) => sync.sessionId === sessionRow.id)
          .map((sync) => sync.id),
      );

      resetSessionFlow(checkInSummary(feedback), feedback);
    } catch (error) {
      setStatusMessage(toDisplayError(error, "Unable to save your check-in."));
    } finally {
      setIsSubmittingTimerAction(false);
    }
  }

  async function handleExtendTimer() {
    if (!sessionRow) {
      return;
    }

    setIsSubmittingTimerAction(true);
    setStatusMessage(null);

    const startedAt = new Date().toISOString();

    try {
      const checkinState = await ensureCheckinDurable(sessionRow);
      const result = await startExtensionBlock({
        durationSeconds: TIMER_DURATION_SECONDS,
        expectedRevision: checkinState.timerRevision,
        sessionId: sessionRow.id,
        startedAt,
      });
      const blockId = requireBlockId(
        result.blockId,
        "Timer extension did not return a block id.",
      );

      try {
        await extendTimer({
          blockId,
          durationSecs: result.durationSeconds ?? TIMER_DURATION_SECONDS,
          sessionId: sessionRow.id,
          startedAt: result.startedAt ?? startedAt,
          timerRevision: result.timerRevision,
        });
      } catch (error) {
        const revertResult = await revertExtensionStart({
          expectedRevision: result.timerRevision,
          sessionId: sessionRow.id,
        }).catch(() => null);

        if (revertResult) {
          setSessionRow((current) =>
            current
              ? {
                  ...current,
                  timer_duration_seconds: TIMER_DURATION_SECONDS,
                  timer_ended_at: checkinState.endedAt ?? current.timer_ended_at,
                  timer_extended: false,
                  timer_revision: revertResult.timerRevision,
                }
              : current,
          );
        }

        throw error;
      }

      setSessionRow((current) =>
        current
          ? {
              ...current,
              timer_duration_seconds:
                (current.timer_duration_seconds ?? TIMER_DURATION_SECONDS) +
                TIMER_DURATION_SECONDS,
              timer_ended_at: null,
              timer_extended: true,
              timer_revision: result.timerRevision,
            }
          : current,
      );
      setLatestTimerBlock({
        block_index: (latestTimerBlock?.block_index ?? 1) + 1,
        created_at: result.startedAt ?? startedAt,
        duration_seconds: result.durationSeconds ?? TIMER_DURATION_SECONDS,
        ended_at: null,
        id: blockId,
        kind: "extension",
        session_id: sessionRow.id,
        started_at: result.startedAt ?? startedAt,
      });
    } catch (error) {
      setStatusMessage(toDisplayError(error, "Unable to extend the timer."));
    } finally {
      setIsSubmittingTimerAction(false);
    }
  }

  async function commitStructuredResult(
    currentSession: SessionRow,
    structured: StructuredChatResponse,
  ) {
    const nextSessionPromise =
      structured.kind === "clarifying_question"
        ? updateSessionDraft(currentSession.id, {
            clarifying_question: structured.question,
            steps: null,
          })
        : updateSessionDraft(currentSession.id, {
            steps: structured.steps,
          });
    const assistantMessagePromise = insertConversationMessage({
      content: structured.assistantText,
      role: "assistant",
      sessionId: currentSession.id,
    });
    const [nextSession, assistantMessage] = await Promise.all([
      nextSessionPromise,
      assistantMessagePromise,
    ]);

    setMessages((current) => [...current, assistantMessage]);
    setSessionRow(nextSession);
    setSteps(structured.kind === "steps" ? structured.steps : []);
  }

  return {
    chatState: chat.state,
    clarifyingAnswer,
    clarifyingQuestion: sessionRow?.clarifying_question ?? null,
    currentStage,
    energyLevel,
    handleCheckIn,
    handleClarifyingSubmit,
    handleConfirm,
    handleExtendTimer,
    handleGenerateSteps,
    handleMoveStep,
    handleRetry,
    handleSaveStuckTask,
    handleStopTimer,
    helperText,
    isBooting,
    isRetrying,
    isSavingDraft,
    isSubmittingTimerAction,
    latestTimerBlock,
    reminder,
    sessionRow,
    setClarifyingAnswer,
    setEnergyLevel,
    setStuckOnInput,
    statusMessage,
    steps,
    streamingTranscriptRow,
    stuckOnInput,
    timerState: timer.state,
    transcriptRows,
  };
}

function deriveStage(input: {
  latestTimerBlock: SessionTimerBlockRow | null;
  sessionRow: SessionRow | null;
  steps: SessionStep[];
  timerStatus: "awaiting_checkin" | "idle" | "running";
}): SessionStage {
  if (input.timerStatus === "running") {
    return "timer";
  }

  if (input.timerStatus === "awaiting_checkin") {
    return "checkin";
  }

  if (
    input.sessionRow?.status === "active" &&
    input.latestTimerBlock?.ended_at &&
    !input.sessionRow.checked_in_at &&
    !isCheckinGraceExpired(input.latestTimerBlock.ended_at)
  ) {
    return "checkin";
  }

  if (
    input.sessionRow?.status === "active" &&
    input.latestTimerBlock &&
    !input.latestTimerBlock.ended_at
  ) {
    return "timer";
  }

  if (input.steps.length > 0) {
    return "steps";
  }

  if (input.sessionRow?.clarifying_question && !input.sessionRow.clarifying_answer) {
    return "clarifying";
  }

  if (input.sessionRow?.stuck_on) {
    return "energy";
  }

  return "compose";
}

function checkInSummary(feedback: NonNullable<SessionRow["feedback"]>) {
  if (feedback === "yes") {
    return "Nice. You got started. Come back when you need the next round.";
  }

  if (feedback === "somewhat") {
    return "Progress counts. Take the next small step when you’re ready.";
  }

  return "Thanks for checking in. Start a fresh round when you want another reset.";
}

function isSessionLocationState(value: unknown): value is SessionLocationState {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (!("sessionSource" in value)) {
    return true;
  }

  return value.sessionSource === undefined || isSessionSource(value.sessionSource);
}

function readRequestedSource(state: unknown): SessionSource {
  if (!isSessionLocationState(state)) {
    return "manual";
  }

  if (state.sessionSource === "detection") {
    return "detection";
  }

  if (state.sessionSource === "email") {
    return "email";
  }

  return "manual";
}
