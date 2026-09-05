/**
 * Fluency, measured rather than judged.
 *
 * These are the standard measures used in second-language fluency research, and
 * every one of them is arithmetic over word timings a speech recogniser already
 * returns. No model is asked anything here (spec section 6).
 *
 *   speech rate        words per minute over the whole recording
 *   articulation rate  words per minute of actual speaking, pauses excluded
 *   phonation ratio    share of the recording that is speech
 *   mean length of run words spoken between pauses — the single strongest
 *                      predictor of perceived fluency in the literature
 *   pause profile      how many silences, how long, and where they fall
 *   filler rate        "um" and "uh" per hundred words
 *
 * WHY THIS BEATS ASKING A MODEL
 * ──────────────────────────────
 * A model given a transcript cannot know how long the student hesitated — that
 * information is in the timings, not the words. A model given the audio returns
 * an impression that changes between runs. These numbers are the same every
 * time, cost nothing, and can be shown to a student as a reason.
 */

// ─── Input ────────────────────────────────────────────────────────────────────

export interface TimedWord {
  word: string;
  /** Seconds from the start of the recording. */
  start: number;
  end: number;
}

export interface FluencyMetrics {
  /** Words per minute across the whole recording. */
  speechRate: number;
  /** Words per minute of speaking time only. */
  articulationRate: number;
  /** 0–1: how much of the recording was speech rather than silence. */
  phonationRatio: number;
  /** Words between pauses. */
  meanLengthOfRun: number;
  /** Silences at or above the pause threshold. */
  pauseCount: number;
  /** Seconds, averaged over those pauses. */
  meanPauseSeconds: number;
  /** Pauses of a second or more — the ones a listener notices. */
  longPauseCount: number;
  /** Filler sounds per hundred words. */
  fillersPer100Words: number;
  wordCount: number;
  durationSeconds: number;
}

/**
 * A silence of 250ms or more counts as a pause.
 *
 * This is the conventional threshold in fluency research: below it, the gap is
 * ordinary articulation rather than hesitation.
 */
const PAUSE_THRESHOLD_SECONDS = 0.25;
const LONG_PAUSE_SECONDS = 1.0;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Compute the metrics from timed words.
 *
 * `durationSeconds` is the length of the recording, which differs from the last
 * word's end time when the student left silence at the end. Passing it lets
 * trailing silence count against the phonation ratio, as it should.
 */
export function computeFluencyMetrics(
  words: TimedWord[],
  durationSeconds: number,
  fillerCount = 0,
): FluencyMetrics {
  const empty: FluencyMetrics = {
    speechRate: 0,
    articulationRate: 0,
    phonationRatio: 0,
    meanLengthOfRun: 0,
    pauseCount: 0,
    meanPauseSeconds: 0,
    longPauseCount: 0,
    fillersPer100Words: 0,
    wordCount: 0,
    durationSeconds: Math.max(0, round2(durationSeconds)),
  };

  if (words.length === 0 || durationSeconds <= 0) return empty;

  const ordered = [...words].sort((a, b) => a.start - b.start);

  // Sum of word durations, not last-end minus first-start: the difference
  // between them IS the pausing, which is what we are trying to measure.
  const speakingTime = ordered.reduce(
    (sum, w) => sum + Math.max(0, w.end - w.start),
    0,
  );

  const pauses: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const gap = ordered[i].start - ordered[i - 1].end;
    if (gap >= PAUSE_THRESHOLD_SECONDS) pauses.push(gap);
  }

  const wordCount = ordered.length;
  const longPauseCount = pauses.filter((p) => p >= LONG_PAUSE_SECONDS).length;
  const meanPause =
    pauses.length > 0 ? pauses.reduce((a, b) => a + b, 0) / pauses.length : 0;

  return {
    speechRate: round1((wordCount / durationSeconds) * 60),
    // Guard the divisor: a recogniser that returns zero-width words would
    // otherwise produce Infinity and poison everything downstream.
    articulationRate: speakingTime > 0 ? round1((wordCount / speakingTime) * 60) : 0,
    phonationRatio: round2(Math.min(1, speakingTime / durationSeconds)),
    // Runs are the segments between pauses, so there is always one more run
    // than there are pauses.
    meanLengthOfRun: round1(wordCount / (pauses.length + 1)),
    pauseCount: pauses.length,
    meanPauseSeconds: round2(meanPause),
    longPauseCount,
    fillersPer100Words: round1((fillerCount / wordCount) * 100),
    wordCount,
    durationSeconds: round2(durationSeconds),
  };
}

