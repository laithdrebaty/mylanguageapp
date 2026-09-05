/**
 * Choosing who a student practises English with.
 *
 * Spec section 11: match on English level, learning goals, interests,
 * professional field and availability.
 *
 * WHY THIS IS ARITHMETIC AND NOT A MODEL
 * ───────────────────────────────────────
 * Every input here is already structured: a level order, two sets of tags, a
 * field, a set of hours. Comparing them is set intersection and subtraction.
 * A model given the same inputs would produce a ranking that changes between
 * calls, cannot be explained to a student who asks why they were paired with
 * someone, and costs money per match in a product with a $5/month budget.
 *
 * WHAT THE RANKING IS FOR
 * ────────────────────────
 * Two things, in this order:
 *
 *   1. Refusing.  A B2 speaker and an A1 speaker do not have a conversation;
 *      they have four minutes of embarrassment. Level distance past
 *      MAX_LEVEL_GAP is not ranked low, it is excluded — "nobody is available
 *      right now" is a better answer than a pairing that fails for both people.
 *
 *   2. Ranking what is left.  Shared interests and a shared professional field
 *      are what give two strangers something to say once the greeting is over.
 *      They break ties; they never override level, and they never let a blocked
 *      or busy candidate through.
 *
 * This is a pure function on purpose: the exclusions below are the safety rules
 * of the feature, and safety rules that can only be verified by making two real
 * browsers call each other do not get verified.
 */

/** Levels further apart than this are not offered to each other at all. */
export const MAX_LEVEL_GAP = 1;

/** How long a candidate's poll can be stale before they are treated as gone. */
export const CANDIDATE_STALE_MS = 20_000;

export interface PracticeCandidate {
  userId: number;
  /**
   * `levels.order` — the curriculum's own ordering, not a CEFR string, so the
   * distance between two students is a subtraction.
   *
   * Null for a student who has not been placed yet.
   */
  levelOrder: number | null;
  goals: string[];
  interests: string[];
  professionalField: string | null;
  /** Hours of the day (UTC, 0–23) this student said they are usually around. */
  availableHours: number[];
  /** When they joined the queue. Longer waits win ties. */
  waitingSince: Date;
  /** Their last poll. Older than CANDIDATE_STALE_MS and they have gone. */
  lastSeenAt: Date;
}

/** The student we are finding a partner for. Waiting time is not needed here. */
export type PracticeSeeker = Omit<PracticeCandidate, "waitingSince" | "lastSeenAt">;

export interface MatchOptions {
  /** Anyone in a block relationship with the seeker, in either direction. */
  blockedUserIds?: Iterable<number>;
  /** Anyone already in a waiting or active call. */
  busyUserIds?: Iterable<number>;
  /** Defaults to now; injected so the tests are not clock-dependent. */
  now?: Date;
}

export interface RankedMatch {
  userId: number;
  /** 0–100, higher is better. Stored on the session so a pairing can be explained. */
  score: number;
  /** Plain-language reasons, in the order they contributed. */
  reasons: string[];
}

// ─── Weights ──────────────────────────────────────────────────────────────────
//
// Level dominates by construction: the most any number of shared tags can add
// is 40, which is exactly the gap between "same level" and "one level apart".
// Shared interests can therefore lift a neighbour-level partner to equal a
// same-level stranger, and never above one who also shares interests.

const SAME_LEVEL = 60;
const ONE_LEVEL_APART = 20;
/**
 * One or both students have no level yet — a new account, or placement not
 * taken. Refusing them would leave the feature unusable on the day someone
 * signs up, so they are matched, ranked below any known-level pairing.
 */
const UNKNOWN_LEVEL = 15;

const PER_SHARED_INTEREST = 6;
const MAX_INTEREST_POINTS = 18;
const PER_SHARED_GOAL = 4;
const MAX_GOAL_POINTS = 12;
const SAME_FIELD = 6;
const OVERLAPPING_HOURS = 4;

/** One point per 30 s waited, up to 10. Fairness, not fit — it only breaks ties. */
const WAITING_POINT_EVERY_MS = 30_000;
const MAX_WAITING_POINTS = 10;

// ─── Tags ─────────────────────────────────────────────────────────────────────

/**
 * Tags are typed by students in two languages and arrive with stray case,
 * spacing and Arabic diacritics of no semantic weight. Compare what was meant,
 * not what was keyed.
 */
export function normaliseTag(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/[ً-ْ]/g, "") // Arabic short vowels and sukun
    .replace(/\s+/g, " ");
}

function sharedTags(a: string[], b: string[]): string[] {
  const left = new Set(a.map(normaliseTag).filter(Boolean));
  const shared: string[] = [];
  for (const raw of b) {
    const tag = normaliseTag(raw);
    if (tag && left.has(tag) && !shared.includes(tag)) shared.push(tag);
  }
  return shared;
}

