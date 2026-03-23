import type { EnergyLevel, SessionStep } from "../../shared/session/session-protocol.js";
import type {
  ConversationMessageRow,
  SessionRow,
  SessionTimerBlockRow,
} from "./session-records";

export type SessionStage =
  | "clarifying"
  | "checkin"
  | "compose"
  | "energy"
  | "steps"
  | "timer";

export type SessionThreadMessageItem = {
  content: string;
  id: string;
  kind: "message";
  persisted: boolean;
  role: "assistant" | "user";
  status?: "streaming";
};

export type SessionThreadPromptItem = {
  content: string;
  id: string;
  kind: "prompt";
  prompt: "clarifying" | "energy" | "opening";
  role: "assistant";
  synthetic: true;
};

export type SessionThreadControlItem = {
  control: "checkin" | "energy" | "steps" | "timer";
  id: string;
  kind: "control";
};

export type SessionThreadItem =
  | SessionThreadControlItem
  | SessionThreadMessageItem
  | SessionThreadPromptItem;

export type DeriveThreadItemsInput = {
  chatState: {
    isStreaming: boolean;
    streamingText: string;
  };
  currentStage: SessionStage;
  latestTimerBlock: SessionTimerBlockRow | null;
  messages: ConversationMessageRow[];
  sessionRow: SessionRow | null;
  steps: SessionStep[];
};

export const SESSION_OPENING_PROMPT = "What are you stuck on?";
export const SESSION_ENERGY_PROMPT = "What kind of energy do you have right now?";

const ENERGY_REPLY_LABELS: Record<EnergyLevel, string> = {
  high: "High",
  low: "Low",
  medium: "Medium",
};

function normalizeMessageContent(value: string) {
  return value.trim();
}

export function hasMatchingConversationMessage(input: {
  content: string;
  messages: Array<Pick<ConversationMessageRow, "content" | "role">>;
  role: ConversationMessageRow["role"];
}) {
  const target = normalizeMessageContent(input.content);

  if (!target) {
    return false;
  }

  return input.messages.some(
    (message) =>
      message.role === input.role &&
      normalizeMessageContent(message.content) === target,
  );
}

function toPersistedMessageItem(
  message: Pick<ConversationMessageRow, "content" | "id" | "role">,
): SessionThreadMessageItem {
  return {
    content: message.content,
    id: message.id,
    kind: "message",
    persisted: true,
    role: message.role,
  };
}

function toSyntheticMessageItem(input: {
  content: string;
  id: string;
  role: SessionThreadMessageItem["role"];
  status?: SessionThreadMessageItem["status"];
}): SessionThreadMessageItem {
  return {
    content: input.content,
    id: input.id,
    kind: "message",
    persisted: false,
    role: input.role,
    status: input.status,
  };
}

export function deriveThreadItems(input: DeriveThreadItemsInput): SessionThreadItem[] {
  const items: SessionThreadItem[] = [
    {
      content: SESSION_OPENING_PROMPT,
      id: "prompt:opening",
      kind: "prompt",
      prompt: "opening",
      role: "assistant",
      synthetic: true,
    },
  ];
  const stuckOn = input.sessionRow?.stuck_on?.trim() ?? "";
  const openingMessage = stuckOn
    ? input.messages.find(
        (message) =>
          message.role === "user" &&
          normalizeMessageContent(message.content) === stuckOn,
      )
    : null;

  if (stuckOn) {
    items.push(
      openingMessage
        ? toPersistedMessageItem(openingMessage)
        : toSyntheticMessageItem({
            content: stuckOn,
            id: "synthetic:user-opening",
            role: "user",
          }),
    );
    items.push({
      content: SESSION_ENERGY_PROMPT,
      id: "prompt:energy",
      kind: "prompt",
      prompt: "energy",
      role: "assistant",
      synthetic: true,
    });
  }

  if (input.sessionRow?.energy_level) {
    items.push(
      toSyntheticMessageItem({
        content: ENERGY_REPLY_LABELS[input.sessionRow.energy_level],
        id: "synthetic:user-energy",
        role: "user",
      }),
    );
  }

  const remainingMessages = openingMessage
    ? input.messages.filter((message) => message.id !== openingMessage.id)
    : input.messages;

  items.push(...remainingMessages.map(toPersistedMessageItem));

  if (
    input.sessionRow?.clarifying_question &&
    !input.messages.some((message) => message.role === "assistant")
  ) {
    items.push({
      content: input.sessionRow.clarifying_question,
      id: "prompt:clarifying",
      kind: "prompt",
      prompt: "clarifying",
      role: "assistant",
      synthetic: true,
    });
  }

  if (input.chatState.isStreaming && input.chatState.streamingText.length > 0) {
    items.push(
      toSyntheticMessageItem({
        content: input.chatState.streamingText,
        id: "message:streaming",
        role: "assistant",
        status: "streaming",
      }),
    );
  }

  if (input.currentStage === "energy") {
    items.push({
      control: "energy",
      id: "control:energy",
      kind: "control",
    });
  }

  if (input.currentStage === "steps" && input.steps.length > 0) {
    items.push({
      control: "steps",
      id: "control:steps",
      kind: "control",
    });
  }

  if (input.currentStage === "timer") {
    items.push({
      control: "timer",
      id: input.latestTimerBlock
        ? `control:timer:${input.latestTimerBlock.id}`
        : "control:timer",
      kind: "control",
    });
  }

  if (input.currentStage === "checkin") {
    items.push({
      control: "checkin",
      id: input.latestTimerBlock
        ? `control:checkin:${input.latestTimerBlock.id}`
        : "control:checkin",
      kind: "control",
    });
  }

  return items;
}
