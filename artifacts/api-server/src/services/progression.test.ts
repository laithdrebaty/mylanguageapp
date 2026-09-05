import { describe, it, expect } from "vitest";
import { decideEligibility, rankRemediation, type EligibilityInput } from "./progression";

/** A student who has done everything right and may sit the evaluation. */
const ready: EligibilityInput = {
  isPlaced: true,
  hasEvaluation: true,
  isCurrentLevel: true,
  requiredPercent: 100,
  lessonsTotal: 25,
  lessonsPassed: 25,
  maxAttempts: null,
  attempts: [],
  cooldownHours: null,
  now: new Date("2026-09-04T12:00:00Z"),
};

const hoursAgo = (h: number) =>
  new Date(ready.now.getTime() - h * 3_600_000);

describe("decideEligibility", () => {
  it("opens the gate for a student who has finished the level", () => {
    const result = decideEligibility(ready);
    expect(result.eligible).toBe(true);
    expect(result.code).toBeNull();
    expect(result.completedPercent).toBe(100);
  });

  it("keeps the gate shut when the level has no published evaluation", () => {
    expect(decideEligibility({ ...ready, hasEvaluation: false }).code).toBe("NO_EVALUATION");
  });

  it("keeps the gate shut for a student who has not been placed", () => {
    expect(decideEligibility({ ...ready, isPlaced: false }).code).toBe("NOT_PLACED");
  });

  it("refuses an evaluation for a level the student is not on", () => {
    expect(decideEligibility({ ...ready, isCurrentLevel: false }).code).toBe("NOT_CURRENT_LEVEL");
  });

  it("refuses while lessons remain", () => {
    const result = decideEligibility({ ...ready, lessonsPassed: 20 });
    expect(result.code).toBe("LESSONS_INCOMPLETE");
    expect(result.completedPercent).toBe(80);
  });

  it("honours a level configured to unlock before every lesson is done", () => {
    const result = decideEligibility({
      ...ready,
      requiredPercent: 80,
      lessonsPassed: 20,
    });
    expect(result.eligible).toBe(true);
  });

  it("rounds completion down, so 24 of 25 lessons does not read as 100%", () => {
    const result = decideEligibility({ ...ready, lessonsPassed: 24 });
    expect(result.completedPercent).toBe(96);
    expect(result.eligible).toBe(false);
  });

  it("treats a level with no published lessons as complete rather than deadlocking", () => {
    const result = decideEligibility({ ...ready, lessonsTotal: 0, lessonsPassed: 0 });
    expect(result.completedPercent).toBe(100);
    expect(result.eligible).toBe(true);
  });

  it("refuses once the attempt allowance is spent", () => {
    const result = decideEligibility({
      ...ready,
      maxAttempts: 2,
      attempts: [
        { passed: false, submittedAt: hoursAgo(50) },
        { passed: false, submittedAt: hoursAgo(80) },
      ],
    });
    expect(result.code).toBe("ATTEMPTS_EXHAUSTED");
    expect(result.attemptsRemaining).toBe(0);
  });

  it("reports the unfinished lessons ahead of a spent allowance, as the more useful thing to fix", () => {
    const result = decideEligibility({
      ...ready,
      lessonsPassed: 10,
      maxAttempts: 1,
      attempts: [{ passed: false, submittedAt: hoursAgo(100) }],
    });
    expect(result.code).toBe("LESSONS_INCOMPLETE");
  });

  it("holds a student in cooldown after a failure", () => {
    const result = decideEligibility({
      ...ready,
      cooldownHours: 24,
      attempts: [{ passed: false, submittedAt: hoursAgo(1) }],
    });
    expect(result.code).toBe("COOLDOWN");
    expect(result.retryAvailableAt).toBe(new Date("2026-09-05T11:00:00Z").toISOString());
  });

  it("releases the student once the cooldown has elapsed", () => {
    const result = decideEligibility({
      ...ready,
      cooldownHours: 24,
      attempts: [{ passed: false, submittedAt: hoursAgo(25) }],
    });
    expect(result.eligible).toBe(true);
    expect(result.retryAvailableAt).toBeNull();
  });

  it("does not start a cooldown from an abandoned attempt", () => {
    const result = decideEligibility({
      ...ready,
      cooldownHours: 24,
      attempts: [{ passed: null, submittedAt: null }],
    });
    expect(result.eligible).toBe(true);
  });

  it("does not start a cooldown from an attempt still awaiting assessment", () => {
    // passed stays null while a block waits on an AI or teacher verdict. That is
    // not a failure, and must not lock the student out.
    const result = decideEligibility({
      ...ready,
      cooldownHours: 24,
      attempts: [{ passed: null, submittedAt: hoursAgo(1) }],
    });
    expect(result.eligible).toBe(true);
  });

  it("measures the cooldown from the most recent failure, not the first", () => {
    const result = decideEligibility({
      ...ready,
      cooldownHours: 24,
      // Newest first, as the caller supplies them.
      attempts: [
        { passed: false, submittedAt: hoursAgo(2) },
        { passed: false, submittedAt: hoursAgo(200) },
      ],
    });
    expect(result.code).toBe("COOLDOWN");
  });

  it("treats a zero cooldown as no cooldown", () => {
    const result = decideEligibility({
      ...ready,
      cooldownHours: 0,
      attempts: [{ passed: false, submittedAt: hoursAgo(0.1) }],
    });
    expect(result.eligible).toBe(true);
  });

  it("counts every attempt against the allowance, passed or failed", () => {
    const result = decideEligibility({
      ...ready,
      maxAttempts: 3,
      attempts: [{ passed: true, submittedAt: hoursAgo(5) }],
    });
    expect(result.attemptsUsed).toBe(1);
    expect(result.attemptsRemaining).toBe(2);
  });

  it("reports unlimited attempts as null rather than a number", () => {
    expect(decideEligibility(ready).attemptsRemaining).toBeNull();
  });
});

