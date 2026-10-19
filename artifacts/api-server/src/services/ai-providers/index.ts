/**
 * Picks the right wire protocol for a configured provider.
 *
 * Two shapes exist in the wild and they are not interchangeable:
 *
 *   OpenAI-compatible  `Authorization: Bearer`, POST /chat/completions,
 *                      reply at choices[0].message.content
 *                      — Groq, OpenRouter, Together, local llama.cpp, …
 *   Anthropic          `x-api-key`, POST /v1/messages, system as a top-level
 *                      field, reply at content[].text
 *
 * Routing is on the base URL rather than a stored flag so an admin adding a
 * provider at /admin/ai only has to paste an endpoint and a key — there is no
 * extra dropdown to get wrong, and a provider added before this existed keeps
 * working.
 *
 * Every caller imports from here, never from a specific adapter.
 */

import type { ResolvedTaskConfig } from "../ai-config";
import * as openai from "./openai-compatible";
import * as anthropic from "./anthropic";
import * as openaiAudio from "./openai-audio";
import * as assemblyai from "./assemblyai-audio";

export {
  AIProviderError,
  type ChatMessage,
  type ChatUsage,
  type ChatResult,
} from "./openai-compatible";

/** True for Anthropic's own API. Gateways that re-expose Claude in OpenAI shape are not this. */
function isAnthropic(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.endsWith("api.anthropic.com");
  } catch {
    return false;
  }
}

/** Transport failures and 429/5xx, where the same request may well succeed. */
const MAX_ATTEMPTS = parseInt(process.env.AI_MAX_ATTEMPTS ?? "3", 10);

/**
 * Retry what the adapters already mark as retryable.
 *
 * Every adapter sets `retryable` on the errors it throws, but until now nothing
 * acted on it: a single dropped connection surfaced to the student as "the
 * tutor is unavailable". Outbound calls to a model provider cross the open
 * internet and fail intermittently — measured here at roughly one call in five
 * — so one lost packet should cost a few hundred milliseconds, not the lesson.
 *
 * Only retries what is safe to repeat: a request that never produced a reply.
 * A 400 or a bad key is returned immediately, because asking again would spend
 * the quota on the same failure.
 */
async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await run();
    } catch (err) {
      lastError = err;
      const retryable = err instanceof openai.AIProviderError && err.retryable;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      // Back off a little so a provider hiccup is not hammered.
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }

  throw lastError;
}

export function chat(
  config: ResolvedTaskConfig,
  messages: openai.ChatMessage[],
  opts: { jsonMode?: boolean } = {},
): Promise<openai.ChatResult> {
  return withRetry(() =>
    isAnthropic(config.baseUrl)
      ? anthropic.chat(config, messages, opts)
      : openai.chat(config, messages, opts),
  );
}

export function chatJson<T>(
  config: ResolvedTaskConfig,
  messages: openai.ChatMessage[],
  validate: (value: unknown) => T,
): Promise<{ value: T; usage: openai.ChatUsage; modelId: string }> {
  return withRetry(() =>
    isAnthropic(config.baseUrl)
      ? anthropic.chatJson<T>(config, messages, validate)
      : openai.chatJson<T>(config, messages, validate),
  );
}

/** True for AssemblyAI, which uses upload-then-poll rather than one multipart call. */
function isAssemblyAI(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.endsWith("assemblyai.com");
  } catch {
    return false;
  }
}

/**
 * Speech to text, routed the same way as chat: on the base URL.
 *
 * An admin adding a provider at /admin/ai pastes an endpoint and a key; which
 * wire protocol that implies is this module's problem, not theirs.
 */
export function transcribe(
  config: ResolvedTaskConfig,
  audio: Uint8Array,
  opts: {
    fileName: string;
    contentType: string;
    languageHint?: string;
    /** Separate the speakers. Only the peer-call analysis needs this, and only
     *  the AssemblyAI adapter implements it; elsewhere it is ignored. */
    diarize?: boolean;
    /** The audio has one speaker per channel. Exact attribution, so it is
     *  preferred over `diarize` when the recording was made in stereo. */
    multichannel?: boolean;
  },
): Promise<openaiAudio.TranscriptionResult> {
  return withRetry(() =>
    isAssemblyAI(config.baseUrl)
      ? assemblyai.transcribe(config, audio, opts)
      : openaiAudio.transcribe(config, audio, opts),
  );
}

export type { TranscriptionResult, TranscribedWord, TranscriptUtterance } from "./openai-audio";

/** Re-exported: callers parse defensively around both adapters. */
export { extractJsonObject } from "./openai-compatible";
