/**
 * Admin AI configuration API.
 *
 * Hand-written for the same reason as `cms-api.ts`: these endpoints are not in
 * `openapi.yaml`, so there are no generated hooks for them.
 *
 * An API key travels one way only. It is sent when set or rotated and is never
 * returned — the server gives back a last-four hint and nothing else.
 */

const base = () => `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

export class AiAdminError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "AiAdminError";
    this.status = status;
    this.code = code;
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
    let payload: { error?: string; code?: string } = {};
    try {
      payload = await r.json();
    } catch {
      // Non-JSON body; status alone will have to do.
    }
    throw new AiAdminError(
      payload.error ?? `${method} ${path} → ${r.status}`,
      r.status,
      payload.code ?? null,
    );
  }

  return r.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type AITask =
  | "open_answer"
  | "placement_analysis"
  | "conversation"
  | "feedback"
  | "weakness_analysis"
  | "transcription";

export interface AiProvider {
  id: number;
  label: string;
  role: "chat" | "speech";
  baseUrl: string;
  apiKeyHint: string | null;
  hasApiKey: boolean;
  isActive: boolean;
  /** Per million tokens. Null means the price is unknown and cost is not recorded. */
  inputPricePerMtok: number | null;
  outputPricePerMtok: number | null;
  updatedAt?: string;
}

export interface AiTaskSettings {
  id: number;
  task: AITask;
  providerId: number | null;
  modelId: string | null;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
}

export interface AiPlanPolicy {
  id: number;
  planCode: string;
  task: AITask;
  dailyLimit: number;
}

export interface AiConfig {
  settings: {
    enabled: boolean;
    monthlyBudgetUsd: number | null;
    monthToDateSpendUsd: number;
    encryptionAvailable: boolean;
  };
  providers: AiProvider[];
  tasks: AiTaskSettings[];
  policies: AiPlanPolicy[];
  availableTasks: AITask[];
}

export interface ModelInfo {
  id: string;
  ownedBy: string | null;
}

export interface ConnectionTest {
  ok: boolean;
  latencyMs: number;
  modelId: string;
  reply: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface UsageRow {
  task: string;
  calls: number;
  failures: number;
  tokens: number;
  cost_usd: number;
}

// ─── Calls ────────────────────────────────────────────────────────────────────

export const getAiConfig = () => request<AiConfig>("GET", "/admin/ai/config");

export const getAiUsage = (days = 30) =>
  request<{ days: number; rows: UsageRow[] }>("GET", `/admin/ai/usage?days=${days}`);

export const updateAiSettings = (patch: {
  enabled?: boolean;
  monthlyBudgetUsd?: number | null;
}) => request<unknown>("PATCH", "/admin/ai/settings", patch);

export const createProvider = (input: {
  label: string;
  role: "chat" | "speech";
  baseUrl: string;
  apiKey?: string;
  isActive?: boolean;
}) => request<AiProvider>("POST", "/admin/ai/providers", input);

export const updateProvider = (
  id: number,
  patch: {
    label?: string;
    baseUrl?: string;
    /** Omit to keep the stored key; the panel can never read it back. */
    apiKey?: string;
    isActive?: boolean;
    inputPricePerMtok?: number | null;
    outputPricePerMtok?: number | null;
  },
) => request<AiProvider>("PATCH", `/admin/ai/providers/${id}`, patch);

export const deleteProvider = (id: number) =>
  request<{ deleted: boolean }>("DELETE", `/admin/ai/providers/${id}`);

export const listProviderModels = (id: number) =>
  request<{ models: ModelInfo[] }>("GET", `/admin/ai/providers/${id}/models`);

export const testProvider = (id: number, modelId: string) =>
  request<ConnectionTest>("POST", `/admin/ai/providers/${id}/test`, { modelId });

export const updateTask = (
  task: AITask,
  patch: Partial<Pick<AiTaskSettings, "providerId" | "modelId" | "temperature" | "maxTokens" | "enabled">>,
) => request<AiTaskSettings>("PATCH", `/admin/ai/tasks/${task}`, patch);

export const setPolicy = (planCode: string, task: AITask, dailyLimit: number) =>
  request<AiPlanPolicy>("PUT", "/admin/ai/policies", { planCode, task, dailyLimit });
