---
status: complete
priority: p2
issue_id: "004"
tags: [code-review, performance, typescript]
dependencies: []
---

# Guard Tray Auth Sync Against Token Refreshes

## Problem Statement

The tray menu rebuilds on every Supabase token refresh (~hourly) even when the signed-in/signed-out state hasn't changed. This causes unnecessary IPC calls and Rust-side menu rebuilds.

## Findings

**From: performance-oracle, triage review**

1. **Tray rebuilds on every token refresh** — The `useEffect` on `[session]` calls `update_tray_auth_state` every time the session object reference changes. Supabase's `onAuthStateChange` fires `TOKEN_REFRESHED` events with a new session object, triggering an IPC call + full Rust menu rebuild even though auth state (signed-in vs signed-out) hasn't changed.
   - Location: `src/hooks/useAuth.tsx`, lines 74-83

2. **The auth-aware tray menu itself is an approved Phase 1 requirement** — The Phase 1 plan explicitly requires the tray menu to reflect auth state, and this was shipped and verified. Removing the auth-aware menu (previously proposed as Option A) would reopen a shipped requirement.
   - References: `docs/plans/2026-03-14-feat-unstuck-sensei-phase1-foundation-plan.md` (lines 657, 714), `todos/001-ready-p1-phase1-foundation-execution.md` (line 179)

## Proposed Solution

Depend on `Boolean(session)` instead of the session object reference, so the effect only fires on actual sign-in/sign-out transitions:

```typescript
const signedIn = Boolean(session);

useEffect(() => {
  if (!isTauri()) return;
  void invoke("update_tray_auth_state", { signedIn }).catch(() => {});
}, [signedIn]); // Only fires on actual sign-in/sign-out transitions
```

**Pros:** Retains existing auth-aware menu UX, eliminates unnecessary rebuilds
**Cons:** None
**Effort:** Trivial (one-line dep array change + derived boolean)
**Risk:** Low

## Technical Details

- **Affected files:** `src/hooks/useAuth.tsx`

## Acceptance Criteria

- [ ] Tray menu does not rebuild on token refresh (only on actual sign-in/sign-out)
- [ ] No unnecessary IPC calls during normal app operation
- [ ] Auth-aware tray menu behavior is preserved (signed-in vs signed-out menus)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-15 | Created from code review of PR #1 | Simplicity + performance agents converged on this |
| 2026-03-15 | Triage: rewrote todo — Option A (remove auth menu) conflicts with Phase 1 scope; narrowed to Option B only | Always check approved requirements before proposing removals |
| 2026-03-15 | Validity check after PR #5: completed | `src/hooks/useAuth.tsx` now syncs detection/tray state from a `useEffect` keyed by `session?.user.id`, and `src-tauri/src/commands.rs` rebuilds the tray via `sync_detection_config`, so token refreshes no longer trigger tray rebuilds |

## Resources

- PR: https://github.com/p-kreglicki/unstuck-sensei/pull/1
