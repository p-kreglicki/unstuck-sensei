---
title: "feat: Session Chat Shell"
type: feat
status: active
date: 2026-03-22
origin: docs/brainstorms/2026-03-22-session-chat-shell-brainstorm.md
---

# feat: Session Chat Shell

## Enhancement Summary

**Deepened on:** 2026-03-22
**Sections enhanced:** 7
**Research inputs used:** `frontend-design`, `julik-frontend-races-reviewer`, `kieran-typescript-reviewer`, `pattern-recognition-specialist`, `performance-oracle`, `security-sentinel`, `code-simplicity-reviewer`, project learnings, React docs, WAI-ARIA guidance, and MDN platform docs.

### Key Improvements

1. Added an explicit thread architecture: persisted transcript rows, synthetic prompt turns, and inline control items are modeled separately instead of being mixed ad hoc in JSX.
2. Added a concrete scroll and accessibility contract for the fixed-height conversation panel, including `role="log"`, `useLayoutEffect`-driven scroll sync, reduced-motion handling, and selective `overflow-anchor` usage.
3. Added a performance guardrail from prior timer work: the 1 Hz countdown must stay isolated to the timer card so the entire conversation shell does not re-render every second.

### New Considerations Discovered

- A full chat shell needs a stable focus and auto-scroll policy or it will feel cheap during streaming, retry, and resume flows.
- The plan should explicitly avoid a “generic chat engine” abstraction; a small typed thread mapper is enough for this feature.

## Overview

Reframe the session route as a messaging-style conversation without replacing the existing session state machine. The goal is to make the coaching flow read like a proper dialogue between the user and the AI sensei: fixed-height thread, clear left/right bubble treatment, and a bottom composer for typed replies.

This plan is explicitly grounded in the March 22 brainstorm choice to keep the current session logic while presenting the whole experience inside a single chat shell (see brainstorm: `docs/brainstorms/2026-03-22-session-chat-shell-brainstorm.md`). It should not introduce a parallel chat-native workflow, new persistence tables, or a second source of truth for transcript state.

## Research Summary

### Origin Brainstorm

Relevant brainstorm found: `docs/brainstorms/2026-03-22-session-chat-shell-brainstorm.md`.

Key decisions carried forward:
- Use a fixed-height conversation area with internal scrolling (see brainstorm: `docs/brainstorms/2026-03-22-session-chat-shell-brainstorm.md`).
- Keep a bottom composer for typed user replies (see brainstorm: `docs/brainstorms/2026-03-22-session-chat-shell-brainstorm.md`).
- Render prompts and user replies as visible chat turns, not separate form cards (see brainstorm: `docs/brainstorms/2026-03-22-session-chat-shell-brainstorm.md`).
- Keep later controls such as energy, steps, timer, and check-in inside the same conversation shell (see brainstorm: `docs/brainstorms/2026-03-22-session-chat-shell-brainstorm.md`).
- Preserve the existing underlying session logic rather than rebuilding the flow as a chat-native state machine (see brainstorm: `docs/brainstorms/2026-03-22-session-chat-shell-brainstorm.md`).

### Repository Research Summary

- `src/pages/Session.tsx` currently renders the flow as independent stage cards: `StuckInput`, `EnergySelector`, `TranscriptCard`, `ClarifyingQuestion`, `StepsList`, `Timer`, and `CheckIn`.
- `src/hooks/useSessionFlow.ts` already owns the canonical flow state and persistence: stage derivation, draft/session writes, transcript reads, step reordering, timer transitions, and check-in transitions.
- `src/hooks/useSessionFlow.ts` currently inserts the first user transcript row in `handleGenerateSteps()`, not in `handleSaveStuckTask()`. That is the root cause of the opening exchange not behaving like a real sent message.
- `src/components/session/TranscriptCard.tsx` already distinguishes `assistant` and `user` roles, but it is a passive transcript slab, not the primary interaction surface.
- `src/components/session/EnergySelector.tsx`, `src/components/session/StepsList.tsx`, `src/components/session/Timer.tsx`, and `src/components/session/CheckIn.tsx` already contain the structured controls the new shell must embed inside the thread.
- `src/pages/Session.test.tsx` covers key stage-level behavior, but it does not yet assert conversation-shell rendering, synthetic prompt turns, or bottom-composer behavior.
- The wider product shell in `src/components/Layout.tsx` already uses a narrow mobile-sized desktop frame, so a fixed-height thread fits the existing UI direction.

### Institutional Learnings

Relevant documented learning:

