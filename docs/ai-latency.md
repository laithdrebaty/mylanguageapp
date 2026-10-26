---
name: AI latency
description: Why AI lesson blocks feel slow, where the time actually goes, and the changes that would make them feel fast. Ordered by what the student notices per hour of work. Verified against the code.
---

# AI latency — making lesson blocks feel fast

The complaint this file exists to fix: **a student submits a turn and waits with
nothing on screen.**

The headline finding is that almost none of the fix is infrastructure. A faster
server, a bigger instance or a closer region move the small numbers. The student
is waiting on the model provider, and on the fact that we hand them the reply
only once it is complete.

Everything below was checked against the code. Nothing is assumed.

Related: [ai-cost-model.md](./ai-cost-model.md) (the same levers, costed),
[DEPLOY-DIGITALOCEAN.md](./DEPLOY-DIGITALOCEAN.md).

---

## Where the time goes

One text conversation turn, roughly:

| Stage | Time | Notes |
|---|---|---|
| Quota claim (Valkey `INCR`) | ~1–5 ms | `claimQuota`, fail-closed |
| History read (Postgres) | ~5–20 ms | full session, then sliced |
| System prompt build | <1 ms | but see #2 — it is large |
| **Model generation (Haiku 4.5)** | **~1–3 s** | **the wait** |
| Usage logging | off the response | fire-and-forget by design |

A **spoken** turn adds ASR before any of this, which is seconds more and is
mostly out of our hands.

So: the model is ~90% of the wait, and the student currently sees nothing for the
whole of it.

---

## 1. Stream the response — the one that matters

**There is no streaming anywhere in the codebase.** No SSE, no chunked
responses, no `stream` in `services/ai-providers/anthropic.ts`. Every turn is a
single blocking HTTP request that resolves only when the full reply exists.

Streaming does not make the model faster. It changes **time-to-first-word from
~2 s to ~400 ms**, which is the number a person actually experiences. This is the
single largest perceived-speed improvement available, and it is worth more than
every other item on this list combined.

**Where it goes:** `anthropic.ts` (the SDK supports streaming directly), the
conversation route, and `conversation-block.tsx`, which today awaits `sendTurn`
and renders the reply in one piece.

**What to watch out for** — this is not a one-liner:

- **Proxy buffering.** App Platform's load balancer and any CDN in front must not
  buffer the response, or streaming silently degrades to the current behaviour.
- **The rate limiter and session middleware** sit in front of the route; confirm
  neither buffers.
