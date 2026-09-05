import { describe, it, expect } from "vitest";
import {
  gradeResponse,
  sanitizeBlockForStudent,
  isAutoGraded,
  needsAssessment,
  type QuizBlockConfig,
} from "./quiz-grading";

const mcq: QuizBlockConfig = {
  options: [
    { id: "a", text: "A" },
    { id: "b", text: "B" },
  ],
  correctOptionIds: ["a"],
  explanation: "A is correct",
};

describe("gradeResponse — recordings count as an answer", () => {
  it("does not score a spoken answer zero just because there is no text", () => {
    // The student's words are in the uploaded audio, not in `response`.
    const result = gradeResponse("speaking_prompt", null, null, { hasMedia: true });
    expect(result.score).toBeNull();
    expect(result.gradedBy).toBe("pending");
  });

  it("still scores a speaking block zero when nothing at all was submitted", () => {
    const result = gradeResponse("speaking_prompt", null, null);
    expect(result.score).toBe(0);
    expect(result.gradedBy).toBe("auto");
  });

  it("leaves a listening block with a recording pending rather than wrong", () => {
    const result = gradeResponse("listening", null, null, { hasMedia: true });
    expect(result.gradedBy).toBe("pending");
  });

  it("does not let an attached recording rescue a blank multiple-choice answer", () => {
    // Audio on an MCQ is meaningless — the question has a definite answer and
    // the student did not give one.
    const result = gradeResponse("mcq", mcq, null, { hasMedia: true });
    expect(result.score).toBe(0);
  });
});

describe("gradeResponse — objective types", () => {
  it("marks a correct single choice", () => {
    expect(gradeResponse("mcq", mcq, "a").score).toBe(100);
  });

  it("marks a wrong single choice", () => {
    expect(gradeResponse("mcq", mcq, "b").score).toBe(0);
  });

  it("leaves a question with no answer key pending instead of marking it wrong", () => {
    const result = gradeResponse("mcq", { options: mcq.options }, "a");
    expect(result.score).toBeNull();
    expect(result.gradedBy).toBe("pending");
  });

  it("does not give full marks for selecting every option", () => {
    const multi: QuizBlockConfig = {
      options: [
        { id: "a", text: "A" },
        { id: "b", text: "B" },
        { id: "c", text: "C" },
      ],
      correctOptionIds: ["a", "b"],
    };
    const all = gradeResponse("multi_select", multi, ["a", "b", "c"]).score ?? 0;
    const exact = gradeResponse("multi_select", multi, ["a", "b"]).score ?? 0;
    expect(exact).toBe(100);
    expect(all).toBeLessThan(exact);
  });

  it("ignores case and surrounding space when checking spelling", () => {
    const cfg: QuizBlockConfig = { keyPoints: ["Necessary"] };
    expect(gradeResponse("spelling", cfg, "  necessary ").score).toBe(100);
    expect(gradeResponse("spelling", cfg, "neccesary").score).toBe(0);
  });

  it("gives presentational blocks full marks so they cannot drag a score down", () => {
    expect(gradeResponse("text", null, null).score).toBe(100);
    expect(gradeResponse("explanation", null, null).score).toBe(100);
  });
});

describe("sanitizeBlockForStudent", () => {
  const block = { id: 1, type: "mcq", config: mcq as unknown };

  it("never sends the answer key while the attempt is live", () => {
    const safe = sanitizeBlockForStudent(block);
    expect(safe.config.correctOptionIds).toBeUndefined();
    expect(safe.config.explanation).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain("A is correct");
  });

  it("reveals the answer key once answers may be shown", () => {
    const safe = sanitizeBlockForStudent(block, { revealAnswers: true });
    expect(safe.config.correctOptionIds).toEqual(["a"]);
    expect(safe.config.explanation).toBe("A is correct");
  });

  it("keeps the option text students need to answer", () => {
    const safe = sanitizeBlockForStudent(block);
    expect(safe.config.options).toHaveLength(2);
  });

  it("drops a stray isCorrect flag an author left on an option", () => {
    const sneaky = {
      id: 2,
      type: "mcq",
      config: { options: [{ id: "a", text: "A", isCorrect: true }] } as unknown,
    };
    expect(JSON.stringify(sanitizeBlockForStudent(sneaky))).not.toContain("isCorrect");
  });
});

describe("block classification", () => {
  it("treats only the objectively-checkable types as auto-graded", () => {
    expect(isAutoGraded("mcq")).toBe(true);
    expect(isAutoGraded("multi_select")).toBe(true);
    expect(isAutoGraded("spelling")).toBe(true);
    expect(isAutoGraded("writing")).toBe(false);
    expect(isAutoGraded("speaking_prompt")).toBe(false);
  });

  it("sends speaking and writing for assessment", () => {
    expect(needsAssessment("speaking_prompt")).toBe(true);
    expect(needsAssessment("writing")).toBe(true);
    expect(needsAssessment("mcq")).toBe(false);
    expect(needsAssessment("text")).toBe(false);
  });
});
