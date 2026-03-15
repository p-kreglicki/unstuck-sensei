---
status: complete
priority: p2
issue_id: "006"
tags: [code-review, performance, database, rls]
dependencies: []
---

# Validate `conversation_messages` RLS Performance Before Denormalizing

## Problem Statement

The `conversation_messages` table currently authorizes access by checking whether each row's `session_id` belongs to one of the current user's sessions. That policy shape may be acceptable for Phase 1, but if message volume grows it could become a hotspot. The current todo should focus on validating that risk before introducing a denormalized `user_id` column.

## Findings

**From: performance-oracle, triage review**

1. **The current policy is a real join-style access check, but not the specific build issue originally claimed** — `conversation_messages` policies use `session_id IN (SELECT id FROM public.sessions WHERE user_id = auth.uid())`.
   - Location: `supabase/migrations/202603150001_phase1_foundation.sql`, lines 106-125
   - This is worth monitoring as data grows, but it is not enough on its own to justify duplicating `user_id` onto the table.

2. **The original Safari build-target recommendation was invalid** — `vite.config.ts` targets `safari13`, and that aligns with Tauri's currently supported macOS Catalina baseline. Raising the target would be a product-support decision, not a free optimization.
   - Location: `vite.config.ts`, line 28
   - Conclusion: remove build-target changes from this todo unless the app first raises its minimum supported macOS version.

## Proposed Solutions

### Option A: Measure Current Policy Cost First (Recommended)

1. Keep the existing `conversation_messages` schema and RLS policies unchanged for now.
2. Add a short verification note or benchmark plan covering expected message volumes and the policy query shape.
3. Revisit denormalization only if local profiling, `EXPLAIN`, or production evidence shows the current policy is a bottleneck.

**Pros:** Avoids premature schema duplication, keeps data model simpler
**Cons:** Does not proactively optimize a path that may matter later
**Effort:** Small
**Risk:** Low

### Option B: Denormalize `user_id` If Evidence Shows RLS Cost Is Material

If profiling demonstrates a real bottleneck:

1. Add `user_id` to `conversation_messages`
2. Backfill or populate it on insert
3. Add an index on `user_id`
4. Update RLS policies to use direct `user_id = (SELECT auth.uid())` checks
5. Regenerate `database.types.ts`

**Pros:** Simpler policy predicates if needed at scale
**Cons:** Duplicated ownership data and additional integrity surface
**Effort:** Medium
**Risk:** Medium

## Recommended Action

Keep the current normalized schema and use the validation plan in `docs/plans/2026-03-15-conversation-messages-rls-validation.md` before proposing denormalization.

## Technical Details

- **Affected files:** `supabase/migrations/202603150001_phase1_foundation.sql`
- **Explicitly not in scope:** `vite.config.ts` build target changes without a separate platform-support decision

## Acceptance Criteria

- [x] The todo no longer recommends raising the Safari build target without changing supported macOS versions
- [x] There is a clear validation plan for whether `conversation_messages` RLS is actually a performance problem
- [x] Any future denormalization proposal is gated on measured evidence, not assumption

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-15 | Created from code review of PR #1 | Performance + data integrity agents both flagged the subquery pattern |
| 2026-03-15 | Triage: removed invalid build-target recommendation and narrowed the database concern to evidence-driven validation | Support-matrix changes and schema denormalization both need stronger justification than speculative optimization |
| 2026-03-15 | Resolved by adding a concrete RLS validation plan and closing the todo without changing schema or build targets | The right fix here is better decision discipline, not immediate optimization |

## Resources

- PR: https://github.com/p-kreglicki/unstuck-sensei/pull/1
- Supabase RLS performance guidance: https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
- Validation plan: `docs/plans/2026-03-15-conversation-messages-rls-validation.md`
