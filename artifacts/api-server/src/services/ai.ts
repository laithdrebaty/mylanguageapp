/**
 * Shared AI types.
 *
 * WHERE CONFIGURATION LIVES
 * ─────────────────────────
 * Not here, and not in the environment. Which provider, which model per task,
 * and how much each plan may use are rows in the database, edited at runtime
 * from the admin panel at /admin/ai — see `services/ai-config.ts`. The only
 * AI-related environment variable is `AI_CONFIG_SECRET`, which encrypts the
 * stored API keys.
 *
 * This file used to hold a provider factory keyed off `AI_PROVIDER`. That is
 * gone: it duplicated the runtime configuration, and it threw at startup on any
 * value it did not recognise, so a stale `.env` could stop the server booting.
 *
 * WHERE THE CALLS LIVE
 * ────────────────────
 *   services/ai-config.ts                   — resolve a task's provider, model, key
 *   services/ai-providers/openai-compatible — the one client for every provider
 *   services/ai-quota.ts                    — per-plan daily limits and usage logging
 *
 * The types below describe what the assessment features return. They are shared
 * so that a grader, a background job and a route all agree on the shape.
 */

/**
 * Legacy label recorded on `ai_usage_logs.feature` for continuity with rows
 * written before tasks existed. New code should use `AITask` from
 * `@workspace/db`; this stays only so old log rows remain interpretable.
 */
export type AIFeature =
  | "speaking_evaluation"
  | "pronunciation_evaluation"
  | "open_answer_evaluation"
  | "conversation_assist"
  | "conversation_evaluation";

/** Provider/model/token accounting attached to anything an AI produced. */
export interface AIMeta {
  provider: string;
  modelId: string;
  tokensUsed: number;
}

export interface SpeakingEvaluationInput {
  /** A media_assets id for the student's recording. */
  mediaId: number;
  /** The text the student was asked to read, when there is one. */
  referenceText?: string | null;
  /** The prompt they were responding to, for open speaking. */
  prompt: string;
  targetLanguage: string;
}

export interface SpeakingEvaluationResult {
  /**
   * 0–100. Computed from the alignment between the transcript and the
   * reference text, not asked of a model: a language model's guess at a
   * pronunciation score is not reproducible, and this number gates progress.
   */
  pronunciationScore: number;
  /** 0–100, from speech rate, pausing and run length — also computed, not asked. */
  fluencyScore: number;
  transcript: string;
  /** The short Arabic sentence a model writes from the numbers above. */
  feedback: string;
  _meta: AIMeta;
}

export interface OpenAnswerEvaluationInput {
  question: string;
  studentAnswer: string;
  /** What a good answer must mention, authored with the question. */
  keyPoints?: string[];
  /** The level the answer should be judged against, e.g. "A2.1". */
  levelCode?: string | null;
  targetLanguage: string;
  learnerLanguage: string;
}

export interface OpenAnswerEvaluationResult {
  /** 0–100. */
  score: number;
  correct: boolean;
  /** Feedback in the learner's language. */
  feedback: string;
  _meta: AIMeta;
}
