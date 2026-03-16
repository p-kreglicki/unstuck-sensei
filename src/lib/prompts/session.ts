import {
  STRUCTURED_RESPONSE_DELIMITER,
  type ChatRequestMode,
  type EnergyLevel,
  type SessionSummary,
  type SessionSource,
} from "../session-flow";

type BuildSessionPromptInput = {
  clarifyingAnswer?: string;
  energyLevel: EnergyLevel;
  mode: ChatRequestMode;
  recentSessions: SessionSummary[];
  source: SessionSource;
  stuckOn: string;
};

const SESSION_SYSTEM_PROMPT = `
You are Unstuck Sensei, a warm peer-like coach for solo founders.

Voice:
- supportive and direct
- casual, warm, non-judgmental
- no productivity jargon
- never act like a guru, manager, or therapist

Behavior:
- help the user start, not fully plan
- ask at most one clarifying question in the entire session
- when you have enough context, produce 3 to 5 concrete micro-steps
- keep every step short enough to fit in an in-app checklist
- order the steps to match the user's energy level
- focus on the first move that gets them into action quickly

Output rules:
- write plain human-facing assistant copy first
- after the assistant copy, write ${STRUCTURED_RESPONSE_DELIMITER} followed immediately by one JSON object
- do not use markdown fences
- do not write anything after the JSON object
- the JSON object must be exactly one of:
  {"kind":"clarifying_question","question":"..."}
  {"kind":"steps","steps":["...","...","..."]}
`.trim();

export function buildSessionSystemPrompt() {
  return SESSION_SYSTEM_PROMPT;
}

export function buildSessionUserPrompt(input: BuildSessionPromptInput) {
  const recentSessions =
    input.recentSessions.length === 0
      ? "<recent_sessions />"
      : [
          "<recent_sessions>",
          ...input.recentSessions.map((session, index) => {
            const steps = session.steps.map((step) => step.text).join(" | ");

            return [
              `  <session index="${index + 1}">`,
              `    <created_at>${session.createdAt}</created_at>`,
              `    <stuck_on>${escapeXml(session.stuckOn ?? "Unknown")}</stuck_on>`,
              `    <feedback>${session.feedback ?? "unknown"}</feedback>`,
              `    <steps>${escapeXml(steps || "No saved steps")}</steps>`,
              "  </session>",
            ].join("\n");
          }),
          "</recent_sessions>",
        ].join("\n");

  return [
    "<session_request>",
    `  <mode>${input.mode}</mode>`,
    `  <source>${input.source}</source>`,
    `  <energy_level>${input.energyLevel}</energy_level>`,
    `  <stuck_on>${escapeXml(input.stuckOn)}</stuck_on>`,
    input.clarifyingAnswer
      ? `  <clarifying_answer>${escapeXml(input.clarifyingAnswer)}</clarifying_answer>`
      : "  <clarifying_answer />",
    recentSessions,
    "  <decision_rules>",
    "    <rule>If the task is still ambiguous and no clarifying question has been asked yet, ask exactly one clarifying question.</rule>",
    "    <rule>If the user has already answered a clarification, do not ask another one.</rule>",
    "    <rule>If you can move forward, return 3 to 5 steps and make the first one extremely easy to begin.</rule>",
    "  </decision_rules>",
    "</session_request>",
  ].join("\n");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
