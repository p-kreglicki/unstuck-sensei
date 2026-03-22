import { useLocation } from "react-router";
import { CheckIn } from "../components/session/CheckIn";
import { ClarifyingQuestion } from "../components/session/ClarifyingQuestion";
import { EnergySelector } from "../components/session/EnergySelector";
import { LoadingCard } from "../components/session/LoadingCard";
import { SessionConversationShell } from "../components/session/SessionConversationShell";
import { StepsList } from "../components/session/StepsList";
import { StuckInput } from "../components/session/StuckInput";
import { Timer } from "../components/session/Timer";
import { useSessionFlow } from "../hooks/useSessionFlow";

export function Session() {
  const location = useLocation();
  const flow = useSessionFlow({ locationState: location.state });
  const composer =
    flow.currentStage === "compose" ? (
      <StuckInput
        helperText={flow.helperText}
        isSubmitting={flow.isSavingDraft}
        onChange={flow.setStuckOnInput}
        onSubmit={() => void flow.handleSaveStuckTask()}
        reminder={flow.reminder}
        value={flow.stuckOnInput}
      />
    ) : flow.currentStage === "clarifying" && flow.clarifyingQuestion ? (
      <ClarifyingQuestion
        answer={flow.clarifyingAnswer}
        isSubmitting={flow.chatState.isStreaming}
        onAnswerChange={flow.setClarifyingAnswer}
        onSubmit={() => void flow.handleClarifyingSubmit()}
        question={flow.clarifyingQuestion}
      />
    ) : null;

  function renderControl(control: "checkin" | "energy" | "steps" | "timer") {
    switch (control) {
      case "energy":
        return (
          <EnergySelector
            isSubmitting={flow.chatState.isStreaming}
            onSelect={flow.setEnergyLevel}
            onSubmit={() => void flow.handleGenerateSteps()}
            value={flow.energyLevel}
          />
        );
      case "steps":
        return (
          <StepsList
            isConfirming={flow.isSubmittingTimerAction}
            isRetrying={flow.isRetrying || flow.chatState.isStreaming}
            onConfirm={flow.handleConfirm}
            onMoveDown={(index) => void flow.handleMoveStep(index, index + 1)}
            onMoveUp={(index) => void flow.handleMoveStep(index, index - 1)}
            onRetry={() => void flow.handleRetry()}
            steps={flow.steps}
          />
        );
      case "timer":
        return (
          <Timer
            firstStepText={flow.steps[0]?.text ?? null}
            isStopping={flow.isSubmittingTimerAction}
            onStop={() => void flow.handleStopTimer()}
          />
        );
      case "checkin":
        return (
          <CheckIn
            canExtend={!flow.sessionRow?.timer_extended}
            firstStepText={flow.steps[0]?.text ?? null}
            isSubmitting={flow.isSubmittingTimerAction}
            onExtend={() => void flow.handleExtendTimer()}
            onFeedback={(feedback) => void flow.handleCheckIn(feedback)}
          />
        );
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      {flow.statusMessage ? (
        <p className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {flow.statusMessage}
        </p>
      ) : null}

      {flow.isBooting ? (
        <LoadingCard />
      ) : (
        <SessionConversationShell
          composer={composer}
          items={flow.threadItems}
          renderControl={renderControl}
        />
      )}
    </div>
  );
}
