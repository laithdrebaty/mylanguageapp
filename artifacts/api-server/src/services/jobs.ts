/**
 * Background Jobs / Async Processing
 *
 * Provides a thin abstraction for work that should NOT block an HTTP response:
 *   - AI evaluation (speaking, pronunciation, open answers)
 *   - Audio/media processing
 *   - Push notifications
 *   - Usage/analytics aggregation
 *   - Heavy report generation
 *
 * V1: all jobs run in-process using setImmediate — fire-and-forget, no queue.
 * This is correct for the current load. Failures are logged but do not surface
 * to the student.
 *
 * TO ADD A REAL QUEUE (Bull, BullMQ, pg-boss) LATER
 * ───────────────────────────────────────────────────
 * 1. Install the queue library.
 * 2. Implement JobQueue with the library's worker/producer API.
 * 3. Replace the FireAndForgetQueue with the real implementation.
 * 4. Update createJobQueue() to choose based on JOB_QUEUE env var.
 * 5. Nothing in the rest of the codebase changes — callers use jobs.enqueue().
 *
 * IMPORTANT: jobs.enqueue() MUST NOT be awaited by HTTP handlers for
 * non-critical work. Return the HTTP response first, then enqueue.
 */

import { logger } from "../lib/logger";

// ─── Job definitions ──────────────────────────────────────────────────────────

export type JobName =
  | "evaluate_speaking"
  | "evaluate_open_answer"
  | "send_notification"
  | "aggregate_usage"
  | "process_audio";

export interface JobPayload {
  evaluate_speaking: {
    userId: number;
    lessonId: number;
    exerciseId: number;
    audioRef: string;
    prompt: string;
    targetLanguage: string;
  };
  evaluate_open_answer: {
    userId: number;
    lessonId: number;
    exerciseId: number;
    question: string;
    studentAnswer: string;
    targetLanguage: string;
    learnerLanguage: string;
  };
  send_notification: {
    userId: number;
    type: string;
    payload: Record<string, unknown>;
  };
  aggregate_usage: {
    userId: number;
    feature: string;
    count: number;
  };
  process_audio: {
    audioRef: string;
    targetFormat: string;
  };
}

// ─── Queue interface ──────────────────────────────────────────────────────────

export interface JobQueue {
  enqueue<N extends JobName>(
    name: N,
    payload: JobPayload[N],
    options?: { delayMs?: number },
  ): void; // intentionally not async — enqueue is fire-and-forget
}

// ─── In-process fire-and-forget implementation ────────────────────────────────

class FireAndForgetQueue implements JobQueue {
  enqueue<N extends JobName>(name: N, payload: JobPayload[N]): void {
    setImmediate(() => {
      // In V1 jobs are no-ops — they log so you can see what would be queued.
      // Replace this with actual handlers as features are implemented.
      logger.info({ job: name, payload }, "Job enqueued (in-process stub)");
    });
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

function createJobQueue(): JobQueue {
  const backend = process.env.JOB_QUEUE ?? "memory";

  switch (backend) {
    case "memory":
      return new FireAndForgetQueue();

    // case "bullmq":
    //   return new BullMQQueue({ redisUrl: process.env.REDIS_URL! });

    default:
      throw new Error(`Unknown JOB_QUEUE: "${backend}". Supported: memory, bullmq (coming)`);
  }
}

export const jobs: JobQueue = createJobQueue();
