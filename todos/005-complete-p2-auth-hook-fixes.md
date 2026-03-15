---
status: complete
priority: p2
issue_id: "005"
tags: [code-review, quality, typescript, auth]
dependencies: []
---

# Auth Hook Improvements

## Problem Statement

The `useAuth` hook has two issues: `signOut()` silently ignores the error returned by `supabase.auth.signOut()`, and `user` state is redundantly stored instead of derived from `session`.

## Findings

**From: pattern-recognition-specialist, kieran-typescript-reviewer, triage review**

1. **`signOut()` silently ignores returned error** — `supabase.auth.signOut()` returns `{ error }` (it does not throw). The current code ignores this return value entirely, so a failed sign-out appears successful to the user. The `signIn`/`signUp` functions correctly check and return the error; `signOut` should follow the same pattern.
   - Location: `src/hooks/useAuth.tsx`, line 138

2. **`user` state is redundant** — `user` is always `session?.user ?? null`. Storing it in a separate `useState` creates a brief window where `session` and `user` could be out of sync during React batching. Should be derived.
   - Location: `src/hooks/useAuth.tsx`, lines 30, 48, 64

3. ~~**`secureStorage.setItem` asymmetric error handling**~~ — **Invalidated during triage.** The asymmetry is intentional and correct: `setItem` propagates errors because a failed keychain write means the session won't persist, and masking that would let sign-in appear successful while persistence is broken. `getItem`/`removeItem` can tolerate missing-key cases. No change needed.

## Proposed Solutions

### Solution: Fix signOut and derive user

1. Check the returned error from `signOut`:
```typescript
async function signOut(): Promise<void> {
  setIsLoading(true);
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Sign-out failed:", error.message);
    }
  } finally {
    setIsLoading(false);
  }
}
```

2. Derive `user` from `session`:
```typescript
// Remove: const [user, setUser] = useState<User | null>(null);
// Remove: all setUser() calls
// In the context value:
const user = session?.user ?? null;
```

**Effort:** Small
**Risk:** Low

## Acceptance Criteria

- [x] `signOut()` checks the returned error from Supabase and returns it to the caller for UI handling
- [x] `user` is derived from `session`, not stored separately
- [x] `secureStorage.setItem` continues to propagate errors (no change)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-15 | Created from code review of PR #1 | Pattern + TS reviewers converged on these |
| 2026-03-15 | Triage: corrected signOut finding (returns error, doesn't throw), removed secureStorage.setItem fix (asymmetry is intentional) | Always check the actual library API before proposing error-handling changes |
| 2026-03-15 | Validity check after PR #5: completed | `src/hooks/useAuth.tsx` now derives `user` from `session`, and `signOut()` returns Supabase's `{ error }` so callers like `src/components/Layout.tsx` can surface failures instead of silently succeeding |

## Resources

- PR: https://github.com/p-kreglicki/unstuck-sensei/pull/1
