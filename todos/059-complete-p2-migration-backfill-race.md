---
status: complete
priority: p2
issue_id: "059"
tags: [code-review, database, migration]
dependencies: []
---

# Race Between NULL Backfill and NOT NULL Constraint Addition

## Problem Statement

The repair migration backfills NULL timestamps before adding NOT NULL constraints, but the DEFAULT is set in the same ALTER statement as NOT NULL. A concurrent INSERT between the backfill UPDATE and the ALTER could insert a NULL value if the column has no DEFAULT yet, causing the ALTER to fail.

## Findings

- **Data Integrity Guardian**: Rated MODERATE. Very low risk for early-stage app with few concurrent users, but trivially fixable.
- **Location**: `supabase/migrations/202603160001_repair_foundation_schema_drift.sql` lines 7-19 (profiles), 75-87 (sessions), 144-150 (conversation_messages)
- Pattern: UPDATE NULLs → ALTER SET DEFAULT + SET NOT NULL (should be: SET DEFAULT → UPDATE NULLs → SET NOT NULL)

## Proposed Solutions

Reorder operations: set DEFAULT first, backfill NULLs second, add NOT NULL third.

```sql
ALTER TABLE public.profiles ALTER COLUMN created_at SET DEFAULT NOW();
UPDATE public.profiles SET created_at = NOW() WHERE created_at IS NULL;
ALTER TABLE public.profiles ALTER COLUMN created_at SET NOT NULL;
```

- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [x] DEFAULT is set before backfill runs
- [x] NOT NULL is set after backfill completes
- [x] No window where concurrent INSERTs could insert NULLs

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created from PR #10 code review | Data integrity guardian flagged |
| 2026-03-17 | Reordered the repair migration so `SET DEFAULT` happens before each timestamp backfill and `SET NOT NULL` happens after | Resolved in `profiles`, `sessions`, and `conversation_messages`. This closes the concurrent-insert window the todo described. |

## Resources

- PR #10: feat(session): add phase 3 core coaching flow
