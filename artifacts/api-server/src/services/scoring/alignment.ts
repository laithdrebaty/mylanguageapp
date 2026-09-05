/**
 * Comparing what a student read aloud against what they were asked to read.
 *
 * WHY THIS IS ARITHMETIC AND NOT A MODEL
 * ───────────────────────────────────────
 * Spec section 4A gates progress on a pronunciation score of 75%. A language
 * model asked "score this pronunciation" returns a different number each time
 * you ask, cannot explain which word was wrong, and cannot be defended to a
 * student who appeals. But the reference text is *ours* — the curriculum team
 * wrote the passage — so the transcript can be aligned against it and the
 * errors counted. That is a measurement: reproducible, explainable word by
 * word, and free.
 *
 * The model's job comes later and is a different one: turning these numbers
 * into a sentence of advice (spec section 8).
 *
 * WHAT THIS DOES AND DOES NOT MEASURE
 * ────────────────────────────────────
 * It measures whether the speech recogniser heard the right words. A word
 * mispronounced badly enough to be transcribed as a different word is caught;
 * a subtle vowel error that ASR still resolves correctly is not. That is a real
 * limitation and the reason `docs/features/pronunciation.md` says this is not
 * phoneme-level assessment. It is, however, exactly the signal a read-aloud
 * exercise needs: did they say the words on the page.
 */

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * Contractions a recogniser may expand or keep, and forms a reader may use
 * interchangeably with the text. Marking these wrong would punish a student for
 * the transcriber's choices rather than their own.
 */
const EQUIVALENTS: Record<string, string> = {
  cannot: "cant",
  "can't": "cant",
  "won't": "wont",
  "will not": "wont",
  "don't": "dont",
  "do not": "dont",
  "i'm": "iam",
  "i am": "iam",
  "it's": "its",
  "it is": "its",
  "that's": "thats",
  "that is": "thats",
  "there's": "theres",
  "there is": "theres",
  "he's": "hes",
  "she's": "shes",
  "we're": "were",
  "they're": "theyre",
  "you're": "youre",
  "isn't": "isnt",
  "is not": "isnt",
  "didn't": "didnt",
  "did not": "didnt",
  "ok": "okay",
};

/** Sounds a speaker makes while thinking. Never a reading error. */
export const FILLERS = new Set([
  "uh", "uhh", "um", "umm", "er", "err", "ah", "ahh", "eh", "hmm", "mm", "mhm",
]);

/**
 * Reduce a word to what can fairly be compared.
 *
 * Punctuation and case come from the transcriber, not the speaker, so they are
 * discarded. Apostrophes go too, which is what folds "dont" and "don't"
 * together without needing an entry for every contraction.
 */
export function normaliseWord(word: string): string {
  const lower = word.toLowerCase().trim();
  const mapped = EQUIVALENTS[lower] ?? lower;
  return mapped
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Count hesitation sounds in a transcript.
 *
 * Separate from alignment on purpose: fluency needs this number whether or not
 * there is a passage to align against. Deriving it from the alignment meant
 * open speaking — which has no passage — silently counted zero fillers and
 * scored better than the same recording graded against a text.
 */
export function countFillers(text: string): number {
  return tokenise(text).filter((w) => FILLERS.has(w)).length;
}

/** Split text into comparable words, dropping anything that normalises away. */
export function tokenise(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normaliseWord)
    .filter((w) => w.length > 0);
}

// ─── Alignment ────────────────────────────────────────────────────────────────

export type AlignmentOp = "match" | "substitute" | "delete" | "insert";

export interface AlignedWord {
  op: AlignmentOp;
  /** The word from the passage. Null for an insertion. */
  reference: string | null;
  /** What was heard. Null for a deletion. */
  heard: string | null;
  /** Index in the reference token list, for highlighting the passage. */
  referenceIndex: number | null;
}

export interface AlignmentResult {
  words: AlignedWord[];
  referenceWordCount: number;
  heardWordCount: number;
  matched: number;
  substituted: number;
  /** Reference words that were not said at all. */
  deleted: number;
  /** Words said that are not in the passage (excluding fillers). */
  inserted: number;
  /** Filler sounds, counted separately — hesitation, not a reading error. */
  fillers: number;
  /** (substitutions + deletions + insertions) / reference words. */
  wordErrorRate: number;
  /** Share of the passage actually read correctly. */
  coverage: number;
  /** Reference words that were wrong or missed, in passage order. */
  problemWords: string[];
}

/**
 * Align a transcript against the reference passage.
 *
 * Standard Levenshtein over word tokens with a backtrace, which is the same
 * method speech-recognition accuracy is universally measured with. Fillers are
 * stripped from the transcript before aligning: "um" between two correct words
 * is hesitation, and counting it as an inserted error would mean a nervous
 * student scores worse than a careless one.
 */
