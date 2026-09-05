> **Update.** The provider plumbing described below has been replaced. Provider,
> API key, per-task model and per-plan limits are now database rows edited at
> `/admin/ai` — see [ai-configuration.md](ai-configuration.md). `services/ai.ts`
> no longer holds a provider factory, and the `AI_PROVIDER` / `AI_DAILY_LIMIT_*`
> environment variables are gone. What remains accurate below is the product
> question this document raises: whether "talk to AI" is a multi-turn
> conversation or one-shot evaluation. **That is now decided: both.** One-shot
> evaluation is [open-answer-grading.md](open-answer-grading.md) and
> [pronunciation.md](pronunciation.md); the multi-turn conversation is
> [conversation-tutor.md](conversation-tutor.md), with its own sessions and turns
> tables. This document is kept only for the history of that decision.

# Feature: "Talk to AI" (planned, not built yet)

## What it's supposed to do
Give students a limited number of daily AI interactions — e.g. having a conversation, getting their speaking or open-ended answers evaluated. Access and daily limits would depend on subscription plan (free = none, paid plans = a set number per day).

## Where the code lives
- `artifacts/api-server/src/services/ai.ts` — defines the shape a real AI provider would have (`evaluateSpeaking`, `evaluateOpenAnswer`) but every method just throws "not yet configured." No provider is wired up.
- `artifacts/api-server/src/services/ai-quota.ts` — daily quota counting (Redis-backed) and usage logging to a database table (`ai_usage_logs`), fully built and ready.
- No route file, page, or component currently calls either of these — there is no `/api/ai/...` endpoint anywhere yet.

## Honest status: this feature does not exist yet
This is the most important thing to flag: **the "talk to AI" feature isn't implemented at all right now** — not partially, not behind a flag. What exists is well-designed *plumbing* for it:
- A place to plug in a real AI provider (OpenAI, Anthropic, etc.) later without having to rewrite calling code.
- A daily quota system (5/day, 20/day depending on plan, 0 for free) that already correctly fails safely — if Redis is ever down, it blocks AI requests rather than accidentally letting people use it for free, which protects you from a surprise bill.
- A place to log every AI call for cost tracking and billing.

But there is no actual conversation feature — no chat endpoint, no "talk to the AI" screen in the app, and no code path that a student can currently reach. This matches what the project's own architecture notes say ("No AI in V1") — so this isn't a bug, it's just not built yet, and it's good that the app doesn't pretend otherwise anywhere in the UI.

## Quality check of what *is* there

**Solid:**
- The quota system is genuinely well thought out: it fails closed (blocks requests) if the counting system goes down, specifically to avoid giving away free AI usage by accident — a sensible call for a $2–4/month product where AI costs money per use.
- Usage is planned to be logged to a real database table for billing/audit, not just counted in a way that disappears.
- The design keeps "which AI provider" and "how much can this user use it" completely separate from the rest of the app, so swapping providers later shouldn't require touching lesson/quiz code.

**Gaps to be aware of before you build the real feature:**
1. There's no method in the AI provider interface for an actual back-and-forth conversation — only one-shot "evaluate this speaking clip" or "evaluate this written answer." If "talk to an AI" means a chat-style conversation (multiple turns, memory of what was said), that's a different shape of feature than what's stubbed out here and will need its own design (e.g. a conversation/message history table, streaming responses).
2. No route exists yet, so there's nothing to review for security/access-control on this specific feature — that review will need to happen once it's built (in particular: make sure the quota check happens *before* any AI call is made, not after, so you can't spend a request without it being counted).

## Suggested next steps
- Since this is unbuilt, this isn't a "fix the code" situation — it's a "decide what to build" one. Worth deciding early: is this a multi-turn conversation, or one-shot evaluation of a specific answer? That decision changes the data model needed (a messages/turns table vs. just logging single requests), so it's worth settling before development starts.
- When it is built, reuse `ai-quota.ts` as-is — it doesn't need rework, it just needs a real feature calling it.
