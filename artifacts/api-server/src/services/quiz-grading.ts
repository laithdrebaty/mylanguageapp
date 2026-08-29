/**
 * Quiz block configuration, sanitisation, and auto-grading.
 *
 * Quiz answer keys live in `content_blocks.config` (a JSONB bag) rather than in
 * the `exercises` table, because `exercises.lesson_id` is NOT NULL and a quiz
 * block has no lesson.
 *
 * SECURITY
 * ────────
 * `config` holds the correct answers. It must NEVER reach a student verbatim.
 * Every student-facing path goes through `sanitizeBlockForStudent`, and grading
 * happens here on the server — a score submitted by the client is always ignored.
 */

/** Shape a teacher authors into content_blocks.config for a quiz block. */
export interface QuizBlockConfig {
  /** Choices for mcq / multi_select. */
  options?: Array<{ id: string; text: string; textAr?: string | null }>;
  /** Correct choice ids. One entry for mcq, one or more for multi_select. */
  correctOptionIds?: string[];
  /** Shown after grading (or immediately, when revealAnswers = 'immediate'). */
  explanation?: string | null;
  explanationAr?: string | null;
  /** Rubric for writing / image_describe — what a good answer must mention. */
  keyPoints?: string[];
  /** Minimum words before a written answer is accepted. */
  minWords?: number;
  /** Media asset key for listening / audio / video blocks. */
  mediaKey?: string | null;
  /** Weight of this block in the total. Defaults to 1. */
  points?: number;
}

/** Blocks whose answers the server can score with no AI and no teacher. */
const AUTO_GRADED = new Set(["mcq", "multi_select", "spelling"]);
/** Blocks that carry no answer at all — presentational only. */
const NON_SCORING = new Set(["text", "explanation", "video", "audio"]);

export const isAutoGraded = (type: string): boolean => AUTO_GRADED.has(type);
export const isNonScoring = (type: string): boolean => NON_SCORING.has(type);

/** Blocks needing an AI verdict (or a teacher, until AI is configured). */
export const needsAssessment = (type: string): boolean =>
  !isAutoGraded(type) && !isNonScoring(type);

export const blockPoints = (config: QuizBlockConfig | null): number => {
  const p = config?.points;
  return typeof p === "number" && p > 0 ? p : 1;
};

/**
 * Strip everything a student must not see.
 *
 * Returns the block with `config` replaced by a whitelist: option text without
 * the `correctOptionIds` key, media references, and word limits. The
 * explanation is withheld unless the caller says answers may be revealed.
 */
export function sanitizeBlockForStudent<T extends { type: string; config: unknown }>(
  block: T,
  opts: { revealAnswers: boolean } = { revealAnswers: false },
): Omit<T, "config"> & { config: Record<string, unknown> } {
  const config = (block.config ?? {}) as QuizBlockConfig;

  const safe: Record<string, unknown> = {};

  if (Array.isArray(config.options)) {
    // Deliberately rebuild each option rather than spreading, so a stray
    // `isCorrect` flag on an authored option can never slip through.
    safe.options = config.options.map((o) => ({
      id: o.id,
      text: o.text,
      textAr: o.textAr ?? null,
    }));
  }
  if (typeof config.minWords === "number") safe.minWords = config.minWords;
  if (config.mediaKey) safe.mediaKey = config.mediaKey;
  safe.points = blockPoints(config);

  if (opts.revealAnswers) {
    if (config.explanation) safe.explanation = config.explanation;
    if (config.explanationAr) safe.explanationAr = config.explanationAr;
    if (Array.isArray(config.correctOptionIds)) {
      safe.correctOptionIds = config.correctOptionIds;
    }
  }

  const { config: _dropped, ...rest } = block;
  return { ...rest, config: safe };
}

export interface GradeResult {
  /** 0-100 for this block, or null when it awaits AI/teacher assessment. */
  score: number | null;
  gradedBy: "auto" | "pending";
  feedback: string | null;
}

/**
 * Score one response.
 *
 * Objective types are decided here and now. Everything else returns `pending`
 * so an AI or a teacher can fill it in later without blocking submission.
 */
export function gradeResponse(
  blockType: string,
  config: QuizBlockConfig | null,
  response: unknown,
): GradeResult {
  if (isNonScoring(blockType)) {
    return { score: 100, gradedBy: "auto", feedback: null };
  }

  // Nothing was submitted. There is nothing for an AI or a teacher to assess,
  // so this scores zero now rather than sitting pending forever.
  if (isBlankResponse(response)) {
    return { score: 0, gradedBy: "auto", feedback: "No answer submitted." };
  }

  if (blockType === "mcq" || blockType === "multi_select") {
    const correct = config?.correctOptionIds ?? [];
    if (correct.length === 0) {
      // Authored without an answer key — do not silently mark it wrong.
      return { score: null, gradedBy: "pending", feedback: "No answer key configured." };
    }

    const selected = extractSelected(response);
    if (selected.length === 0) {
      return { score: 0, gradedBy: "auto", feedback: "No answer selected." };
    }

    if (blockType === "mcq") {
      const ok = selected.length === 1 && correct.includes(selected[0]);
      return { score: ok ? 100 : 0, gradedBy: "auto", feedback: null };
    }

    // multi_select: partial credit, penalising wrong picks so that selecting
    // every option cannot score full marks.
    const correctSet = new Set(correct);
    const hits = selected.filter((s) => correctSet.has(s)).length;
    const misses = selected.length - hits;
    const raw = (hits - misses) / correctSet.size;
    return {
      score: Math.max(0, Math.min(1, raw)) * 100,
      gradedBy: "auto",
      feedback: null,
    };
  }

  if (blockType === "spelling") {
    const expected = (config?.keyPoints ?? [])[0];
    const given = typeof response === "string" ? response : extractText(response);
    if (!expected) {
      return { score: null, gradedBy: "pending", feedback: "No expected spelling configured." };
    }
    const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
    return {
      score: norm(given ?? "") === norm(expected) ? 100 : 0,
      gradedBy: "auto",
      feedback: null,
    };
  }

  // writing / speaking_prompt / image_describe / listening — needs assessment.
  return { score: null, gradedBy: "pending", feedback: null };
}

/** True when the student submitted nothing meaningful for this block. */
export function isBlankResponse(response: unknown): boolean {
  if (response === null || response === undefined) return true;
  if (typeof response === "string") return response.trim() === "";
  if (Array.isArray(response)) return response.length === 0;
  if (typeof response === "object") {
    const values = Object.values(response as Record<string, unknown>);
    if (values.length === 0) return true;
    return values.every((v) => isBlankResponse(v));
  }
  return false;
}

function extractSelected(response: unknown): string[] {
  if (Array.isArray(response)) return response.filter((v): v is string => typeof v === "string");
  if (typeof response === "string") return [response];
  if (response && typeof response === "object") {
    const v = (response as Record<string, unknown>).selectedOptionIds
      ?? (response as Record<string, unknown>).selectedOptionId;
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
    if (typeof v === "string") return [v];
  }
  return [];
}

function extractText(response: unknown): string | null {
  if (typeof response === "string") return response;
  if (response && typeof response === "object") {
    const v = (response as Record<string, unknown>).text;
    if (typeof v === "string") return v;
  }
  return null;
}

export const responseText = extractText;
