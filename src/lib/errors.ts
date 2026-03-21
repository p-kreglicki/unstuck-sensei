const DATABASE_SETUP_MESSAGE =
  "Database setup is incomplete. Run the Supabase migrations for this project and retry.";

const SAFE_DISPLAY_ERROR_MESSAGES = new Set([
  "Rate limit reached. Take a breath, then try again soon.",
  "Save the task first, then try again.",
  "The coaching request could not be completed right now.",
  "The coaching request failed.",
  "The coaching request was canceled.",
  "The coaching service is busy right now. Try again soon.",
  "The coaching service is temporarily unavailable. Try again soon.",
  "The coaching stream ended before a result was returned.",
  "The coaching stream failed unexpectedly.",
  "The coaching stream failed.",
  "The server returned an invalid coaching result.",
  "Unauthorized. Sign in again and retry.",
  "Unable to start the chat right now.",
  "Your session expired. Sign in again to continue.",
]);

const SAFE_DISPLAY_ERROR_PATTERNS = [
  /^The coaching request failed with status \d+\.$/,
];

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

  if (message === fallbackMessage || isSafeDisplayMessage(message)) {
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

function isSafeDisplayMessage(message: string) {
  return (
    SAFE_DISPLAY_ERROR_MESSAGES.has(message) ||
    SAFE_DISPLAY_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  );
}
