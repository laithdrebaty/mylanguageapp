import { describe, it, expect } from "vitest";
import {
  rankPracticeMatches,
  bestPracticeMatch,
  isEligible,
  normaliseTag,
  MAX_LEVEL_GAP,
  CANDIDATE_STALE_MS,
  type PracticeCandidate,
  type PracticeSeeker,
} from "./practice-match";

const NOW = new Date("2026-09-05T12:00:00Z");
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000);

function seeker(over: Partial<PracticeSeeker> = {}): PracticeSeeker {
  return {
    userId: 1,
    levelOrder: 3,
    goals: [],
    interests: [],
    professionalField: null,
    availableHours: [],
    ...over,
  };
}

function candidate(over: Partial<PracticeCandidate> = {}): PracticeCandidate {
  return {
    userId: 2,
    levelOrder: 3,
    goals: [],
    interests: [],
    professionalField: null,
    availableHours: [],
    waitingSince: secondsAgo(5),
    lastSeenAt: secondsAgo(1),
    ...over,
  };
}

const rank = (s: PracticeSeeker, c: PracticeCandidate[], o = {}) =>
  rankPracticeMatches(s, c, { now: NOW, ...o });

describe("who is refused outright", () => {
  it("never offers a student themselves", () => {
    expect(rank(seeker({ userId: 7 }), [candidate({ userId: 7 })])).toHaveLength(0);
  });

  it("never offers someone the student has blocked, or who blocked them", () => {
    // The caller passes both directions of the block relationship, because a
    // block is symmetric in effect even though only one row is written. This is
    // the single most important exclusion in the feature: a student who blocked
    // someone must never see them again.
    const out = rank(seeker(), [candidate({ userId: 2 })], { blockedUserIds: [2] });
    expect(out).toHaveLength(0);
  });

  it("never offers someone already in a call", () => {
    expect(rank(seeker(), [candidate({ userId: 2 })], { busyUserIds: [2] })).toHaveLength(0);
  });

  it("never offers someone whose browser has stopped polling", () => {
    // They closed the tab. Ringing them spends the seeker's patience on a call
    // that will not be answered.
    const gone = candidate({ lastSeenAt: new Date(NOW.getTime() - CANDIDATE_STALE_MS - 1) });
    expect(rank(seeker(), [gone])).toHaveLength(0);
  });

  it("refuses a pairing further apart than MAX_LEVEL_GAP rather than ranking it low", () => {
    // A B2 and an A1 do not have a conversation. Ranking this last would still
    // pair them whenever nobody better is waiting, which is exactly when a
    // lonely student would accept it.
    const far = candidate({ levelOrder: 3 + MAX_LEVEL_GAP + 1 });
    expect(rank(seeker({ levelOrder: 3 }), [far])).toHaveLength(0);
  });

  it("allows a neighbouring level", () => {
    expect(rank(seeker({ levelOrder: 3 }), [candidate({ levelOrder: 4 })])).toHaveLength(1);
  });

  it("still matches a student who has not been placed yet", () => {
    // Refusing an unplaced student would leave the feature unusable on the day
    // someone signs up. They are matched, and ranked below any known pairing.
    const out = rank(seeker({ levelOrder: null }), [candidate({ levelOrder: 5 })]);
    expect(out).toHaveLength(1);
  });

  it("isEligible and the ranking agree about who is allowed", () => {
    const blocked = candidate({ userId: 2 });
    expect(isEligible(seeker(), blocked, { now: NOW, blockedUserIds: [2] })).toBe(false);
    expect(isEligible(seeker(), blocked, { now: NOW })).toBe(true);
  });
});

