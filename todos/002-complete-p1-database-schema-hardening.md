---
status: complete
priority: p1
issue_id: "002"
tags: [code-review, security, data-integrity, database]
dependencies: []
---

# Database Schema Hardening

## Problem Statement

The Phase 1 migration has several schema gaps that could cause silent failures, data integrity issues, or compliance problems as the app grows. These are best fixed now before any real user data exists.

## Findings

**From: security-sentinel, data-integrity-guardian**

1. **No DELETE policies on any table** — With RLS enabled and no DELETE policy, authenticated users cannot delete their own sessions, messages, or profile data. This silently fails (returns 0 affected rows, no error). Blocks future GDPR/CCPA right-to-deletion compliance.
   - Location: `supabase/migrations/202603150001_phase1_foundation.sql`

2. **No INSERT policy on profiles** — Profile creation relies entirely on the `handle_new_user()` SECURITY DEFINER trigger. If the trigger ever fails, the user gets created in `auth.users` but has no profile row. Every subsequent profile query returns nothing with no obvious cause.
   - Location: `supabase/migrations/202603150001_phase1_foundation.sql`, lines 18-29

3. **SECURITY DEFINER function is world-executable** — `handle_new_user()` has default EXECUTE permissions granted to PUBLIC. Should be restricted.
   - Location: `supabase/migrations/202603150001_phase1_foundation.sql`, line 107

4. **`update_updated_at()` missing `SET search_path = ''`** — The `handle_new_user()` function correctly sets an empty search path, but `update_updated_at()` does not. Inconsistent and a minor security gap.
   - Location: `supabase/migrations/202603150001_phase1_foundation.sql`, line 132

5. **No `display_name` length constraint** — User-controlled input via `raw_user_meta_data` during signup. No length limit means excessively large strings can be stored.
   - Location: `supabase/migrations/202603150001_phase1_foundation.sql`, line 6

6. **`created_at` columns are nullable** — All three tables allow explicit `NULL` for `created_at`, which would break time-based queries. Should be `NOT NULL`.
   - Location: All three `CREATE TABLE` statements

7. **Missing `updated_at` on sessions table** — Sessions are updated over their lifecycle (status changes, feedback, timer fields) but have no `updated_at` column or trigger.
   - Location: `supabase/migrations/202603150001_phase1_foundation.sql`, lines 34-52

8. **`timer_duration_seconds` allows negative values** — No CHECK constraint prevents nonsensical negative or zero durations.
   - Location: `supabase/migrations/202603150001_phase1_foundation.sql`, line 50

9. **`steps` JSONB column is unvalidated** — No structural check ensures the top-level value is an array.
   - Location: `supabase/migrations/202603150001_phase1_foundation.sql`, line 41

## Proposed Solutions

### Option A: New Migration File (Recommended)

Create a follow-up migration `202603150002_schema_hardening.sql` that applies all fixes additively:

- Add DELETE policies for `sessions` and `conversation_messages`
- Add defensive INSERT policy on `profiles`
- `REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC`
- Add `SET search_path = ''` to `update_updated_at()`
- Add `CHECK (char_length(display_name) <= 100)` on profiles
- Add `NOT NULL` to all `created_at` columns (safe since DEFAULT NOW() means no existing NULLs)
- Add `updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL` to sessions + wire trigger
- Add `CHECK (timer_duration_seconds > 0)` on sessions
- Add `CHECK (steps IS NULL OR jsonb_typeof(steps) = 'array')` on sessions

**Pros:** Clean migration history, minimal risk
**Cons:** Two migration files for Phase 1
**Effort:** Small
**Risk:** Low

### Option B: Amend the Existing Migration

Since this is pre-production with no deployed data, edit the original migration directly.

**Pros:** Single clean migration
**Cons:** Rewrites history if already applied to a Supabase project
**Effort:** Small
**Risk:** Low if no data exists yet

## Recommended Action

_To be filled during triage_

## Technical Details

- **Affected files:** `supabase/migrations/202603150001_phase1_foundation.sql`
- **Database changes:** ALTER TABLE, CREATE POLICY, REVOKE, CREATE TRIGGER

## Acceptance Criteria

- [x] All tables have DELETE policies for authenticated users (own data only)
- [x] Profiles table has defensive INSERT policy
- [x] `handle_new_user()` has restricted EXECUTE permissions
- [x] `update_updated_at()` has `SET search_path = ''`
- [x] `display_name` has length constraint
- [x] All `created_at` columns are NOT NULL
- [x] Sessions table has `updated_at` column and trigger
- [x] `timer_duration_seconds` has positive CHECK constraint
- [x] `steps` has array-type CHECK constraint
- [x] `database.types.ts` is regenerated to reflect changes

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-15 | Created from code review of PR #1 | Multiple agents flagged overlapping schema concerns |
| 2026-03-15 | Fixed: amended original migration with all 9 schema fixes, updated database.types.ts | Pre-production, so Option B (amend in place) was used |

## Resources

- PR: https://github.com/p-kreglicki/unstuck-sensei/pull/1
- Supabase RLS best practices: https://supabase.com/docs/guides/auth/row-level-security
