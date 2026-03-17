import { formatError } from "./formatError";

describe("formatError", () => {
  it("returns the message from Error instances", () => {
    expect(formatError(new Error("boom"))).toBe("boom");
  });

  it("returns string errors as-is", () => {
    expect(formatError("boom")).toBe("boom");
  });

  it("falls back for unknown values", () => {
    expect(formatError({ message: "boom" })).toBe("Command failed.");
  });
});
