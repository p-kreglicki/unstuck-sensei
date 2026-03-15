---
status: complete
priority: p1
issue_id: "003"
tags: [code-review, security, configuration]
dependencies: []
---

# Harden CSP and Production Environment Validation

## Problem Statement

The CSP policy is missing explicit directives, and the Supabase client silently falls back to placeholder credentials when env vars are missing. In a production build, this creates a broken app that fails at runtime rather than at startup.

## Findings

**From: security-sentinel, performance-oracle**

1. **Placeholder Supabase credentials in production** — When `VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY` are missing, the client is created with `https://placeholder.supabase.co` and a fake key. With `autoRefreshToken: true`, this causes periodic failed DNS lookups and a broken UX with no clear error.
   - Location: `src/lib/supabase.ts`, lines 93-95
   - The `console.warn` on lines 9-12 is insufficient for production builds

2. **CSP missing explicit `script-src` and `object-src`** — The CSP falls back to `default-src 'self'` for scripts, which is correct but implicit. No `object-src 'none'` to prevent plugin-based attacks.
   - Location: `src-tauri/tauri.conf.json`, line 24

## Proposed Solutions

### Solution 1: Fail-Fast in Production + CSP Hardening (Recommended)

**`src/lib/supabase.ts`:** Add a production guard:
```typescript
if (!import.meta.env.DEV && (!supabaseUrl || !supabasePublishableKey)) {
  throw new Error("Supabase configuration is required in production builds.");
}
```

**`src-tauri/tauri.conf.json`:** Update CSP to:
```
default-src 'self'; script-src 'self'; connect-src 'self' https://*.supabase.co; style-src 'self' 'unsafe-inline'; object-src 'none'
```

**Pros:** Immediate, clear failure on misconfiguration; defense-in-depth CSP
**Cons:** None
**Effort:** Small (two one-line changes)
**Risk:** Low

## Recommended Action

_To be filled during triage_

## Technical Details

- **Affected files:** `src/lib/supabase.ts`, `src-tauri/tauri.conf.json`

## Acceptance Criteria

- [x] Production builds throw on missing Supabase env vars
- [x] Dev builds retain the current console.warn + placeholder behavior
- [x] CSP includes explicit `script-src 'self'` and `object-src 'none'`

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-15 | Created from code review of PR #1 | Security + performance agents both flagged placeholder credentials |
| 2026-03-15 | Fixed: added production guard in supabase.ts, hardened CSP in tauri.conf.json | Two one-line changes |

## Resources

- PR: https://github.com/p-kreglicki/unstuck-sensei/pull/1
