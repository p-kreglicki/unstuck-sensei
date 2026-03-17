# feat: Unstuck Sensei Phase 3 — Core Session Flow

## Summary

Deliver Phase 3 of the desktop MVP by replacing the current session placeholder with the real coaching flow: stuck input, energy check, one optional clarification, streamed AI decomposition, step reordering, retry, and final confirmation. This phase still stops at step confirmation, not timer start, so Phase 4 remains the owner of the production timer.

Carry forward the March 12, 2026 brainstorm decisions: warm peer tone, no productivity jargon, one-screen-at-a-time flow, one clarifying question max, 3-5 concrete micro-steps, and recent-session memory for returning users (see [brainstorm](/Users/piotrkreglicki/Projects/unstuck-sensei/docs/brainstorms/2026-03-12-unstuck-sensei-mvp-brainstorm.md)).

## Interfaces

- Keep the main session route at `/`; do not introduce `/session`.
- Add a hosted `POST /api/chat` endpoint in `vercel-api` using `fetch()` streaming with `Content-Type: text/event-stream`, consumed by `fetch` + manual stream parsing in the client.
  - Do not assume browser `EventSource`; the client must send `Authorization` and use `POST`.
  - Emit real SSE frames with named events:
    - `event: text-delta`
    - `event: structured`
    - `event: error`
    - `event: done`
  - Request body:
    - `{ sessionId, mode: "initial" | "clarification" | "retry", stuckOn, energyLevel, clarifyingAnswer?, source: "manual" | "detection" | "email" }`
  - Final `structured` payload is exactly one of:
    - `{ kind: "clarifying_question", question, assistantText }`
    - `{ kind: "steps", steps: [{ id: string, text: string }], assistantText }`
- Add a frontend chat hook contract:
  - `useChat({ sessionId })` exposes `sendInitial`, `sendClarification`, `retry`, `cancel`, `state`
  - `state` tracks `stage`, `streamingText`, `finalAssistantText`, `structuredResult`, `error`, `isStreaming`
- Add a Rust-to-frontend navigation bridge via a Tauri event, not deep links:
  - Rust emits `app:navigate` with payload `{ to: "/" | "/settings", source?: "tray" | "detection" }`
  - React listens once near the app root and calls router navigation
- Canonical `sessions.steps` application shape is an ordered JSON array of `{ id: string, text: string }`.
  - This phase does not require a DB migration unless implementation adds a check constraint later.
  - Enforce the shape in TypeScript parsing/validation before writes.
- `conversation_messages.content` stores only human-readable transcript text.
  - Structured flow state is reconstructed from `sessions` fields plus transcript text, not from replaying stored envelopes.
- Phase 3 deploy env:
  - `ANTHROPIC_API_KEY`
  - `ANTHROPIC_MODEL`
  - `SUPABASE_URL`
  - `SUPABASE_PUBLISHABLE_KEY`

## Implementation Changes

- Proxy and auth:
  - Build `vercel-api/api/chat/route.ts` as a Node runtime streaming function.
  - Require `Authorization: Bearer <supabase access token>`.
  - Verify the token with Supabase, then create a user-scoped Supabase client via `accessToken`; do not use `SUPABASE_SERVICE_ROLE_KEY` in this phase.
  - Load up to 3 recent session summaries for context: `stuck_on`, `energy_level`, `steps`, `feedback`, `created_at`.
  - Rate limit by user from existing data, not a new table: assistant message count over rolling windows, default `12/hour` and `40/day`.
- Prompt strategy:
  - Introduce `src/lib/prompts/session.ts` as the single prompt source for Phase 3.
  - Use one explicit Anthropic prompt format: XML-tagged sections for context and rules, with a required terminal structured block that the proxy parses.
  - The prompt must enforce:
    - warm peer tone
    - no productivity jargon
    - one clarifying question maximum
    - either a clarification result or a 3-5 step result, never both
    - step text short enough for an in-app checklist
  - The proxy parses the terminal structured block and separately streams the human-readable assistant copy.
- Streaming behavior:
  - The proxy forwards incremental assistant text as `text-delta` SSE frames.
  - When the model completes, the proxy emits one `structured` frame, then one `done` frame.
  - Retry exactly once only if zero bytes have been written to the client response stream yet.
  - If upstream fails after any client-visible bytes are sent, emit `error` and stop; do not retry.
