/**
 * Cache Service Abstraction
 *
 * Wraps the cache backend behind a simple get/set/del interface so the
 * rest of the codebase is not coupled to any specific cache implementation.
 *
 * V1 uses an in-process LRU-style Map with TTL. This is sufficient for a
 * single-server deployment and avoids adding an external dependency before
 * it is needed.
 *
 * TO ADD REDIS LATER
 * ───────────────────
 * 1. `pnpm --filter @workspace/api-server add ioredis`
 * 2. Implement CacheProvider with a RedisCache class.
 * 3. Set CACHE_PROVIDER=redis and REDIS_URL=redis://... in the environment.
 * 4. Update createCacheProvider() to instantiate RedisCache.
 * 5. Nothing else in the codebase changes.
 *
 * WHAT SHOULD BE CACHED
 * ──────────────────────
 * - Curriculum metadata (long TTL, rarely changes)
 * - Level metadata (long TTL, rarely changes)
 * - Lesson content (medium TTL, changes only when admin publishes)
 * - Vocabulary lists (long TTL)
 * - Subscription plan definitions (long TTL)
 *
 * WHAT MUST NOT BE CACHED HERE
 * ──────────────────────────────
 * - Per-user progress, scores, XP (always read from DB for consistency)
 * - Session data (managed by connect-pg-simple)
 * - Active subscription status (must be fresh to enforce access control)
 */

// ─── Provider interface ───────────────────────────────────────────────────────

export interface CacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Flush all keys with a given prefix — useful for invalidating a lesson */
  delByPrefix(prefix: string): Promise<void>;
}

// ─── In-process implementation ────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class InProcessCache implements CacheProvider {
  private store = new Map<string, CacheEntry<unknown>>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async delByPrefix(prefix: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

function createCacheProvider(): CacheProvider {
  const provider = process.env.CACHE_PROVIDER ?? "memory";

  switch (provider) {
    case "memory":
      return new InProcessCache();

    // case "redis":
    //   return new RedisCache({ url: process.env.REDIS_URL! });

    default:
      throw new Error(`Unknown CACHE_PROVIDER: "${provider}". Supported: memory, redis (coming)`);
  }
}

export const cache: CacheProvider = createCacheProvider();

// ─── Cache key helpers ────────────────────────────────────────────────────────
// Centralising keys here prevents typos and makes invalidation auditable.

export const CacheKeys = {
  curriculumList: () => "curricula:list",
  levelList: (curriculumId: number) => `levels:curriculum:${curriculumId}`,
  lessonContent: (lessonId: number) => `lesson:content:${lessonId}`,
  subscriptionPlans: () => "subscription:plans:list",
  vocabularyByLesson: (lessonId: number) => `vocabulary:lesson:${lessonId}`,
} as const;

// ─── TTL constants (seconds) ──────────────────────────────────────────────────
export const CacheTTL = {
  /** 1 hour — curriculum/level definitions change rarely */
  CURRICULUM_META: 3600,
  /** 5 minutes — lesson content can be updated by admins */
  LESSON_CONTENT: 300,
  /** 24 hours — subscription plan definitions are very stable */
  SUBSCRIPTION_PLANS: 86400,
} as const;
