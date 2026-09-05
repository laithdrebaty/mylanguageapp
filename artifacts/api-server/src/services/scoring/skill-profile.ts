/**
 * Turning everything a student has done into a picture of what they are good at.
 *
 * Spec section 8: the system should continuously analyse performance across
 * lessons and assessments, identify patterns — weak pronunciation, weak
 * vocabulary, grammar problems, poor comprehension, limited speaking, poor
 * fluency, strong areas — and advise where to put more effort.
 *
 * WHY THIS IS ARITHMETIC
 * ───────────────────────
 * "Weak at grammar" is a claim about a *distribution*: how this student scored
 * on grammar, across enough attempts, recently. That is a mean over evidence,
 * not a judgement. A model handed a transcript of someone's history would
 * produce a plausible-sounding summary that changes each time you ask and
 * cannot be traced back to any particular attempt.
 *
 * Every number here comes from marks already recorded — the per-dimension
 * sub-scores from written grading, the pronunciation and fluency scores from
 * speech assessment, correctness on objective questions. A student who asks
 * "why do you say my grammar is weak" can be shown the attempts.
 *
 * The model's job comes after, and is only to phrase it.
 *
 * WHAT IT REFUSES TO SAY
 * ───────────────────────
 * Anything it does not have the evidence for. Telling a student they are weak
 * at grammar on the strength of one answer is worse than saying nothing: it is
 * discouraging, probably wrong, and destroys trust in every other thing the app
 * tells them. Confidence is reported, and low-confidence skills are excluded
 * from strengths and weaknesses entirely.
 */

/** The dimensions the spec asks to track. */
export const SKILLS = [
  "pronunciation",
  "fluency",
  "vocabulary",
  "grammar",
  "comprehension",
  "writing",
  "speaking",
] as const;

export type Skill = (typeof SKILLS)[number];

/** One recorded observation about one skill. */
export interface SkillEvidence {
  skill: Skill;
  /** 0–100. */
  score: number;
  /** When it was recorded. Recent evidence counts for more. */
  at: Date;
  /**
   * Relative importance. A dedicated speaking assessment says more about
   * speaking than one multiple-choice question says about comprehension.
   */
  weight?: number;
  /** For explaining the number back to the student. */
  source?: string;
}

export type Confidence = "none" | "low" | "medium" | "high";
export type Trend = "improving" | "steady" | "declining" | "unknown";

export interface SkillSummary {
  skill: Skill;
  /** 0–100, recency-weighted. Null when there is no evidence at all. */
  score: number | null;
  sampleCount: number;
  confidence: Confidence;
  trend: Trend;
  /** Most recent observation, so the caller can say how stale this is. */
  lastObservedAt: Date | null;
}

export interface SkillProfile {
  skills: SkillSummary[];
  /** Skills the student is reliably good at. Never low-confidence. */
  strengths: Skill[];
  /** Skills that need work, weakest first. Never low-confidence. */
  weaknesses: Skill[];
  /** Total observations behind the whole profile. */
  totalEvidence: number;
}

// ─── Tuning ───────────────────────────────────────────────────────────────────

/**
 * Evidence loses half its weight every 30 days.
 *
 * A student who struggled with grammar two months ago and has been solid since
 * should not still be told grammar is their weakness — that is the opposite of
 * useful. Decay is what makes the profile track improvement.
 */
const HALF_LIFE_DAYS = 30;

/** Below this many observations, a skill is not reported as strong or weak. */
const MIN_SAMPLES_FOR_CONFIDENCE = 3;
const SAMPLES_FOR_MEDIUM = 5;
const SAMPLES_FOR_HIGH = 10;

/** At or below this, a skill needs work. At or above the other, it is a strength. */
const WEAKNESS_THRESHOLD = 65;
const STRENGTH_THRESHOLD = 82;

/** A trend needs enough points to have two halves worth comparing. */
const MIN_SAMPLES_FOR_TREND = 4;
/** Points of difference between halves before it counts as a direction. */
const TREND_DELTA = 6;

// ─── Aggregation ──────────────────────────────────────────────────────────────

const clamp = (n: number): number =>
  Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;

