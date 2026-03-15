# Unstuck Sensei — MVP Brainstorm

**Date:** 2026-03-12
**Status:** Draft
**Source:** original product spec (kept local) + brainstorming session

---

## What We're Building

A session-based AI coach that helps solo founders get unstuck and start working on their hardest tasks — in under 2 minutes. Positioned as a daily morning ritual, not just an on-demand tool.

**Product name:** Unstuck Sensei
**Target:** Solo founders & indie hackers
**Business model:** Lifestyle SaaS ($8–15K MRR target)
**Build timeline:** 2–4 weeks to MVP

## Why This Approach

### The Retention Problem

Validation revealed a key concern: people get the concept but **doubt they'd use it regularly**. The demand signal and willingness-to-pay tests showed moderate results — interest exists but isn't overwhelming.

The biggest objection wasn't "I'd just use ChatGPT" or "too expensive" — it was **"not sure I'd use it regularly."** This means the core value proposition resonates, but the product needs a habit trigger to survive past the novelty phase.

### The Hybrid Solution

Rather than over-building a morning-first product (too much scope for MVP) or shipping a pure on-demand tool (ignores the validation feedback), we're taking a **hybrid approach:**

1. **Build Tier 1 as originally specced** — the full session flow is the core product
2. **Add a lightweight daily email trigger** — a simple scheduled email at a user-chosen time with a CTA to start a session

This tests whether an external trigger improves retention without adding significant build complexity. The email is generic for now (no personalization) — just a daily nudge to show up.

## MVP Feature Set (Refined Tier 1)

### Core Features (from original spec)

| Feature | Description | Priority |
|---------|-------------|----------|
| **Session Start Flow** | User states what they're stuck on. AI asks 1 clarifying question, decomposes into 3–5 micro-steps. | Must-have |
| **Energy Check-in** | Low / Medium / High selector. AI adjusts step order based on energy. | Must-have |
| **Session Summary** | Shows decomposition, suggested first step, "Start working" button → 25-min countdown timer. | Must-have |
| **Session Memory** | Store each session with timestamp, task, energy, steps, feedback. Inject last 3–5 sessions as AI context. | Must-have |
| **User Auth** | Email + password or magic link via Supabase Auth. | Must-have |
| **Session History** | List of past sessions with date, task, energy. Clickable to review. | Must-have |

### New Addition: Daily Email Trigger

| Feature | Description | Priority |
|---------|-------------|----------|
| **Onboarding time picker** | During signup, ask "When do you usually start work?" Simple time picker. | Must-have |
| **Daily email** | Scheduled email at user's chosen time. Warm, buddy tone: "Hey! What's the one thing you're putting off today? Let's tackle it together." Single CTA button to start a session. | Must-have |
| **Email opt-out** | Simple unsubscribe link in email. Preference in settings. | Must-have |

### Timer (Kept in MVP)

The 25-minute countdown timer stays. It bridges "I have a plan" to "I'm actually working" — core to the value proposition. Includes:
- Countdown display after clicking "Start working on [first step]"
- Manual stop button
- Session end check-in: "Did you get started? (Yes / Somewhat / No)"

## Key Decisions

1. **Hybrid approach over pure on-demand.** Daily email trigger tests the retention hypothesis without over-building. If emails don't move the retention needle, we know the problem is deeper than trigger/habit.

2. **User-chosen email time over fixed default.** Slightly more onboarding friction, but founders work wildly different schedules. An 8am email to someone who starts at noon is spam.

3. **Warm peer tone, not "sensei" authority.** Despite the brand name, the AI's voice should feel like a supportive buddy: casual, encouraging, no hierarchy. "Let's break this down together" — not "Your task has been decomposed."

4. **Timer stays in MVP.** The decomposition alone isn't enough — the product needs to bridge all the way to action. The timer is that bridge.

5. **Brand: Unstuck Sensei.** Committed name. The "sensei" is the brand flavor, but the tone is warm/peer, not authoritative.

## Technical Stack (from spec, unchanged)

