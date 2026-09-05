# Feature: Runtime AI configuration

The admin panel at `/admin/ai` where the provider, the API key, the model for each task, and each plan's daily allowance are set — at runtime, with no redeploy.

## Why it exists

Two of these change more often than the code does, and one of them is not decided yet:

- **The provider and model** will change. NVIDIA NIM today, DeepSeek or Groq tomorrow, a different model when a cheaper one appears. An env var means a redeploy to change a model id.
- **The commercial split is undecided.** Pricing a new tier must be a row in a table, not an edit to a JavaScript object followed by a deploy.

So none of it is compiled in. The one thing that *is* an environment variable is `AI_CONFIG_SECRET`, which encrypts the stored keys.

## How it works

**One client for every provider.** NVIDIA NIM, DeepSeek, Groq, Together, vLLM and Ollama all speak the OpenAI chat-completions shape, so `services/ai-providers/openai-compatible.ts` handles all of them. There is deliberately no vendor branching in it — the moment that file asks "which vendor is this", the abstraction has failed.

**Four layers of configuration**, each a table:

| Table | Holds |
|---|---|
| `ai_settings` | Master kill switch, monthly USD ceiling. One row. |
| `ai_providers` | Endpoint, encrypted key, `chat` or `speech` role. One active per role. |
| `ai_task_settings` | Per-task provider, model, temperature, max tokens, enabled. |
| `ai_plan_policies` | Daily limit per plan per task. Replaces the hardcoded `DAILY_LIMITS`. |

**Six tasks**, because grading a one-line answer and running a ten-minute conversation do not want the same model or temperature: `open_answer`, `placement_analysis`, `conversation`, `feedback`, `weakness_analysis`, `transcription`.

**Keys go in and never come out.** Stored with AES-256-GCM, decrypted only to make a request. No endpoint returns one; the panel shows the last four characters so two keys can be told apart. Saving a provider without an `apiKey` field keeps the stored key — the panel cannot send back something it was never given, so absence must not clear it.

**It fails loudly at configuration time, not at use time.** A task cannot be enabled without a provider and a model. AI cannot be switched on when `AI_CONFIG_SECRET` is missing. Deleting a provider stands down every task that pointed at it, in the same transaction — otherwise the foreign key nulls `provider_id` and leaves the task marked enabled, which reads as configured but fails on every call.

**Model lists are fetched, not typed.** `GET /admin/ai/providers/:id/models` calls the provider's `/v1/models`, so an administrator picks from a dropdown instead of typing an id from memory. `POST .../test` makes one 16-token real call and reports latency, tokens and the reply.

**Config is read per call, not cached.** An admin who turns AI off expects it off now, not after a cache expiry. These are two indexed reads on a path about to spend hundreds of milliseconds on a network call to an LLM.

**Quotas are per plan *and* per task**, keyed `v1:ai:daily:{userId}:{task}:{date}` in Redis, so a student who spends their conversation allowance can still have a written answer graded. A plan/task pair with no policy row is **denied** — defaulting to allowed would make every task added later silently free for everyone.

## Where the code lives

- `artifacts/api-server/src/services/ai-config.ts` — encryption, resolution, limits, budget
- `artifacts/api-server/src/services/ai-providers/openai-compatible.ts` — the client
- `artifacts/api-server/src/routes/admin-ai.ts` — the endpoints
- `artifacts/ascension/src/pages/admin/ai-settings.tsx` — the panel
- `artifacts/api-server/migrations/006_ai_runtime_config.sql`
- Tests: `ai-config.test.ts` (14, encryption), `openai-compatible.test.ts` (14, JSON extraction)

## Setting it up

1. Set `AI_CONFIG_SECRET` on the API server (`openssl rand -hex 32`). Without it, the panel refuses to store a key rather than writing one in plaintext.
2. Open `/admin/ai` as an admin. Add a provider — for NVIDIA, base URL `https://integrate.api.nvidia.com/v1` and your `nvapi-…` key. Mark it active.
3. On a task, pick the provider, press the refresh button to fetch the model list, choose a model, **Test**, then enable.
4. Set the daily limits per plan, and a monthly ceiling if you want a hard stop.
5. Turn on the master switch.

Nothing spends money until step 5: providers, models and tasks all start disabled.

## Gaps to be aware of

1. ~~Not every task is implemented.~~ **All six now are:** `open_answer`, `transcription`, `feedback`, `weakness_analysis`, `conversation` and `placement_analysis`.
2. ~~Cost is not recorded.~~ **Resolved.** Providers carry input/output prices per million tokens and calls record a computed `cost_usd`, so the monthly ceiling works. A provider with no prices records a null cost and is marked "no prices" in the panel.
3. **Redis is required for any AI feature.** The quota counter fails closed, so a deployment without Redis grades nothing. It is now in `docker-compose.yml`.
4. ~~The speech role has no client.~~ **Resolved.** `services/ai-providers/openai-audio.ts` implements the `/audio/transcriptions` shape (Groq Whisper, OpenAI). NVIDIA Riva ASR does not speak it and would need its own client. Transcription is billed per audio minute, and there is no price field for that — so speech usage does not contribute to the monthly budget.
5. **No audit trail of configuration changes.** Changes are written to the application log with the acting admin's id, but not to `cms_audit_logs`, so there is no queryable history of who changed a limit.
6. **`ai-admin-api.ts` is hand-written.** These endpoints are not in `openapi.yaml`, so there are no generated hooks — same situation as `cms-api.ts` and `quiz-api.ts`.
