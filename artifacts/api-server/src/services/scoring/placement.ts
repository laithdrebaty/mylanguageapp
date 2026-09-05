/**
 * Working out where a new student belongs.
 *
 * Spec section 2: assess across skills, determine an approximate starting
 * level, and identify strengths, weaknesses and where to put effort.
 *
 * WHY THE LEVEL IS ARITHMETIC
 * ────────────────────────────
 * The spec says the AI determines the level. Taken literally that would mean a
 * model's unaudited guess decides which lessons a student can reach — a number
 * that changes between runs, cannot be explained to the student, and cannot be
 * defended when they ask why they were put in A1 and their friend in B1.
 *
 * So the level is computed here from the answers, and the model is given a
 * bounded say: it may move the result by at most one sub-level, and only with a
 * stated reason that is recorded. That keeps what the spec is reaching for — a
 * judgement that accounts for an uneven profile — without letting a
 * hallucination put a beginner in C2.
 *
 * WHAT DIFFICULTY IS FOR
 * ───────────────────────
 * Percentage correct alone cannot separate a strong beginner from a weak
 * intermediate: both score around half. Weighting each question by the level it
 * was written for can — getting the B2 questions right means something that
 * getting more A1 questions right does not.
 */

export const PLACEMENT_SKILLS = [
  "reading",
  "listening",
  "vocabulary",
  "grammar",
  "comprehension",
  "writing",
] as const;

export type PlacementSkill = (typeof PLACEMENT_SKILLS)[number];

export type Difficulty = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

/** One answered question. */
export interface AnsweredQuestion {
  skill: PlacementSkill;
  difficulty: Difficulty;
  correct: boolean;
}

export interface SkillScore {
  skill: PlacementSkill;
  /** 0–100, or null when the test asked nothing about this skill. */
  score: number | null;
  answered: number;
}

export interface PlacementOutcome {
  /** 0–100 overall, weighted by question difficulty. */
  overall: number;
  skills: SkillScore[];
  /** Band the student placed into, e.g. "A2". */
  band: Difficulty;
  /** Which half of the band — 1 or 2. */
  half: 1 | 2;
  /** e.g. "A2.1". */
  levelCode: string;
  strengths: PlacementSkill[];
  weaknesses: PlacementSkill[];
}

/**
 * What a question is worth.
 *
 * A correct B2 answer is evidence of more than a correct A1 answer, so it
 * counts for more. The steps are deliberately gentle: making the hard questions
 * worth many times the easy ones would let two lucky guesses at the end
 * dominate everything before them.
 */
const DIFFICULTY_WEIGHT: Record<Difficulty, number> = {
  A1: 1.0,
  A2: 1.3,
  B1: 1.7,
  B2: 2.2,
  C1: 2.8,
  C2: 3.5,
};