| Layer | Choice |
|-------|--------|
| Frontend | Next.js + Tailwind CSS |
| Backend | Next.js API routes or Supabase Edge Functions |
| Database | Supabase (Postgres) |
| Auth | Supabase Auth (magic link + email/password) |
| LLM | Claude Haiku 4.5 (primary) |
| Payments | Stripe (Tier 2) |
| Hosting | Vercel |
| Email | Resend (daily trigger + transactional) |

### Email Infrastructure Addition

The daily trigger email requires:
- **Resend** for sending (free tier: 100 emails/day, more than enough for early MVP)
- **Cron job** (Vercel Cron or Supabase pg_cron) to trigger emails at user-specific times
- Simple email template with single CTA button

## Core User Flow (Refined)

### First-Time User
1. **Land on marketing page** → Sign up
2. **Onboarding:** Email, password, "When do you usually start work?" (time picker)
3. **First session:** "What are you stuck on?" → Energy check → Decomposition → Start working → Timer → Check-in
4. **Next morning:** Receive daily email at chosen time → CTA links to new session

### Returning User
1. **Trigger:** Daily email OR opens app directly
2. **Session start:** "What are you stuck on?" + context note from last session
3. **Energy check → Decomposition → Start working → Timer → Check-in**
4. **Session saved to history**

### Session Flow (6 Steps, under 3 minutes)
1. "What are you stuck on?" (text input) + returning user context note
2. Energy check: Low / Medium / High (single tap)
3. AI asks max 1 clarifying question, then generates 3–5 micro-steps (energy-sequenced)
4. User confirms, reorders, or asks for re-decomposition (lightweight)
5. "Start working on [first step]" → 25-min countdown begins
6. Timer ends or manual stop → "Did you get started?" (Yes / Somewhat / No) → Session saved

## UX Principles

- **Speed over completeness.** Good-enough in 30 seconds beats perfect in 5 minutes.
- **One screen at a time.** Linear progression, no dashboards in the main flow.
- **Warmth over efficiency.** Supportive peer tone. "Let's" and "we" language.
- **No guilt.** Never shame for not completing. Next session opens fresh.
- **No productivity jargon.** No "time blocking," "deep work," or "eat the frog."

## Resolved Questions

1. **Email deliverability:** Plain text emails, no HTML branding. Feels like a message from a friend, not marketing. Higher inbox placement. Track clicks via session start link (UTM params or redirect).

2. **Time zone handling:** Auto-detect from browser using `Intl.DateTimeFormat().resolvedOptions().timeZone`. No extra onboarding question. Reliable for 99% of users.

3. **Timer end behavior:** Offer one optional extension (+25 min) when the timer ends. "Want to keep going?" with a single extend button. Caps at 2 blocks (50 min total). Then check-in.

4. **Session frequency & daily email:** Always send the daily email, but change the message based on context:
   - If no session today: "Hey! What's the one thing you're putting off today? Let's tackle it together." + CTA
   - If session already completed: "Nice work today! See you tomorrow." (reinforcement, no CTA pressure)

5. **Onboarding flow:** Keep the time picker in onboarding. It's one extra field and founders understand why it's there. The daily email is a feature, not friction. Onboarding flow: email → password → "When do you usually start work?" (time picker) → first session.

## Success Metrics (from spec)

| Phase | Metric | Target |
|-------|--------|--------|
| Week 1–4 | Return rate (2+ sessions) | 30%+ |
| Week 1–4 | "Did this help?" yes rate | 60%+ |
| Week 1–4 | "Start working" click rate | 50%+ |
| **New** | Email open rate | 40%+ |
| **New** | Email → session conversion | 15%+ |

## Kill Criteria (from spec)

After 6 weeks with 200+ signups: if return rate < 15% AND "Did this help?" yes rate < 40%, the core hypothesis is invalidated. Pivot or exit.

## What's Explicitly NOT in MVP

- Google Calendar integration (Tier 2)
- Personalized session openers based on patterns (Tier 2)
- Paywall / pricing (Tier 2)
- Weekly momentum email (Tier 2)
- Post-session rating beyond yes/somewhat/no (Tier 2)
- Community features (Tier 3)
- Slack bot (Tier 3)
- Notion/Todoist import (Tier 3)
- Native mobile app (Tier 3)
- Voice interface (Tier 3)
- Smart nudges based on patterns (Tier 2 — requires accumulated data)
