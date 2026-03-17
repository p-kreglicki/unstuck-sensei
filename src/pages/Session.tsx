import { useLocation } from "react-router";
import { ClarifyingQuestion } from "../components/session/ClarifyingQuestion";
import { ConfirmedCard } from "../components/session/ConfirmedCard";
import { EnergySelector } from "../components/session/EnergySelector";
import { LoadingCard } from "../components/session/LoadingCard";
import { StepsList } from "../components/session/StepsList";
import { StuckInput } from "../components/session/StuckInput";
import { TranscriptCard } from "../components/session/TranscriptCard";
import { useSessionFlow } from "../hooks/useSessionFlow";

export function Session() {
  const location = useLocation();
  const flow = useSessionFlow({ locationState: location.state });

  return (
    <div className="space-y-5">
      {flow.statusMessage ? (
        <p className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {flow.statusMessage}
        </p>
      ) : null}

      {flow.isBooting ? (
        <LoadingCard />
      ) : (
        <>
          {flow.currentStage === "compose" ? (
            <StuckInput
              helperText={flow.helperText}
              isSubmitting={flow.isSavingDraft}
              onChange={flow.setStuckOnInput}
              onSubmit={() => void flow.handleSaveStuckTask()}
              reminder={flow.reminder}
              value={flow.stuckOnInput}
            />
          ) : null}

          {flow.currentStage === "energy" ? (
            <EnergySelector
              isSubmitting={flow.chatState.isStreaming}
              onSelect={flow.setEnergyLevel}
              onSubmit={() => void flow.handleGenerateSteps()}
              value={flow.energyLevel}
            />
          ) : null}

          {flow.transcriptRows.length > 0 || flow.streamingTranscriptRow ? (
            <TranscriptCard
              rows={flow.transcriptRows}
              streamingRow={flow.streamingTranscriptRow}
            />
          ) : null}

          {flow.currentStage === "clarifying" && flow.clarifyingQuestion ? (
            <ClarifyingQuestion
              answer={flow.clarifyingAnswer}
              isSubmitting={flow.chatState.isStreaming}
              onAnswerChange={flow.setClarifyingAnswer}
              onSubmit={() => void flow.handleClarifyingSubmit()}
              question={flow.clarifyingQuestion}
            />
          ) : null}

          {flow.currentStage === "steps" && flow.steps.length > 0 ? (
            <StepsList
              isRetrying={flow.isRetrying || flow.chatState.isStreaming}
              onConfirm={flow.handleConfirm}
              onMoveDown={(index) => void flow.handleMoveStep(index, index + 1)}
              onMoveUp={(index) => void flow.handleMoveStep(index, index - 1)}
              onRetry={() => void flow.handleRetry()}
              steps={flow.steps}
            />
          ) : null}

          {flow.currentStage === "confirmed" && flow.steps.length > 0 ? (
            <ConfirmedCard steps={flow.steps} />
          ) : null}
        </>
      )}
    </div>
  );
}
