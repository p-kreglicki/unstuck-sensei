---
status: pending
priority: p2
issue_id: "006"
tags: [code-review, performance, database, build]
dependencies: []
---

# RLS Performance and Build Target Optimization

## Problem Statement

The `conversation_messages` RLS policies use correlated subqueries that will degrade at scale, and the Vite build targets Safari 13 unnecessarily, inflating bundle size.

## Findings

**From: performance-oracle, data-integrity-guardian**

1. **RLS subqueries on `conversation_messages`** — SELECT and INSERT policies use `session_id IN (SELECT id FROM public.sessions WHERE user_id = auth.uid())`. This is a correlated subquery evaluated for every row. At 500 sessions and 10K messages per user, this becomes expensive. The standard Supabase pattern is to denormalize `user_id` onto the messages table for O(1) policy evaluation.
   - Location: `supabase/migrations/202603150001_phase1_foundation.sql`, lines 93-102
   - **Best fixed in the Phase 1 migration before any data exists** (avoids a future data migration)

2. **Safari 13 build target is unnecessary** — Tauri v2's WKWebView on supported macOS versions is Safari 15.6+. Targeting Safari 13 forces esbuild to downlevel optional chaining, nullish coalescing, and other modern syntax, producing larger output.
   - Location: `vite.config.ts`, line 28

## Proposed Solutions

### Solution 1: Denormalize + Update Target (Recommended)

**Database:** Add `user_id` column to `conversation_messages`:
```sql
ALTER TABLE public.conversation_messages
  ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX idx_conversation_messages_user_id
  ON public.conversation_messages USING btree (user_id);
```

Update RLS policies to use direct `user_id = (SELECT auth.uid())` check.

**Vite:** Change `safari13` to `safari15` in `vite.config.ts`.

**Pros:** O(1) RLS evaluation, smaller bundle
**Cons:** Slight denormalization of user_id
**Effort:** Small
**Risk:** Low (no data exists yet)

## Acceptance Criteria

- [ ] `conversation_messages` has direct `user_id` column with index
- [ ] RLS policies on `conversation_messages` use direct `user_id` check
- [ ] Vite build target updated to `safari15` or higher
- [ ] `database.types.ts` regenerated

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-15 | Created from code review of PR #1 | Performance + data integrity agents both flagged the subquery pattern |

## Resources

- PR: https://github.com/p-kreglicki/unstuck-sensei/pull/1
- Supabase RLS performance: https://supabase.com/docs/guides/auth/row-level-security#policies
