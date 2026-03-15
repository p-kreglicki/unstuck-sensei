---
status: complete
priority: p2
issue_id: "010"
tags: [code-review, typescript, detection, observability]
dependencies: []
---

# Swallowed Errors in Detection Sync

## Problem Statement

The `syncDetectionConfig` function in `useAuth.tsx` has an empty catch block that silently swallows all errors. A misconfigured Supabase URL, missing RLS policy, or Rust-side validation error (`"Unsupported sensitivity: ..."`) would produce zero feedback during development, making debugging extremely difficult.

## Findings

**Source:** TypeScript Reviewer (BLOCKING), Security Sentinel, Performance Oracle

- Location: `src/hooks/useAuth.tsx:136-138`
- The comment "Detection sync is helpful for desktop UX but should not block auth flows" is correct in intent — detection errors should not break auth. But silent swallowing makes debugging impossible.

## Proposed Solutions

### Option A: Dev-mode console.warn (Recommended)
```typescript
} catch (error) {
  if (import.meta.env.DEV) {
    console.warn("[detection] sync failed:", error);
  }
}
```
- **Pros:** Zero production cost, surfaces errors in development
- **Cons:** None
- **Effort:** Small
- **Risk:** None

## Acceptance Criteria

- [x] Detection sync errors are logged to console in development mode
- [x] Production builds remain silent (no user-facing error)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-15 | Created from PR #3 code review | Silent catch blocks hurt development velocity |
| 2026-03-15 | Added dev-only console warning in `syncDetectionConfig` | The error can stay non-blocking for auth while still being visible during local debugging. |

## Resources

- PR: https://github.com/p-kreglicki/unstuck-sensei/pull/3
