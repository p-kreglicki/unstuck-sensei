---
status: complete
priority: p1
issue_id: "049"
tags: [code-review, security, vercel-api]
dependencies: []
---

# Rate Limiter Bypassable via Client-Side Counter

## Problem Statement

The rate limiter counts `assistant` messages in `conversation_messages`, but these messages are only inserted by the client-side code (`session-records.ts`). The serverless function never inserts a conversation message row. A modified client that skips `insertConversationMessage` can make unlimited Anthropic API requests, causing unbounded cost.

## Findings

- **Security Sentinel**: Rated HIGH. Rate limit is entirely client-honor-system based.
- **Location**: `vercel-api/api/chat.ts` lines 133-152 (scopedClient for rate limiting) and 363-386 (`checkRateLimit`)
- The server streams the Anthropic response but delegates message persistence to the client.
- A modified desktop client (or direct API call) can bypass the counter entirely.
- **Validation (2026-03-16)**: Confirmed against the current codebase. `checkRateLimit` counts `conversation_messages` rows with `role = 'assistant'`, but `handleChatRequest` never inserts such a row after a successful Anthropic response.
- **Validation (2026-03-16)**: Assistant-message persistence still happens in the desktop client via `commitStructuredResult` in `src/pages/Session.tsx`, which calls `insertConversationMessage` after the server request already completed.
- **Validation (2026-03-16)**: Because `conversation_messages` inserts are allowed via user-scoped RLS, a modified client can simply omit that insert and keep the server-side counter flat while continuing to call `/api/chat`.
- **Validation (2026-03-16)**: The serverless route does not validate ownership or existence of `sessionId` before making the Anthropic request, so a direct authenticated caller is not forced through any server-controlled write path that would increment the limiter.

## Proposed Solutions

### Option A: Server-side message insertion
After a successful Anthropic response, the serverless function inserts the `assistant` conversation message using an admin/service-role client. Remove client-side assistant message insertion.
- **Pros**: Rate limit becomes tamper-proof
- **Cons**: Requires service-role key on the server (currently avoided by design)
- **Effort**: Medium
- **Risk**: Medium (introduces service-role key dependency)

### Option B: Separate server-controlled counter
Create an `api_requests` table populated server-side on each successful chat request. Rate limit counts rows in that table instead of conversation_messages.
- **Pros**: No service-role key needed (can use scoped client with INSERT-only RLS policy). Clean separation of concerns.
- **Cons**: Additional table + migration
- **Effort**: Medium
- **Risk**: Low

### Option C: External rate limiting (Vercel KV / Upstash)
Use a KV store keyed by user ID with TTL-based counters.
- **Pros**: Fastest, no DB round-trip
- **Cons**: Additional infrastructure dependency
- **Effort**: Medium
- **Risk**: Low

## Recommended Action

Implemented: server-controlled quota reservation using a new `chat_request_logs` table and `consume_chat_rate_limit(...)` RPC, enforced before the Anthropic request starts.

## Technical Details

- **Affected files**: `vercel-api/api/chat.ts`, new Supabase migration
- **Components**: Vercel serverless function, Supabase schema

## Acceptance Criteria

- [x] Rate limit counter is incremented server-side, not client-side
- [x] A client that skips `insertConversationMessage` still gets rate-limited
- [x] Existing hourly (12) and daily (40) limits preserved

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created from PR #9 code review | Security sentinel flagged as HIGH |
| 2026-03-16 | Re-validated against `vercel-api/api/chat.ts`, the desktop session flow, and the current Supabase RLS policies | Confirmed. The limiter is keyed off client-written rows, so any authenticated caller that skips the client insert bypasses both hourly and daily caps. |
| 2026-03-16 | Added a server-controlled request log table, an atomic quota reservation RPC with a per-user advisory lock, and API-side enforcement before calling Anthropic | Resolved. The limiter no longer depends on client-persisted assistant messages, and direct authenticated callers cannot bypass it by omitting a follow-up insert. |

## Resources

- PR #9: feat(session): implement phase 3 core coaching flow
