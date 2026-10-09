/**
 * Student quiz API.
 *
 * Hand-written rather than generated, following the same pattern as
 * `cms-api.ts`: the quiz endpoints are not described in `openapi.yaml`, so
 * there are no Orval hooks for them. When those endpoints are added to the
 * spec this file should be deleted in favour of the generated client.
 *
 * Uses the Vite BASE_URL so paths work when the app is served under a sub-path.
 */

const base = () => `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

/** An error that carries the server's machine-readable code and payload. */
export class QuizApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly payload: Record<string, unknown> | null;

  constructor(message: string, status: number, payload: Record<string, unknown> | null) {
    super(message);
    this.name = "QuizApiError";
    this.status = status;
    this.payload = payload;
    this.code = typeof payload?.code === "string" ? payload.code : null;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${base()}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!r.ok) {
    let payload: Record<string, unknown> | null = null;
    try {
      payload = await r.json();
    } catch {
      // Non-JSON error body — fall through to the status-only message.
    }
    const message =
      typeof payload?.error === "string" ? payload.error : `${method} ${path} → ${r.status}`;
    throw new QuizApiError(message, r.status, payload);
  }

  return r.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** A block as the student sees it: answer keys already stripped by the server. */
export interface StudentQuizBlock {
  id: number;
  type: string;
  order: number;
  title: string | null;
  titleAr: string | null;
  instructions: string | null;
  instructionsAr: string | null;
  content: string | null;
  contentAr: string | null;
  prompt: string | null;
  promptAr: string | null;
  /** The block's own media — the clip to hear, or the image to describe. */
  referenceMediaId?: number | null;
  config: {
    options?: Array<{ id: string; text: string; textAr: string | null }>;
    minWords?: number;
    mediaKey?: string | null;
    points?: number;
    explanation?: string;
    explanationAr?: string;
    correctOptionIds?: string[];
  };
}

export interface StudentQuiz {
  id: number;
  title: string;
  titleAr: string;
  description: string | null;
  descriptionAr: string | null;
  instructions: string | null;
  instructionsAr: string | null;
  timeLimitSec: number | null;
  maxAttempts: number | null;
  passingScore: number;
  contentVersion: number;
  blocks: StudentQuizBlock[];
}

export interface QuizAttempt {
  id: number;
  quizId: number;
  userId: number;
  status: string;
  score: number | null;
  passed: boolean | null;
  pendingReviewCount: number;
  startedAt: string;
  submittedAt: string | null;
  resumed?: boolean;
}

export interface PromotionOutcome {
  promoted: boolean;
  fromLevelId: number | null;
  toLevelId: number | null;
  toLevelCode: string | null;
  toLevelName: string | null;
  toLevelNameAr: string | null;
  curriculumCompleted: boolean;
}

export interface RemediationLesson {
  lessonId: number;
  title: string;
  titleAr: string;
  bestScore: number | null;
  attempts: number;
}

export interface QuizSubmitResult {
  id: number;
  status: string;
  score: number | null;
  passed: boolean | null;
  pendingReviewCount: number;
  passingScore: number;
  /** Present only for a level evaluation. */
  promotion?: PromotionOutcome;
  /** Present only when a level evaluation was failed. */
  remediation?: RemediationLesson[];
}

export interface QuizAttemptReview {
  attempt: {
    id: number;
    quizId: number;
    status: string;
    score: number | null;
    passed: boolean | null;
    pendingReviewCount: number;
    startedAt: string;
    submittedAt: string | null;
  };
  quiz: { id: number; title: string; titleAr: string; passingScore: number } | null;
  blocks: Array<
    StudentQuizBlock & {
      response: {
        response: unknown;
        mediaKey: string | null;
        score: number | null;
        gradedBy: string | null;
        feedback: string | null;
        feedbackAr: string | null;
      } | null;
    }
  >;
}

// ─── Calls ────────────────────────────────────────────────────────────────────

export const getQuiz = (quizId: number) => request<StudentQuiz>("GET", `/quizzes/${quizId}`);

export const startAttempt = (quizId: number) =>
  request<QuizAttempt>("POST", `/quizzes/${quizId}/attempts`);

/**
 * Save one answer.
 *
 * A spoken answer travels as `mediaId` rather than `response` — the words are
 * in the uploaded recording, and the server derives the storage key from the
 * asset it has already verified rather than trusting anything sent here.
 */
export const saveResponse = (
  attemptId: number,
  blockId: number,
  payload: { response?: unknown; mediaId?: number },
) =>
  request<{ id: number; blockId: number; saved: boolean }>(
    "PUT",
    `/quiz-attempts/${attemptId}/responses/${blockId}`,
    payload,
  );

export const submitAttempt = (attemptId: number) =>
  request<QuizSubmitResult>("POST", `/quiz-attempts/${attemptId}/submit`);

export const getAttempt = (attemptId: number) =>
  request<QuizAttemptReview>("GET", `/quiz-attempts/${attemptId}`);
