// Keep this mirrored with src-tauri/src/timer/mod.rs until we introduce shared cross-runtime config.
export const CHECKIN_GRACE_HOURS = 12;

export function isCheckinGraceExpired(endedAt: string | null) {
  if (!endedAt) {
    return false;
  }

  return (
    Date.now() - new Date(endedAt).getTime() >= CHECKIN_GRACE_HOURS * 60 * 60 * 1000
  );
}
