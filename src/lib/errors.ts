export function toDisplayError(error: unknown, fallbackMessage: string) {
  const message = readErrorMessage(error);

  if (!message) {
    return fallbackMessage;
  }

  if (
    /relation .* does not exist/i.test(message) ||
    /column .* does not exist/i.test(message)
  ) {
    return "Database setup is incomplete. Run the Supabase migrations for this project and retry.";
  }

  return message;
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
