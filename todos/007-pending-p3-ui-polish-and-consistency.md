---
status: pending
priority: p3
issue_id: "007"
tags: [code-review, quality, ui, typescript]
dependencies: []
---

# UI Polish and Code Consistency

## Problem Statement

Minor UI and code consistency issues that should be addressed before the app becomes user-facing but are non-blocking for Phase 1.

## Findings

**From: pattern-recognition-specialist, kieran-typescript-reviewer, code-simplicity-reviewer**

1. **Login error/success messages share same styling** — `statusMessage` conflates errors ("Invalid credentials") and success ("Signed in. Redirecting...") with identical visual treatment. Users cannot distinguish them.
   - Location: `src/pages/Login.tsx`, lines 10, 23-32, 112-116

2. **Border radius proliferation** — Five different radius values (`rounded-2xl`, `rounded-[28px]`, `rounded-[32px]`, `rounded-full`, `rounded-[18px]`) across only four components. The arbitrary values suggest design tokens that should be formalized in a Tailwind theme extension.
   - Location: All UI components

3. **Tracking value drift** — Login uses `tracking-[0.35em]` while Layout uses `tracking-[0.3em]` for the same visual element (small uppercase label). Likely unintentional.
   - Location: `src/pages/Login.tsx`, line 40 vs `src/components/Layout.tsx`, line 18

4. **`index.html` title is generic** — Still says "Tauri + React + Typescript" instead of "Unstuck Sensei".
   - Location: `index.html`

5. **`App.tsx` uses default export** — Every other module uses named exports. Default exports make refactoring harder.
   - Location: `src/App.tsx`, line 50

6. **Login UI contains implementation notes** — "Magic links are a stretch goal" and "PKCE + deep links next" are developer notes rendered in the UI.
   - Location: `src/pages/Login.tsx`, lines 107-109

## Proposed Solutions

All are straightforward one-off fixes:
1. Split `statusMessage` into `{ type: 'error' | 'success'; message: string }` with distinct styling
2. Normalize border-radius to 2-3 values via Tailwind theme config
3. Align tracking values
4. Update `<title>` to "Unstuck Sensei"
5. Switch to named export: `export function App()`
6. Remove or hide implementation notes behind `import.meta.env.DEV`

**Effort:** Small
**Risk:** Low

## Acceptance Criteria

- [ ] Error and success messages have distinct visual styling
- [ ] Border radius values are consolidated
- [ ] Tracking values are consistent
- [ ] Page title is "Unstuck Sensei"
- [ ] All exports follow named export convention
- [ ] No developer implementation notes in production UI

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-15 | Created from code review of PR #1 | Multiple agents flagged overlapping UI consistency concerns |

## Resources

- PR: https://github.com/p-kreglicki/unstuck-sensei/pull/1