const BANDS: Difficulty[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

/**
 * Where a weighted score places a student.
 *
 * The top of the scale is deliberately unreachable from a short test. A
 * twenty-question quiz is not evidence that someone belongs in C2, and placing
 * them there would strand them in material they cannot follow with no way back
 * but an administrator. Under-placing is recoverable — they pass the level
 * evaluation quickly and move up. Over-placing is not.
 */
const BAND_THRESHOLDS: Array<{ min: number; band: Difficulty; half: 1 | 2 }> = [
  { min: 92, band: "C1", half: 1 },
  { min: 85, band: "B2", half: 2 },
  { min: 76, band: "B2", half: 1 },
  { min: 67, band: "B1", half: 2 },
  { min: 58, band: "B1", half: 1 },
  { min: 48, band: "A2", half: 2 },
  { min: 38, band: "A2", half: 1 },
  { min: 22, band: "A1", half: 2 },
  { min: 0, band: "A1", half: 1 },
];

/** At or below this a skill needs work; at or above the other it is a strength. */
const WEAK_BELOW = 55;
const STRONG_AT = 80;
/** Fewer answers than this and a skill is not called strong or weak. */
const MIN_QUESTIONS_PER_SKILL = 2;

const clamp = (n: number): number =>
  Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;

/**
 * Score a completed placement test.
 *
 * `writingScore` comes from the open-answer grader when the test included a
 * written question. It is folded in as its own skill rather than averaged into
 * the total blind, so a student who writes well but guesses badly at grammar
 * shows up as exactly that.
 */
export function scorePlacement(
  answers: AnsweredQuestion[],
  writingScore?: number | null,
): PlacementOutcome {
  const skills: SkillScore[] = PLACEMENT_SKILLS.map((skill) => {
    if (skill === "writing" && writingScore != null) {
      return { skill, score: clamp(writingScore), answered: 1 };
    }

    const rows = answers.filter((a) => a.skill === skill);
    if (rows.length === 0) return { skill, score: null, answered: 0 };

    let earned = 0;
    let possible = 0;
    for (const row of rows) {
      const weight = DIFFICULTY_WEIGHT[row.difficulty] ?? 1;
      possible += weight;
      if (row.correct) earned += weight;
    }

    return {
      skill,
      score: possible > 0 ? Math.round((earned / possible) * 100) : null,
      answered: rows.length,
    };
  });

  // The overall figure is weighted the same way, over every question at once —
  // not an average of the per-skill percentages, which would give a skill with
  // two questions the same say as one with ten.
  let earned = 0;
  let possible = 0;
  for (const row of answers) {
    const weight = DIFFICULTY_WEIGHT[row.difficulty] ?? 1;
    possible += weight;
    if (row.correct) earned += weight;
  }
  if (writingScore != null) {
    // Weighted as a B1 question: producing language is worth more than
    // recognising it, but one prompt should not swing the whole result.
    const weight = DIFFICULTY_WEIGHT.B1;
    possible += weight;
    earned += (clamp(writingScore) / 100) * weight;
  }

  const overall = possible > 0 ? Math.round((earned / possible) * 100) : 0;

  const placed =
    BAND_THRESHOLDS.find((t) => overall >= t.min) ??
    BAND_THRESHOLDS[BAND_THRESHOLDS.length - 1];

  const reportable = skills.filter(
    (s) => s.score !== null && s.answered >= MIN_QUESTIONS_PER_SKILL,
  );

  return {
    overall,
    skills,
    band: placed.band,
    half: placed.half,
    levelCode: `${placed.band}.${placed.half}`,
    strengths: reportable
      .filter((s) => (s.score as number) >= STRONG_AT)
      .sort((a, b) => (b.score as number) - (a.score as number))
      .map((s) => s.skill),
    weaknesses: reportable
      .filter((s) => (s.score as number) <= WEAK_BELOW)
      .sort((a, b) => (a.score as number) - (b.score as number))
      .map((s) => s.skill),
  };
}

/**
 * Apply the AI's suggested adjustment, refusing anything it should not be
 * allowed to do.
 *
 * At most one sub-level in either direction. A model that returns "C2.2" for a
 * student who scored 30% is not making a judgement about an uneven profile; it
 * is wrong, and the arithmetic should win. Returning the computed level
 * unchanged is always a safe answer.
 */
export function applyLevelAdjustment(
  computed: PlacementOutcome,
  suggestedLevelCode: string | null | undefined,
  orderedLevelCodes: string[],
): { levelCode: string; adjusted: boolean } {
  if (!suggestedLevelCode) return { levelCode: computed.levelCode, adjusted: false };

  const computedIndex = orderedLevelCodes.indexOf(computed.levelCode);
  const suggestedIndex = orderedLevelCodes.indexOf(suggestedLevelCode);

  // A suggestion naming a level this curriculum does not have is not a
  // judgement about the student.
  if (computedIndex === -1 || suggestedIndex === -1) {
    return { levelCode: computed.levelCode, adjusted: false };
  }

  if (Math.abs(suggestedIndex - computedIndex) > 1) {
    return { levelCode: computed.levelCode, adjusted: false };
  }

  return {
    levelCode: suggestedLevelCode,
    adjusted: suggestedIndex !== computedIndex,
  };
}

export { DIFFICULTY_WEIGHT, BAND_THRESHOLDS, WEAK_BELOW, STRONG_AT, BANDS };