- `docs/solutions/security-issues/phase-3-p1-chat-api-and-detection-hardening.md`
  - Relevance: the desktop client is not the source of truth. This UI change should preserve the existing server and database contracts rather than shifting transcript truth into ad hoc client-only state.
  - Practical implication: keep `conversation_messages`, `sessions`, and `useSessionFlow` as the canonical data boundary; derive presentation state from them instead of inventing a new chat persistence layer.

### External Research Decision

The repo already has strong local context and established session-flow patterns. External research is unnecessary for this plan.

### Section Manifest

- **Overview / Problem Statement**: sharpen the scope so this remains a shell refactor, not a workflow rewrite
- **Proposed Solution**: define the chat-shell behavior, accessibility semantics, and scroll expectations
- **Technical Approach**: add a typed thread-item model, state boundaries, and performance constraints
- **File-Level Plan**: clarify which components should own presentation vs. business state
- **Risks And Mitigations**: add race, scroll, accessibility, and timer-render edge cases
- **Acceptance Criteria / Test Plan**: make the expected behavior observable in tests

### Skill Lenses Applied

- **`frontend-design`**: keep the shell intentionally chat-like, visually coherent, and not just a stack of rounded cards.
- **`julik-frontend-races-reviewer`**: treat streaming, scrolling, and animation timing as race-prone UI state, not an afterthought.
- **`kieran-typescript-reviewer`** and **`pattern-recognition-specialist`**: use a small typed thread-item model and preserve the current separation between `useSessionFlow` state and UI rendering.
- **`performance-oracle`**: keep timer countdown updates isolated so the entire conversation thread does not re-render every second.
- **`security-sentinel`**: preserve current input limits and server-owned validation boundaries; do not let UI-only chat affordances become new trust boundaries.
- **`code-simplicity-reviewer`**: avoid inventing a reusable chat framework for a single session route.

## Problem Statement / Motivation

Today the app has real conversational content, but the experience still feels like a form wizard with a transcript attached to it. The user sees separate cards for opening input, clarifying input, steps, timer, and check-in, which breaks the illusion of talking to a coach.

The desired UX is more specific:
- the conversation area should have a stable height
- typed replies should come from a bottom composer
- assistant and user turns should be visually distinct by side and color
- the whole session, including structured controls, should feel like one ongoing dialogue

The challenge is to achieve that without rewriting the durable session model or losing the current reliability around streaming, resume, timer handoff, and check-in.

## SpecFlow Gaps Resolved In This Plan

1. **Opening-turn timing is currently wrong for chat UX.**
   The first user answer is only persisted when energy is submitted. This plan moves the first user-turn creation to the moment the user submits the opening message, so the conversation starts when the user expects it to.

2. **Not every visible chat turn should be a persisted transcript row.**
   The app needs assistant prompts like the opening prompt and energy question to appear in the thread, but those are workflow scaffolding, not durable human transcript rows. This plan defines a derived conversation view-model with both persisted and synthetic turns.

3. **Selection-only stages do not fit a text composer.**
   The brainstorm chose a bottom composer for typing, but energy selection, step actions, timer controls, and check-in are not typed replies. This plan keeps the composer for free-text stages and renders structured controls inline inside the thread for selection stages.

4. **Reload and historical compatibility are under-specified.**
   Existing drafts and historical sessions may lack some turns that the new shell wants to display. This plan requires the thread to synthesize missing early-stage turns from durable session fields instead of needing a migration.

5. **Auto-scroll behavior is currently undefined.**
   Streaming and dynamic controls inside a fixed-height thread need a clear scroll contract. This plan defines when to auto-scroll and when to preserve the user’s manual scroll position.

## Proposed Solution

Build a single `SessionConversationShell` on top of `useSessionFlow`.

The shell should:
- derive a chronological thread from `sessionRow`, `messages`, `chat.state`, `steps`, `latestTimerBlock`, and `currentStage`
- mix persisted transcript rows with synthetic workflow turns
- anchor a composer to the bottom for compose and clarifying stages
- render stage-specific control cards inline in the thread for energy selection, steps, timer, and check-in
- keep the thread height fixed and scrollable inside the shell
- preserve existing writes, streaming, retry, timer, and check-in behavior

This keeps the implementation as a UI-shell refactor, not a new conversation engine.

### Research Insights

**Best Practices**
- Model the conversation as a scrollable log with a labeled heading so new additions are announced to assistive technology in sequence, which matches WAI guidance for chat-like updates.
- Use a thread-local scroll controller rather than sprinkling `scrollIntoView()` calls across event handlers and stage components.
- Keep the composer visually docked to the bottom of the shell, but treat it as a stage-aware input surface, not a universal control host.