export function alignTranscript(
  referenceText: string,
  transcript: string,
): AlignmentResult {
  const reference = tokenise(referenceText);
  const heardRaw = tokenise(transcript);

  const fillers = heardRaw.filter((w) => FILLERS.has(w)).length;
  const heard = heardRaw.filter((w) => !FILLERS.has(w));

  const empty: AlignmentResult = {
    words: [],
    referenceWordCount: reference.length,
    heardWordCount: heard.length,
    matched: 0,
    substituted: 0,
    deleted: reference.length,
    inserted: 0,
    fillers,
    wordErrorRate: reference.length === 0 ? 0 : 1,
    coverage: 0,
    problemWords: reference,
  };

  if (reference.length === 0 || heard.length === 0) {
    if (reference.length === 0) {
      // Nothing to read against. Every heard word is an insertion, and there is
      // no meaningful error rate — the caller should not have asked.
      return {
        ...empty,
        deleted: 0,
        inserted: heard.length,
        wordErrorRate: 0,
        coverage: 0,
        problemWords: [],
        words: heard.map((h) => ({
          op: "insert" as const,
          reference: null,
          heard: h,
          referenceIndex: null,
        })),
      };
    }
    return {
      ...empty,
      words: reference.map((r, i) => ({
        op: "delete" as const,
        reference: r,
        heard: null,
        referenceIndex: i,
      })),
    };
  }

  const n = reference.length;
  const m = heard.length;

  // cost[i][j] = edit distance between reference[0..i) and heard[0..j)
  const cost: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 0; i <= n; i++) cost[i][0] = i;
  for (let j = 0; j <= m; j++) cost[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = reference[i - 1] === heard[j - 1];
      cost[i][j] = Math.min(
        cost[i - 1][j - 1] + (same ? 0 : 1), // match or substitute
        cost[i - 1][j] + 1, // deletion — the word was not said
        cost[i][j - 1] + 1, // insertion — an extra word was said
      );
    }
  }

  // Walk back from the corner to recover which operation produced each step.
  const words: AlignedWord[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const same = reference[i - 1] === heard[j - 1];
      if (cost[i][j] === cost[i - 1][j - 1] + (same ? 0 : 1)) {
        words.push({
          op: same ? "match" : "substitute",
          reference: reference[i - 1],
          heard: heard[j - 1],
          referenceIndex: i - 1,
        });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
      words.push({
        op: "delete",
        reference: reference[i - 1],
        heard: null,
        referenceIndex: i - 1,
      });
      i--;
      continue;
    }
    words.push({
      op: "insert",
      reference: null,
      heard: heard[j - 1],
      referenceIndex: null,
    });
    j--;
  }

  words.reverse();

  const matched = words.filter((w) => w.op === "match").length;
  const substituted = words.filter((w) => w.op === "substitute").length;
  const deleted = words.filter((w) => w.op === "delete").length;
  const inserted = words.filter((w) => w.op === "insert").length;

  return {
    words,
    referenceWordCount: n,
    heardWordCount: m,
    matched,
    substituted,
    deleted,
    inserted,
    fillers,
    // Capped at 1: a student who reads a completely different passage scores
    // zero, not a negative number that would distort any average built on it.
    wordErrorRate: Math.min(1, (substituted + deleted + inserted) / n),
    coverage: matched / n,
    problemWords: words
      .filter((w) => (w.op === "substitute" || w.op === "delete") && w.reference)
      .map((w) => w.reference as string),
  };
}

// ─── Score ────────────────────────────────────────────────────────────────────

/**
 * The pronunciation score, 0–100.
 *
 * One minus the word error rate, which is the accepted measure of how well
 * speech was recognised. Explainable to a student in one sentence: "you said 43
 * of the 50 words correctly", with `problemWords` naming exactly which ones.
 *
 * Insertions count, but only up to a point. A student who reads the passage
 * correctly and then adds a sentence of their own should lose a little, not
 * fail — over-reading is not the failure mode this exercise is guarding
 * against, and ASR routinely hallucinates a trailing word or two on quiet audio.
 */
export function pronunciationScore(alignment: AlignmentResult): number {
  if (alignment.referenceWordCount === 0) return 0;

  const { substituted, deleted, inserted, referenceWordCount } = alignment;

  const cappedInsertions = Math.min(inserted, Math.ceil(referenceWordCount * 0.1));
  const errors = substituted + deleted + cappedInsertions;
  const accuracy = 1 - errors / referenceWordCount;

  return Math.max(0, Math.min(100, Math.round(accuracy * 100)));
}
