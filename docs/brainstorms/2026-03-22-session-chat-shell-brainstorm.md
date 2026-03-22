---
date: 2026-03-22
topic: session-chat-shell
---

# Session Chat Shell

## What We're Building

We are reshaping the session experience so it reads as a proper dialogue between the user and the AI sensei, instead of a stack of separate stage cards. The session keeps the current underlying flow and business rules, but the UI should feel closer to a familiar messaging app.

The core interaction becomes a fixed-height chat panel with a bottom composer. The opening prompt, the user's stuck-task reply, the clarifying question, and the user's clarification all appear as chat turns in one continuous thread. Later structured moments such as energy selection, generated steps, and confirmation also stay inside the same conversation panel so the full session feels like one coherent exchange.

## Why This Approach

We considered three directions:

1. Keep the current staged flow and only restyle transcript bubbles. This is the smallest change, but it would still feel like a form with a side transcript rather than a true conversation.
2. Keep the current session logic, but present the whole flow inside a single chat shell. This is the recommended option because it delivers the familiar chat UX without forcing a risky rewrite of the session model.
3. Rebuild the session as a fully chat-native state machine. This would create the purest messaging metaphor, but it adds complexity before we know whether the presentation change alone solves the UX problem.

We chose option 2. It is the simplest path that makes the experience feel like “a proper dialogue” while preserving the current flow logic, transcript persistence, and structured controls.

## Key Decisions

- Use a fixed-height conversation area: the thread should feel stable and scroll within its own panel instead of growing the whole page.
- Keep a bottom composer: active user input should live in a familiar messaging-style composer anchored at the bottom of the chat panel.
- Render all prompts and replies as chat turns: the session opening prompt, clarifying question, and both user answers should appear as bubbles in the visible transcript.
- Keep structured controls inside the chat shell: energy selection, step generation, and confirmation remain part of the same conversation surface rather than breaking back out into separate cards.
- Use clear role styling: user and assistant messages should differ by alignment, color, and visual weight so the exchange is instantly legible.

## Resolved Questions

- Should this be a visual polish or a deeper shell change? A deeper shell change: the whole session should read as one conversation.
- Should opening prompts become visible chat turns? Yes, both prompts and user responses belong in the transcript.
- Where should typing happen? In a bottom composer, consistent with familiar chat apps.
- Should later controls stay in the same panel? Yes, structured controls should still live inside the conversation shell.

## Open Questions

None for the brainstorm phase.

## Next Steps

Move to planning with a UI-focused scope:
- define how stage transitions map into chat turns
- define which structured controls stay interactive inside the thread
- define fixed-height and overflow behavior for desktop and smaller screens
