---
status: resolved
priority: p1
tags: [security, rate-limiting, input-validation, rust, concurrency, sse, vercel-api, supabase, phase-3]
related_issues: ["048", "049", "062", "068", "078", "080", "081"]
related_prs: [12, 13, 14, 15]
resolved_date: 2026-03-17
modules: [vercel-api, src-tauri/detection, shared/session]
---

# Phase 3 P1: Chat API Security & Detection Reliability Hardening

Four P1 issues and one closely related P2 regression were discovered and resolved during Phase 3 core session flow implementation. Three are security vulnerabilities in the Vercel chat API, one is a concurrency bug in the Rust detection layer, and one is an SSE contract regression.

All fixes shipped in PRs #12-#14, merged to main as of commit `35181ae` (2026-03-17).

---

## Issue #048: No Input Length Limits on `stuckOn` and `clarifyingAnswer`

### Symptom

The `POST /api/chat` endpoint accepted arbitrary-length strings for `stuckOn` and `clarifyingAnswer`. A modified client could send multi-megabyte payloads, inflating Anthropic API token costs, abusing Supabase TEXT column storage, and degrading LLM output quality.

### Root Cause

`normalizeRequestBody()` validated types but not lengths. The desktop UI had `maxLength` on textareas, but direct API calls bypassed this entirely. No database CHECK constraints existed either.

### Solution (commit `e9949b1`)

Defense-in-depth across three layers:

**Layer 1 — Shared constants** (`shared/session/session-input-limits.ts`):
```typescript
export const STUCK_ON_MAX_LENGTH = 2000;
export const CLARIFYING_ANSWER_MAX_LENGTH = 1000;
```

**Layer 2 — API validation** (`vercel-api/api/chat.ts`):
```typescript
if (stuckOn.length > STUCK_ON_MAX_LENGTH) {
  return { kind: "error", message: `stuckOn must be ${STUCK_ON_MAX_LENGTH} characters or fewer.` };
}
```

**Layer 3 — Database backstop** (migration `202603160002`):
```sql
ALTER TABLE sessions ADD CONSTRAINT sessions_stuck_on_length
  CHECK (char_length(stuck_on) <= 2000);
ALTER TABLE sessions ADD CONSTRAINT sessions_clarifying_answer_length
  CHECK (char_length(clarifying_answer) <= 1000);
```

### Prevention

- Define input limits as shared constants imported by UI, API, and referenced in migrations.
- In Tauri apps the desktop client is untrusted — validate in the Vercel API layer, not just the React UI.
- Add database CHECK constraints as a final backstop for all user-facing TEXT columns.

---

## Issue #049: Rate Limiter Bypassable via Client-Side Counter

### Symptom

Rate limiting counted `assistant` rows in `conversation_messages`. These rows were only inserted by the desktop client after receiving a response. A modified client that skipped `insertConversationMessage()` could make unlimited Anthropic API calls — unbounded cost exposure.

### Root Cause

The server made the Anthropic request but delegated message persistence to the untrusted desktop client. The rate limit check (`checkRateLimit`) queried client-persisted data, creating a client-honor-system for cost control.

### Solution (commits `e9949b1`, `42c3486`, `dba8936`)

Replaced with a server-controlled `chat_request_logs` table and `consume_chat_rate_limit()` RPC:

1. Server calls `consume_chat_rate_limit(session_id)` before any Anthropic request.
2. The function uses `pg_advisory_xact_lock` to serialize per-user quota checks.
3. If under limit, it atomically inserts a log row and returns `allowed`.
4. If over limit, it returns `rate_limited` and the API responds 429.
5. Limits (12/hour, 40/day) are hardcoded constants inside the function.

Client-side message persistence is now decoupled from rate enforcement entirely.

### Prevention

- Couple the rate check atomically with the expensive operation (advisory lock + INSERT before Anthropic call).

---

## Issue #062: RPC Rate Limit Parameters Client-Controllable

### Symptom

`consume_chat_rate_limit(input_session_id, input_hourly_limit, input_daily_limit)` accepted limit thresholds as parameters. Since the function was `GRANT EXECUTE TO authenticated`, any user could call it directly via PostgREST with `input_hourly_limit = 999999`, completely bypassing rate enforcement.

### Root Cause

The initial implementation passed limits as parameters for future configurability. This turned a server-enforced policy into a client-suggested preference. The Vercel API passed correct values, but the RPC was callable directly.

### Solution (commits `42c3486`, `dba8936`, `8b25e7c`)

Migration `202603170002` replaced the function signature:

```sql
-- Before: client-controllable
CREATE FUNCTION consume_chat_rate_limit(
  input_session_id UUID, input_hourly_limit INTEGER, input_daily_limit INTEGER
) ...

-- After: hardcoded constants
CREATE FUNCTION consume_chat_rate_limit(input_session_id UUID) ...
DECLARE
  hourly_limit CONSTANT INTEGER := 12;
  daily_limit  CONSTANT INTEGER := 40;
```

