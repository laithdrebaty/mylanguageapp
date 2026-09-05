import { describe, it, expect } from "vitest";
import {
  scorePlacement,
  applyLevelAdjustment,
  type AnsweredQuestion,
  type Difficulty,
  type PlacementSkill,
} from "./placement";

const CURRICULUM = [
  "A1.1", "A1.2", "A2.1", "A2.2", "B1.1", "B1.2",
  "B2.1", "B2.2", "C1.1", "C1.2", "C2.1", "C2.2",
];

function questions(
  skill: PlacementSkill,
  difficulty: Difficulty,
  count: number,
  correct: number,
): AnsweredQuestion[] {
  return Array.from({ length: count }, (_, i) => ({
    skill,
    difficulty,
    correct: i < correct,
  }));
}

/** A spread across skills and difficulties, with `fraction` answered right. */
function mixed(fraction: number): AnsweredQuestion[] {
  const skills: PlacementSkill[] = ["grammar", "vocabulary", "reading", "comprehension"];
  const levels: Difficulty[] = ["A1", "A2", "B1", "B2"];
  const out: AnsweredQuestion[] = [];
  for (const skill of skills) {
    for (const difficulty of levels) {
      out.push(...questions(skill, difficulty, 2, Math.round(2 * fraction)));
    }
  }
  return out;
}

const scoreOf = (o: ReturnType<typeof scorePlacement>, skill: PlacementSkill) =>
  o.skills.find((s) => s.skill === skill)!;

describe("scorePlacement — the level", () => {
  it("places someone who got nothing right at the very bottom", () => {
    expect(scorePlacement(mixed(0)).levelCode).toBe("A1.1");
  });

  it("places a strong performance high", () => {
    expect(scorePlacement(mixed(1)).band).toMatch(/B2|C1/);
  });

  it("moves the level up as the score rises", () => {
    const codes = [0, 0.25, 0.5, 0.75, 1].map((f) => scorePlacement(mixed(f)).levelCode);
    const indices = codes.map((c) => CURRICULUM.indexOf(c));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
    }
  });

  it("will not place anyone at the top of the scale from a short test", () => {
    // A twenty-question quiz is not evidence that someone belongs in C2, and
    // placing them there strands them with no way back but an administrator.
    // Under-placing is recoverable; over-placing is not.
    expect(scorePlacement(mixed(1)).band).not.toBe("C2");
  });

  it("distinguishes a strong beginner from a weak intermediate", () => {
    // Both score about half. Only the difficulty of what they got right
    // separates them, which is the whole reason questions carry a level.
    const strongBeginner = [
      ...questions("grammar", "A1", 5, 5),
      ...questions("grammar", "B2", 5, 0),
    ];
    const weakIntermediate = [
      ...questions("grammar", "A1", 5, 1),
      ...questions("grammar", "B2", 5, 4),
    ];
    const a = CURRICULUM.indexOf(scorePlacement(strongBeginner).levelCode);
    const b = CURRICULUM.indexOf(scorePlacement(weakIntermediate).levelCode);
    expect(b).toBeGreaterThan(a);
  });

  it("always produces a level that exists in the curriculum", () => {
    for (const f of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
      expect(CURRICULUM).toContain(scorePlacement(mixed(f)).levelCode);
    }
  });

  it("does not fall over on an empty test", () => {
    const o = scorePlacement([]);
    expect(o.overall).toBe(0);
    expect(o.levelCode).toBe("A1.1");
  });
});