**Performance Considerations**
- During streaming, prefer instant bottom sticking over smooth scrolling on every chunk; smooth animation on every delta is visually noisy and can feel janky.
- Keep scroll writes centralized and cancel-safe. If a `requestAnimationFrame` or delayed scroll is scheduled, it must not survive unmounts, stage changes, or retry resets.
- Preserve the existing countdown isolation pattern so only the inline timer card subscribes to `useTimerCountdown()`.

**Edge Cases**
- User scrolls upward during assistant streaming: keep their manual position stable and stop auto-jumping until they return near the bottom.
- Streaming fails after partial text: preserve the partial assistant bubble and keep retry affordance close to that turn.
- Resumed draft missing the first persisted message: synthesize the opening exchange from `sessionRow.stuck_on` instead of showing a broken-looking thread.
- Multi-line composer growth: ensure the last bubble is not obscured by the docked composer.

## Technical Approach

### Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Source of truth | Keep `useSessionFlow`, `sessions`, and `conversation_messages` as canonical | The data model already works. The UX issue is presentation, not missing persistence primitives. |
| Thread model | Build a derived thread view-model that combines persisted messages with synthetic prompt/control items | The shell needs visible turns that should not all be stored as transcript rows. |
| Initial user turn | Persist the opening user message in `handleSaveStuckTask()` instead of waiting until `handleGenerateSteps()` | A sent chat message should appear when the user sends it, not one stage later. |
| Historical compatibility | Synthesize missing opening or energy turns from `sessionRow` fields when old sessions do not have matching transcript rows | This avoids schema churn or backfills for a UI-only improvement. |
| Composer behavior | Bottom composer is shown for free-text stages only: compose and clarifying | This matches the user’s request while avoiding awkward text-entry hacks for selection stages. |
| Structured stages | Energy, steps, timer, and check-in remain inline cards inside the thread | This preserves a single conversation surface without pretending every action is typed text. |
| Error treatment | Keep operational errors in the existing status banner rather than injecting them as fake assistant messages | Errors are product/system state, not part of the human dialogue. |
| Scroll policy | Auto-scroll when the user is already near the bottom or when a new streaming turn begins; preserve manual scroll position otherwise | Prevents the UI from fighting the user while still keeping live conversation readable. |
| Layout constraint | Fixed-height thread inside the existing session page footprint | Matches the brainstorm requirement and the current narrow-shell desktop layout. |

### Architecture Refinements

Use a small discriminated union for thread items instead of letting each component infer chat semantics independently.

```ts
type ThreadItem =
  | {
      id: string;
      kind: "message";
      role: "assistant" | "user";
      content: string;
      persisted: boolean;
    }
  | {
      id: string;
      kind: "prompt";
      role: "assistant";
      content: string;
      synthetic: true;
    }
  | {
      id: string;
      kind: "control";
      control: "energy" | "steps" | "timer" | "checkin";
    };
```

This keeps the design aligned with the existing codebase pattern:
- `useSessionFlow` owns durable state and mutations
- a pure mapper derives `ThreadItem[]`
- presentational components render those items without re-encoding session business rules

This is the simplest structure that still makes synthetic vs. durable turns explicit.

### Conversation Mapping

The thread should map current stage state into visible conversation items like this:

1. **Compose**
   - Synthetic assistant opener bubble: "What are you stuck on?"
   - Optional reminder/helper copy as a lightweight assistant/system bubble
   - Bottom composer active

2. **After opening submit**
   - Right-aligned user bubble from `stuck_on`
   - Synthetic assistant bubble asking about energy
   - Inline energy selector card appears in-thread

3. **Streaming / first response**
   - Optional synthetic right-aligned energy reply bubble once `energy_level` exists
   - Streaming assistant bubble uses existing `chat.state.streamingText`
   - Structured result commits into either a clarifying assistant turn or a steps assistant turn

4. **Clarifying**
   - Assistant clarifying question from durable session state or transcript
   - Bottom composer active for the user’s answer

5. **Steps**
   - Assistant step-introduction text from transcript
   - Inline steps card with reorder, retry, and confirm actions

6. **Timer**
   - Thread stays visible
   - Inline timer card appears as the current active control item

7. **Check-in**
   - Assistant check-in prompt plus inline feedback controls
   - Optional extend action stays in the same thread

8. **Completion / reset**
   - After stop or successful check-in reset, the next fresh session should render a clean opener thread again
   - Existing top-level summary status message can remain outside the thread

