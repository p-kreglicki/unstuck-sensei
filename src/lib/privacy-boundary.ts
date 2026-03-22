/*
 * Phase 5 privacy boundary source of truth.
 * Covered features: desktop focus detection, session coaching flow, timer/check-in persistence,
 * profile settings, and account/privacy screens.
 * If a future feature changes what the app tracks or transmits, update this file and the UIs
 * that import it before shipping.
 */

export const privacyBoundary = {
  neverCollected: [
    "App names as durable telemetry",
    "URLs",
    "Keystrokes",
    "Screenshots",
    "Clipboard contents",
  ],
  sentToServer: [
    "Session text",
    "Clarifying answers",
    "AI responses",
    "Timer and check-in metadata",
    "Settings and profile preferences",
  ],
  trackedLocally: [
    "App switch count",
    "Idle time",
    "Runtime detection state like paused, cooldown, or active",
    "Meeting-app suppression signal kept in memory only",
  ],
} as const;

export const privacyBoundaryIntro =
  "Unstuck Sensei watches for friction signals on your device, then only sends the coaching and settings data it needs to help you.";
