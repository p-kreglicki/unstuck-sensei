---
status: complete
priority: p2
issue_id: "100"
tags: [code-review, testing, timer]
dependencies: []
---

# Add test coverage for timer durability fallback and error paths

## Problem Statement

The `ensureCheckinDurable` function and `replayPendingSyncsPass` have untested branches that handle edge cases and error recovery. These are the paths most likely to regress silently since they only fire under failure conditions.

## Findings

- `useTimer.tsx:327-337` — `ensureCheckinDurable` fallback when no pending sync exists (calls `loadLatestTimerBlock` to get `ended_at`). No test covers this branch.
- `useTimer.tsx:431-501` — `replayPendingSyncsPass` mid-loop: if a DB call throws, already-processed sync IDs in `syncIdsToClear` are never cleared. Re-attempt relies on Supabase RPC idempotency (expected revision rejection). No test verifies this recovery.
- `useTimer.tsx:484-500` — `expire_checkin` sync kind in the replay loop. No test exercises this path.
- Security sentinel and TypeScript reviewer both flagged these gaps independently.

## Proposed Solutions

### Option 1: Add three targeted test cases (Recommended)

**Approach:** Add tests to `useTimer.test.tsx`:
1. `ensureCheckinDurable` returns fallback state when no pending sync matches
2. `replayPendingSyncsPass` recovers from a mid-loop DB error without losing unprocessed syncs
3. `expire_checkin` sync is correctly replayed

- **Pros:** Direct coverage of the riskiest untested paths
- **Cons:** Adds ~100 lines to test file
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria

- [x] Test: `ensureCheckinDurable` with no matching pending sync returns `{ endedAt, timerRevision }` from DB/fallback
- [x] Test: mid-loop error in `replayPendingSyncsPass` leaves unprocessed syncs intact for retry
- [x] Test: `expire_checkin` sync kind is replayed and runtime is cleared

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-21 | Created from code review of commit 8af9f81 | Flagged by security-sentinel and TypeScript reviewer |
| 2026-03-21 | Added targeted `useTimer.test.tsx` coverage for the fallback, retry-after-failure, and `expire_checkin` replay branches | The recovery path depends on RPC idempotency plus preserving uncleared syncs until a later successful pass; dedicated tests make that contract explicit |

## Resources

- Commit: 8af9f81
- `src/hooks/useTimer.tsx:308-373` (ensureCheckinDurable)
- `src/hooks/useTimer.tsx:375-515` (replayPendingSyncsPass)
- `src/hooks/useTimer.test.tsx`