### Accessibility And Scroll Contract

The conversation shell should explicitly behave like a live, sequential log:

```tsx
<section aria-labelledby="conversation-heading">
  <h2 id="conversation-heading" className="sr-only">
    Conversation
  </h2>
  <div
    role="log"
    aria-labelledby="conversation-heading"
    aria-relevant="additions text"
  >
    {threadItems.map(renderThreadItem)}
    <div ref={bottomRef} />
  </div>
</section>
```

Implementation guidance:
- Use `useLayoutEffect` for scroll synchronization that depends on freshly rendered DOM, because React documents it as the correct place for pre-paint layout work.
- Prefer `scrollIntoView({ block: "end", inline: "nearest" })` on a bottom sentinel or newest turn instead of manually computing `scrollTop` offsets.
- Only reach for `flushSync` if an event-driven append-and-scroll operation proves to lag by one render; do not make it the default plan.
- Keep browser scroll anchoring enabled by default and only use `overflow-anchor: none` on elements that demonstrably fight the desired bottom-stick behavior.
- Any smooth scrolling or reveal animation should respect `prefers-reduced-motion: reduce`.

### Data And State Changes

No schema changes are required.

Recommended `useSessionFlow` adjustments:
- move first-user-message persistence from `handleGenerateSteps()` to `handleSaveStuckTask()`
- guard against double-inserting the same opening user message on resumed drafts
- expose enough state to build a richer thread view-model without making presentation decisions inside the hook
- keep `transcriptRows` and `streamingTranscriptRow` available, but consider also exporting a smaller set of raw state fields used to derive synthetic turns cleanly
- avoid introducing scroll or DOM refs into `useSessionFlow`; keep it platform-agnostic and focused on session state
- preserve the current timer/countdown split so the conversation shell does not subscribe to high-frequency countdown state

Recommended presentation-layer additions:
- add a new shell component such as `src/components/session/SessionConversationShell.tsx`
- add small thread primitives, for example:
  - `ConversationBubble`
  - `ConversationThread`
  - `ConversationComposer`
  - `ConversationControlCard`
- either retire `TranscriptCard.tsx` or reduce it to a lower-level bubble/thread primitive

Suggested shell decomposition:

```ts
Session.tsx
  -> SessionConversationShell
      -> deriveThreadItems(flowState)
      -> ConversationThread
      -> ConversationComposer
      -> inline stage control cards
```

That keeps business logic out of leaf components and avoids turning `Session.tsx` into a second state machine.

### File-Level Plan

Expected primary touch points:

- `src/pages/Session.tsx`
  - replace the current stack of standalone stage cards with the new conversation shell composition
- `src/hooks/useSessionFlow.ts`
  - adjust first-turn persistence timing
  - expose state needed for synthetic-turn derivation
  - preserve all existing stage and timer logic
- `src/components/session/TranscriptCard.tsx`
  - repurpose or replace with thread primitives
- `src/components/session/StuckInput.tsx`
  - likely split into a composer-focused component or fold into the new shell
- `src/components/session/ClarifyingQuestion.tsx`
  - likely split into prompt + composer responsibilities
- `src/components/session/EnergySelector.tsx`
  - preserve behavior but restyle for inline thread placement
- `src/components/session/StepsList.tsx`
  - preserve behavior but restyle for inline thread placement
- `src/components/session/Timer.tsx`
  - adapt to sit inside the thread without looking like a detached page section
- `src/components/session/CheckIn.tsx`
  - adapt to sit inside the thread without looking like a detached page section
- `src/pages/Session.test.tsx`
  - update assertions to reflect thread-based rendering and composer behavior

## Implementation Phases

### Phase 1: Thread Model And Session-Flow Contract

Goal: make the session state available in the right shape before changing the UI.

Tasks:
- [x] Add a small typed thread-item model for persisted messages, synthetic prompts, and inline controls.
- [x] Add a pure `deriveThreadItems(...)` mapper that accepts `useSessionFlow` state and returns ordered thread items.
- [x] Move initial user-message persistence from `handleGenerateSteps()` to `handleSaveStuckTask()`.
- [x] Prevent duplicate first-message insertion on resumed drafts.
- [x] Define compatibility rules for older drafts with missing early transcript rows.

Primary files:
- `src/hooks/useSessionFlow.ts`
- `src/components/session/TranscriptCard.tsx` or new thread-mapper module

Exit criteria:
- Opening user input is durably available at submit time.
- Thread derivation logic is isolated from presentational JSX.

### Phase 2: Conversation Shell Layout