describe("rankRemediation", () => {
  const lessons = [
    { id: 1, title: "Greetings", titleAr: "التحيات", order: 1 },
    { id: 2, title: "Numbers", titleAr: "الأرقام", order: 2 },
    { id: 3, title: "Family", titleAr: "العائلة", order: 3 },
    { id: 4, title: "Colours", titleAr: "الألوان", order: 4 },
  ];

  it("puts the weakest lesson first", () => {
    const ranked = rankRemediation(lessons, [
      { lessonId: 1, bestScore: 90, attempts: 1 },
      { lessonId: 2, bestScore: 55, attempts: 3 },
      { lessonId: 3, bestScore: 70, attempts: 2 },
    ]);
    expect(ranked.map((r) => r.lessonId)).toEqual([2, 3, 1, 4]);
  });

  it("sorts never-attempted lessons after ones the student struggled with", () => {
    const ranked = rankRemediation(lessons, [
      { lessonId: 3, bestScore: 65, attempts: 2 },
    ]);
    expect(ranked[0].lessonId).toBe(3);
    expect(ranked[0].bestScore).toBe(65);
    expect(ranked[1].bestScore).toBeNull();
  });

  it("breaks ties by curriculum order", () => {
    const ranked = rankRemediation(lessons, [
      { lessonId: 3, bestScore: 60, attempts: 1 },
      { lessonId: 1, bestScore: 60, attempts: 1 },
    ]);
    expect(ranked.map((r) => r.lessonId).slice(0, 2)).toEqual([1, 3]);
  });

  it("respects the limit", () => {
    expect(rankRemediation(lessons, [], 2)).toHaveLength(2);
  });

  it("returns nothing for a level with no lessons", () => {
    expect(rankRemediation([], [])).toEqual([]);
  });

  it("does not leak the internal sort key into the response", () => {
    const ranked = rankRemediation(lessons, []);
    expect(ranked[0]).not.toHaveProperty("order");
  });

  it("reports a lesson the student has never touched as zero attempts", () => {
    const ranked = rankRemediation(lessons, []);
    expect(ranked[0].attempts).toBe(0);
    expect(ranked[0].bestScore).toBeNull();
  });
});