describe("scorePlacement — the breakdown", () => {
  it("scores each skill separately", () => {
    const o = scorePlacement([
      ...questions("grammar", "A1", 4, 1),
      ...questions("vocabulary", "A1", 4, 4),
    ]);
    expect(scoreOf(o, "grammar").score).toBe(25);
    expect(scoreOf(o, "vocabulary").score).toBe(100);
  });

  it("reports null for a skill the test never asked about", () => {
    const o = scorePlacement(questions("grammar", "A1", 4, 2));
    expect(scoreOf(o, "listening").score).toBeNull();
    expect(scoreOf(o, "listening").answered).toBe(0);
  });

  it("names strengths and weaknesses", () => {
    const o = scorePlacement([
      ...questions("vocabulary", "A1", 4, 4),
      ...questions("grammar", "A1", 4, 1),
    ]);
    expect(o.strengths).toContain("vocabulary");
    expect(o.weaknesses).toContain("grammar");
  });

  it("will not call a skill weak on the strength of one question", () => {
    const o = scorePlacement([
      ...questions("grammar", "A1", 1, 0),
      ...questions("vocabulary", "A1", 4, 2),
    ]);
    expect(o.weaknesses).not.toContain("grammar");
  });

  it("does not let a skill with two questions outweigh one with ten", () => {
    // The overall figure is weighted over every question, not averaged across
    // per-skill percentages.
    const o = scorePlacement([
      ...questions("grammar", "A1", 10, 10),
      ...questions("vocabulary", "A1", 2, 0),
    ]);
    expect(o.overall).toBeGreaterThan(75);
  });

  it("orders weaknesses worst first and strengths best first", () => {
    const o = scorePlacement([
      ...questions("grammar", "A1", 4, 2),
      ...questions("vocabulary", "A1", 4, 0),
      ...questions("reading", "A1", 4, 4),
      ...questions("comprehension", "A1", 4, 3),
    ]);
    expect(o.weaknesses[0]).toBe("vocabulary");
    expect(o.strengths[0]).toBe("reading");
  });
});

describe("scorePlacement — the written answer", () => {
  it("records the writing score as its own skill", () => {
    const o = scorePlacement(questions("grammar", "A1", 4, 2), 90);
    expect(scoreOf(o, "writing").score).toBe(90);
  });

  it("lets a good writer with weak grammar show up as exactly that", () => {
    const o = scorePlacement(questions("grammar", "A1", 6, 1), 95);
    expect(o.weaknesses).toContain("grammar");
    expect(scoreOf(o, "writing").score).toBe(95);
  });

  it("counts towards the level without dominating it", () => {
    const without = scorePlacement(mixed(0.5));
    const withPerfect = scorePlacement(mixed(0.5), 100);
    expect(withPerfect.overall).toBeGreaterThan(without.overall);
    expect(withPerfect.overall - without.overall).toBeLessThan(15);
  });

  it("ignores a missing writing score rather than treating it as zero", () => {
    const a = scorePlacement(mixed(0.5));
    const b = scorePlacement(mixed(0.5), null);
    expect(a.overall).toBe(b.overall);
    expect(scoreOf(b, "writing").score).toBeNull();
  });
});

describe("applyLevelAdjustment", () => {
  const computed = scorePlacement(mixed(0.5));

  it("accepts a move of one sub-level", () => {
    const index = CURRICULUM.indexOf(computed.levelCode);
    const oneUp = CURRICULUM[index + 1];
    const r = applyLevelAdjustment(computed, oneUp, CURRICULUM);
    expect(r.levelCode).toBe(oneUp);
    expect(r.adjusted).toBe(true);
  });

  it("refuses a bigger jump and keeps the computed level", () => {
    // A model returning C2.2 for someone who scored half is not making a
    // judgement about an uneven profile. It is wrong, and the arithmetic wins.
    const r = applyLevelAdjustment(computed, "C2.2", CURRICULUM);
    expect(r.levelCode).toBe(computed.levelCode);
    expect(r.adjusted).toBe(false);
  });

  it("refuses a level this curriculum does not have", () => {
    expect(applyLevelAdjustment(computed, "Z9.9", CURRICULUM).levelCode).toBe(
      computed.levelCode,
    );
  });

  it("keeps the computed level when nothing was suggested", () => {
    expect(applyLevelAdjustment(computed, null, CURRICULUM).adjusted).toBe(false);
    expect(applyLevelAdjustment(computed, undefined, CURRICULUM).adjusted).toBe(false);
  });

  it("reports no adjustment when the suggestion matches", () => {
    const r = applyLevelAdjustment(computed, computed.levelCode, CURRICULUM);
    expect(r.adjusted).toBe(false);
  });

  it("accepts a move down as readily as a move up", () => {
    const index = CURRICULUM.indexOf(computed.levelCode);
    const oneDown = CURRICULUM[index - 1];
    expect(applyLevelAdjustment(computed, oneDown, CURRICULUM).levelCode).toBe(oneDown);
  });
});
