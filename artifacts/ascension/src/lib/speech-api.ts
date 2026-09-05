/**
 * Polling for a spoken answer's verdict.
 *
 * Speech assessment runs in the background — it downloads the recording and
 * waits on a recogniser — so the submit response can only say "pending". The
 * student would otherwise record, upload, and never learn the outcome.
 *
 * Hand-written for the same reason as the other clients here: this endpoint is
 * not in `openapi.yaml`.
 */

const base = () => `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

export interface SpeechMetrics {
  speechRate?: number;
  pauseCount?: number;
  meanLengthOfRun?: number;
  fillersPer100Words?: number;
  problemWords?: string[];
  fluencyUnavailable?: boolean;
}

export interface AttemptVerdict {
  attemptId: number;
  blockId: number;
  evaluationStatus: "graded" | "pending" | "skipped";
  correct: boolean | null;
  score: number | null;
  feedback: string | null;
  feedbackAr: string | null;
  transcript: string | null;
  pronunciationScore: number | null;
  fluencyScore: number | null;
  speechMetrics: SpeechMetrics | null;
}

export async function getAttemptVerdict(
  lessonId: number,
  attemptId: number,
): Promise<AttemptVerdict> {
  const r = await fetch(`${base()}/lessons/${lessonId}/attempts/${attemptId}`, {
    credentials: "include",
  });
  if (!r.ok) throw new Error(`Attempt ${attemptId} → ${r.status}`);
  return r.json();
}

/**
 * Wait for a verdict, giving up rather than polling forever.
 *
 * Backs off as it goes: transcription usually lands in a few seconds, but a
 * queued job behind a slow provider can take longer, and hammering the API for
 * a minute helps nobody. Returns the last state seen — still `pending` is a
 * legitimate answer, and the UI says so honestly rather than pretending.
 */
export async function pollAttemptVerdict(
  lessonId: number,
  attemptId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<AttemptVerdict | null> {
  const delays = [1500, 2000, 3000, 4000, 6000, 8000];

  for (const delay of delays) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (opts.signal?.aborted) return null;

    try {
      const verdict = await getAttemptVerdict(lessonId, attemptId);
      if (verdict.evaluationStatus !== "pending") return verdict;
    } catch {
      // A failed poll is not a failed assessment. Keep trying; the last
      // attempt's result is what gets reported.
    }
  }

  try {
    return await getAttemptVerdict(lessonId, attemptId);
  } catch {
    return null;
  }
}
