---
status: complete
priority: p2
issue_id: "058"
tags: [code-review, database, migration]
dependencies: []
---

# Repair Migration Creates Duplicate CHECK Constraints

## Problem Statement

When `202603160001_repair_foundation_schema_drift.sql` runs after a clean Phase 1 foundation migration, it creates duplicate CHECK constraints. The foundation migration creates unnamed constraints (Postgres auto-names them like `profiles_display_name_check`), while the repair migration checks for explicitly named versions (`profiles_display_name_length_check`). The `IF NOT EXISTS` lookup by name misses the auto-generated constraint, creating a functionally identical duplicate.

## Findings

- **Data Integrity Guardian**: Rated MODERATE. Duplicate constraints are wasteful and make future migrations harder to reason about.
- **Location**: `supabase/migrations/202603160001_repair_foundation_schema_drift.sql` lines 21-37 (profiles), 89-119 (sessions)
- Affects `profiles_display_name_length_check`, `sessions_steps_is_array_check`, `sessions_timer_duration_seconds_positive_check`

## Proposed Solutions

### Option A: Drop auto-generated constraints first
Before the `IF NOT EXISTS` blocks, add `DROP CONSTRAINT IF EXISTS` for the known auto-generated names.
- **Effort**: Small
- **Risk**: Low (idempotent drops)

### Option B: Query by constraint expression content
Check `pg_constraint` by `conbin` or `consrc` content rather than just name, to detect any existing equivalent constraint.
- **Effort**: Medium
- **Risk**: Low

### Option C: Accept the duplicates
The duplicates are functionally harmless — just wasteful. Document and move on.
- **Effort**: None
- **Risk**: Low (but confusing for future migrations)

## Recommended Action

Prevent the repair migration from creating named constraints when the equivalent
Phase 1 auto-generated checks already exist, then add a forward cleanup
migration that removes duplicates from databases where the repair migration has
already run.

## Acceptance Criteria

- [x] No duplicate CHECK constraints after migration runs on a clean Phase 1 database
- [x] Migration remains idempotent (safe to run multiple times)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created from PR #10 code review | Data integrity guardian flagged |
| 2026-03-16 | Updated the repair migration to recognize the existing Phase 1 auto-generated check names and added a cleanup migration to drop already-duplicated checks | Avoiding fresh duplicates is not enough; previously migrated databases also need a forward repair |

## Resources

- PR #10: feat(session): add phase 3 core coaching flow