describe("what the ranking prefers", () => {
  it("puts the same level above a neighbouring level", () => {
    const out = rank(seeker({ levelOrder: 3 }), [
      candidate({ userId: 2, levelOrder: 4 }),
      candidate({ userId: 3, levelOrder: 3 }),
    ]);
    expect(out[0]!.userId).toBe(3);
  });

  it("puts a known level above an unknown one", () => {
    const out = rank(seeker({ levelOrder: 3 }), [
      candidate({ userId: 2, levelOrder: null }),
      candidate({ userId: 3, levelOrder: 4 }),
    ]);
    expect(out[0]!.userId).toBe(3);
  });

  it("uses shared interests to separate two partners at the same level", () => {
    // This is what the tags are for: level says the conversation is possible,
    // interests say there is something to talk about once the greeting is over.
    const out = rank(seeker({ interests: ["football", "cooking"] }), [
      candidate({ userId: 2 }),
      candidate({ userId: 3, interests: ["cooking"] }),
    ]);
    expect(out[0]!.userId).toBe(3);
  });

  it("never lets shared tags beat a level advantage outright", () => {
    // The most tags, goals, field and hours can add is below the gap between
    // same-level and one-level-apart. A perfectly matched neighbour draws level
    // with a same-level stranger; it does not overtake one who also shares
    // interests.
    const tagRich = candidate({
      userId: 2,
      levelOrder: 4,
      interests: ["a", "b", "c", "d", "e"],
      goals: ["x", "y", "z", "w"],
      professionalField: "medicine",
      availableHours: [12],
      waitingSince: secondsAgo(5),
    });
    const plainSameLevel = candidate({
      userId: 3,
      levelOrder: 3,
      interests: ["a"],
      waitingSince: secondsAgo(5),
    });
    const out = rank(
      seeker({
        levelOrder: 3,
        interests: ["a", "b", "c", "d", "e"],
        goals: ["x", "y", "z", "w"],
        professionalField: "medicine",
        availableHours: [12],
      }),
      [tagRich, plainSameLevel],
    );
    expect(out[0]!.userId).toBe(3);
  });

  it("breaks a tie in favour of whoever has waited longer", () => {
    const out = rank(seeker(), [
      candidate({ userId: 2, waitingSince: secondsAgo(5) }),
      candidate({ userId: 3, waitingSince: secondsAgo(240) }),
    ]);
    expect(out[0]!.userId).toBe(3);
  });

  it("caps the waiting bonus so a long wait cannot force a bad pairing", () => {
    // Someone waiting an hour is still not given a partner one level away when
    // a same-level partner is there.
    const out = rank(seeker({ levelOrder: 3 }), [
      candidate({ userId: 2, levelOrder: 4, waitingSince: secondsAgo(3600) }),
      candidate({ userId: 3, levelOrder: 3, waitingSince: secondsAgo(1) }),
    ]);
    expect(out[0]!.userId).toBe(3);
  });

  it("counts a shared professional field and overlapping hours", () => {
    const out = rank(
      seeker({ professionalField: "Medicine", availableHours: [19, 20] }),
      [
        candidate({ userId: 2 }),
        candidate({ userId: 3, professionalField: "medicine", availableHours: [20] }),
      ],
    );
    expect(out[0]!.userId).toBe(3);
    expect(out[0]!.reasons.join(" ")).toContain("same field");
    expect(out[0]!.reasons.join(" ")).toContain("same times");
  });

  it("ranks the same pool the same way whatever order it arrives in", () => {
    // Two API instances matching from the same queue must agree, or the same
    // student is offered two different partners a moment apart.
    const pool = [
      candidate({ userId: 5, waitingSince: secondsAgo(5) }),
      candidate({ userId: 2, waitingSince: secondsAgo(5) }),
      candidate({ userId: 9, waitingSince: secondsAgo(5) }),
    ];
    const forwards = rank(seeker(), pool).map((m) => m.userId);
    const backwards = rank(seeker(), [...pool].reverse()).map((m) => m.userId);
    expect(forwards).toEqual(backwards);
    expect(forwards[0]).toBe(2);
  });
});

describe("tags as students actually type them", () => {
  it("treats case and stray spacing as the same tag", () => {
    expect(normaliseTag("  Football  ")).toBe(normaliseTag("football"));
    const out = rank(seeker({ interests: ["Football"] }), [
      candidate({ interests: ["  football "] }),
    ]);
    expect(out[0]!.reasons.join(" ")).toContain("football");
  });

  it("ignores Arabic diacritics, which carry no meaning for matching", () => {
    expect(normaliseTag("سَفَر")).toBe(normaliseTag("سفر"));
  });

  it("does not count the same interest twice when a student listed it twice", () => {
    const withDuplicates = rank(seeker({ interests: ["books"] }), [
      candidate({ userId: 2, interests: ["books", "Books", "BOOKS"] }),
    ]);
    const withOne = rank(seeker({ interests: ["books"] }), [
      candidate({ userId: 3, interests: ["books"] }),
    ]);
    expect(withDuplicates[0]!.score).toBe(withOne[0]!.score);
  });
});

describe("nobody available", () => {
  it("returns nothing rather than the least bad option", () => {
    // "No one is available right now" is a legitimate answer, and a better one
    // than pairing two people who cannot hold a conversation.
    expect(bestPracticeMatch(seeker({ levelOrder: 1 }), [candidate({ levelOrder: 6 })], {
      now: NOW,
    })).toBeNull();
    expect(bestPracticeMatch(seeker(), [], { now: NOW })).toBeNull();
  });
});
