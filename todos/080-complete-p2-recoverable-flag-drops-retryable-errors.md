---
status: complete
priority: p2
issue_id: "080"
tags: [code-review, quality, reliability, vercel-api]
dependencies: []
---

# SSE recoverable flag drops non-Anthropic retryable errors

## Problem Statement

Commit `dba8936` changes the SSE `error` payload to derive `recoverable` only from `AnthropicRequestError.retryable`. That narrows the signal too far: `streamAnthropicResponse()` also throws plain `RetryableError` instances for transient failures such as an upstream stream ending before the structured payload arrives. Those failures can still be retryable, but the new code now reports them as `recoverable: false`.

This regresses the client contract from "retry when the server knows the failure is transient" to "retry only for one retryable subclass". If the UI uses `recoverable` to decide whether to offer or trigger retry behavior, users can be told a transient failure is terminal.

## Findings

- `vercel-api/api/chat.ts:307-310` now sets `recoverable` with `error instanceof AnthropicRequestError ? error.retryable : false`.
- `vercel-api/api/chat.ts:423-427` still throws a plain `RetryableError` when the Anthropic stream ends before the structured result arrives, with `retryable` derived from whether any bytes were streamed.
- `vercel-api/api/chat.ts:450-456` treats any `RetryableError` as retryable for the internal retry loop, confirming that retryability is intentionally broader than `AnthropicRequestError`.
- `vercel-api/tests/chat.test.ts:460-551` covers retryable Anthropic HTTP failures and non-retryable unexpected errors, but it does not cover the plain-`RetryableError` path introduced by the structured-output guard.
- Related known pattern: [todos/069-complete-p3-error-message-leak-streaming.md](/Users/piotrkreglicki/Projects/unstuck-sensei/todos/069-complete-p3-error-message-leak-streaming.md) deliberately separates sanitized client messaging from internal error detail. This commit preserved that, but narrowed the recoverability contract too far.

## Proposed Solutions

### Option 1: Derive from `RetryableError` instead of `AnthropicRequestError` (Recommended)

**Approach:** Change the SSE payload logic to use `error instanceof RetryableError ? error.retryable : false`.

**Pros:**
- Matches the existing retryability model already used inside `streamAnthropicResponse()`
- Fixes the regression without changing error-message sanitization
- Small, localized change

**Cons:**
- Keeps retryability encoded in an error-class hierarchy

**Effort:** Small

**Risk:** Low

---

### Option 2: Introduce an explicit helper like `isRecoverableError(error)`

**Approach:** Centralize the client-facing recoverability decision in one helper that understands all recoverable error shapes.

**Pros:**
- Makes the contract explicit and easier to extend
- Reduces future drift between internal retry behavior and SSE signaling

**Cons:**
- Slightly more code than the direct fix
- Still requires a regression test for the structured-output path

**Effort:** Small

**Risk:** Low

## Recommended Action

Use Option 1 unless there is an imminent broader cleanup planned for the streaming error model. Add a regression test that simulates a streamed response ending before the structured delimiter arrives and assert the SSE `error` event includes `"recoverable":true` when no client-visible bytes were emitted.

## Technical Details

**Affected files:**
- `vercel-api/api/chat.ts`
- `vercel-api/tests/chat.test.ts`

**Related components:**
- SSE client error handling for `/api/chat`
- Anthropic stream parser / structured-output guard

**Database changes:**
- Migration needed? No
- New columns/tables? No

## Resources

- **Commit under review:** `dba8936`
- **Relevant file:** `vercel-api/api/chat.ts`
- **Relevant test file:** `vercel-api/tests/chat.test.ts`
- **Related todo:** [todos/069-complete-p3-error-message-leak-streaming.md](/Users/piotrkreglicki/Projects/unstuck-sensei/todos/069-complete-p3-error-message-leak-streaming.md)

## Acceptance Criteria

- [x] SSE `recoverable` is derived from the full retryable error contract, not only `AnthropicRequestError`
- [x] A test covers the "structured result never arrived" failure path
- [x] The regression test asserts `recoverable: true` when that failure is retryable
- [x] Existing chat route tests still pass

## Work Log

### 2026-03-17 - Initial Discovery

**By:** Codex

**Actions:**
- Reviewed commit `dba8936` and the surrounding chat streaming error handling
- Compared the new SSE `recoverable` logic against the existing `RetryableError` hierarchy
- Verified that the structured-output guard still throws plain `RetryableError`
- Ran `npm test -- vercel-api/tests/chat.test.ts`
- Ran `./node_modules/.bin/tsc -p vercel-api/tsconfig.json`

**Learnings:**
- The commit fixes Anthropic-vs-generic error classification, but it regresses a separate retryable path that is not an `AnthropicRequestError`
- Current tests pass because they do not exercise the structured-output retryability path

### 2026-03-17 - Implemented fix and regression coverage

**By:** Codex

**Actions:**
- Updated `vercel-api/api/chat.ts` to derive SSE recoverability from `RetryableError`
- Added regression tests in `vercel-api/tests/chat.test.ts` for missing structured output before and after client-visible bytes are streamed
- Adjusted the retry-path test harness to return a fresh stream on each fetch attempt
- Ran `npm test -- vercel-api/tests/chat.test.ts`
- Ran `./node_modules/.bin/tsc -p vercel-api/tsconfig.json`

**Learnings:**
- The recoverability contract should follow the base retryable error model, not only the Anthropic-specific subclass
- Retried streaming tests must create a new `Response` body per fetch call because `ReadableStream` instances are single-consumer