function recencyWeight(at: Date, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - at.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

function confidenceFor(samples: number): Confidence {
  if (samples === 0) return "none";
  if (samples < MIN_SAMPLES_FOR_CONFIDENCE) return "low";
  if (samples < SAMPLES_FOR_MEDIUM) return "low";
  if (samples < SAMPLES_FOR_HIGH) return "medium";
  return "high";
}

/**
 * Improving, steady or declining.
 *
 * Compares the mean of the newer half against the older half, unweighted —
 * recency weighting is exactly what would hide a trend, since it makes the
 * recent half dominate both.
 */
function trendFor(sorted: SkillEvidence[]): Trend {
  if (sorted.length < MIN_SAMPLES_FOR_TREND) return "unknown";

  const mid = Math.floor(sorted.length / 2);
  const older = sorted.slice(0, mid);
  const newer = sorted.slice(sorted.length - mid);

  const mean = (rows: SkillEvidence[]) =>
    rows.reduce((sum, r) => sum + clamp(r.score), 0) / rows.length;

  const delta = mean(newer) - mean(older);
  if (delta >= TREND_DELTA) return "improving";
  if (delta <= -TREND_DELTA) return "declining";
  return "steady";
}

/**
 * Build the profile.
 *
 * `now` is a parameter rather than read from the clock so the result is a
 * function of its inputs — which is what makes it testable and what makes two
 * calls a second apart agree.
 */
export function buildSkillProfile(
  evidence: SkillEvidence[],
  now: Date = new Date(),
): SkillProfile {
  const summaries: SkillSummary[] = SKILLS.map((skill) => {
    const rows = evidence
      .filter((e) => e.skill === skill)
      .sort((a, b) => a.at.getTime() - b.at.getTime());

    if (rows.length === 0) {
      return {
        skill,
        score: null,
        sampleCount: 0,
        confidence: "none" as Confidence,
        trend: "unknown" as Trend,
        lastObservedAt: null,
      };
    }

    let weighted = 0;
    let totalWeight = 0;
    for (const row of rows) {
      const weight = (row.weight ?? 1) * recencyWeight(row.at, now);
      weighted += clamp(row.score) * weight;
      totalWeight += weight;
    }

    return {
      skill,
      // Evidence old enough to have decayed to nothing would divide by zero.
      // Falling back to an unweighted mean keeps a long-dormant student's
      // history readable rather than blanking it.
      score:
        totalWeight > 0
          ? Math.round(weighted / totalWeight)
          : Math.round(rows.reduce((s, r) => s + clamp(r.score), 0) / rows.length),
      sampleCount: rows.length,
      confidence: confidenceFor(rows.length),
      trend: trendFor(rows),
      lastObservedAt: rows[rows.length - 1].at,
    };
  });

  // Only skills we actually have grounds to talk about. A single bad answer is
  // not a weakness, and saying so would be both wrong and discouraging.
  const reportable = summaries.filter(
    (s) => s.score !== null && s.confidence !== "none" && s.confidence !== "low",
  );

  const weaknesses = reportable
    .filter((s) => (s.score as number) <= WEAKNESS_THRESHOLD)
    .sort((a, b) => (a.score as number) - (b.score as number))
    .map((s) => s.skill);

  const strengths = reportable
    .filter((s) => (s.score as number) >= STRENGTH_THRESHOLD)
    .sort((a, b) => (b.score as number) - (a.score as number))
    .map((s) => s.skill);

  return {
    skills: summaries,
    strengths,
    weaknesses,
    totalEvidence: evidence.length,
  };
}

/**
 * The one skill most worth working on next, or null when there is not enough
 * evidence to say.
 *
 * Deliberately one. A list of six things to improve is a list nobody acts on,
 * and the spec asks for advice on where to put effort — singular.
 */
export function primaryFocus(profile: SkillProfile): Skill | null {
  return profile.weaknesses[0] ?? null;
}

export {
  HALF_LIFE_DAYS,
  WEAKNESS_THRESHOLD,
  STRENGTH_THRESHOLD,
  MIN_SAMPLES_FOR_CONFIDENCE,
};
