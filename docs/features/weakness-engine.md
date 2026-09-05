# Feature: Skill profile and weakness detection

Spec section 8 — analyse performance across lessons and assessments, identify patterns, and advise where to put effort. Section 9 draws the boundary around that advice; section 12 asks for a progress view showing what the student is good at and what needs work.

## What it does

A student sees a bar per skill — pronunciation, fluency, vocabulary, grammar, comprehension, writing, speaking — with a trend arrow, the one skill most worth working on, and specific things from their own course to go and do.

## How it works

**The profile is arithmetic.** "Weak at grammar" is a claim about a distribution: how this student scored on grammar, across enough attempts, recently. That is a mean over evidence, not a judgement. A model handed a history transcript would produce a plausible summary that changes each time you ask and cannot be traced to any attempt.

Every number comes from marks already recorded:

| Source | Contributes to |
|---|---|
| Speech assessment scores | pronunciation, fluency, speaking |
| Written grading sub-scores | grammar, vocabulary, comprehension (relevance), writing (clarity) |
| Multiple choice / multi-select | comprehension |
| Spelling | vocabulary |
| Lesson best scores | comprehension |

This is why those written sub-scores were stored separately rather than collapsed into one mark: "weak grammar across six answers" is a finding; "scored 62" is not.

**Recent work counts for more.** Evidence halves in weight every 30 days. A student who struggled two months ago and has been solid since should not still be told grammar is their weakness — that is the opposite of useful. In testing, six good recent answers moved grammar from 37 to 66 and took it off the weakness list, which is the behaviour you want.

**It refuses to speak beyond its evidence.** Below five observations a skill is low-confidence and is excluded from strengths and weaknesses entirely, and the UI names it as "not enough yet" rather than drawing a bar. Telling a student their grammar is weak on the strength of one answer is worse than saying nothing: probably wrong, discouraging, and it teaches them not to believe anything else on the page.

**Trend is measured unweighted.** Recency weighting would make the newer half dominate both halves and flatten every trend to "steady".

**Recommendations are selected, not generated.** Section 9 forbids inventing a new learning path, skipping content, or pulling the student out of the sequence. That is enforced structurally: code picks rows from the curriculum — lessons at or below the student's current level that they scored worst on, plus the specific words their recordings got wrong. The model is handed the finished list and asked to write a sentence about it. It has no way to invent a recommendation because it is never asked for one.

Nothing here recommends an AI conversation. The spec is explicit that the system should not push expensive AI activities simply because AI exists.

**The advice sentence is optional and separate.** The profile and recommendations cost nothing and load with the dashboard; the Arabic sentence costs a model call and is only fetched when the student asks. With AI switched off, everything except the sentence still works.

## Where the code lives

- `artifacts/api-server/src/services/scoring/skill-profile.ts` — the pure aggregation
- `artifacts/api-server/src/services/weakness.ts` — evidence gathering, recommendation selection, the advice call
- `artifacts/api-server/src/routes/review.ts` — `GET /review/skills`
- `artifacts/ascension/src/components/skill-profile-card.tsx` — on the student dashboard
- Tests: `skill-profile.test.ts` (26)

## Tuning

One place, at the top of `skill-profile.ts`: the 30-day half-life, the confidence thresholds, and the 65/82 weakness and strength lines. These are starting values. They are the first thing to revisit once there is real student data, which is why they are constants in one block rather than scattered through the scoring.

## Gaps to be aware of

1. **No history.** The profile is computed fresh each time from a 120-day window; nothing is stored, so there is no "your grammar over six months" chart and no way to show progress against a past snapshot.
2. **Not cached.** Every dashboard load runs five queries. Fine now; worth a short Redis cache before this is on a busy page.
3. **Comprehension is the catch-all.** Multiple-choice, relevance and lesson scores all feed it, which makes it the best-evidenced skill and the least specific one. Splitting reading comprehension from listening comprehension needs the block type to be carried through, which it currently is not for lesson attempts.
4. **No staff view.** A teacher cannot see a student's profile; there is no `/cms` or `/admin` screen for it, though the data is per-student and the endpoint would be trivial.
5. **Recommendations do not consider recency of the lesson.** A lesson scored badly four months ago ranks the same as one scored badly last week.
6. **Nothing feeds evaluation failure back in.** Failing a level evaluation is a strong signal and is not currently evidence — only the individual question scores within it are.
7. **Conversations are not evidence either.** Turns, words spoken and vocabulary used are recorded on each session (see [conversation-tutor.md](conversation-tutor.md)) but not read here, so a student who practises mainly by talking gets no speaking signal from it.
