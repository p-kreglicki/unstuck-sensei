---
status: pending
priority: p2
issue_id: "004"
tags: [code-review, performance, simplicity, rust]
dependencies: []
---

# Simplify Tray Menu and Fix Token Refresh Rebuild

## Problem Statement

The tray menu system is over-built for Phase 1 and has a performance issue: the menu rebuilds on every Supabase token refresh (~hourly) even when auth state hasn't actually changed.

## Findings

**From: code-simplicity-reviewer, performance-oracle**

1. **Auth-aware tray menu is YAGNI** — The tray has "Start Session", "Pause Detection" (disabled), and "Settings" items that all just call `show_main_window`. The signed-in menu is functionally identical to "open window + quit." ~30 lines of Rust and ~10 lines of TypeScript exist for menu items that do nothing distinct in Phase 1.
   - Location: `src-tauri/src/lib.rs`, lines 15-48; `src/hooks/useAuth.tsx`, lines 74-83

2. **Tray rebuilds on every token refresh** — The `useEffect` on `[session]` calls `update_tray_auth_state` every time the session object reference changes. Supabase `onAuthStateChange` fires on token refreshes (~hourly), producing a new session object each time. This triggers an unnecessary IPC call + full Rust menu rebuild.
   - Location: `src/hooks/useAuth.tsx`, lines 74-83

## Proposed Solutions

### Option A: Simplify Menu + Guard Rebuild (Recommended)

1. Collapse `build_tray_menu` to always show "Open" and "Quit" (remove `signed_in` parameter)
2. Remove `update_tray_auth_state` Tauri command entirely
3. Remove the tray sync `useEffect` from `useAuth.tsx`
4. Reintroduce auth-aware menu when Phase 3 adds session functionality to the tray

**Pros:** ~40 LOC removed, eliminates unnecessary IPC, cleaner Phase 1
**Cons:** Less polish in tray during Phase 1 (but the polish is non-functional anyway)
**Effort:** Small
**Risk:** Low

### Option B: Keep Menu, Guard Rebuild Only

Keep the auth-aware menu but fix the rebuild trigger:
```typescript
const signedIn = Boolean(session);
useEffect(() => {
  if (!isTauri()) return;
  void invoke("update_tray_auth_state", { signedIn }).catch(() => {});
}, [signedIn]); // Only fires on actual sign-in/sign-out transitions
```

**Pros:** Retains existing UX, minimal change
**Cons:** Keeps YAGNI menu items
**Effort:** Trivial (one-line dep array change)
**Risk:** Low

## Recommended Action

_To be filled during triage_

## Technical Details

- **Affected files:** `src-tauri/src/lib.rs`, `src/hooks/useAuth.tsx`

## Acceptance Criteria

- [ ] Tray menu does not rebuild on token refresh (only on actual auth state change)
- [ ] No unnecessary IPC calls during normal app operation
- [ ] Tray still provides Open/Quit functionality

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-15 | Created from code review of PR #1 | Simplicity + performance agents converged on this |

## Resources

- PR: https://github.com/p-kreglicki/unstuck-sensei/pull/1