Goal: replace the stacked card layout with one fixed-height conversation surface.

Tasks:
- [ ] Create `SessionConversationShell.tsx` or equivalent shell component.
- [ ] Implement a fixed-height conversation region with internal scrolling.
- [ ] Add the bottom composer for compose and clarifying stages.
- [ ] Render assistant and user turns with clear left/right alignment and differentiated bubble styling.
- [ ] Add labeled log semantics for the conversation region.

Primary files:
- `src/pages/Session.tsx`
- `src/components/session/SessionConversationShell.tsx`
- `src/components/session/StuckInput.tsx`
- `src/components/session/ClarifyingQuestion.tsx`

Exit criteria:
- Session route visually reads as a dialogue instead of a card stack.
- Opening prompt and user reply appear as chat turns inside the same panel.

### Phase 3: Inline Structured Controls

Goal: keep the rest of the session flow inside the same conversation shell.

Tasks:
- [ ] Adapt `EnergySelector` for in-thread placement.
- [ ] Adapt `StepsList` for in-thread placement with retry, reorder, and confirm actions intact.
- [ ] Adapt `Timer` to render as an inline thread control card.
- [ ] Adapt `CheckIn` to render as an inline thread control card.
- [ ] Ensure transitions between compose, energy, clarifying, steps, timer, and check-in feel like one continuous thread.

Primary files:
- `src/components/session/EnergySelector.tsx`
- `src/components/session/StepsList.tsx`
- `src/components/session/Timer.tsx`
- `src/components/session/CheckIn.tsx`

Exit criteria:
- Energy, steps, timer, and check-in all render inside the same conversation shell.
- No stage falls back to the old detached-card layout.

### Phase 4: Scroll, Focus, And Performance Hardening

Goal: make the shell behave well under streaming, retry, countdown, and manual scrolling.

Tasks:
- [ ] Add a single scroll controller for bottom-stick behavior.
- [ ] Use `useLayoutEffect` or equivalent pre-paint synchronization for append-and-scroll cases.
- [ ] Preserve manual scroll position when the user scrolls away from the bottom.
- [ ] Ensure `useTimerCountdown()` remains isolated to the inline timer card.
- [ ] Respect `prefers-reduced-motion` for smooth scrolling and decorative motion.
- [ ] Verify focus transitions between composer, streamed assistant output, and inline controls.

Primary files:
- `src/components/session/SessionConversationShell.tsx`
- `src/components/session/Timer.tsx`
- any new scroll/focus utility introduced for the shell

Exit criteria:
- Streaming does not cause janky scrolling.
- Timer countdown does not re-render the entire transcript every second.

### Phase 5: Verification And Compatibility Coverage

Goal: lock in the new shell with test coverage for the important regressions.

Tasks:
- [ ] Update `Session.test.tsx` for thread rendering, composer behavior, and inline controls.
- [ ] Add tests for synthetic-turn derivation, including older resumed drafts.
- [ ] Add coverage for streaming and partial assistant output inside the thread.
- [ ] Add assertions for accessible log semantics.
- [ ] Manually validate reduced motion, scroll behavior, and resume compatibility.

Primary files:
- `src/pages/Session.test.tsx`
- any new derivation/presenter test files

Exit criteria:
- The new shell is covered by both behavior tests and manual smoke checks.
- Resume, retry, streaming, and timer flows all remain intact.

## Implementation Task Checklist

- [x] Introduce thread item types and derivation logic
- [x] Persist opening user turn at initial submit
- [x] Synthesize missing early turns for old drafts
- [ ] Replace stacked session cards with one conversation shell
- [ ] Add fixed-height log region with bottom composer
- [ ] Move energy selector into the thread
- [ ] Move steps actions into the thread
- [ ] Move timer and check-in cards into the thread
- [ ] Add centralized scroll/focus handling
- [ ] Keep countdown re-renders isolated
- [ ] Add accessible log semantics
- [ ] Update automated tests and manual validation notes

## Execution Plan

### Delivery Strategy

This work is best delivered as 4 small-to-medium PRs or 5 tightly scoped commits. The key constraint is to land the state-shape changes before the shell refactor, and to keep scroll/focus hardening separate from the first visual rewrite so regressions are easier to isolate.

Recommended rule:
- each slice should leave the session flow working end to end
- each slice should have at least one targeted verification step
- avoid mixing “new shell layout” and “scroll/focus hardening” in the same review if possible

### PR-Sized Slices

#### Slice 1: Session-flow transcript contract

**Goal:** fix the first-turn persistence timing and introduce the typed thread model.

