# Feature: AI conversation tutor

Spec section 4D — roughly ten minutes of conversation built on the lesson's topic, text, target vocabulary, learning objective and the student's level. Section 7 sets the rules it has to follow.

## What it does

A student opens a conversation from a lesson's dialogue block and talks to a tutor about that lesson. They can type or speak. They see how many turns and minutes are left throughout, and which of the lesson's target words they have actually used.

## How it works

**What is enforced versus what is asked for.** Most of section 7 is tone, and tone is what a prompt is for. Two things are not tone, and neither is left to the model:

- **Duration and usage.** Turns are counted and elapsed time is measured server-side. The server refuses past the cap whatever the model would have said next. Section 7 requires the duration to be limited by configuration, and a limit a model is merely *asked* to respect is not a limit. This is also the most expensive feature in the product, so the cap is the cost control too.
- **Staying on topic.** The lesson's material is the only context supplied. The model gets no curriculum, no other lessons, and no tool to fetch them, so it cannot take the student somewhere else (section 9).

**The caps are copied, not read live.** A curriculum edit mid-conversation must not change the rules a student is already playing by, so `maxTurns` and `maxMinutes` are stamped onto the session when it opens.

**One live conversation per student**, enforced by a partial unique index. Without it a student could open several and spend several times the quota in parallel, each of which passed its own check.

**The prompt is about behaviour, not character.** "At most two short sentences, then ONE question", "never list their errors", "do not lecture". A model told to be "a helpful, engaging tutor" writes essays; a model told to keep it to two sentences and ask one question keeps the student talking, which is what section 4D actually asks for.

**Vocabulary use is counted, not judged.** Which target words the student used is computed by matching normalised whole words — so "worked" does not count as having used "work". Using the exact target word is the thing being measured, and a looser match would inflate it into meaninglessness.

**History is windowed at twelve messages.** The whole conversation would grow the prompt, and the bill, quadratically across twenty turns. Verified in testing: message count per call rose 2, 3, 5, 7, 9, 11, 13 and then held flat at 14 — system prompt, twelve messages of history, and the new turn.

**Speaking reuses the pronunciation pipeline.** A spoken turn is uploaded through the same verified media path, transcribed with the same `transcription` task, and the transcript becomes the message. Configuring two speech providers for one product would be a trap for whoever sets it up. The transcript is shown back to the student, so a misheard turn is visible rather than leaving them wondering why the reply makes no sense.

## Where the code lives

- `artifacts/api-server/src/services/conversation.ts` — sessions, caps, the prompt, vocabulary counting, spoken-turn transcription
- `artifacts/api-server/src/routes/conversation.ts` — start, turn, end, resume
- `artifacts/ascension/src/components/conversation-block.tsx` — the chat, mounted on a lesson's dialogue block
- `artifacts/api-server/migrations/011_conversation.sql`
- Tests: `conversation.test.ts` (15 — vocabulary matching and the prompt's constraints)

## Configuring one

A `dialogue` block on a lesson becomes a conversation. Its `config.maxTurns` and `estimatedMinutes` set the caps; without them the defaults are 20 turns and 10 minutes. The lesson's title, objectives, first text block and vocabulary rows are what the tutor is given.

The `conversation` task must be enabled at `/admin/ai`, and the plan's `conversation` daily limit is what bounds cost per student. The seeded default of 5 per day for `general_english` means five model calls — one greeting plus four turns — which is worth knowing before setting a 20-turn block loose on that plan.

## Gaps to be aware of

1. **The per-plan daily limit counts model calls, not conversations.** A 20-turn block on a plan with a limit of 5 gives the student four turns and then stops. The limit and the block's cap are set in different places and nothing warns when they contradict each other.
2. **Nothing feeds the conversation into the skill profile.** Turns, words spoken and vocabulary used are all recorded on the session, but `weakness.ts` does not read them, so a student who only ever practises by talking has no speaking evidence from it.
3. **No corrections are extracted.** The tutor corrects mistakes inline as section 7 asks, but nothing parses those out, so they are not counted as grammar evidence and cannot be reviewed later.
4. **Abandoned sessions are never swept.** A student who closes the tab leaves an `active` row, and the one-live-conversation index then blocks them from starting another until it is ended by hand. The grading sweeper's pattern would fit here.
5. **No staff view.** Transcripts are stored but nothing displays them, so a teacher cannot see how a conversation went.
6. **Time is checked only when a turn is taken.** A student who leaves the tab open past the limit is refused on their next turn rather than being told at the moment it expires.