Added explicit permission boundaries:
```sql
REVOKE ALL ON FUNCTION consume_chat_rate_limit(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_chat_rate_limit(UUID) TO authenticated;
```

### Prevention

- Code review checklist: for every RPC parameter, ask "can a direct PostgREST caller abuse this?"

---

## Issue #078: Mutex Poison Never Cleared in Detection Layer

### Symptom

After a panic in the Rust detection runtime, the `std::sync::Mutex<DetectionState>` stayed permanently poisoned. The recovery helper rebuilt state on each lock acquisition, but because `clear_poison()` was never called, every subsequent lock re-ran recovery — repeatedly wiping timers, nudge state, and app-switch history.

### Root Cause

The recovery helper received a `PoisonError<MutexGuard>`, which gives access to the inner data but not the mutex itself. Without access to the mutex, it couldn't call `Mutex::clear_poison()`. The fix appeared to work because the first recovery succeeded, but the poison bit remained set.

### Solution (commit `e512bea`)

Changed the helper to accept the mutex reference directly:

```rust
fn recover_detection_state_lock(
    mutex: &Mutex<DetectionState>,
) -> MutexGuard<DetectionState> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            let mut guard = poisoned.into_inner();
            *guard = DetectionState::from_config(/* ... */);
            mutex.clear_poison();
            guard
        }
    }
}
```

All command/tray/platform entry points now use this centralized helper. Tests verify that the second lock acquisition after recovery returns `Ok(...)`.

### Prevention

- Pass the mutex itself to recovery helpers so `clear_poison()` is callable — the poisoned guard alone isn't enough.

---

## Issue #080 (P2): SSE Recoverable Flag Regression

### Symptom

After commit `dba8936`, the SSE `error` payload derived `recoverable` only from `AnthropicRequestError.retryable`. Plain `RetryableError` instances (for example, stream ended before structured output delimiter) were marked `recoverable: false`, causing the client to hide the retry button for transient failures.

### Root Cause

The error class hierarchy (`RetryableError` base -> `AnthropicRequestError` subclass) was correct for internal retry logic, but the SSE signaling code checked `instanceof AnthropicRequestError` instead of `instanceof RetryableError`. This narrowed the client-facing signal to only Anthropic HTTP errors, missing application-level retryable failures.

### Solution (commit `4ce54a4`)

Changed the SSE payload to derive `recoverable` from the base `RetryableError` class:

```typescript
// Before: only AnthropicRequestError
recoverable: error instanceof AnthropicRequestError && error.retryable

// After: all RetryableError subclasses
recoverable: error instanceof RetryableError && error.retryable
```

### Prevention

- Add a unit test for each error subclass that asserts the SSE `recoverable` field value — this catches hierarchy regressions automatically.

---

## Cross-Cutting Lessons

### For Supabase RPC Functions
- Every parameter is client-controllable via PostgREST. Treat RPC functions as public API endpoints.
- Hardcode security policy inside the function. If limits must be configurable, use an admin-only table.
- Always pair with explicit `REVOKE/GRANT`.

### For Vercel Streaming APIs
- Separate internal retry decisions from client-facing recoverability signals.
- Server must own all security-critical state (rate counters, quotas). Never depend on client persistence.
- Validate inputs at the API boundary before any business logic or external calls.

### For Rust Shared State
- Mutex poison recovery must clear the poison bit, not just reconstruct data.
- Test recovery completeness by verifying the second lock, not just the first.

### General Pattern

These issues share a root theme: implementation details became implicit security/reliability contracts. Parameter names, client persistence, error class hierarchies, and mutex guard types all silently defined system behavior in ways that diverged from intent. The fix in every case was making the contract explicit: hardcoded constants, server-controlled counters, base-class checks, and `clear_poison()` calls.

---

## Remaining Gaps

GAP 1 (`sessionId` UUID validation) was resolved in follow-up work on 2026-03-18 via the API-side UUID check tracked by issue `068`. The remaining gaps below are the still-open follow-ups from this postmortem.

| ID | Finding | Severity |
|----|---------|----------|
| GAP 2 | `release_chat_rate_limit_reservation` callable by any authenticated user — a client can delete its own pending log rows to reset the rate counter | Medium |
| GAP 3 | Dead INSERT RLS policy on `chat_request_logs` — unused surface area since `SECURITY DEFINER` function handles all inserts | Low |
| GAP 4 | `consume_chat_rate_limit` uses `SECURITY DEFINER` to allow cleanup `DELETE` of expired reservations; this escalation is intentional (function still checks `auth.uid()` internally and locks `search_path`) but undocumented in migrations | Informational |