- **Usage accounting.** Token counts arrive in the final stream event. Usage
  logging is fire-and-forget (see ai-cost-model.md #15) and must stay that way —
  but it has to read the totals from the right place.
- **Error handling mid-stream.** A provider failure after the first token cannot
  be turned into a clean HTTP error. The UI needs a partial-reply state, and
  quota refunding has to account for a turn that half-happened.
- **Arabic rendering.** Text arriving in fragments must not break RTL layout or
  grapheme clusters mid-character.

A cheaper intermediate, if streaming is deferred: show a typing indicator and
optimistically render the student's own message immediately. That does not reduce
the wait but removes the dead screen, and it is an afternoon's work.

---

## 2. Stop resending the full lesson text every turn

`buildSystemPrompt(context)` is rebuilt on **every** turn
(`services/conversation.ts`), and it carries the full lesson text. ai-cost-model.md
already recommends fixing this for cost reasons:

> Every turn currently resends the full lesson text. Sending a summary after the
> first turn cuts tokens directly, with no minimum-size threshold to clear.

It is a latency fix too: fewer input tokens means less prefill, so
time-to-first-token drops. Measured prompt size is ~1,800 tokens with a 500-word
passage, and roughly 963→1,200 tokens across ten turns.

**Prompt caching does not help here.** Haiku 4.5 requires a 4,096-token minimum
cacheable prefix; the system prompt is under half that, so the `cache_control`
marker is silently ignored. Confirmed in ai-cost-model.md with
`cache_creation_input_tokens: 0`. Do not reach for caching until either the
prompt grows past ~4k tokens or conversation moves to Sonnet 5 (1,024 minimum).

---

## 3. `HISTORY_WINDOW = 12` already protects you — keep it

`HISTORY_WINDOW = 12` in `services/conversation.ts` caps how much history is sent,
so per-turn latency **and** cost stay flat instead of compounding as a
conversation grows. ai-cost-model.md measures the effect: +25% total across ten
turns, not 10×.

This is a number to protect. Raising it re-introduces the compounding, in latency
as well as spend.

One small inefficiency worth noting: the history query reads the **entire**
session from Postgres and then slices to the last 12 in application code. On a
long session that is more rows than needed. A `ORDER BY created_at DESC LIMIT 12`
(then reversed) would read exactly what is used. Tens of milliseconds, not
seconds — do it when touching the file, not as a project.

---

## 4. Region matters, modestly

The one genuine deployment lever. Two distances are in play and they pull in
opposite directions:

- **Student → our API.** Syrian learners.
- **Our API → `api.anthropic.com` / `api.assemblyai.com`.** US-hosted.

Frankfurt (`fra1`) is the reasonable compromise and is what the deploy doc uses.
This is worth tens to low hundreds of milliseconds, not seconds — real, but an
order of magnitude below streaming.

Keep **Valkey co-located with the API**. The quota check runs before every AI
call and fails closed, so a cross-region or cross-vendor Redis would add a round
trip to every single AI interaction.

---

## 5. ASR is the slow path, and the timeout is tight

Spoken turns wait for transcription before the model runs. Two ceilings, both in
`ai-providers/assemblyai-audio.ts`:

```
AI_ASR_TIMEOUT_MS      = 60000    # per HTTP request
AI_ASR_POLL_TIMEOUT_MS = 180000   # total wait for a transcript
```

Three minutes was sized for a 30-second read-aloud. A 15-minute multichannel
peer-call job is a different shape of work and can exceed it — peer-calls
checklist #13. Raise `AI_ASR_POLL_TIMEOUT_MS` to `600000` for peer calls.

Neither variable reaches the container today (checklist #1), so both run on these
defaults regardless of what `.env` says.

Nothing here makes ASR faster; it stops a long job failing. For a *short* spoken
turn the wait is inherent — the honest fix is UI: say "transcribing…" rather than
showing a spinner that looks like the model is thinking.

---

## 6. What not to do

- **Do not buy a bigger instance to fix this.** The API spends ~20 ms on a turn.
  CPU is not the constraint.
- **Do not add prompt caching on Haiku.** The minimum prefix is not met; it is
  silently ignored. See #2.
- **Do not raise `HISTORY_WINDOW`** hoping for better replies. It costs latency
  and money, and the measured conversation quality did not need it.
- **Do not reach for a model router yet.** ai-cost-model.md assesses this: the
  stack already runs on Haiku, so there is little to route away from.

---

## Order of work

1. **Streaming** (#1) — the only change that alters what the student experiences.
2. **Typing indicator + optimistic student message** — an afternoon, and it
   removes the dead screen even before streaming lands.
3. **Trim the resent lesson text** (#2) — latency and cost together.
4. **Raise `AI_ASR_POLL_TIMEOUT_MS`** (#5) — config, prevents outright failures
   on long calls.
5. **Region: Frankfurt, Valkey co-located** (#4) — free, decided at deploy time.
6. **`LIMIT 12` on the history query** (#3) — opportunistic.

Items 4 and 5 are part of the deployment. Items 1–3 are application work, and
item 1 is where essentially all the perceived gain is.

---

## How to know it worked

There is no measurement of this today, which is worth fixing alongside the work:

- Log **time-to-first-token** separately from total generation time. Only the
  first matters to a person.
- The AssemblyAI adapter already logs elapsed time — compare one real 15-minute
  evaluation against the poll timeout before trusting it (#5).
- `ai_usage_logs` holds token counts; prompt-token growth across a session is the
  signal that #2 has regressed.
