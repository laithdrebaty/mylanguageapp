# Feature: Student-to-student voice practice

Spec section 11 — separate from the AI tutor, students practise English by talking to other learners. Matching on level, goals, interests, professional field and availability; the minimum set is matching, a voice call, ending the call, blocking and reporting. Video is explicitly left for later.

This is the only feature in the product where one student's action affects another. Everything else is a student alone with material. That difference is why blocking and reporting are part of the first version rather than a follow-up.

## What it does

A student opens **تدريب صوتي** in the sidebar, fills in what they want to practise and opts in once, deliberately, next to a plain statement of what a live call with a stranger means. From then on, "ابحث عن شريك" puts them in a pool. When two people who fit are both waiting, the one who arrived first places the call and the other's screen rings. Either can refuse without explaining. Once accepted, the two browsers connect directly and talk.

During the call the student can mute, hang up (one tap, no confirmation), **block** the other person, or **report** them. Reports go to a queue at `/cms/practice-reports` that a person works through.

## How it works

**No AI, anywhere in it.** No model is called, no AI quota is spent, and nothing here reads the AI configuration. Every input to matching is already structured — a level order, two sets of tags, a field, a set of hours — so choosing a partner is set intersection and subtraction. A model given the same inputs would rank differently between calls, could not explain a pairing to a student who asked, and would cost money per match in a product with a $5/month budget.

**The audio never reaches the server.** It is a direct WebRTC connection between the two browsers. Nothing is recorded, nothing is stored, and there is no file for anyone to listen to afterwards.

### Signalling: HTTP polling, mailbox in Postgres

WebRTC needs the two browsers to swap an SDP offer, an SDP answer and a handful of ICE candidates before audio can flow. There is no WebSocket anywhere in this codebase.

**Decision: poll over ordinary HTTP, and keep the mailbox in Postgres** (`practice_signals`). Why, and what was rejected:

- **A WebSocket** (`ws` alongside Express) is the conventional answer and would shave a second or two off call setup. It costs a new dependency, a second authentication path on the upgrade handshake, and sticky sessions or a Redis fan-out the moment there is more than one API instance — for about twenty small messages per call, none of which happen once the call is up.
- **A managed service** (LiveKit, Daily, Twilio) is fastest to working software and solves TURN too, but every one of them prices per participant-minute. A hundred students talking would leave the $5/month budget behind in the first week.
- **Redis as the mailbox** was the original plan. It was dropped for one specific reason: if Redis blips between one browser writing an offer and the other polling for it, the offer is gone and the call fails for no visible cause. `practice_signals` is about twenty small rows per call, which Postgres does not notice, and it makes the Redis-outage question moot — **this feature does not use Redis at all**, so a Redis outage cannot degrade it, let alone block it.

The cursor is the row id: a client asks for everything after the highest id it has seen. Nothing needs deleting to stay correct, and a client that misses a poll catches up on the next one. Rows are deleted when the call ends, which is also the only place a student's SDP was written down.

The cost is honest and small: call setup takes a second or two longer than a WebSocket would. Once connected, no signalling happens at all.

### TURN: not configured, and the UI says so

Roughly **10–20% of peer connections fail without a TURN relay** — symmetric NAT, restrictive mobile and corporate networks. TURN relays the actual audio, so it costs real bandwidth.

**Decision: ship STUN-only, and be loud about it.** `PRACTICE_TURN_URLS`, `PRACTICE_TURN_USERNAME` and `PRACTICE_TURN_CREDENTIAL` are read from the environment and served to the browser by `GET /practice/ice-servers`, so a relay can be switched on later without shipping new client code, and its credentials never sit in public JavaScript.

What makes this defensible rather than negligent is the failure path. The handshake has a deadline (`PRACTICE_CONNECT_TIMEOUT_MS`, 30 s). Past it the call screen says, in Arabic, that the connection could not be established, that this is usually the network type rather than a fault in the app or their account, that the system is not using a relay at the moment, and that trying Wi-Fi instead of mobile data may work. **A screen that says "connecting…" forever is the failure mode this avoids.**

If the failure rate turns out to matter in practice, self-hosting coturn is the next step and needs no application change beyond the three environment variables.

### Matching

`services/scoring/practice-match.ts` is a pure function with its own test file, because the exclusions in it are the safety rules of the feature and rules that can only be checked by making two real browsers call each other do not get checked.

It answers two questions separately. **Is this pairing allowed** (`isEligible`) and **how good is it** (the score). Refusals:

