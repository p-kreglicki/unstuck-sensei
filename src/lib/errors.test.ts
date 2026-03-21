import { toDisplayError } from "./errors";

describe("toDisplayError", () => {
  it("sanitizes missing relation errors", () => {
    expect(
      toDisplayError(
        { message: 'relation "public.sessions" does not exist' },
        "fallback",
      ),
    ).toBe(
      "Database setup is incomplete. Run the Supabase migrations for this project and retry.",
    );
  });

  it("sanitizes missing column errors", () => {
    expect(
      toDisplayError(
        { message: 'column "feedback" does not exist' },
        "fallback",
      ),
    ).toBe(
      "Database setup is incomplete. Run the Supabase migrations for this project and retry.",
    );
  });

  it("returns the fallback when no message exists", () => {
    expect(toDisplayError({}, "fallback")).toBe("fallback");
  });

  it("returns other messages unchanged", () => {
    expect(
      toDisplayError(
        { message: "Unable to save your draft session." },
        "fallback",
      ),
    ).toBe("Unable to save your draft session.");
  });
});