Scope:
- move initial user-message persistence into `handleSaveStuckTask()`
- prevent duplicate first-message insertion on resumed drafts
- add thread item types and a pure derivation function
- keep the existing UI unchanged

Files:
- `src/hooks/useSessionFlow.ts`
- new thread-derivation helper or repurposed `src/components/session/TranscriptCard.tsx`
- targeted tests for the derivation logic if introduced

Suggested commit title:
- `refactor(session): prepare transcript state for chat shell`

Verification:
- opening submit still creates/resumes a draft
- no duplicate first user message on reload/resume
- existing session tests stay green

PR size:
- small to medium

Why first:
- this is the contract change everything else depends on

#### Slice 2: Conversation shell skeleton

**Goal:** replace the stacked compose/transcript/clarify layout with a single fixed-height conversation shell and bottom composer.

Scope:
- add `SessionConversationShell`
- replace the current top-level `Session.tsx` layout
- render assistant/user bubbles from derived thread items
- support compose and clarifying stages through the bottom composer
- add log semantics and labeled thread region

Files:
- `src/pages/Session.tsx`
- `src/components/session/SessionConversationShell.tsx`
- `src/components/session/StuckInput.tsx`
- `src/components/session/ClarifyingQuestion.tsx`
- `src/components/session/TranscriptCard.tsx` or replacement thread primitives

Suggested commit title:
- `feat(session): add fixed-height conversation shell`

Verification:
- opening prompt and user reply render as chat bubbles
- clarifying stage uses the same shell and composer
- thread is fixed-height and internally scrollable

PR size:
- medium

Review focus:
- visual coherence
- accessibility semantics
- no regression in compose/clarify flow

#### Slice 3: Inline structured stages

**Goal:** move energy, steps, timer, and check-in into the same conversation shell.

Scope:
- adapt `EnergySelector` for inline thread placement
- adapt `StepsList` for inline thread placement
- adapt `Timer` and `CheckIn` for inline thread placement
- ensure all non-text stages still read as part of one dialogue

Files:
- `src/components/session/EnergySelector.tsx`
- `src/components/session/StepsList.tsx`
- `src/components/session/Timer.tsx`
- `src/components/session/CheckIn.tsx`
- `src/components/session/SessionConversationShell.tsx`

Suggested commit title:
- `feat(session): embed structured stages in chat thread`

Verification:
- energy selection happens inside the thread
- generated steps render inline with retry/reorder/confirm intact
- timer and check-in remain functional inside the shell

PR size:
- medium

Review focus:
- continuity of the session flow
- whether inline controls still feel obvious and usable

#### Slice 4: Scroll, focus, and performance hardening

**Goal:** make streaming and timer behavior feel stable under real use.

Scope:
- add a single scroll controller
- preserve manual scroll position away from bottom
- auto-stick safely during streaming
- verify composer focus transitions
- keep countdown updates isolated to the timer card
- respect reduced motion

Files:
- `src/components/session/SessionConversationShell.tsx`
- any new shell scroll/focus utility
- `src/components/session/Timer.tsx`

Suggested commit title:
- `fix(session): harden chat shell scrolling and timer rendering`

Verification:
- streaming while near bottom keeps latest turn visible
- streaming while scrolled up does not yank the viewport
- timer countdown does not re-render the entire thread every second
- reduced motion mode behaves sensibly

PR size:
- small to medium

Review focus:
- race conditions
- jank under streaming
- render-scope regressions

#### Slice 5: Test and cleanup pass

**Goal:** lock in the final shell with explicit coverage and remove leftover staged-flow artifacts.

Scope:
- update `Session.test.tsx`
- add derivation tests if not already added
- remove dead or obsolete UI fragments left from the old layout
- tighten naming and component boundaries after the visual migration settles

Files:
- `src/pages/Session.test.tsx`
- any new presenter test files
- any old components left only partially used

Suggested commit title:
- `test(session): cover chat shell flows and compatibility cases`

Verification:
- targeted tests pass
- no dead staged-flow rendering path remains in `Session.tsx`

PR size:
- small

Review focus:
- simplicity
- naming
- regression coverage

### Recommended Commit Order

If this is done as commits instead of PRs, use this order:

1. `refactor(session): prepare transcript state for chat shell`
2. `feat(session): add fixed-height conversation shell`
3. `feat(session): embed structured stages in chat thread`
4. `fix(session): harden chat shell scrolling and timer rendering`
5. `test(session): cover chat shell flows and compatibility cases`

### Merge Gates Between Slices

Before starting the next slice:

