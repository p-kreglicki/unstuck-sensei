# Conversation Messages RLS Validation Plan

## Goal

Decide whether `public.conversation_messages` needs a denormalized `user_id` column for RLS performance, using measurement instead of assumption.

## Current Policy Shape

The current migration authorizes message rows by checking whether each `session_id` belongs to one of the current user's sessions:

```sql
session_id IN (
  SELECT id FROM public.sessions WHERE user_id = (SELECT auth.uid())
)
```

That keeps ownership normalized under `public.sessions` and avoids duplicating `user_id` onto `public.conversation_messages`.

## When To Revisit

Run this validation before introducing message-history features that list or search large numbers of `conversation_messages`, or when profiling shows message reads are a measurable hotspot.

## Validation Steps

1. Seed realistic data volumes for one user:
   - 500 sessions
   - 10,000 conversation messages distributed across those sessions
2. Run `EXPLAIN (ANALYZE, BUFFERS)` for the representative client queries:
   - list recent messages for one session
   - count messages for one session
   - delete messages by `session_id`
3. Confirm the planner uses:
   - `idx_sessions_user_id` on `public.sessions`
   - `idx_conversation_messages_session_id` on `public.conversation_messages`
4. Record timings before considering any schema change.

## Representative Queries

Use an authenticated session and inspect the queries the app is expected to perform:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, role, content, created_at
FROM public.conversation_messages
WHERE session_id = '<session-id>'
ORDER BY created_at ASC;
```

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM public.conversation_messages
WHERE session_id = '<session-id>';
```

```sql
EXPLAIN (ANALYZE, BUFFERS)
DELETE FROM public.conversation_messages
WHERE session_id = '<session-id>';
```

## Decision Rule

Keep the current schema unless profiling shows the RLS predicate is materially contributing to slow queries after indexes are in place.

Only consider denormalizing `user_id` onto `public.conversation_messages` if:

- message-table queries are slow under realistic volume,
- the slowdown is attributable to the policy join pattern rather than missing indexes or query shape, and
- the extra integrity burden of duplicated ownership data is acceptable.

## Out Of Scope

- Changing `vite.config.ts` browser targets
- Raising the app's minimum supported macOS version
- Denormalizing `user_id` without measured evidence
