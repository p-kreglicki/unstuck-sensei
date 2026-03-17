import type {
  SessionStep,
  SessionSummary,
} from "../../shared/session/session-protocol.js";

export function moveStep(
  steps: SessionStep[],
  fromIndex: number,
  toIndex: number,
): SessionStep[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= steps.length ||
    toIndex >= steps.length ||
    fromIndex === toIndex
  ) {
    return steps;
  }

  const nextSteps = [...steps];
  const [step] = nextSteps.splice(fromIndex, 1);

  if (!step) {
    return steps;
  }

  nextSteps.splice(toIndex, 0, step);

  return nextSteps;
}

export function formatSessionReminder(summary: SessionSummary | null) {
  if (!summary?.stuckOn) {
    return null;
  }

  if (summary.feedback === "yes") {
    return `Last time you made progress on "${summary.stuckOn}".`;
  }

  if (summary.feedback === "somewhat") {
    return `Last time you got moving on "${summary.stuckOn}" but still had some friction.`;
  }

  if (summary.feedback === "no") {
    return `Last time "${summary.stuckOn}" still felt sticky.`;
  }

  return `Last time you worked on "${summary.stuckOn}".`;
}
