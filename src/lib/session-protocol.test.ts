import { describe, expect, it } from "vitest";
import {
  createSessionSteps,
  isStructuredChatResponse,
  parseSessionSteps,
} from "../../shared/session/session-protocol.js";

describe("session protocol", () => {
  it("accepts a valid structured steps response", () => {
    expect(
      isStructuredChatResponse({
        assistantText: "Start here.",
        kind: "steps",
        steps: [{ id: "step-1", text: "Open the doc." }],
      }),
    ).toBe(true);
  });

  it("rejects responses without assistant text", () => {
    expect(
      isStructuredChatResponse({
        assistantText: "   ",
        kind: "clarifying_question",
        question: "What matters most?",
      }),
    ).toBe(false);
  });

  it("filters invalid saved steps before rehydrating state", () => {
    expect(
      parseSessionSteps([
        { id: "step-1", text: "Ship the draft" },
        { id: "", text: "Missing id" },
        { id: "step-3", text: "   " },
      ]),
    ).toEqual([{ id: "step-1", text: "Ship the draft" }]);
  });

  it("normalizes raw step strings into persisted steps", () => {
    expect(createSessionSteps([" Open the editor ", "", "Write the intro"])).toEqual([
      { id: "step-1", text: "Open the editor" },
      { id: "step-2", text: "Write the intro" },
    ]);
  });
});
