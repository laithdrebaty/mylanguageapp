import { describe, it, expect } from "vitest";
import { extractJsonObject } from "./openai-compatible";

/**
 * Models wrap JSON in prose and fences however firmly you ask them not to.
 * Grading a student must not fail because a model said "Sure!" first, so the
 * extractor is deliberately forgiving about what surrounds the object — and
 * deliberately strict about the object itself.
 */
describe("extractJsonObject", () => {
  it("parses a bare object", () => {
    expect(extractJsonObject('{"score":80}')).toEqual({ score: 80 });
  });

  it("ignores prose before and after", () => {
    expect(
      extractJsonObject('Sure! Here is the result:\n{"score":75}\nHope that helps.'),
    ).toEqual({ score: 75 });
  });

  it("sees through a markdown fence", () => {
    expect(extractJsonObject('```json\n{"score":90,"correct":true}\n```')).toEqual({
      score: 90,
      correct: true,
    });
  });

  it("keeps nested objects whole", () => {
    expect(extractJsonObject('prefix {"a":{"b":{"c":1}},"d":2} suffix')).toEqual({
      a: { b: { c: 1 } },
      d: 2,
    });
  });

  it("does not stop at a brace inside a string", () => {
    // Naive brace counting ends the object early here and produces invalid JSON.
    expect(extractJsonObject('{"feedback":"use { and } carefully","score":50}')).toEqual({
      feedback: "use { and } carefully",
      score: 50,
    });
  });

  it("handles an escaped quote inside a string", () => {
    expect(extractJsonObject('{"feedback":"say \\"hello\\" clearly"}')).toEqual({
      feedback: 'say "hello" clearly',
    });
  });

  it("handles a trailing backslash before the closing quote", () => {
    expect(extractJsonObject('{"path":"C:\\\\temp\\\\"}')).toEqual({ path: "C:\\temp\\" });
  });

  it("handles Arabic feedback text", () => {
    expect(extractJsonObject('{"feedbackAr":"إجابتك جيدة، لكن انتبه للقواعد."}')).toEqual({
      feedbackAr: "إجابتك جيدة، لكن انتبه للقواعد.",
    });
  });

  it("returns null when there is no object at all", () => {
    expect(extractJsonObject("I cannot help with that.")).toBeNull();
  });

  it("returns null for an unterminated object rather than guessing", () => {
    expect(extractJsonObject('{"score":80')).toBeNull();
  });

  it("returns null when the braces balance but the content is not JSON", () => {
    expect(extractJsonObject("{not json at all}")).toBeNull();
  });

  it("takes the first complete object when a model emits two", () => {
    expect(extractJsonObject('{"score":1} and also {"score":2}')).toEqual({ score: 1 });
  });

  it("is not confused by a brace appearing before the object in prose", () => {
    expect(extractJsonObject('Use } sparingly. {"score":10}')).toEqual({ score: 10 });
  });

  it("handles an empty object", () => {
    expect(extractJsonObject("{}")).toEqual({});
  });
});
