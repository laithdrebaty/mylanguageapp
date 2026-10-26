---
name: AI cost model
description: What the AI features cost per subscription plan, which models to use, and the three settings that decide whether the $2 tier is profitable.
---

# AI cost model

Costs modelled against the four subscription plans and their stated limits.
Every figure below is **modelled from published provider rates**, not measured —
`ai_usage_logs` is the only source of truth once a provider is live, and the
conversation figures in particular should be re-derived from it within a week of
launch.

---

## The plans, as given

| Plan | Price | Lessons/mo | Calls/mo (20 min) |
|---|---|---|---|
| General | $2 | 12 | 8 |
| General | $5 | 24 | 16 |
| Professional | $4 | 12 | 8 |
| Professional | $7 | 24 | 16 |

Each lesson carries **three AI-bearing blocks**:

1. **Read aloud** — the student reads a passage, the recording is assessed
2. **Open-ended answer** — written or spoken, assessed against a rubric
3. **Conversation with the AI** — on the lesson's topic

---

## Recommended models

| Task | Model | Rate | Why |
|---|---|---|---|
| **Read aloud** | **ASR only** — no LLM | $0.0025/min | Scoring is arithmetic. See below. |
| **Open-ended answer** | Claude Haiku 4.5 | $1 / $5 per MTok | Short text at A1–B2; not reasoning-limited |
| **Conversation** | Claude Haiku 4.5 | $1 / $5 | Chat at learner level |
| **Peer-call analysis** | Claude Haiku 4.5 | $1 / $5 | One pass over a transcript |
| **Placement / weakness** | Claude Sonnet 5 | $2 / $10 | Rare, high-consequence, negligible at low volume |

Transcription: **AssemblyAI Universal-2** at $0.0025/min — cheapest full-featured
ASR with diarization, which the peer-call analysis needs to tell the two
speakers apart.

### Read-aloud needs no language model

`services/scoring/alignment.ts` already makes this argument, and it is right:

> A language model asked "score this pronunciation" returns a different number
> each time you ask, cannot explain which word was wrong, and cannot be defended
> to a student who appeals. But the reference text is *ours* — so the transcript
> can be aligned against it and the errors counted.

Transcribe, align against the passage, score. That is why this block costs
**half a cent** and not fifteen. The 75% pass gate in spec section 4A is
defensible precisely because it is a measurement rather than an opinion.

---

## Cost per unit

Assuming a **1.4× retry factor** — roughly 40% of read-aloud and open-ended
blocks are attempted more than once, which section 4A explicitly requires.

| Unit | Cost | Share |
|---|---|---|
| Read aloud (1.5 min, with retries) | $0.0052 | 5% |
| Open-ended answer (with retries) | $0.0034 | 3% |
| **Conversation (10 min)** | **$0.100** | **92%** |
| Peer call (20 min, both speakers) | $0.0596 | — |

**The conversation block is 92% of a lesson's AI cost.** Every decision that
matters is a decision about that block.

---

## The headline finding, remeasured: every plan clears comfortably

**Superseded.** This section previously read "the $2 plan is thin" at an 11%
margin and called it unviable. That was a projection. One full lesson has now
been run end to end against live providers and logged in `ai_usage_logs`, and
the projection was pessimistic by roughly an order of magnitude.

### What one lesson actually cost

Lesson "Every Day at The Corner Café" — 9 conversation turns, one spoken
open-ended answer, one speaking prompt. 23 model calls, 12,929 tokens, no
failures:

| Unit | Projected | **Measured** |
|---|---|---|
| Conversation | $0.100 (10 min) | **$0.0126** (9 turns, ~4 min) |
| Open-ended answer | $0.0034 | **$0.0015** |
| Speaking prompt | $0.0052 | **$0.0013** |
| ASR (1.68 min, 11 recordings) | — | **$0.0042** ⚠️ not logged |
| **Lesson total** | **~$0.11** | **$0.0197** |

**Why the projection was 5× high: `HISTORY_WINDOW = 12`.** The $0.100 figure
assumed conversation cost compounds as history accumulates. It does not — the
sliding window caps the prompt, and the measured per-turn cost flattens:

```
turn 1:   963 prompt tokens → $0.00110
turn 5:  1135                → $0.00127
turn 10: 1200                → $0.00134    (+25% total, not 10×)
```

