import { describe, expect, it } from "vitest";
import {
  buildSessionSystemPrompt,
  buildSessionUserPrompt,
} from "../../shared/session/session-prompts.js";
import { STRUCTURED_RESPONSE_DELIMITER } from "../../shared/session/session-protocol.js";

describe("session prompts", () => {
  it("keeps the structured response delimiter in the system prompt", () => {
    expect(buildSessionSystemPrompt()).toContain(STRUCTURED_RESPONSE_DELIMITER);
  });

  it("escapes user content when building the session prompt", () => {
    expect(
      buildSessionUserPrompt({
        energyLevel: "medium",
        mode: "initial",
        recentSessions: [
          {
            createdAt: "2026-03-17T09:00:00.000Z",
            feedback: "somewhat",
            steps: [{ id: "step-1", text: "Write <draft>" }],
            stuckOn: "Ship & announce",
          },
        ],
        source: "manual",
        stuckOn: "Fix <landing> & launch",
      }),
    ).toContain("&lt;landing&gt; &amp; launch");
  });
});