- **After Slice 1**
  - confirm draft creation/resume still works
  - confirm no duplicate opening messages

- **After Slice 2**
  - confirm the shell works for compose and clarifying without touching energy/steps/timer yet
  - confirm fixed-height thread behavior on the current shell width

- **After Slice 3**
  - confirm the whole stage progression still works end to end
  - confirm timer start, stop, extend, and check-in were not visually orphaned

- **After Slice 4**
  - confirm streaming does not produce scroll jank
  - confirm countdown updates remain isolated

- **After Slice 5**
  - confirm tests describe the new contract instead of the old card layout
  - confirm dead UI paths are removed

### Suggested Reviewers By Slice

- **Slice 1:** TypeScript and data-shape review
- **Slice 2:** Frontend UX and accessibility review
- **Slice 3:** Product-flow review
- **Slice 4:** Frontend race/performance review
- **Slice 5:** Simplicity and regression review

### Anti-Scope Creep Notes

Do not combine this work with:
- prompt or model changes
- transcript schema changes
- history page redesign
- timer feature behavior changes
- generalized chat framework abstractions for future routes

If any of those become necessary, they should be split into follow-up work, not folded into the chat-shell delivery.

### UX Constraints

- Assistant and user turns must remain visually distinct through alignment, color, and bubble shape.
- The fixed-height thread must work in the current `max-w-md` shell without forcing page-level overflow.
- Streaming assistant text should feel like part of the thread, not a separate loading card.
- The UI should not regress the brainstorm’s "one screen at a time" feel by introducing split panes or dashboard-like secondary areas.
- Reordering, retry, timer stop, extension, and check-in actions must remain obvious even though they move into the thread.
- Focus should move predictably: after a text submit, either the streaming bubble or next active control is visible; after clarification completes, the composer should not retain stale focus.
- The shell should keep enough bottom padding or sentinel spacing that the docked composer never covers the latest visible content.
- Decorative motion should stay subtle and degrade cleanly for `prefers-reduced-motion`.

## Risks And Mitigations

### Risk: Duplicate or missing opening user messages

Cause:
- the initial user turn is currently inserted later than the actual user action
- historical drafts may already exist without that row

Mitigation:
- persist on initial submit going forward
- synthesize from `sessionRow.stuck_on` when no durable first-turn row exists
- add focused tests around fresh drafts and resumed drafts

### Risk: Thread derivation becomes too clever

Cause:
- mixing durable transcript rows with synthetic workflow turns can drift if the logic is scattered

Mitigation:
- centralize thread-item derivation in one presenter function or shell-level mapper
- keep persisted vs synthetic item types explicit

### Risk: Auto-scroll becomes irritating during streaming or reordering

Cause:
- fixed-height chat UIs often force-scroll unexpectedly

Mitigation:
- track whether the user is near the bottom
- only auto-scroll on safe transitions
- test streaming and retry behavior explicitly
- centralize scroll behavior in one hook or shell-level controller rather than scattering imperative scroll calls

### Risk: Inline control cards feel bolted on

Cause:
- existing components were designed as standalone sections

Mitigation:
- restyle them as thread-native surfaces with reduced chrome and clear conversational anchoring
- keep them inside the same scroll context and visual rhythm as bubbles

### Risk: Countdown updates re-render the whole thread

Cause:
- the timer runs at 1 Hz and the conversation shell is larger than the current standalone timer card

Mitigation:
- keep `useTimerCountdown()` usage isolated to the inline timer card
- pass stable props into the thread list so static bubbles do not repaint on every tick
- treat this as a regression test target because prior timer work already proved this can become expensive

### Risk: Accessibility semantics are visually correct but not announced correctly

Cause:
- chat UIs can look fine while still being silent or noisy to assistive technology

Mitigation:
- label the thread and expose it as a log region
- validate that appended assistant turns are announced politely
- keep error banners outside the log so system failures are not read as conversation turns

## Acceptance Criteria

- [ ] The session route renders a fixed-height, internally scrollable conversation panel.
- [ ] The opening prompt appears as a visible assistant turn in the thread.
- [ ] The user’s opening answer appears immediately as a right-aligned chat turn when submitted.
- [ ] The bottom composer is used for free-text replies in compose and clarifying stages.
- [ ] Energy selection appears inside the same conversation panel and does not break the thread into a separate card stack.
- [ ] Assistant streaming text appears as an in-thread bubble.
- [ ] Clarifying questions and clarifying replies read as normal chat turns.
- [ ] Generated steps, retry, reorder, and confirm controls appear inside the same conversation panel.
- [ ] Timer and check-in controls remain inside the same conversation panel.
- [ ] Existing session persistence, retry, timer, and check-in behavior continue to work.
- [ ] Resumed drafts and older sessions still render a coherent thread even if some early turns must be synthesized.
- [ ] The conversation thread is exposed with appropriate live-region semantics for sequential updates.
- [ ] Timer countdown updates do not cause the entire transcript to re-render every second.
- [ ] Smooth scrolling and decorative motion degrade when reduced-motion is requested.

