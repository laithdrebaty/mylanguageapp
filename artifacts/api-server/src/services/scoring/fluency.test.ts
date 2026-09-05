import { describe, it, expect } from "vitest";
import {
  computeFluencyMetrics,
  scoreFluency,
  expectationForLevel,
  type TimedWord,
} from "./fluency";

/** Words spoken evenly at `wpm`, each lasting 80% of its slot. */
function evenSpeech(count: number, wpm: number): TimedWord[] {
  const slot = 60 / wpm;
  return Array.from({ length: count }, (_, i) => ({
    word: `w${i}`,
    start: i * slot,
    end: i * slot + slot * 0.8,
  }));
}

describe("computeFluencyMetrics", () => {
  it("measures speech rate over the whole recording", () => {
    const words = evenSpeech(60, 120);
    const m = computeFluencyMetrics(words, 30);
    expect(m.speechRate).toBe(120);
    expect(m.wordCount).toBe(60);
  });

  it("counts trailing silence against the phonation ratio", () => {
    // Twenty seconds of speech in a sixty-second recording is not fluent
    // delivery, and the last word's end time would hide that.
    const words = evenSpeech(40, 120);
    const m = computeFluencyMetrics(words, 60);
    expect(m.phonationRatio).toBeLessThan(0.4);
  });

  it("separates articulation rate from speech rate", () => {
    // Someone who speaks quickly but pauses a lot has a high articulation rate
    // and a low speech rate. Conflating them hides the hesitation.
    const words: TimedWord[] = [
      { word: "a", start: 0, end: 0.3 },
      { word: "b", start: 0.3, end: 0.6 },
      { word: "c", start: 3.0, end: 3.3 },
      { word: "d", start: 3.3, end: 3.6 },
    ];
    const m = computeFluencyMetrics(words, 4);
    expect(m.articulationRate).toBeGreaterThan(m.speechRate);
  });

  it("counts a silence of 250ms or more as a pause", () => {
    const words: TimedWord[] = [
      { word: "a", start: 0, end: 0.4 },
      { word: "b", start: 0.5, end: 0.9 }, // 100ms gap — articulation
      { word: "c", start: 1.4, end: 1.8 }, // 500ms gap — a pause
    ];
    const m = computeFluencyMetrics(words, 2);
    expect(m.pauseCount).toBe(1);
  });

  it("flags the long pauses a listener actually notices", () => {
    const words: TimedWord[] = [
      { word: "a", start: 0, end: 0.4 },
      { word: "b", start: 2.4, end: 2.8 }, // 2s
      { word: "c", start: 3.2, end: 3.6 }, // 400ms
    ];
    const m = computeFluencyMetrics(words, 4);
    expect(m.pauseCount).toBe(2);
    expect(m.longPauseCount).toBe(1);
  });

  it("computes mean length of run as words between pauses", () => {
    // Nine words, two pauses, so three runs of three.
    const words: TimedWord[] = [];
    let t = 0;
    for (let run = 0; run < 3; run++) {
      for (let i = 0; i < 3; i++) {
        words.push({ word: `w${run}${i}`, start: t, end: t + 0.3 });
        t += 0.35;
      }
      t += 1;
    }
    const m = computeFluencyMetrics(words, t);
    expect(m.pauseCount).toBe(2);
    expect(m.meanLengthOfRun).toBe(3);
  });

  it("reports one run when the speaker never pauses", () => {
    const m = computeFluencyMetrics(evenSpeech(20, 150), 8);
    expect(m.pauseCount).toBe(0);
    expect(m.meanLengthOfRun).toBe(20);
  });

  it("expresses fillers per hundred words so length does not distort it", () => {
    const m = computeFluencyMetrics(evenSpeech(50, 120), 25, 5);
    expect(m.fillersPer100Words).toBe(10);
  });

  it("returns zeroes for an empty recording rather than NaN", () => {
    const m = computeFluencyMetrics([], 10);
    expect(m.speechRate).toBe(0);
    expect(Number.isFinite(m.meanLengthOfRun)).toBe(true);
  });

  it("survives a zero-length recording", () => {
    const m = computeFluencyMetrics(evenSpeech(10, 120), 0);
    expect(Number.isFinite(m.speechRate)).toBe(true);
  });

  it("survives a recogniser that returns zero-width words", () => {
    const words: TimedWord[] = [
      { word: "a", start: 1, end: 1 },
      { word: "b", start: 2, end: 2 },
    ];
    const m = computeFluencyMetrics(words, 3);
    expect(Number.isFinite(m.articulationRate)).toBe(true);
    expect(m.articulationRate).toBe(0);
  });

  it("does not report a phonation ratio above 1", () => {
    // Overlapping word spans can happen; the ratio is still a share.
    const words: TimedWord[] = [
      { word: "a", start: 0, end: 5 },
      { word: "b", start: 0, end: 5 },
    ];
    expect(computeFluencyMetrics(words, 5).phonationRatio).toBe(1);
  });

  it("does not depend on the order words arrive in", () => {
    const words = evenSpeech(10, 120);
    const shuffled = [...words].reverse();
    expect(computeFluencyMetrics(shuffled, 5)).toEqual(
      computeFluencyMetrics(words, 5),
    );
  });
});

