---
status: complete
priority: p2
issue_id: "085"
tags: [code-review, quality, vercel-api, ux]
dependencies: []
---

# Raw Anthropic error messages now reach end users via exposeMessage

## Problem Statement

The removal of `normalizeAnthropicError` means raw Anthropic API error messages now flow through to end users via the `exposeMessage: true` flag on `createAnthropicError`. Some Anthropic error messages are not user-friendly (e.g., `"model: claude-3-5-haiku-latest"` for an invalid model request).

However, there is a counterargument: the **old** normalized messages leaked deployment internals to users — strings like `"Check ANTHROPIC_API_KEY and ANTHROPIC_MODEL"` exposed environment variable names. The raw Anthropic messages (e.g., `"You do not have access to this model"`) are arguably more appropriate for users, and the new `logContext` captures all debugging info operators need in structured log fields.

## Findings

- `vercel-api/api/chat.ts` `createAnthropicError` sets `exposeMessage: true` with `parsed.message` (raw Anthropic error text).
- `formatServerError` at line 935 forwards the message to the client when `exposeMessage === true`.
- The old `normalizeAnthropicError` mapped known error patterns to deployment guidance, but those messages contained env var names — not suitable for users either.
- Identified by: architecture-strategist, kieran-typescript-reviewer, pattern-recognition-specialist. Counter-argued by: code-simplicity-reviewer, security-sentinel.

## Proposed Solutions

### Option 1: Add a simple user-facing fallback for non-user-friendly messages (Recommended)

**Approach:** In `formatServerError`, wrap exposed messages with a sanitizer that catches known unhelpful patterns (e.g., messages that reference model IDs without context) and replaces them with a generic message like "The coaching service encountered an error. Try again in a moment."

- **Pros:** Best of both worlds — user-friendly messages, no env var leaks.
- **Cons:** Adds ~10 lines of code.
- **Effort:** Small.
- **Risk:** Low.

### Option 2: Keep as-is

**Approach:** Accept raw Anthropic messages. They are generally readable and the old normalization had its own problems (env var leaks).

- **Pros:** Simpler. Raw Anthropic messages are mostly fine.
- **Cons:** Some edge-case messages may confuse users.
- **Effort:** None.
- **Risk:** Low — only affects rare API configuration errors.

## Technical Details

- **Affected files:** `vercel-api/api/chat.ts`

## Acceptance Criteria

- [x] End users never see env var names or raw model identifiers in error messages
- [x] Operators still get full error context in structured logs

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-18 | Created from PR #16 code review | Balance between user-friendly messages and not leaking deployment internals |
| 2026-03-21 | Validated against current `vercel-api/api/chat.ts` implementation and closed as resolved by later changes | User-facing Anthropic failures now go through `userMessageForAnthropicError()`, while raw provider detail is retained only in structured log context |

## Resources

- PR: https://github.com/p-kreglicki/unstuck-sensei/pull/16