function hoursOverlap(a: number[], b: number[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const left = new Set(a);
  return b.some((hour) => left.has(hour));
}

// ─── The rules ────────────────────────────────────────────────────────────────

/**
 * Would these two be offered to each other at all?
 *
 * Separate from scoring because it answers a different question. Scoring says
 * "how good is this"; this says "is this allowed", and the difference matters
 * when someone changes a weight.
 */
export function isEligible(
  seeker: PracticeSeeker,
  candidate: PracticeCandidate,
  options: MatchOptions = {},
): boolean {
  const now = options.now ?? new Date();

  if (candidate.userId === seeker.userId) return false;

  // A block is symmetric in effect. The caller passes both directions.
  for (const id of options.blockedUserIds ?? []) {
    if (id === candidate.userId) return false;
  }
  for (const id of options.busyUserIds ?? []) {
    if (id === candidate.userId) return false;
  }

  // Gone quiet. Offering a partner who has closed the tab spends the seeker's
  // patience on a call that will never be answered.
  if (now.getTime() - candidate.lastSeenAt.getTime() > CANDIDATE_STALE_MS) return false;

  // Level. Unknown on either side is allowed but ranked low; a known pair
  // further apart than MAX_LEVEL_GAP is refused outright.
  if (seeker.levelOrder !== null && candidate.levelOrder !== null) {
    if (Math.abs(seeker.levelOrder - candidate.levelOrder) > MAX_LEVEL_GAP) return false;
  }

  return true;
}

function scorePair(
  seeker: PracticeSeeker,
  candidate: PracticeCandidate,
  now: Date,
): RankedMatch {
  const reasons: string[] = [];
  let score = 0;

  if (seeker.levelOrder === null || candidate.levelOrder === null) {
    score += UNKNOWN_LEVEL;
    reasons.push("level not known yet");
  } else if (seeker.levelOrder === candidate.levelOrder) {
    score += SAME_LEVEL;
    reasons.push("same level");
  } else {
    score += ONE_LEVEL_APART;
    reasons.push("one level apart");
  }

  const interests = sharedTags(seeker.interests, candidate.interests);
  if (interests.length > 0) {
    score += Math.min(interests.length * PER_SHARED_INTEREST, MAX_INTEREST_POINTS);
    reasons.push(`shared interests: ${interests.join(", ")}`);
  }

  const goals = sharedTags(seeker.goals, candidate.goals);
  if (goals.length > 0) {
    score += Math.min(goals.length * PER_SHARED_GOAL, MAX_GOAL_POINTS);
    reasons.push(`shared goals: ${goals.join(", ")}`);
  }

  const seekerField = seeker.professionalField ? normaliseTag(seeker.professionalField) : "";
  const candidateField = candidate.professionalField
    ? normaliseTag(candidate.professionalField)
    : "";
  if (seekerField && seekerField === candidateField) {
    score += SAME_FIELD;
    reasons.push(`same field: ${candidateField}`);
  }

  if (hoursOverlap(seeker.availableHours, candidate.availableHours)) {
    score += OVERLAPPING_HOURS;
    reasons.push("usually free at the same times");
  }

  // Fairness, applied last and deliberately small: it settles a tie between two
  // equally good partners in favour of whoever has been waiting, and it can
  // never promote a worse fit past a better one.
  const waitedMs = Math.max(0, now.getTime() - candidate.waitingSince.getTime());
  const waitingPoints = Math.min(
    Math.floor(waitedMs / WAITING_POINT_EVERY_MS),
    MAX_WAITING_POINTS,
  );
  score += waitingPoints;

  return { userId: candidate.userId, score: Math.min(100, score), reasons };
}

/**
 * Rank the people this student could practise with, best first.
 *
 * Returns an empty array when nobody qualifies. That is a legitimate answer —
 * "nobody is available right now" — and the caller must present it as one
 * rather than as a failure.
 */
export function rankPracticeMatches(
  seeker: PracticeSeeker,
  candidates: PracticeCandidate[],
  options: MatchOptions = {},
): RankedMatch[] {
  const now = options.now ?? new Date();

  return candidates
    .filter((candidate) => isEligible(seeker, candidate, { ...options, now }))
    .map((candidate) => scorePair(seeker, candidate, now))
    .sort((a, b) =>
      // Score first; then the lower user id, so the order is stable and two
      // servers ranking the same pool agree.
      b.score - a.score || a.userId - b.userId,
    );
}

/** The one partner to offer, or null when there is nobody to offer. */
export function bestPracticeMatch(
  seeker: PracticeSeeker,
  candidates: PracticeCandidate[],
  options: MatchOptions = {},
): RankedMatch | null {
  return rankPracticeMatches(seeker, candidates, options)[0] ?? null;
}
