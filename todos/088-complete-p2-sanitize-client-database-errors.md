---
status: complete
priority: p2
issue_id: "088"
tags: [code-review, quality, ux, security, supabase]
dependencies: []
---

# Sanitize client-side database errors before showing them to users

## Problem Statement

`src/lib/errors.ts` currently wraps raw Supabase schema errors in a friendlier prefix, but still includes the original database error text verbatim in the user-visible message. That leaks internal schema details like table and column names to end users, which is inconsistent with the sanitization policy now used on the hosted chat API.

This is lower-risk than the server-side leak because the app is desktop-only and the error originates in the local client flow, but it still exposes implementation details that are not helpful to users and make the product feel unfinished.

## Findings

- `src/lib/errors.ts` matches `relation .* does not exist` and `column .* does not exist`, then returns `Database setup is incomplete. ${message} Run the Supabase migrations for this project and retry.` — preserving the raw schema error text.
- `src/hooks/useSessionFlow.ts` uses `toDisplayError()` for multiple session flows, so the current leak affects load, save, refine, retry, and reorder failure paths.
- `src/pages/Session.test.tsx` currently asserts the leaked schema name is rendered to the user, so the current behavior is intentional in tests and will need to be updated alongside any fix.
- PR 18 review comment identified the inconsistency with the server-side sanitization principle introduced for Anthropic and streaming failures.

## Proposed Solutions

### Option 1: Replace raw schema errors with stable user-facing copy (Recommended)

**Approach:** Update `toDisplayError()` to map schema/setup failures to a generic message such as `Database setup is incomplete. Run the Supabase migrations for this project and retry.` without appending the original database error text.

- **Pros:** Aligns client and server sanitization policy, removes schema-name leakage, keeps actionable guidance.
- **Cons:** Slightly less specific for developers diagnosing local setup issues from the UI alone.
- **Effort:** Small.
- **Risk:** Low.

### Option 2: Keep raw details in dev only

**Approach:** Return sanitized copy in production builds but preserve raw schema details behind `import.meta.env.DEV`.

- **Pros:** Better local debugging ergonomics.
- **Cons:** Introduces environment-conditional messaging and still leaves two behaviors to maintain and test.
- **Effort:** Small.
- **Risk:** Low.

## Recommended Action

Adopt Option 1 unless local debugging becomes materially harder. The UI should show stable product copy, and debugging detail can come from console logs or developer tools instead of end-user banners.

## Technical Details

- **Affected files:** `src/lib/errors.ts`, `src/hooks/useSessionFlow.ts`, `src/pages/Session.test.tsx`
- **Related pattern:** `vercel-api/api/chat.ts` now separates sanitized user messages from provider-specific detail kept in logs.

## Resources

- PR review context: PR #18 comment 2
- Related todo: [085-pending-p2-raw-anthropic-errors-exposed-to-users.md](/Users/piotrkreglicki/Projects/unstuck-sensei/todos/085-pending-p2-raw-anthropic-errors-exposed-to-users.md)
- Related completed work: [069-complete-p3-error-message-leak-streaming.md](/Users/piotrkreglicki/Projects/unstuck-sensei/todos/069-complete-p3-error-message-leak-streaming.md)

## Acceptance Criteria

- [x] User-visible database setup errors no longer include raw relation or column names
- [x] Session flows still show actionable guidance when local schema/setup is incomplete
- [x] Tests are updated to assert sanitized copy instead of leaked schema details

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-18 | Created from PR #18 review follow-up | No existing open todo tracked the client-side leak; current tests explicitly lock in the leaked schema-name behavior |
| 2026-03-21 | Sanitized setup/schema errors in `toDisplayError()`, added direct unit coverage, and updated the session UI assertion | The actionable guidance survives without leaking relation or column names; the helper is the right single point to enforce that policy |