// ─── Level expectations ───────────────────────────────────────────────────────

/**
 * What counts as fluent depends on the level. Holding an A1 student to a C1
 * speech rate would mark every beginner as disfluent, which is both wrong and
 * discouraging.
 *
 * These are starting values drawn from published L2 fluency norms, not laws.
 * They are the first thing to tune once there is real student data — which is
 * why they are one table here rather than scattered through the scoring.
 */
interface LevelExpectation {
  /** Words per minute at which the level's target is fully met. */
  targetSpeechRate: number;
  /** Words per run at which the level's target is fully met. */
  targetRunLength: number;
}

const EXPECTATIONS: Array<{ prefix: string; expectation: LevelExpectation }> = [
  { prefix: "A1", expectation: { targetSpeechRate: 70, targetRunLength: 3.5 } },
  { prefix: "A2", expectation: { targetSpeechRate: 90, targetRunLength: 5 } },
  { prefix: "B1", expectation: { targetSpeechRate: 110, targetRunLength: 7 } },
  { prefix: "B2", expectation: { targetSpeechRate: 130, targetRunLength: 9 } },
  { prefix: "C1", expectation: { targetSpeechRate: 145, targetRunLength: 11 } },
  { prefix: "C2", expectation: { targetSpeechRate: 155, targetRunLength: 12 } },
];

/** Unknown or missing level codes fall to the gentlest expectation. */
const DEFAULT_EXPECTATION = EXPECTATIONS[0].expectation;

export function expectationForLevel(levelCode: string | null | undefined): LevelExpectation {
  if (!levelCode) return DEFAULT_EXPECTATION;
  const upper = levelCode.toUpperCase();
  const found = EXPECTATIONS.find((e) => upper.startsWith(e.prefix));
  return found?.expectation ?? DEFAULT_EXPECTATION;
}

// ─── Score ────────────────────────────────────────────────────────────────────

export interface FluencyScore {
  score: number;
  /** Which components pulled the score down, worst first. */
  weaknesses: Array<"pace" | "hesitation" | "choppiness" | "fillers">;
}

/** 0 below `floor`, 1 at or above `target`, linear between. */
function ramp(value: number, floor: number, target: number): number {
  if (target <= floor) return value >= target ? 1 : 0;
  return Math.max(0, Math.min(1, (value - floor) / (target - floor)));
}

/**
 * Turn the metrics into a 0–100 fluency score for a given level.
 *
 * Four components, weighted by how much each contributes to a listener's sense
 * of fluency:
 *
 *   pace 30%        speech rate against the level's target
 *   runs 30%        mean length of run — the strongest single predictor
 *   continuity 25%  phonation ratio: how much of the time was speech
 *   fillers 15%     hesitation markers per hundred words
 *
 * Speaking *faster* than the target is not penalised. Rushing is a real fault,
 * but distinguishing it from confident delivery needs prosody this pipeline
 * does not have, and marking a fast reader down would be a guess.
 */
export function scoreFluency(
  metrics: FluencyMetrics,
  levelCode: string | null | undefined,
): FluencyScore {
  if (metrics.wordCount === 0) return { score: 0, weaknesses: [] };

  const { targetSpeechRate, targetRunLength } = expectationForLevel(levelCode);

  // Floors are set at roughly a third of target: below that the delivery is
  // halting enough that the component contributes nothing.
  const pace = ramp(metrics.speechRate, targetSpeechRate * 0.35, targetSpeechRate);
  const runs = ramp(metrics.meanLengthOfRun, targetRunLength * 0.35, targetRunLength);
  // 0.55 is a reasonable phonation ratio for read-aloud with natural pauses;
  // below 0.3 the recording is mostly silence.
  const continuity = ramp(metrics.phonationRatio, 0.3, 0.55);
  // 5 fillers per 100 words is noticeably hesitant; 0 is clean.
  const fillers = 1 - Math.min(1, metrics.fillersPer100Words / 5);

  const score = Math.round(
    (pace * 0.3 + runs * 0.3 + continuity * 0.25 + fillers * 0.15) * 100,
  );

  const weaknesses: FluencyScore["weaknesses"] = [];
  if (pace < 0.6) weaknesses.push("pace");
  if (continuity < 0.6) weaknesses.push("hesitation");
  if (runs < 0.6) weaknesses.push("choppiness");
  if (fillers < 0.6) weaknesses.push("fillers");

  return { score: Math.max(0, Math.min(100, score)), weaknesses };
}
