const DATABASE_SETUP_MESSAGE =
  "Database setup is incomplete. Run the Supabase migrations for this project and retry.";
const DISPLAYABLE_ERROR_FLAG = "displayable";

type DisplayableError = Error & {
  displayable: true;
};

export function createDisplayError(message: string): DisplayableError {
  return Object.assign(new Error(message), {
    [DISPLAYABLE_ERROR_FLAG]: true as const,
  });
}

export function toDisplayError(error: unknown, fallbackMessage: string) {
  const message = readErrorMessage(error);

  if (!message) {
    return fallbackMessage;
  }

  if (
    /relation .* does not exist/i.test(message) ||
    /column .* does not exist/i.test(message)
  ) {
    return DATABASE_SETUP_MESSAGE;
  }

  if (message === fallbackMessage || isDisplayError(error)) {
    return message;
  }

  return fallbackMessage;
}

function readErrorMessage(error: unknown) {
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    return error.message.trim();
  }

  return null;
}

function isDisplayError(error: unknown): error is DisplayableError {
  return (
    error instanceof Error &&
    DISPLAYABLE_ERROR_FLAG in error &&
    error.displayable === true
  );
}
