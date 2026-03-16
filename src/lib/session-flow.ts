export const STRUCTURED_RESPONSE_DELIMITER = "\n<<<STRUCTURED_RESPONSE>>>\n";

export type EnergyLevel = "high" | "low" | "medium";
export type SessionSource = "detection" | "email" | "manual";
export type ChatRequestMode = "clarification" | "initial" | "retry";

export type SessionStep = {
  id: string;
  text: string;
};

export type ClarifyingQuestionResult = {
  assistantText: string;
  kind: "clarifying_question";
  question: string;
};

export type StepsResult = {
  assistantText: string;
  kind: "steps";
  steps: SessionStep[];
};

export type StructuredChatResponse = ClarifyingQuestionResult | StepsResult;

export type ChatRequestBody = {
  clarifyingAnswer?: string;
  energyLevel: EnergyLevel;
  mode: ChatRequestMode;
  sessionId: string;
  source: SessionSource;
  stuckOn: string;
};

export type SessionSummary = {
  createdAt: string;
  feedback: "no" | "somewhat" | "yes" | null;
  stuckOn: string | null;
  steps: SessionStep[];
};

export function isEnergyLevel(value: unknown): value is EnergyLevel {
  return value === "low" || value === "medium" || value === "high";
}

export function isSessionSource(value: unknown): value is SessionSource {
  return value === "manual" || value === "detection" || value === "email";
}

export function isSessionStep(value: unknown): value is SessionStep {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    "id" in value &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    "text" in value &&
    typeof value.text === "string" &&
    value.text.trim().length > 0
  );
}

export function parseSessionSteps(value: unknown): SessionStep[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isSessionStep);
}

function hasAssistantText(value: unknown): value is { assistantText: string } {
  return (
    !!value &&
    typeof value === "object" &&
    "assistantText" in value &&
    typeof value.assistantText === "string" &&
    value.assistantText.trim().length > 0
  );
}

export function isStructuredChatResponse(
  value: unknown,
): value is StructuredChatResponse {
  if (!value || typeof value !== "object" || !hasAssistantText(value)) {
    return false;
  }

  if (
    "kind" in value &&
    value.kind === "clarifying_question" &&
    "question" in value &&
    typeof value.question === "string" &&
    value.question.trim().length > 0
  ) {
    return true;
  }

  if (
    "kind" in value &&
    value.kind === "steps" &&
    "steps" in value &&
    Array.isArray(value.steps) &&
    value.steps.every(isSessionStep)
  ) {
    return true;
  }

  return false;
}

export function createStepId(index: number) {
  return `step-${index + 1}`;
}

export function createSessionSteps(steps: string[]): SessionStep[] {
  return steps
    .map((step) => step.trim())
    .filter((step) => step.length > 0)
    .map((text, index) => ({
      id: createStepId(index),
      text,
    }));
}

export function clampSteps(steps: SessionStep[]): SessionStep[] {
  return steps.slice(0, 5);
}

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