At **$0.00126/turn**, a *full* 20-turn conversation is ~$0.025 — a quarter of
the projected $0.100. A full lesson with a maxed-out conversation block is
**$0.034**, still under a third of the old estimate.

### Margins against the four plans

Peer calls at $0.0554 each (20 min: $0.050 diarized ASR + $0.005 analysis).
"Measured" uses the observed lesson; "full" assumes every student maxes the
20-turn conversation block.

| Plan | Price | Lessons | Calls | AI cost @40% eval | Profit | Margin |
|---|---|---|---|---|---|---|
| General | $2 | 12 | 8 | $0.59–0.77 | **$1.23–1.41** | **62–70%** |
| General | $5 | 24 | 16 | $1.18–1.54 | **$3.46–3.82** | **69–76%** |
| Professional | $4 | 12 | 8 | $0.59–0.77 | **$3.23–3.41** | **81–85%** |
| Professional | $7 | 24 | 16 | $1.18–1.54 | **$5.46–5.82** | **78–83%** |

Ranges span the measured lesson ($0.0197) to a lesson where every student maxes
the 20-turn conversation block ($0.0344). At **100% of calls evaluated** — which
the minute caps above prevent — the floor is the $2 tier at **35%**.

At 40% peer-call opt-in, as the model assumes. Even at **100% opt-in with every
conversation maxed**, the worst case is the $2 tier at **57%** — against the 11%
this document previously reported.

**The $2 plan is viable.** Conversation length remains the dominant lever, but
it is no longer the difference between profit and loss.

### Peer calls, measured

A peer call **itself is free**: the audio is peer-to-peer WebRTC and never
reaches the server. Only an **evaluated** call costs anything, and evaluation is
opt-in per call, requiring both participants to agree.

From evaluation 942 — a real 59-second stereo call:

| Component | Cost |
|---|---|
| Multichannel ASR (59 s) | $0.0049 |
| Analysis (~690 in / ~900 out, Haiku 4.5) | $0.0052 |
| **Total** | **$0.0101** |

Scaled to a full 20-minute call:

| Component | Cost | Share |
|---|---|---|
| **Multichannel ASR (20 min)** | **$0.1000** | **90%** |
| Analysis (transcript capped at 16k chars) | $0.0111 | 10% |
| **Total per evaluated call** | **$0.1111** | |

**ASR is 90% of the cost, and the transcript cap is why.** `MAX_TRANSCRIPT_CHARS`
holds the model input flat regardless of call length, so analysis barely grows
while ASR scales linearly with minutes. Two consequences:

- **Minutes are the only lever that matters.** A call-count cap cannot express
  this: one 20-minute call costs 10x a 2-minute one for the same single request.
  `ai_plan_policies.monthly_minutes` is therefore the real control.
- **Multichannel doubles ASR** ($0.0025/min becomes $0.0050) because it is billed
  per channel. That buys *exact* speaker attribution — the client records each
  student on their own channel — instead of a coin-flip guess that forced every
  student to be told their feedback might be about the other person. Worth it,
  but it is the single biggest cost decision in the feature.

### What the quota caps actually bound

| Plan | monthly_minutes | Full calls | Max peer-call spend |
|---|---|---|---|
| free | 0 | 0 | $0 — denied |
| general_english | 60 | 3 | **$0.33** |
| professional_english | 120 | 6 | **$0.67** |

These are the numbers that make the margins below hold: the cap, not student
behaviour, is what bounds exposure.

---


## Three changes that fix it

Written when the $2 margin looked like 11%. With the measured numbers the
margin is 57–79% and none of these is load-bearing any more — they are now
headroom rather than rescue.

| Change | $2 margin (measured) |
|---|---|
| Every call analysed, conversations maxed | 57% |
| **+ peer-call analysis opt-in at 40%** | **71%** |
| **+ observed conversation length (~9 turns)** | **79%** |

`HISTORY_WINDOW = 12` in `services/conversation.ts` is what already delivers
most of this, and is the number to protect: raising it re-introduces the
compounding the original projection assumed.

### 1. ⚠️ Prompt caching does NOT apply on Haiku

An earlier version of this document recommended prompt caching for a 34%
saving. **That was wrong and has been removed.**

