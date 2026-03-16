import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import { ClarifyingQuestion } from "../components/session/ClarifyingQuestion";
import { EnergySelector } from "../components/session/EnergySelector";
import { StepsList } from "../components/session/StepsList";
import { StuckInput } from "../components/session/StuckInput";
import { useAuth } from "../hooks/useAuth";
import { useChat } from "../hooks/useChat";
import { toDisplayError } from "../lib/errors";
import {
  CLARIFYING_ANSWER_MAX_LENGTH,
  STUCK_ON_MAX_LENGTH,
} from "../lib/session-input-limits";
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
  formatSessionReminder,
  isEnergyLevel,
  moveStep,
  type EnergyLevel,
  type SessionSource,
  type SessionStep,
  type StructuredChatResponse,
} from "../lib/session-flow";

type SessionStage =
  | "clarifying"
  | "compose"
  | "confirmed"
  | "energy"
  | "steps";

type SessionLocationState = {
  sessionSource?: SessionSource;
};

export function Session() {
  const { user } = useAuth();
  const location = useLocation();
  const requestedSource = readRequestedSource(location.state);
  const [isBooting, setIsBooting] = useState(true);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [sessionRow, setSessionRow] = useState<SessionRow | null>(null);
  const [messages, setMessages] = useState<ConversationMessageRow[]>([]);
  const [recentSessions, setRecentSessions] = useState<
    ReturnType<typeof formatRecentSessions>
  >([]);
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

        setRecentSessions(formatRecentSessions(recent));
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
  const renderedAssistantText =
    chat.state.isStreaming && chat.state.streamingText.length > 0
      ? chat.state.streamingText
      : chat.state.structuredResult?.assistantText ?? null;

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
      const nextSession = await updateSessionDraft(sessionRow.id, {
        energy_level: energyLevel,
      });
      setSessionRow(nextSession);

      if (messages.length === 0) {
        const userMessage = await insertConversationMessage({
          content: stuckOn,
          role: "user",
          sessionId: sessionRow.id,
        });
        setMessages((current) => [...current, userMessage]);
      }

      const structured = await chat.sendInitial({
        energyLevel,
        source: (nextSession.source as SessionSource | null) ?? requestedSource,
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
      const nextSession = await updateSessionDraft(sessionRow.id, {
        clarifying_answer: answer,
      });
      setSessionRow(nextSession);

      const userMessage = await insertConversationMessage({
        content: answer,
        role: "user",
        sessionId: sessionRow.id,
      });
      setMessages((current) => [...current, userMessage]);

      const structured = await chat.sendClarification({
        clarifyingAnswer: answer,
        energyLevel,
        source: (nextSession.source as SessionSource | null) ?? requestedSource,
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
        source: (sessionRow.source as SessionSource | null) ?? requestedSource,
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
    const assistantMessage = await insertConversationMessage({
      content: structured.assistantText,
      role: "assistant",
      sessionId: currentSession.id,
    });

    const nextSession =
      structured.kind === "clarifying_question"
        ? await updateSessionDraft(currentSession.id, {
            clarifying_question: structured.question,
            steps: null,
          })
        : await updateSessionDraft(currentSession.id, {
            steps: structured.steps,
          });

    setMessages((current) => [...current, assistantMessage]);
    setSessionRow(nextSession);
    setSteps(structured.kind === "steps" ? structured.steps : []);
    setConfirmed(false);
  }

  const transcript = useMemo(() => {
    if (messages.length === 0 && !renderedAssistantText) {
      return [];
    }

    const rows = messages.map((message) => ({
      content: message.content,
      id: message.id,
      role: message.role,
      transient: false,
    }));

    if (chat.state.isStreaming && chat.state.streamingText.length > 0) {
      rows.push({
        content: chat.state.streamingText,
        id: "streaming",
        role: "assistant" as const,
        transient: true,
      });
    }

    return rows;
  }, [chat.state.isStreaming, chat.state.streamingText, messages]);

  return (
    <div className="space-y-5">
      {statusMessage || chat.state.error ? (
        <p className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {statusMessage ?? chat.state.error}
        </p>
      ) : null}

      {isBooting ? (
        <LoadingCard />
      ) : (
        <>
          {currentStage === "compose" ? (
            <StuckInput
              helperText={helperText}
              isSubmitting={isSavingDraft}
              onChange={setStuckOnInput}
              onSubmit={() => void handleSaveStuckTask()}
              reminder={reminder}
              value={stuckOnInput}
            />
          ) : null}

          {currentStage === "energy" ? (
            <EnergySelector
              isSubmitting={chat.state.isStreaming}
              onSelect={setEnergyLevel}
              onSubmit={() => void handleGenerateSteps()}
              value={energyLevel}
            />
          ) : null}

          {transcript.length > 0 ? <TranscriptCard rows={transcript} /> : null}

          {currentStage === "clarifying" && sessionRow?.clarifying_question ? (
            <ClarifyingQuestion
              answer={clarifyingAnswer}
              isSubmitting={chat.state.isStreaming}
              onAnswerChange={setClarifyingAnswer}
              onSubmit={() => void handleClarifyingSubmit()}
              question={sessionRow.clarifying_question}
            />
          ) : null}

          {currentStage === "steps" && steps.length > 0 ? (
            <StepsList
              isRetrying={isRetrying || chat.state.isStreaming}
              onConfirm={() => setConfirmed(true)}
              onMoveDown={(index) => void handleMoveStep(index, index + 1)}
              onMoveUp={(index) => void handleMoveStep(index, index - 1)}
              onRetry={() => void handleRetry()}
              steps={steps}
            />
          ) : null}

          {currentStage === "confirmed" && steps.length > 0 ? (
            <ConfirmedCard steps={steps} />
          ) : null}
        </>
      )}
    </div>
  );
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

function readRequestedSource(state: unknown): SessionSource {
  const candidate = state as SessionLocationState | null;

  if (candidate?.sessionSource === "detection") {
    return "detection";
  }

  if (candidate?.sessionSource === "email") {
    return "email";
  }

  return "manual";
}

function formatRecentSessions(
  sessions: Awaited<ReturnType<typeof loadRecentSessionSummaries>>,
) {
  return sessions;
}

function LoadingCard() {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">
        Loading session
      </p>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        Pulling your current draft and recent sessions into place.
      </p>
    </section>
  );
}

function TranscriptCard({
  rows,
}: {
  rows: Array<{
    content: string;
    id: string;
    role: "assistant" | "user";
    transient: boolean;
  }>;
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
        Conversation
      </p>
      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div
            key={row.id}
            className={[
              "rounded-3xl px-4 py-4 text-sm leading-6",
              row.role === "assistant"
                ? "border border-teal-300/15 bg-teal-300/10 text-teal-50"
                : "border border-white/10 bg-slate-950/70 text-slate-100",
            ].join(" ")}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
                {row.role === "assistant" ? "Sensei" : "You"}
              </span>
              {row.transient ? (
                <span className="text-[11px] uppercase tracking-[0.24em] text-teal-200/70">
                  Streaming
                </span>
              ) : null}
            </div>
            <p className="whitespace-pre-wrap">{row.content}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ConfirmedCard({ steps }: { steps: SessionStep[] }) {
  return (
    <section className="rounded-[28px] border border-emerald-300/15 bg-emerald-300/10 p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-emerald-200/80">
        Locked in
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-white">
        Good. You know your first step.
      </h2>
      <p className="mt-3 text-sm leading-6 text-emerald-50/80">
        Phase 4 will turn this into the real timer start. For now the plan is saved and your first move is clear.
      </p>
      <ol className="mt-5 space-y-3">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="rounded-3xl border border-white/10 bg-slate-950/60 px-4 py-4 text-slate-100"
          >
            <span className="mr-3 text-sm text-teal-300">{index + 1}.</span>
            {step.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
