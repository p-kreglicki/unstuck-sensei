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

  it("falls back for unrecognized database errors", () => {
    expect(
      toDisplayError(
        {
          message:
            'insert or update on table "sessions" violates foreign key constraint "sessions_user_id_fkey"',
        },
        "fallback",
      ),
    ).toBe("fallback");
  });

  it("falls back for unrecognized infrastructure errors", () => {
    expect(
      toDisplayError(
        {
          message:
            "failed to connect to pg-pooler.internal.supabase.net: connection refused",
        },
        "fallback",
      ),
    ).toBe("fallback");
  });

  it("preserves allowlisted app messages", () => {
    expect(
      toDisplayError(
        { message: "Your session expired. Sign in again to continue." },
        "fallback",
      ),
    ).toBe("Your session expired. Sign in again to continue.");
  });

  it("preserves allowlisted app message patterns", () => {
    expect(
      toDisplayError(
        { message: "The coaching request failed with status 429." },
        "fallback",
      ),
    ).toBe("The coaching request failed with status 429.");
  });
});