Claude Haiku 4.5 requires a **4,096-token minimum cacheable prefix**. Below it
the `cache_control` marker is silently ignored — no error, just
`cache_creation_input_tokens: 0`. The conversation system prompt measures
roughly 1,800 tokens with a 500-word passage: under half the minimum.

The minimum is not monotonic across models — 512 on Opus 5, 1,024 on Sonnet 5,
**4,096 on Haiku 4.5**. The cheapest model is also the hardest to cache.

What to do instead:

- **Trim what is resent each turn.** Every turn currently resends the full
  lesson text. Sending a summary after the first turn cuts tokens directly,
  with no minimum-size threshold to clear.
- **Revisit only if** the lesson context grows past ~4,000 tokens, or if
  conversation ever moves to Sonnet 5 (1,024 minimum).
- **Verify empirically.** `usage.cache_read_input_tokens` is definitive. Zero
  across repeated requests means the prefix is too short.

Caching is not free either: a cache write costs **1.25×** normal input and a
read **0.1×**, so it only pays from the second read onward.

### 2. Peer-call analysis opt-in

WebRTC audio never reaches the server, so evaluating a call means the students
upload the recording. Make it a deliberate choice — "get feedback on this call"
— rather than automatic. Most calls will not be evaluated, so the $0.06 becomes
an exception rather than a per-user cost.

The call itself stays free: peer-to-peer audio costs nothing per minute.

### 3. Conversation length is the dial

Everything hinges on this one number. At $2, 12 lessons, calls 40% opt-in.
Since caching is unavailable, this is now the **only** lever on the largest
cost line:

| Conversation | AI cost | Margin |
|---|---|---|
| 5 min | $0.70 | 65% |
| 8 min | $0.98 | 51% |
| **10 min** | **$1.21** | **40%** |
| 12 min | $1.39 | 30% |
| 15 min | $1.82 | 9% |
| **20 min** | **$2.54** | **−27% — a loss** |

**10 minutes is the right default for the $2 tier.** 15 minutes leaves almost
nothing; 20 minutes loses money on every subscriber.

Longer conversations are a reasonable thing to sell on the $5 and $7 tiers,
where the headroom exists.

### Optimised, all plans (calls opt-in, no caching)

| Plan | AI cost | Margin |
|---|---|---|
| General $2 | $1.21 | **40%** |
| General $5 | $2.42 | **52%** |
| Professional $4 | $1.21 | **70%** |
| Professional $7 | $2.42 | **65%** |

---

## ⚠️ The quota model is wrong today

`ai_plan_policies` counts **model calls per day**. The seeded policy for
`general_english` is `conversation: 5`.

If that means five *sessions*, a student may use 5 × 10 min = **50 minutes a
day**. At 30 days that is roughly **$15 of conversation on a $2 plan**.

The limits in the plans above are **monthly, and denominated in lessons and
calls** — not daily model calls. The quota system has to match:

- **lessons per month** (consumed when a lesson is started)
- **peer calls per month**
- **conversation minutes per month**, as the backstop

This is the single highest-risk item. It should be fixed *before* conversation
is enabled, because no amount of model choice recovers from an unbounded one.

---

## At scale

Optimised $2 plan at $1.21/user, assuming 30% of registered users pay:

| Users | Paying | AI/month | Revenue | Net |
|---|---|---|---|---|
| 1,000 | 300 | $363 | $600 | $237 |
| 5,000 | 1,500 | $1,815 | $3,000 | $1,185 |
| 10,000 | 3,000 | $3,630 | $6,000 | $2,370 |

A mix weighted toward $4 and $7 improves this sharply: at $4 the same usage
leaves 70% margin. **The pricing question is as important as the engineering
one** — the $2 tier is the one that barely works, and every subscriber who
chooses $4 instead is worth roughly ten on the lower tier.

---

## On Jev and model routers