- Yourself.
- Anyone in a block relationship, in either direction.
- Anyone already in a waiting or active call.
- Anyone whose poll has gone quiet for 20 s — they closed the tab.
- Anyone more than **one sub-level away**. This is a refusal, not a low rank: a B2 and an A1 do not have a conversation, and ranking it last would still pair them whenever nobody better is waiting, which is exactly when a lonely student would accept it.

What is left is scored. Level dominates by construction — the most every tag, field and hour bonus can add together is 40, exactly the gap between "same level" (60) and "one level apart" (20). So a perfectly matched neighbour can draw level with a same-level stranger and never overtake one who also shares interests. Shared interests, goals, professional field and overlapping availability break ties, because they are what gives two strangers something to say after the greeting. Waiting time adds at most 10 points: enough to settle a tie in favour of whoever has been waiting, never enough to force a worse pairing.

A student who has not been placed yet still gets matched, ranked below any known-level pairing. Refusing them would leave the feature unusable on the day someone signs up.

**Nobody available is a real answer.** An empty pool returns an empty result and the screen says "لا يوجد أحد متاح في هذه اللحظة" — not an error.

### What the server enforces

| Bound | Where | Why there |
|---|---|---|
| One live call per person | Partial unique index on `status IN ('waiting','active')`, on each side | Two matchers picking the same waiting student a millisecond apart: the loser's insert fails on the constraint instead of putting someone in two calls |
| Daily call limit (20) | Counted in Postgres | The `MEDIA_DAILY_UPLOAD_LIMIT` precedent, not the AI-quota one — a practice call costs nothing per minute, so this is abuse control and must not fail closed |
| Maximum call length (30 min) | Checked on every poll | The server ends the call whatever the browsers think |
| Ring timeout (45 s) | Checked on every poll | An unanswered ring must not hold both people out of the pool |
| Blocks | The matching query, and again in the pure matcher | Defence in depth on the rule that matters most |

**There is no background job.** Everything that expires — an unanswered ring, an over-long call, a queue entry whose owner closed the tab — expires when someone next polls, and both sides poll every second during a call. A sweeper would exist to catch the case where nobody is looking, which is exactly the case where nothing is harmed by waiting. Stale queue entries are ignored by `last_seen_at` rather than deleted, so nothing has to be cleaned up on the way out either.

### Safety, in detail

- **A block is immediate and permanent.** It ends the call in progress, and the pair is never offered to each other again in either direction. One row is written, not two: mirroring it would tell the blocked student something about the block, which is not information they are owed.
- **Report is reachable during the call**, not only afterwards. Someone who needs to report something wants out now, so sending the report also ends the call and — by default, with a switch to turn it off — blocks the person.
- **Ending is instantaneous and unilateral.** No confirmation dialog anywhere, deliberately.
- **Every block, unblock, report and review writes a `cms_audit_logs` row.** Blocks are audited in the service rather than the route, because a block also happens as a side effect of a report.
- **Students are told what is not recorded**, in the notice on the page and again in the report dialog: the moderator will only have what the reporter writes.
- **Nothing is automatic.** No threshold suspends an account. Two people can be wrong about the same third person, and an account closed by a script has nobody to appeal to.
- The admin queue shows report and block counts per student, so a pattern is visible even though a single call is not.

## Where the code lives

- `artifacts/api-server/migrations/013_voice_practice.sql` — six tables; idempotent, verified by three consecutive runs
- `lib/db/src/schema/practice.ts`
- `artifacts/api-server/src/services/scoring/practice-match.ts` — the pure matcher
- `artifacts/api-server/src/services/practice.ts` — preferences, queue, session lifecycle, signalling, blocks, reports, ICE config
- `artifacts/api-server/src/routes/practice.ts` — the student endpoints
- `artifacts/api-server/src/routes/cms/practice-reports.ts` — the moderator queue
- `artifacts/ascension/src/hooks/use-voice-call.ts` — the WebRTC peer connection and the signalling poll
- `artifacts/ascension/src/pages/practice.tsx` — the student screen (Arabic, RTL)
- `artifacts/ascension/src/pages/cms/practice-reports.tsx` — the moderator screen (English, LTR)
- `artifacts/ascension/src/lib/practice-api.ts`
- Tests: `practice-match.test.ts` (20 — what is refused, what is preferred, and why each rule exists)

## Endpoints

