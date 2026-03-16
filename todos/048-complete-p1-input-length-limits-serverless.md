---
status: complete
priority: p1
issue_id: "048"
tags: [code-review, security, vercel-api]
dependencies: []
---

# No Input Length Limits on `stuckOn` and `clarifyingAnswer`

## Problem Statement

The `normalizeRequestBody` function in the Vercel API validates that `stuckOn` and `clarifyingAnswer` are strings but enforces no maximum length. A malicious client can send multi-megabyte payloads that inflate Anthropic API costs, abuse Supabase storage, and degrade LLM performance.

## Findings

- **Security Sentinel**: Rated HIGH. No length validation on any user-controlled string field.
- **Location**: `vercel-api/api/chat.ts` lines 388-423 (`normalizeRequestBody`)
- The `stuckOn` value flows directly into the Anthropic prompt (line 229) and is stored in `sessions.stuck_on` (TEXT, unconstrained).
- The `clarifyingAnswer` flows into the prompt and `sessions.clarifying_answer`.
- **Validation (2026-03-16)**: Confirmed against the current codebase. `normalizeRequestBody` only checks that `stuckOn` and `clarifyingAnswer` are strings, then trims them before forwarding them to `buildSessionUserPrompt`, with no max-length guard in the API route.
- **Validation (2026-03-16)**: The desktop UI also leaves both `<textarea>` fields unconstrained, but that does not materially reduce severity because the serverless endpoint accepts direct authenticated requests from a modified client.
- **Validation (2026-03-16)**: The Supabase schema still defines `sessions.stuck_on` and `sessions.clarifying_answer` as unconstrained `TEXT`, so there is no database backstop if the API keeps accepting oversized payloads.

## Proposed Solutions

### Option A: Server-side length validation in `normalizeRequestBody`
Add max length checks (e.g., 2000 chars for `stuckOn`, 1000 for `clarifyingAnswer`). Return null (400 error) if exceeded.
- **Pros**: Simple, fast, prevents abuse at the boundary
- **Cons**: None significant
- **Effort**: Small
- **Risk**: Low

### Option B: Server-side length validation + DB CHECK constraints
Same as A, plus add `CHECK (char_length(stuck_on) <= 2000)` in a migration.
- **Pros**: Defense in depth
- **Cons**: Requires a migration
- **Effort**: Small-Medium
- **Risk**: Low

## Recommended Action

Implemented: server-side API length validation, matching UI caps, and database `CHECK` constraints.

## Technical Details

- **Affected files**: `vercel-api/api/chat.ts`
- **Components**: Vercel serverless function
- **Database changes**: Optional CHECK constraint migration

## Acceptance Criteria

- [x] `normalizeRequestBody` rejects `stuckOn` longer than 2000 characters
- [x] `normalizeRequestBody` rejects `clarifyingAnswer` longer than 1000 characters
- [x] Returns 400 with clear error message on oversized input

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created from PR #9 code review | Security sentinel flagged as HIGH |
| 2026-03-16 | Re-validated against `vercel-api/api/chat.ts`, the session prompt builder, the session UI textareas, and the current Supabase migrations | Confirmed. The issue is server-side and reproducible by any authenticated caller; no length cap exists at the API, UI, or database layers. |
| 2026-03-16 | Implemented server-side length checks in `normalizeRequestBody`, added textarea `maxLength` caps, and added Supabase `CHECK` constraints for `sessions.stuck_on` and `sessions.clarifying_answer` | Resolved with defense in depth: the UI blocks oversized input, the API returns explicit 400 errors, and direct database writes are constrained as well. |

## Resources

- PR #9: feat(session): implement phase 3 core coaching flow
