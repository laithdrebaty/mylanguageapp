import { describe, it, expect } from "vitest";
import {
  buildSkillProfile,
  primaryFocus,
  type Skill,
  type SkillEvidence,
} from "./skill-profile";

const NOW = new Date("2026-09-05T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

/** `count` observations of one skill, all the same score, spread over recent days. */
function evidence(skill: Skill, score: number, count: number, startDaysAgo = 1): SkillEvidence[] {
  return Array.from({ length: count }, (_, i) => ({
    skill,
    score,
    at: daysAgo(startDaysAgo + i),
  }));
}

const summaryFor = (profile: ReturnType<typeof buildSkillProfile>, skill: Skill) =>
  profile.skills.find((s) => s.skill === skill)!;

describe("buildSkillProfile — reporting only what it can support", () => {
  it("reports no score for a skill with no evidence", () => {
    const p = buildSkillProfile([], NOW);
    expect(summaryFor(p, "grammar").score).toBeNull();
    expect(summaryFor(p, "grammar").confidence).toBe("none");
  });

  it("refuses to call one bad answer a weakness", () => {
    // Telling a student their grammar is weak on one data point is worse than
    // saying nothing: probably wrong, discouraging, and it costs trust in
    // everything else the app tells them.
    const p = buildSkillProfile(evidence("grammar", 20, 1), NOW);
    expect(summaryFor(p, "grammar").score).toBe(20);
    expect(summaryFor(p, "grammar").confidence).toBe("low");
    expect(p.weaknesses).not.toContain("grammar");
  });

  it("refuses to call two good answers a strength", () => {
    const p = buildSkillProfile(evidence("vocabulary", 95, 2), NOW);
    expect(p.strengths).not.toContain("vocabulary");
  });

  it("names a weakness once there is enough evidence", () => {
    const p = buildSkillProfile(evidence("grammar", 45, 6), NOW);
    expect(p.weaknesses).toContain("grammar");
    expect(summaryFor(p, "grammar").confidence).toBe("medium");
  });

  it("names a strength once there is enough evidence", () => {
    const p = buildSkillProfile(evidence("vocabulary", 92, 6), NOW);
    expect(p.strengths).toContain("vocabulary");
  });

  it("says nothing either way about a middling skill", () => {
    const p = buildSkillProfile(evidence("comprehension", 74, 8), NOW);
    expect(p.weaknesses).not.toContain("comprehension");
    expect(p.strengths).not.toContain("comprehension");
  });

  it("raises confidence as evidence accumulates", () => {
    expect(summaryFor(buildSkillProfile(evidence("fluency", 70, 2), NOW), "fluency").confidence).toBe("low");
    expect(summaryFor(buildSkillProfile(evidence("fluency", 70, 6), NOW), "fluency").confidence).toBe("medium");
    expect(summaryFor(buildSkillProfile(evidence("fluency", 70, 12), NOW), "fluency").confidence).toBe("high");
  });
});

describe("buildSkillProfile — recency", () => {
  it("weights recent work above old work", () => {
    // Struggled two months ago, solid since. The profile must reflect who they
    // are now, or it tells an improving student they are still bad.
    const p = buildSkillProfile(
      [...evidence("grammar", 30, 5, 70), ...evidence("grammar", 90, 5, 1)],
      NOW,
    );
    expect(summaryFor(p, "grammar").score).toBeGreaterThan(75);
    expect(p.weaknesses).not.toContain("grammar");
  });

  it("does not let old good work hide a current problem", () => {
    const p = buildSkillProfile(
      [...evidence("pronunciation", 95, 5, 70), ...evidence("pronunciation", 45, 5, 1)],
      NOW,
    );
    expect(summaryFor(p, "pronunciation").score).toBeLessThan(65);
    expect(p.weaknesses).toContain("pronunciation");
  });

  it("still produces a score when every observation is ancient", () => {
    // Decayed weights can underflow to zero; falling back to an unweighted mean
    // keeps a dormant student's history readable instead of blanking it.
    const p = buildSkillProfile(evidence("writing", 60, 5, 4000), NOW);
    expect(summaryFor(p, "writing").score).toBe(60);
    expect(Number.isFinite(summaryFor(p, "writing").score as number)).toBe(true);
  });

  it("records when a skill was last seen — the newest observation, not the oldest", () => {
    // evidence(...) walks backwards from `startDaysAgo`, so these land at 2, 3
    // and 4 days ago. "Last seen" is the most recent of them.
    const p = buildSkillProfile(evidence("speaking", 70, 3, 2), NOW);
    expect(summaryFor(p, "speaking").lastObservedAt).toEqual(daysAgo(2));
  });
});

describe("buildSkillProfile — trend", () => {
  it("reports improvement", () => {
    const p = buildSkillProfile(
      [
        { skill: "grammar", score: 40, at: daysAgo(20) },
        { skill: "grammar", score: 45, at: daysAgo(16) },
        { skill: "grammar", score: 70, at: daysAgo(8) },
        { skill: "grammar", score: 78, at: daysAgo(2) },
      ],
      NOW,
    );
    expect(summaryFor(p, "grammar").trend).toBe("improving");
  });

  it("reports decline", () => {
    const p = buildSkillProfile(
      [
        { skill: "fluency", score: 85, at: daysAgo(20) },
        { skill: "fluency", score: 80, at: daysAgo(16) },
        { skill: "fluency", score: 60, at: daysAgo(8) },
        { skill: "fluency", score: 55, at: daysAgo(2) },
      ],
      NOW,
    );
    expect(summaryFor(p, "fluency").trend).toBe("declining");
  });

  it("reports steady when nothing much changed", () => {
    const p = buildSkillProfile(evidence("vocabulary", 70, 8), NOW);
    expect(summaryFor(p, "vocabulary").trend).toBe("steady");
  });

  it("will not guess a trend from too few points", () => {
    const p = buildSkillProfile(evidence("writing", 50, 3), NOW);
    expect(summaryFor(p, "writing").trend).toBe("unknown");
  });

  it("measures the trend unweighted, so recency cannot hide it", () => {
    // Recency weighting would make the newer half dominate both halves and
    // flatten every trend to "steady".
    const p = buildSkillProfile(
      [
        { skill: "comprehension", score: 30, at: daysAgo(90) },
        { skill: "comprehension", score: 35, at: daysAgo(85) },
        { skill: "comprehension", score: 85, at: daysAgo(3) },
        { skill: "comprehension", score: 90, at: daysAgo(1) },
      ],
      NOW,
    );
    expect(summaryFor(p, "comprehension").trend).toBe("improving");
  });
});

describe("buildSkillProfile — weighting", () => {
  it("lets a dedicated assessment count for more than a single question", () => {
    const light = buildSkillProfile(
      [
        { skill: "speaking", score: 90, at: daysAgo(1), weight: 1 },
        { skill: "speaking", score: 40, at: daysAgo(1), weight: 1 },
        { skill: "speaking", score: 90, at: daysAgo(1), weight: 1 },
      ],
      NOW,
    );
    const heavy = buildSkillProfile(
      [
        { skill: "speaking", score: 90, at: daysAgo(1), weight: 1 },
        { skill: "speaking", score: 40, at: daysAgo(1), weight: 5 },
        { skill: "speaking", score: 90, at: daysAgo(1), weight: 1 },
      ],
      NOW,
    );
    expect(heavy.skills.find((s) => s.skill === "speaking")!.score).toBeLessThan(
      light.skills.find((s) => s.skill === "speaking")!.score as number,
    );
  });
});

describe("buildSkillProfile — ordering and robustness", () => {
  it("lists weaknesses worst first", () => {
    const p = buildSkillProfile(
      [
        ...evidence("grammar", 60, 6),
        ...evidence("vocabulary", 35, 6),
        ...evidence("comprehension", 50, 6),
      ],
      NOW,
    );
    expect(p.weaknesses).toEqual(["vocabulary", "comprehension", "grammar"]);
  });

  it("lists strengths best first", () => {
    const p = buildSkillProfile(
      [...evidence("writing", 85, 6), ...evidence("fluency", 96, 6)],
      NOW,
    );
    expect(p.strengths).toEqual(["fluency", "writing"]);
  });

  it("clamps scores outside 0–100 rather than letting them skew the mean", () => {
    const p = buildSkillProfile(
      [
        { skill: "grammar", score: 500, at: daysAgo(1) },
        { skill: "grammar", score: -200, at: daysAgo(1) },
        { skill: "grammar", score: 50, at: daysAgo(1) },
      ],
      NOW,
    );
    const score = summaryFor(p, "grammar").score as number;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("survives a non-finite score", () => {
    const p = buildSkillProfile(
      [
        { skill: "grammar", score: NaN, at: daysAgo(1) },
        ...evidence("grammar", 80, 4),
      ],
      NOW,
    );
    expect(Number.isFinite(summaryFor(p, "grammar").score as number)).toBe(true);
  });

  it("does not depend on the order evidence arrives in", () => {
    const rows = [
      ...evidence("grammar", 40, 4),
      ...evidence("vocabulary", 80, 4),
    ];
    expect(buildSkillProfile([...rows].reverse(), NOW)).toEqual(
      buildSkillProfile(rows, NOW),
    );
  });

  it("always reports every skill, even the untouched ones", () => {
    const p = buildSkillProfile(evidence("grammar", 70, 3), NOW);
    expect(p.skills).toHaveLength(7);
  });

  it("is reproducible", () => {
    const rows = evidence("fluency", 63, 7);
    const scores = Array.from(
      { length: 10 },
      () => buildSkillProfile(rows, NOW).skills.find((s) => s.skill === "fluency")!.score,
    );
    expect(new Set(scores).size).toBe(1);
  });
});

describe("primaryFocus", () => {
  it("picks the single weakest skill", () => {
    const p = buildSkillProfile(
      [...evidence("grammar", 60, 6), ...evidence("pronunciation", 40, 6)],
      NOW,
    );
    expect(primaryFocus(p)).toBe("pronunciation");
  });

  it("returns nothing when there is no supportable weakness", () => {
    // A list of six things to fix is a list nobody acts on, and inventing one
    // from thin evidence is worse than staying quiet.
    expect(primaryFocus(buildSkillProfile(evidence("grammar", 90, 6), NOW))).toBeNull();
    expect(primaryFocus(buildSkillProfile([], NOW))).toBeNull();
  });
});