- Client-side streaming:
  - `useChat` reads the response body with `ReadableStream.getReader()`, buffers partial chunks, splits complete SSE frames, and dispatches by `event` type.
  - `text-delta` appends to `streamingText`.
  - `structured` validates the final payload shape and commits it to state.
  - `done` flips `isStreaming` false.
  - Interrupted streams keep already-saved session data intact, preserve visible streamed text, and show a retry action for the current turn.
- Session persistence:
  - Create or update the `sessions` row once the user commits `stuck_on`.
  - Save `energy_level` before the first model call.
  - Save `clarifying_question`, `clarifying_answer`, `steps`, and transcript turns as they occur.
  - Persist reordered `steps` immediately.
  - On `retry`, overwrite `sessions.steps` with the latest valid step set but keep prior human-readable transcript messages.
  - Resume the most recent active pre-timer session on reload instead of silently starting a fresh draft.
- UI flow:
  - Replace the `/` placeholder with the real `Session.tsx` stage flow and session subcomponents.
  - Keep detection-launched sessions sourced as `detection`; tray start uses `manual`.
  - Show a short returning-user reminder on the opening screen using recent sessions already loaded client-side.
  - End with a confirmation state such as “I know my first step,” not timer start.

## Test Plan

- Add JS test tooling in this phase: `vitest` for proxy/client logic and React Testing Library for session flow rendering.
- Proxy tests:
  - rejects missing or invalid JWT
  - uses user-scoped Supabase access, not service-role access
  - emits valid SSE frames in the expected order
  - parses both final structured shapes correctly
  - retries only when zero bytes have been written to the client stream
  - returns `429` on rate-limit breach
  - surfaces malformed or incomplete model output as a terminal error
- Frontend tests:
  - initial path with no clarification
  - clarification path with exactly one follow-up
  - detection-launched session source and prefill behavior
  - resume of an existing active draft
  - `retry` replaces visible steps but keeps transcript history
  - reorder persists and survives refresh
  - interrupted stream preserves saved state and exposes retry affordance
  - returning-user reminder renders when recent sessions exist and stays hidden when they do not
  - root-level `app:navigate` listener routes tray actions to `/` and `/settings`
- Manual smoke:
  - tray “Start Session” opens the session flow
  - tray “Settings” routes to settings
  - detection nudge still routes into the session flow
  - streamed assistant text appears progressively in Tauri dev mode

## Assumptions

- Phase 3 remains timer-free by design; Phase 4 owns countdown, completion, and extension behavior.
- `vercel-api` stays colocated in this repo and is deployed as a separate Vercel project.
- The brainstorm’s March 12, 2026 model label is intent, not a hardcoded slug; use `ANTHROPIC_MODEL` so deploy config can track Anthropic’s current naming.
- `sessions.steps` shape is enforced at the application boundary in Phase 3; DB-level JSON shape constraints are optional follow-up work, not required for this phase.
- Human-readable `conversation_messages` are sufficient because retry/context depend on `sessions` structured fields plus transcript text, not envelope replay.
- The parent plan’s older `SUPABASE_SERVICE_ROLE_KEY` Phase 3 env note should be treated as superseded by this scoped-auth design.

## Sources

- Internal: [brainstorm](/Users/piotrkreglicki/Projects/unstuck-sensei/docs/brainstorms/2026-03-12-unstuck-sensei-mvp-brainstorm.md), [parent plan](/Users/piotrkreglicki/Projects/unstuck-sensei/docs/plans/2026-03-14-feat-unstuck-sensei-tauri-desktop-mvp-plan.md)
- Anthropic streaming: [docs](https://platform.claude.com/docs/fr/build-with-claude/streaming)
- Anthropic prompt structuring: [XML tags](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags), [consistency](https://docs.anthropic.com/en/docs/test-and-evaluate/strengthen-guardrails/increase-consistency)
- Supabase JWT verification and scoped clients: [getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims), [JWT guide](https://supabase.com/docs/guides/auth/jwts)
- Vercel streaming functions: [docs](https://vercel.com/docs/functions/streaming-functions)
