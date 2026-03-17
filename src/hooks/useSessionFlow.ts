import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./useAuth";
import { useChat } from "./useChat";
import { toDisplayError } from "../lib/errors";
import {
  CLARIFYING_ANSWER_MAX_LENGTH,
  STUCK_ON_MAX_LENGTH,
} from "../../shared/session/session-input-limits.js";
import {
  createSessionDraft,
  insertConversationMessage,
  loadActiveSessionDraft,
  loadConversationMessages,
  loadRecentSessionSummaries,
  readSessionSteps,
  updateSessionDraft,
  type ConversationMessageRow,
  type SessionRow,
} from "../lib/session-records";
import {
  isEnergyLevel,
  isSessionSource,
  type EnergyLevel,
  type SessionSource,
  type SessionStep,
  type StructuredChatResponse,
} from "../../shared/session/session-protocol.js";
import { formatSessionReminder, moveStep } from "../lib/session-flow";

type SessionStage =
  | "clarifying"
  | "compose"
  | "confirmed"
  | "energy"
  | "steps";

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

export function useSessionFlow({ locationState }: UseSessionFlowOptions) {
  const { user } = useAuth();
  const requestedSource = readRequestedSource(locationState);
  const [isBooting, setIsBooting] = useState(true);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [sessionRow, setSessionRow] = useState<SessionRow | null>(null);
  const [messages, setMessages] = useState<ConversationMessageRow[]>([]);
  const [recentSessions, setRecentSessions] = useState<RecentSessionSummaries>([]);
  const [stuckOnInput, setStuckOnInput] = useState("");
  const [energyLevel, setEnergyLevel] = useState<EnergyLevel | null>(null);
  const [clarifyingAnswer, setClarifyingAnswer] = useState("");
  const [steps, setSteps] = useState<SessionStep[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const chat = useChat({ sessionId: sessionRow?.id ?? null });

  useEffect(() => {
    let active = true;

    async function bootstrapSession() {
      if (!user?.id) {
        return;
      }

      setIsBooting(true);
      setStatusMessage(null);

      try {
        const activeSession = await loadActiveSessionDraft(user.id);
        const [recent, sessionMessages] = await Promise.all([
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
        ]);

        if (!active) {
          return;
        }

        setRecentSessions(recent);
        setSessionRow(activeSession);
        setMessages(sessionMessages);
        setConfirmed(false);

        if (activeSession) {
          setStuckOnInput(activeSession.stuck_on ?? "");
          setEnergyLevel(
            isEnergyLevel(activeSession.energy_level)
              ? activeSession.energy_level
              : null,
          );
          setClarifyingAnswer(activeSession.clarifying_answer ?? "");
          setSteps(readSessionSteps(activeSession));
          return;
        }

        setEnergyLevel(null);
        setClarifyingAnswer("");
        setSteps([]);
        setStuckOnInput(
          requestedSource === "detection"
            ? "I was bouncing between apps and avoiding "
            : "",
        );
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
  }, [requestedSource, user?.id]);

  const currentStage = deriveStage({
    confirmed,
    sessionRow,
    steps,
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
    setConfirmed(false);
  }

  return {
    chatState: chat.state,
    clarifyingAnswer,
    clarifyingQuestion: sessionRow?.clarifying_question ?? null,
    currentStage,
    energyLevel,
    handleClarifyingSubmit,
    handleConfirm: () => setConfirmed(true),
    handleGenerateSteps,
    handleMoveStep,
    handleRetry,
    handleSaveStuckTask,
    helperText,
    isBooting,
    isRetrying,
    isSavingDraft,
    reminder,
    setClarifyingAnswer,
    setEnergyLevel,
    setStuckOnInput,
    statusMessage,
    steps,
    streamingTranscriptRow,
    stuckOnInput,
    transcriptRows,
  };
}

function deriveStage(input: {
  confirmed: boolean;
  sessionRow: SessionRow | null;
  steps: SessionStep[];
}): SessionStage {
  if (input.confirmed) {
    return "confirmed";
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
