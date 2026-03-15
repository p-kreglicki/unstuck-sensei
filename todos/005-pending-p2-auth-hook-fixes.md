---
status: pending
priority: p2
issue_id: "005"
tags: [code-review, quality, typescript, auth]
dependencies: []
---

# Auth Hook Improvements

## Problem Statement

The `useAuth` hook and related storage code have three issues: an unhandled promise rejection on sign-out, a redundant `user` state variable, and asymmetric error handling in the secure storage adapter.

## Findings

**From: pattern-recognition-specialist, kieran-typescript-reviewer**

1. **`signOut()` unhandled rejection** — `signOut()` uses `try/finally` with no `catch`. When called via `void signOut()` in Layout.tsx, a Supabase error becomes an unhandled promise rejection. The `signIn`/`signUp` functions handle errors correctly via return values.
   - Location: `src/hooks/useAuth.tsx`, line 134; `src/components/Layout.tsx`, line 31

2. **`user` state is redundant** — `user` is always `session?.user ?? null`. Storing it in a separate `useState` creates a brief window where `session` and `user` could be out of sync during React batching. Should be derived.
   - Location: `src/hooks/useAuth.tsx`, lines 30, 48, 64

3. **`secureStorage.setItem` asymmetric error handling** — `getItem` and `removeItem` swallow errors silently (defensible), but `setItem` propagates errors. If keychain write fails, the error surfaces inside Supabase internals which may not handle it well.
   - Location: `src/lib/supabase.ts`, lines 49-56 vs 22-36 and 38-47

## Proposed Solutions

### Solution: Fix All Three (Recommended)

1. Add `.catch()` to `signOut` or wrap the call site:
```typescript
async function signOut(): Promise<void> {
  setIsLoading(true);
  try {
    await supabase.auth.signOut();
  } catch {
    // Sign-out failure is non-critical; session will expire naturally.
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

3. Wrap `setItem` in try/catch with `console.error`:
```typescript
async setItem(key: string, value: string): Promise<void> {
  try {
    await invoke("plugin:secure-storage|set_item", { ... });
  } catch (error) {
    console.error("Failed to persist auth token to secure storage:", error);
  }
}
```

**Effort:** Small
**Risk:** Low

## Acceptance Criteria

- [ ] `signOut()` does not produce unhandled rejections
- [ ] `user` is derived from `session`, not stored separately
- [ ] All three `secureStorage` methods have consistent error handling
- [ ] `isLoading` flash during sign-out is acceptable or mitigated

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-15 | Created from code review of PR #1 | Pattern + TS reviewers converged on these |

## Resources

- PR: https://github.com/p-kreglicki/unstuck-sensei/pull/1
