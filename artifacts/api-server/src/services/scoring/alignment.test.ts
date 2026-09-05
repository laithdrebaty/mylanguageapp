import { describe, it, expect } from "vitest";
import {
  alignTranscript,
  pronunciationScore,
  normaliseWord,
  tokenise,
  countFillers,
} from "./alignment";

describe("normalisation", () => {
  it("ignores case and punctuation, which come from the transcriber", () => {
    expect(normaliseWord("Hello,")).toBe("hello");
    expect(normaliseWord("WORLD!")).toBe("world");
  });

  it("folds contractions together however they were written", () => {
    expect(normaliseWord("don't")).toBe(normaliseWord("dont"));
    expect(normaliseWord("cannot")).toBe(normaliseWord("can't"));
    expect(normaliseWord("It's")).toBe(normaliseWord("its"));
  });

  it("handles curly apostrophes, which recognisers emit", () => {
    expect(normaliseWord("don’t")).toBe(normaliseWord("don't"));
  });

  it("drops tokens that are only punctuation", () => {
    expect(tokenise("hello , world .")).toEqual(["hello", "world"]);
  });

  it("keeps numbers", () => {
    expect(tokenise("I woke at 6")).toEqual(["i", "woke", "at", "6"]);
  });
});

describe("alignTranscript", () => {
  const reference = "the quick brown fox jumps over the lazy dog";

  it("scores a perfect reading at 100", () => {
    const a = alignTranscript(reference, reference);
    expect(a.wordErrorRate).toBe(0);
    expect(a.coverage).toBe(1);
    expect(pronunciationScore(a)).toBe(100);
    expect(a.problemWords).toEqual([]);
  });

  it("is not fooled by case and punctuation", () => {
    const a = alignTranscript(reference, "The quick, brown FOX jumps over the lazy dog!");
    expect(pronunciationScore(a)).toBe(100);
  });

  it("names the words that were wrong", () => {
    const a = alignTranscript(reference, "the quick brown box jumps over the lazy dog");
    expect(a.substituted).toBe(1);
    expect(a.problemWords).toEqual(["fox"]);
    expect(pronunciationScore(a)).toBe(89);
  });

  it("counts a skipped word as missed, and names it", () => {
    const a = alignTranscript(reference, "the quick brown fox over the lazy dog");
    expect(a.deleted).toBe(1);
    expect(a.problemWords).toEqual(["jumps"]);
  });

  it("counts an added word", () => {
    const a = alignTranscript(reference, "the very quick brown fox jumps over the lazy dog");
    expect(a.inserted).toBe(1);
    // An added word is not a reference word, so it is not a problem word.
    expect(a.problemWords).toEqual([]);
  });

  it("does not punish hesitation sounds", () => {
    // "um" between correct words is nerves, not a reading error. A student who
    // hesitates must not score worse than one who does not.
    const a = alignTranscript(reference, "the quick um brown fox uh jumps over the lazy dog");
    expect(a.fillers).toBe(2);
    expect(a.inserted).toBe(0);
    expect(pronunciationScore(a)).toBe(100);
  });

  it("caps the damage from over-reading", () => {
    // Read the passage correctly, then keep talking. That should cost a little,
    // not fail — and ASR itself often hallucinates trailing words.
    const extra = `${reference} and then I stopped reading and said many other words here`;
    const a = alignTranscript(reference, extra);
    expect(a.inserted).toBe(11);
    expect(pronunciationScore(a)).toBeGreaterThanOrEqual(85);
  });

  it("scores a completely different passage at zero, never below", () => {
    const a = alignTranscript(reference, "totally unrelated words spoken aloud by someone");
    expect(pronunciationScore(a)).toBe(0);
    expect(a.wordErrorRate).toBeLessThanOrEqual(1);
  });

  it("treats silence as every word missed", () => {
    const a = alignTranscript(reference, "");
    expect(a.deleted).toBe(9);
    expect(a.coverage).toBe(0);
    expect(pronunciationScore(a)).toBe(0);
  });

  it("marks a half-read passage around half", () => {
    const a = alignTranscript(reference, "the quick brown fox jumps");
    expect(pronunciationScore(a)).toBe(56);
  });

  it("keeps the alignment in passage order", () => {
    const a = alignTranscript(reference, "the quick brown box jumps over the lazy dog");
    const indices = a.words
      .map((w) => w.referenceIndex)
      .filter((i): i is number => i !== null);
    expect(indices).toEqual([...indices].sort((x, y) => x - y));
  });

  it("reports one aligned entry per reference word plus insertions", () => {
    const a = alignTranscript(reference, "the quick brown fox jumps over the very lazy dog");
    const covered = a.words.filter((w) => w.op !== "insert").length;
    expect(covered).toBe(9);
  });

  it("handles a reference with no words without dividing by zero", () => {
    const a = alignTranscript("", "some words");
    expect(Number.isFinite(a.wordErrorRate)).toBe(true);
    expect(pronunciationScore(a)).toBe(0);
  });

  it("accepts a contraction where the passage spells it out", () => {
    const a = alignTranscript("I cannot do it", "I can't do it");
    expect(pronunciationScore(a)).toBe(100);
  });

  it("gives the same answer every time — this is a measurement, not an opinion", () => {
    const transcript = "the quick brown box jumped over a lazy dog";
    const scores = Array.from({ length: 20 }, () =>
      pronunciationScore(alignTranscript(reference, transcript)),
    );
    expect(new Set(scores).size).toBe(1);
  });
});

describe("countFillers", () => {
  it("counts hesitation sounds independently of any passage", () => {
    // Fluency needs this whether or not there is a reference text to align to.
    expect(countFillers("um I think uh maybe er yes")).toBe(3);
  });

  it("does not count real words that merely look similar", () => {
    expect(countFillers("the ambulance came and I ran home")).toBe(0);
  });

  it("is not confused by punctuation or case", () => {
    expect(countFillers("Um, well... Uh!")).toBe(2);
  });

  it("returns zero for an empty transcript", () => {
    expect(countFillers("")).toBe(0);
  });
});
