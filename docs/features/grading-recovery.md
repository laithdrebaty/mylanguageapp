# Feature: Grading recovery and the marking queue

The route back for work AI could not finish. Without it, everything built on AI grading had a silent, permanent failure mode.

## The problem this closes

Grading runs as an in-process job, so it is lost if the server restarts between a submit and the job running. It is also skipped whenever AI was unavailable — a provider outage, an exhausted quota, a misconfiguration, a model that keeps returning nonsense. All of those are handled *safely* at the time: the answer stays `pending` rather than being marked wrong.

But `pending` was a dead end. Nothing looked for it again, and no human could mark it. A student's answer could sit unmarked indefinitely — and for a level evaluation that means **a student who passed is never promoted**. Silent and permanent, the worst combination.

Running this against the existing development database immediately surfaced one real stranded answer that had been sitting there from earlier manual testing. The problem was not hypothetical.

## How it works

**A sweeper** runs every ten minutes, finds pending work older than five minutes, and grades it again. Five minutes is long enough never to race the job already handling it — grading a written answer takes seconds, transcription tens of seconds — and short enough that a student is not waiting an hour.

**Retries are bounded.** An answer that can never be marked would otherwise be retried forever against a paid API. After three attempts it stops and is escalated. The attempt is counted *before* the try, not after, so a run that crashes still burns one — otherwise a reliably-crashing item loops forever.

**A marking queue** at `/cms/grading` shows what the retries gave up on, oldest first, because a student who submitted three days ago has been waiting three days. Each item shows the question, the student's written answer or their recording (with playback), the transcript where there is one, the passage they were asked to read, and the last error — everything needed to mark it without leaving the page.

**Marking re-finalises the attempt**, which is the point. It recomputes the score, decides pass/fail once nothing is outstanding, and applies promotion if the quiz was a level evaluation. Recording a score without that would leave the student exactly as stuck. The UI says which happened — "student passed", or how many questions are still outstanding — rather than just "saved".

**Two escape hatches:** run the sweep now (for when an administrator has just fixed the AI configuration and does not want to wait ten minutes to find out whether it worked), and reset one item's retry count (for when the reason it kept failing has been fixed and the work deserves another automatic go rather than a person's time).

By default the queue hides work still being retried automatically. A queue full of items that will clear on their own is a queue nobody trusts.

## Where the code lives

- `artifacts/api-server/src/services/grading-sweeper.ts` — the sweep, the bounds, the timer
- `artifacts/api-server/src/routes/cms/grading.ts` — queue, marking, sweep-now, retry-reset
- `artifacts/ascension/src/pages/cms/grading.tsx` — the queue screen
- `artifacts/api-server/src/index.ts` — the sweeper starts after the port is bound, not at import: a sweep runs real grading and should not compete with startup
- `artifacts/api-server/migrations/010_grading_recovery.sql`

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `GRADING_SWEEP_ENABLED` | on | Set `false` to disable entirely |
| `GRADING_SWEEP_INTERVAL_MS` | 600000 | How often to look |
| `GRADING_SWEEP_STALE_MS` | 300000 | How long before work counts as stranded |
| `GRADING_SWEEP_MAX_ATTEMPTS` | 3 | Tries before escalating to a human |
| `GRADING_SWEEP_BATCH` | 20 | Items per pass, so one sweep cannot spend a quota |

## Gaps to be aware of

1. **Every instance sweeps.** With more than one API server they all run it. Harmless — grading is idempotent and an already-marked item is skipped by the `pending` filter — but wasteful. A real queue makes this one worker, which is the same change as moving off `JOB_QUEUE=memory`.
2. **No alerting.** `countPendingWork()` returns the number waiting on a human, and nothing watches it. That number growing is the signal that AI is misconfigured, and today only someone opening the page would notice.
3. **Marking a lesson activity does not recompute lesson progress.** Quiz attempts are re-finalised; a lesson's `lesson_progress` row is not recalculated from a hand-marked block.
4. **No bulk marking.** Every item is marked one at a time, which is fine for a trickle and painful after an outage that stranded a hundred.
5. **A marked score cannot be corrected from the queue** — once marked, an item leaves it. `GET /cms/grading/recent` lists recent marks but there is no edit path.
