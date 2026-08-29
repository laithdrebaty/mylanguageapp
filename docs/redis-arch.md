---
name: Redis caching architecture
description: How Redis is integrated — client, cache keys, TTLs, AI quota, rate limiting, and failure behavior.
---

## Redis client (services/redis.ts)
- `ioredis` singleton, `lazyConnect: true`, `enableOfflineQueue: false`
- `retryStrategy`: exponential backoff capped at 5 s
- `maxRetriesPerRequest: 0` — fail fast on each command; reconnect happens in background
- `isRedisAvailable()` tracks connect/error/close events
- `withRedis(fn, fallback)` — fail open for cache calls
- `withRedisCritical(fn, featureName)` — throws if Redis down (AI quota, cost protection)

## Cache keys (version-prefixed for safe future busting)
```
v1:lang:list              — languages list (TTL 1h)
v1:curricula:list         — curricula list (TTL 1h)
v1:sub:plans              — subscription plan definitions (TTL 1h)
v1:levels:c:{cid}         — level metadata per curriculum (TTL 15min)
v1:lesson:{lid}:content   — lesson static content bundle (TTL 5min)
v1:vocab:lesson:{lid}     — vocabulary by lesson (TTL 15min)
v1:vocab:level:{lid}      — vocabulary by level (TTL 15min)
v1:ai:daily:{uid}:{date}  — daily AI usage counter (TTL 25h)
v1:ai:lock:{uid}          — concurrent AI request lock (TTL 60s)
rl:api:{ip}               — general API rate limit (rate-limit-redis prefix)
rl:auth:{ip}              — auth rate limit (rate-limit-redis prefix)
```

## Cache invalidation points
- `POST /admin/lessons`        → invalidate lesson content + v1:levels:c: prefix + vocab
- `PATCH /admin/lessons/:id`   → invalidate specific lesson content + v1:levels:c: prefix + lesson vocab
- When languages/curricula change: bump key version to v2: (or admin restart)

## What is NEVER cached
User progress, scores, XP, active subscription status, auth/session data, AI usage records.

## AI quota (services/ai-quota.ts)
- `checkAndIncrement(ctx)` — INCR key atomically; if Redis down, throws (fail closed)
- Daily limits: free=0, general_english=5 (AI_DAILY_LIMIT_GENERAL), professional_english=20 (AI_DAILY_LIMIT_PRO), admin=∞
- `recordUsage(record)` — INSERT to ai_usage_logs PostgreSQL table (persistent billing/audit)
- `acquireLock(userId)` — SET NX EX 60 to prevent concurrent AI requests per user

## Rate limiting
- `rate-limit-redis` RedisStore for shared counters when REDIS_URL is set
- Falls back to in-memory store when Redis absent (development only)
- `makeRedisStore(prefix)` factory in app.ts checks `redis !== null` before creating store
- ioredis sendCommand adapter: `redis.call(args[0], ...args.slice(1))`

## Failure behavior summary
- Cache miss (Redis down): → DB fallback, always works
- General rate limit (Redis down): → in-memory per-instance counter (fail open)
- AI quota (Redis down): → deny request (fail closed, withRedisCritical)

**Why:** At $2–$4/month subscriptions, allowing unlimited AI requests when Redis is down would be far more costly than showing a "service temporarily unavailable" message.