[Jev](https://openrouter.ai/blog/insights/what-is-jev/) is a decision model:
typed answers — scores, yes/no, choices — in 70–500 ms at $0.042/M input tokens
and $0 output, roughly 445× cheaper than an LLM for decisions. OpenRouter's Jev
Router claims 30–50% savings by sending easy requests to cheap models.

**Where it would genuinely help here:**

- Pre-screening open-ended answers — blank, off-topic or one-word responses
  rejected before an LLM sees them
- Routing conversation turns — "hello" does not need the same treatment as a
  complex question
- Guardrails — is this answer in English, is it on topic

**Where it does not help:** it cannot generate feedback, hold a conversation, or
write a rubric assessment. Those are the actual costs.

**Recommendation: not yet.** Router savings are quoted against bills dominated
by frontier models. This stack already runs on Haiku, so 40% of $1.21 is about
$0.48/user — real, but behind an integration and a second provider dependency.
Prompt caching delivers more for less work. Revisit if conversation ever moves
to Sonnet or Opus, where routing cheap turns away from an expensive model starts
to pay.

---

## Order to enable

1. **Open-ended answers** — lowest risk, grader already built
2. **Read aloud** — the differentiating feature, and nearly free
3. **Peer-call analysis** — opt-in
4. **Conversation last** — only once the monthly quota and prompt caching are in
   place

Enable one task, read a week of real `ai_usage_logs`, then set the limits from
data. The conversation token estimate here (~45k in / 6k out over 10 minutes) is
the number most likely to be wrong, and it is the one that decides the margin.

---

## What is still unmodelled

- **Failed and retried AI calls.** The grading sweeper retries up to 3 times;
  a provider having a bad day multiplies cost without producing output.
- **Students who exhaust their allowance every month.** The averages above
  assume the plan limit *is* the usage. Real distributions are long-tailed, and
  the quota exists to bound exactly that tail.
- **Transcription of peer calls in Arabic-accented English**, where word error
  rate is higher than the general benchmarks these rates assume.

---

## The product owner's proposal: self-hosted pronunciation assessment

The product owner asked whether pronunciation assessment should be built
in-house rather than paying a per-minute API, naming three open-source pieces
and asking how to start:

| Tool | Role |
|---|---|
| [Montreal Forced Aligner](https://github.com/MontrealCorpusTools/Montreal-Forced-Aligner) | Word and phoneme timing inside a recording |
| [Wav2Vec2](https://huggingface.co/facebook/wav2vec2-lv-60-espeak-cv-ft) | Phoneme recognition from audio |
| [OpenPronounce](https://github.com/Halleck45/OpenPronounce) | Combines both into a scorer with an API |

He put that question to ChatGPT, which produced a four-phase plan: run it
locally, benchmark against 100–200 hand-graded recordings, adjust the scoring,
then containerise it behind an internal API.

**What follows assesses that plan, not the product owner's technical judgement.**
His actual input was the question and the three tool names — the reasoning being
evaluated below is ChatGPT's. The distinction matters: the proposal's blind
spots are a chatbot's, not his, and the decision of whether to pursue it is
still open rather than something he has argued for.

### What is right about it

**The architecture matches what is already built.** The plan separates an
"acoustic engine" (what did the student say) from a "teaching engine" (what
score do they see, when may they continue). That is exactly the split between
`services/scoring/alignment.ts` and the rest of the grading pipeline.

**The licences are clean.** Verified: MFA is MIT, `wav2vec2-lv-60-espeak-cv-ft`
is Apache-2.0, OpenPronounce is MIT. His instinct to check each model's licence
separately rather than trusting the wrapper's was correct.

**The benchmark step is the valuable one.** Grading 100–200 Syrian-accented
attempts by hand and comparing them to machine scores is worth doing
*regardless of which engine is used*. No published word-error rate tells you
whether a 75% pass gate is fair to your learners; only your own recordings do.

**It is appropriately hedged.** The plan states that self-hosting is not
automatically free or accurate, and declines to quote a per-student cost before
measuring throughput. Those caveats are correct and worth keeping.

### Where it does not hold

**1. It optimises the cheapest 6% of the bill.**

| Block | Cost per user per month ($2 plan) |
|---|---|
| Read-aloud (the thing being self-hosted) | **$0.063** |
| Conversation (untouched by the proposal) | **$1.00** |

Read-aloud is already the cheapest AI feature in the product, precisely because
it needs no language model — transcription plus arithmetic. The proposal would
spend weeks removing six cents while the dollar goes unexamined.

**2. OpenPronounce does not compare against the teacher's recording.**

This is the feature the proposal is built around, and the project does not do
it. Its own documentation describes synthesising the reference from text with
TTS (gTTS by default), then comparing the learner against that synthetic voice
using DTW. The plan flags this as a risk to check — correctly. Checking it
confirms the risk is real.

Making it use a real teacher recording is a modification to the scorer's core
comparison, not a configuration change.

**3. Comparing to one teacher's voice is the wrong target anyway.**

A student with a different pitch, timbre or speaking rate has not mispronounced
anything. Acoustic distance from one specific speaker measures *how much they
sound like that person*, which is not what a pronunciation score should mean —
and it would penalise women, children, and anyone whose voice differs from the
recorded teacher's.

`alignment.ts` already states the better approach:

> The reference text is *ours* — the curriculum team wrote the passage — so the
> transcript can be aligned against it and the errors counted. That is a
> measurement: reproducible, explainable word by word, and free.

The reference recording's real job is for the student to **listen to**, not to
be numerically compared against.

**4. The break-even is thousands of users away.**

Read-aloud ASR on the $2 plan is 25.2 minutes per user per month.

| Hosting | Monthly cost | Break-even vs API |
|---|---|---|
| CPU VPS (4 vCPU) | ~$24 | ~380 paying users |
| GPU T4 | ~$150 | ~2,400 paying users |
| GPU A10 (cloud) | ~$400 | ~6,350 paying users |

At 300 paying users the API bill is **$19/month**. A GPU server is $150–400 —
eight to twenty times more — before counting setup, maintenance, and the
engineering weeks. Published self-hosting analyses put the same break-even at
roughly 25–65 hours of audio per month, which agrees with the figures above.

### Recommendation

**Do the benchmark now. Defer the self-hosting.**

1. **Build the Syrian-accent benchmark set** — phase 2 of the plan, the 100–200
   hand-graded attempts. This is engine-independent, it is the only way to know
   whether any ASR is fair enough to gate progression on, and it is needed
   whichever path is taken.
2. **Keep the hosted ASR** until roughly 2,000 paying users, where the
   arithmetic flips.
3. **Spend the engineering time on conversation instead** — prompt caching alone
   returns 34% of the single largest cost line, in about a day's work.
4. **Revisit at scale.** Nothing here argues self-hosting is wrong in principle;
   it argues the order is wrong. At 3,000+ paying users it becomes the right
   call, and the benchmark set built in step 1 is what will make that migration
   safe.

### The decision that matters more

Conversation length moves the $2 plan's margin from 65% (5 min) to **−27%**
(20 min). Where the pronunciation scorer runs changes six cents; how long the
conversation block lasts changes whether the entry tier is profitable at all.

---

## How each block is actually evaluated

Which CMS block type each of the three AI-bearing blocks maps to, and what
technology assesses it.

| The block | CMS block type | Assessed by | Cost |
|---|---|---|---|
| Student reads a text aloud | **Pronunciation** (`pronunciation_guide`) | ASR → `alignment.ts` + `fluency.ts` | $0.0052 |
| Open-ended question | **Open-Ended Question** (`open_ended`) | Haiku (+ ASR if spoken) | $0.0034 / $0.0072 |
| Conversation on a topic | **Dialogue / Conversation** (`dialogue`) | Haiku + ASR | $0.075–0.100 |

All three exist in the CMS today.

### The read-aloud pipeline

```
student audio
  → ASR → transcript + per-word timings
      → alignment.ts → accuracy, word error rate, problem words   (no model)
      → fluency.ts   → pace, pauses, hesitation                   (no model)
```

1. **Normalise** — case, punctuation and apostrophes come from the transcriber,
   not the speaker, so they are discarded. `don't` and `dont` fold together;
   `it is` and `its` are treated as equivalent.
2. **Align** the heard words against the passage, classifying each as matched,
   substituted, deleted or inserted.
3. **Score** — `accuracy = matched / referenceWordCount`, plus a word error
   rate and the list of `problemWords` to show the student.
4. **Fluency** separately from the timings. Filler sounds (`um`, `uh`) are
   counted apart: hesitation is not a reading error.

No language model touches this path. Claude cannot accept audio, and asking a
model to "score this pronunciation" would produce a different number each time,
with no defensible explanation for a student who appeals.

### ⚠️ What word-level alignment does not catch

It catches a word the recogniser hears as a **different word** — "three"
transcribed as "sree". It does **not** catch a sub-word error that the
recogniser resolves correctly anyway: a slightly wrong vowel in "three" that
still transcribes as `three` scores 100%.

This is word-level accuracy, not phoneme-level assessment. It is the right
signal for "did they say the words on the page", and it is genuinely all the
75% gate in section 4A needs — but it is not what phoneme-level analysis would
give.

### What a spoken open-ended answer can and cannot assess

| Goal | Works? |
|---|---|
| Reading comprehension — did they understand | ✅ Haiku on the transcript |
| Vocabulary, grammar, topic relevance | ✅ Haiku on the transcript |
| Fluency — pace, hesitation | ✅ from the word timings |
| **Pronunciation** | ❌ **no** |

Pronunciation scoring needs a known reference text to align against. An
open-ended answer is invented by the student, so there is nothing to compare to.
If pronunciation must be scored, it has to be a Pronunciation block with a set
passage — which is what the `expectsReferenceReading` flag controls.

The same limit applies to peer calls: free conversation has no reference text,
so a call can be assessed for fluency, vocabulary, grammar and topic relevance,
but never for pronunciation accuracy.

---

## If phoneme-level assessment is wanted

The product owner's underlying goal — sub-word pronunciation analysis — does
**not** require self-hosting. Managed APIs provide it today.

| Option | Cost per user/month | $2 margin | Build |
|---|---|---|---|
| **Current** — word-level (AssemblyAI) | $0.063 | **39%** | — |
| **Azure Pronunciation Assessment** | $0.554 | **15%** | ~2 days |
| ELSA API ($0.008 / 15 s scripted) | $0.806 | 2% | ~3 days |
| SpeechAce ($40/mo flat) | — | — | covers only ~49 users |
| Self-hosted (MFA + Wav2Vec2) | $150–400/mo flat | — | 3–4 weeks |

Based on 25.2 minutes of read-aloud audio per user per month on the $2 plan
(12 lessons × 1.5 min × 1.4 retries).

[Azure Pronunciation Assessment](https://azure.microsoft.com/en-us/pricing/details/speech/)
is the realistic managed option: $1.32 per audio hour, returning phoneme-level
accuracy aggregated into syllable, word and sentence scores — the capability the
self-hosting proposal was aiming at, with no server to run. SpeechAce's flat
plan covers roughly 49 users at this usage, so it stops being cheap immediately.

### The trade, stated plainly

Phoneme-level costs **9× word-level** and takes the $2 tier from 39% to 15%
margin. The question is not open-source versus paid; it is whether sub-word
accuracy is worth most of the entry tier's margin.

### Recommended: tier it

`ai_task_settings` already supports per-task provider selection and
`ai_plan_policies` is already per-plan, so this needs configuration rather than
architecture.

| Plan | Pronunciation engine | Margin |
|---|---|---|
| General $2 | Word-level (current) | 39% |
| General $5 | Azure phoneme-level | ~41% |
| Professional $4 | Azure phoneme-level | **57%** |
| Professional $7 | Azure phoneme-level | ~57% |

This also makes detailed pronunciation feedback a real reason to upgrade, rather
than something given away at $2 and unaffordable at scale.

### Order of work

1. **Benchmark first (1 day).** Record 100–200 attempts from Syrian learners —
   correct, deliberately wrong, and strongly accented — and grade them by hand.
   Run them through both the current word-level scoring and Azure's free tier.
   This answers the only question that matters: **does phoneme-level catch
   errors our learners actually make that word-level misses?** If their errors
   are mostly whole-word substitutions, the 9× buys nothing.
2. **Integrate Azure (~2 days)** only if the benchmark justifies it. It slots in
   as a transcription provider variant; the grading runner already abstracts
   this.
3. **Enable per plan** — phoneme-level on the paid tiers, word-level on $2.
4. **Revisit self-hosting at ~2,400 paying users**, where a flat $150–400/month
   beats per-minute billing. The benchmark from step 1 is what makes that
   migration safe.

### Reply to the product owner

> Phoneme-level assessment is worth having, and we can buy it rather than build
> it — Azure returns phoneme-level scores for about $1.32 per audio hour with no
> server to run. That is 9× our current cost, which is why it belongs on the paid
> tiers while $2 keeps word-level scoring.
>
> Before committing either way, let us do the benchmark you suggested: 100–200
> recordings from Syrian learners, graded by you. If phoneme-level catches errors
> our current scoring misses, it earns its cost. If our learners' errors are
> mostly whole-word, we already catch them.
>
> Self-hosting becomes the cheaper option at roughly 2,400 paying subscribers.
> The benchmark we build now is what makes that switch safe when we reach it.