describe("expectationForLevel", () => {
  it("expects less of a beginner than of an advanced learner", () => {
    expect(expectationForLevel("A1.1").targetSpeechRate).toBeLessThan(
      expectationForLevel("C1.2").targetSpeechRate,
    );
  });

  it("reads the band from a sub-level code", () => {
    expect(expectationForLevel("B2.1")).toEqual(expectationForLevel("B2.2"));
  });

  it("is not case sensitive", () => {
    expect(expectationForLevel("b1.1")).toEqual(expectationForLevel("B1.1"));
  });

  it("falls back to the gentlest expectation for an unknown or missing level", () => {
    const gentlest = expectationForLevel("A1.1");
    expect(expectationForLevel(null)).toEqual(gentlest);
    expect(expectationForLevel("HSK4")).toEqual(gentlest);
  });
});

describe("scoreFluency", () => {
  const fluent = computeFluencyMetrics(evenSpeech(120, 120), 60, 0);

  it("scores a steady, level-appropriate reading highly", () => {
    expect(scoreFluency(fluent, "B1.1").score).toBeGreaterThanOrEqual(85);
  });

  it("judges the same recording against the student's level", () => {
    // 120 wpm is strong for A1 and merely adequate for C1. Marking a beginner
    // against a C1 target would call every beginner disfluent.
    const asBeginner = scoreFluency(fluent, "A1.1").score;
    const asAdvanced = scoreFluency(fluent, "C2.1").score;
    expect(asBeginner).toBeGreaterThan(asAdvanced);
  });

  it("marks down a halting delivery and says why", () => {
    const halting: TimedWord[] = [];
    let t = 0;
    for (let i = 0; i < 20; i++) {
      halting.push({ word: `w${i}`, start: t, end: t + 0.3 });
      t += 2.3; // a two-second pause after every word
    }
    const result = scoreFluency(computeFluencyMetrics(halting, t), "B1.1");
    expect(result.score).toBeLessThan(40);
    expect(result.weaknesses).toContain("hesitation");
    expect(result.weaknesses).toContain("choppiness");
  });

  it("marks down heavy filler use", () => {
    const clean = scoreFluency(computeFluencyMetrics(evenSpeech(100, 110), 55, 0), "B1.1");
    const filled = scoreFluency(computeFluencyMetrics(evenSpeech(100, 110), 55, 12), "B1.1");
    expect(filled.score).toBeLessThan(clean.score);
    expect(filled.weaknesses).toContain("fillers");
  });

  it("does not penalise speaking faster than the target", () => {
    // Distinguishing confident delivery from rushing needs prosody this
    // pipeline does not have, so it does not guess.
    const atTarget = scoreFluency(computeFluencyMetrics(evenSpeech(110, 110), 60), "B1.1");
    const faster = scoreFluency(computeFluencyMetrics(evenSpeech(180, 180), 60), "B1.1");
    expect(faster.score).toBeGreaterThanOrEqual(atTarget.score);
  });

  it("scores an empty recording zero with nothing to report", () => {
    const result = scoreFluency(computeFluencyMetrics([], 10), "B1.1");
    expect(result.score).toBe(0);
    expect(result.weaknesses).toEqual([]);
  });

  it("stays within 0 and 100 for absurd input", () => {
    const absurd = computeFluencyMetrics(evenSpeech(1000, 900), 60, 500);
    const result = scoreFluency(absurd, "A1.1");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("is reproducible", () => {
    const scores = Array.from({ length: 20 }, () => scoreFluency(fluent, "B1.1").score);
    expect(new Set(scores).size).toBe(1);
  });
});
