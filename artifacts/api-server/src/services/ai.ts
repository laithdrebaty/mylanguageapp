/**
 * AI Service Abstraction Layer
 *
 * This module defines the interface and stub implementation for all AI-powered
 * features in Ascension. No real AI provider is wired in V1 — all methods
 * return a NotImplementedError so the application starts cleanly and callers
 * know exactly when AI is missing.
 *
 * DESIGN GOALS
 * ─────────────
 * 1. Provider-agnostic: swap OpenAI → Anthropic → local model by changing
 *    one import and the createAIProvider() factory — no route changes.
 * 2. Cost-aware: every public method accepts a UsageContext so rate limiting,
 *    per-user quotas, and cost tracking can be added without touching callers.
 * 3. Async-ready: all methods are async so they can be offloaded to a queue
 *    (see jobs.ts) without changing the calling signature.
 * 4. Failure-safe: real AI calls should NEVER block the core lesson flow.
 *    Use the results as enrichment, not as a gate.
 *
 * HOW TO ADD AN AI PROVIDER LATER
 * ─────────────────────────────────
 *   1. Install the provider SDK (e.g. `pnpm add openai`).
 *   2. Implement AIProvider by creating e.g. `services/ai-providers/openai.ts`.
 *   3. Set AI_PROVIDER=openai and AI_API_KEY=sk-... in the environment.
 *   4. Update createAIProvider() below to instantiate the right class.
 *   5. Nothing else changes.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UsageContext {
  /** Database user ID — used for per-user quota tracking */
  userId: number;
  /** The subscription plan the user is on — determines AI feature access */
  subscriptionPlan: string | null;
  /** Which feature is making the call — used for cost tracking */
  feature: AIFeature;
}

export type AIFeature =
  | "speaking_evaluation"
  | "pronunciation_evaluation"
  | "open_answer_evaluation"
  | "conversation_assist"
  | "conversation_evaluation";

export interface SpeakingEvaluationInput {
  /** Audio data as base64 or a storage URL */
  audioRef: string;
  /** The prompt/question the student was responding to */
  prompt: string;
  /** Target language (e.g. 'en') */
  targetLanguage: string;
}

export interface SpeakingEvaluationResult {
  /** Pronunciation score 0–100 */
  pronunciationScore: number;
  /** Fluency/content score 0–100 */
  contentScore: number;
  /** Transcript of what was detected */
  transcript: string;
  /** Actionable feedback in the student's language */
  feedback: string;
  /** AI cost metadata for tracking */
  _meta: { provider: string; modelId: string; tokensUsed: number };
}

export interface OpenAnswerEvaluationInput {
  question: string;
  studentAnswer: string;
  targetLanguage: string;
  learnerLanguage: string;
}

export interface OpenAnswerEvaluationResult {
  /** Score 0–100 */
  score: number;
  correct: boolean;
  feedback: string;
  _meta: { provider: string; modelId: string; tokensUsed: number };
}

// ─── Provider interface ───────────────────────────────────────────────────────

export interface AIProvider {
  readonly name: string;

  evaluateSpeaking(
    input: SpeakingEvaluationInput,
    ctx: UsageContext,
  ): Promise<SpeakingEvaluationResult>;

  evaluateOpenAnswer(
    input: OpenAnswerEvaluationInput,
    ctx: UsageContext,
  ): Promise<OpenAnswerEvaluationResult>;
}

// ─── Stub implementation ──────────────────────────────────────────────────────

/**
 * Placeholder that throws a clear error for any AI call.
 * Used until a real provider is configured.
 */
class NotImplementedAIProvider implements AIProvider {
  readonly name = "not_implemented";

  evaluateSpeaking(): Promise<SpeakingEvaluationResult> {
    return Promise.reject(
      new Error("AI speaking evaluation is not yet configured. Set AI_PROVIDER in the environment."),
    );
  }

  evaluateOpenAnswer(): Promise<OpenAnswerEvaluationResult> {
    return Promise.reject(
      new Error("AI answer evaluation is not yet configured. Set AI_PROVIDER in the environment."),
    );
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

function createAIProvider(): AIProvider {
  const provider = process.env.AI_PROVIDER;

  switch (provider) {
    case undefined:
    case "":
    case "stub":
      return new NotImplementedAIProvider();

    // When adding a real provider, add a case here:
    // case "openai":
    //   return new OpenAIProvider({ apiKey: process.env.AI_API_KEY! });

    default:
      throw new Error(`Unknown AI_PROVIDER value: "${provider}". Supported: stub, openai (coming)`);
  }
}

// Singleton — created once at startup; swap by restarting the server.
export const ai: AIProvider = createAIProvider();
