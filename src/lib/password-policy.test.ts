import { PASSWORD_MIN_LENGTH, validatePassword } from "./password-policy";

describe("validatePassword", () => {
  it("rejects passwords shorter than the minimum length", () => {
    expect(validatePassword("short")).toBe(
      `Use at least ${PASSWORD_MIN_LENGTH} characters for your password.`,
    );
  });

  it("accepts passwords that meet the minimum length", () => {
    expect(validatePassword("long-enough")).toBeNull();
  });
});