## Test Plan

- Update `src/pages/Session.test.tsx` to cover:
  - opening assistant prompt is visible on first render
  - opening user reply appears immediately after submit
  - bottom composer appears for compose and clarifying stages
  - energy selector renders inline within the thread
  - steps/timer/check-in controls render inside the same thread container
  - resumed drafts with missing first transcript rows still show a coherent opening exchange
  - the thread container exposes the expected accessible role/label
- Add targeted hook or presenter tests for thread-item derivation:
  - persisted-only thread
  - synthetic opening prompt
  - synthetic missing user opening turn
  - streaming assistant turn
  - clarifying vs steps branch
  - energy-selection stage adds the correct prompt/control items
- Run existing session-flow and chat tests to confirm no regression in streaming and stage behavior
- Add render-scope verification around the inline timer card if the implementation touches shared thread state during countdown
- Manually validate:
  - streaming while scrolled at bottom
  - streaming while scrolled away from bottom
  - reduced-motion enabled
  - screen-reader announcement behavior for appended turns

## Implementation Order

1. Adjust `useSessionFlow` so the opening user turn is available at the right time.
2. Build a pure thread-item derivation layer that can mix durable and synthetic turns.
3. Implement the conversation shell with a single scroll controller, log semantics, and docked composer.
4. Restyle or adapt structured stage components for inline thread usage.
5. Verify timer countdown isolation so the shell does not re-render on every tick.
6. Update tests for the new rendering model, accessibility semantics, and compatibility cases.

## Sources

- Origin brainstorm: [docs/brainstorms/2026-03-22-session-chat-shell-brainstorm.md](/Users/piotrkreglicki/Projects/unstuck-sensei/docs/brainstorms/2026-03-22-session-chat-shell-brainstorm.md)
- Existing session flow: [src/pages/Session.tsx](/Users/piotrkreglicki/Projects/unstuck-sensei/src/pages/Session.tsx)
- Session state/persistence: [src/hooks/useSessionFlow.ts](/Users/piotrkreglicki/Projects/unstuck-sensei/src/hooks/useSessionFlow.ts)
- Current transcript UI: [src/components/session/TranscriptCard.tsx](/Users/piotrkreglicki/Projects/unstuck-sensei/src/components/session/TranscriptCard.tsx)
- Existing stage controls: [src/components/session/EnergySelector.tsx](/Users/piotrkreglicki/Projects/unstuck-sensei/src/components/session/EnergySelector.tsx)
- Existing stage controls: [src/components/session/StepsList.tsx](/Users/piotrkreglicki/Projects/unstuck-sensei/src/components/session/StepsList.tsx)
- Existing stage controls: [src/components/session/Timer.tsx](/Users/piotrkreglicki/Projects/unstuck-sensei/src/components/session/Timer.tsx)
- Existing stage controls: [src/components/session/CheckIn.tsx](/Users/piotrkreglicki/Projects/unstuck-sensei/src/components/session/CheckIn.tsx)
- Existing tests: [src/pages/Session.test.tsx](/Users/piotrkreglicki/Projects/unstuck-sensei/src/pages/Session.test.tsx)
- Institutional learning: [docs/solutions/security-issues/phase-3-p1-chat-api-and-detection-hardening.md](/Users/piotrkreglicki/Projects/unstuck-sensei/docs/solutions/security-issues/phase-3-p1-chat-api-and-detection-hardening.md)
- Institutional learning: [docs/solutions/runtime-errors/rust-timer-checkin-race-conditions.md](/Users/piotrkreglicki/Projects/unstuck-sensei/docs/solutions/runtime-errors/rust-timer-checkin-race-conditions.md)
- React docs: [useLayoutEffect](https://react.dev/reference/react/useLayoutEffect), [manipulating the DOM with refs](https://react.dev/learn/manipulating-the-dom-with-refs)
- W3C WAI: [ARIA23: role="log" for sequential updates](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA23)
- MDN: [Element.scrollIntoView()](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView), [overflow-anchor](https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-anchor), [prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/%40media/prefers-reduced-motion)