```
GET    /practice/profile              preferences + the server's limits
PUT    /practice/profile              opting in is explicit
POST   /practice/queue                join the pool; matches immediately if it can
DELETE /practice/queue                leave it
POST   /practice/poll                 the one thing the client polls: presence,
                                      the pairing, and anything overdue gets closed
POST   /practice/sessions/:id/accept
POST   /practice/sessions/:id/end     { reason }
GET    /practice/ice-servers          STUN/TURN config, server-side credentials
POST   /practice/sessions/:id/signal  { kind, payload }
GET    /practice/sessions/:id/signals ?after=<id>
POST   /practice/block                { userId, sessionId }
DELETE /practice/block/:userId
GET    /practice/blocks
POST   /practice/report               { userId, sessionId, reason, detail, alsoBlock }
GET    /practice/history

GET    /cms/practice/reports          ?status=open|reviewed|actioned|all
POST   /cms/practice/reports/:id/review   { status, note }
GET    /cms/practice/students/:id     everything known about one student
```

Refusals carry a code: `NOT_OPTED_IN`, `ALREADY_IN_CALL`, `DAILY_LIMIT` (429), `SESSION_ENDED`, `NOT_YOURS` (403), `SELF`.

## Configuring it

Everything is environment variables; see `.env.example` under "Student-to-student voice practice". Nothing about this feature is configured from the CMS, and nothing about it is in the AI settings panel.

The one setting worth a decision is `PRACTICE_TURN_URLS`. Leaving it empty is the shipped state and costs roughly one connection in five.

## How it was verified

- The migration applied three times in a row against a real database, with all constraints and both partial unique indexes present afterwards.
- `pnpm run typecheck` clean across the workspace; the full suite at **253 tests passing** (233 before, 20 new).
- Two real Chromium browsers logged in as two students, in one automated run: preferences and opt-in, an empty pool showing "nobody available", the second student matching with the first, the ringing card on both sides, accepting, **a real peer connection reaching `connected` with about 58 KB of audio flowing in each direction**, mute, a report sent during the call, the call ending on *both* sides, the pair failing to re-match afterwards, and the report appearing in the moderator queue and being closed there.

One real bug was found this way and fixed: with no STUN URLs configured, the server returned an ICE server entry with an empty url list, which makes `RTCPeerConnection` throw at construction — the call never started and the screen sat on "connecting…". The server now omits the entry, and the hook treats a construction failure as a failed call rather than a spinner.

## Gaps to be aware of

1. **No TURN relay.** Roughly 10–20% of calls will not connect, more on mobile and corporate networks, and Syrian network conditions may be worse rather than better. The UI says so plainly instead of hanging, and the environment variables are ready, but this is the single biggest known limitation. Self-hosting coturn is the obvious next step.
2. **Calls are not recorded, so a report cannot be verified.** A moderator has the reporter's words, the call's timing, and the pattern of other reports and blocks — nothing more. This is a deliberate privacy decision, but it means a single he-said-she-said cannot be settled. Whether any recording is wanted for safety review is a product decision for Laith, not an engineering one, and it would change the storage design, the privacy notice, and probably which law applies.
3. **No minimum age, and no consent step beyond the opt-in switch.** The spec does not mention one. Putting minors on live unmoderated microphones with strangers deserves an explicit decision before this is opened to real students.
4. **No restriction by country, curriculum or anything else.** Anyone opted in can be matched with anyone else within one level. Whether that should be narrowed is question 2 from the handoff brief and is still open.
5. **Availability hours are UTC and barely used.** They add 4 points when they overlap. A student in a different timezone gets no benefit from them until they think in UTC, and the form says so rather than pretending otherwise. A real schedule would be better.
6. **Call setup takes a second or two longer than a WebSocket would**, because of the 1 s poll. Deliberate; see the signalling decision above.
7. **Nothing feeds practice into the skill profile.** Calls and their durations are recorded, but `weakness.ts` does not read them, so a student who practises only by talking to other learners gains no speaking evidence from it. Same gap as the AI conversation tutor.
8. **No staff view of who is practising.** There is a per-student endpoint used by the report screen, but no list of active calls or pool size for an administrator.
9. **A student cannot ask for a specific partner**, or return to someone they enjoyed talking to. History is recorded (`GET /practice/history`) but nothing uses it.
10. **The daily limit counts calls a student was part of, not calls they started.** Someone who is rung repeatedly spends their allowance on calls they did not ask for. It has not mattered at this scale, but it would under abuse.
