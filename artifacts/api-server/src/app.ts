import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { RedisStore, type SendCommandFn } from "rate-limit-redis";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { redis } from "./services/redis";
// Side-effect import: registers the handlers the background queue dispatches to.
import "./services/job-handlers";

const app: Express = express();

// Trust the first reverse proxy (e.g. nginx / Cloudflare).
// Required for rate-limit to correctly identify client IPs from X-Forwarded-For,
// and for secure cookies to work behind HTTPS termination.
app.set("trust proxy", parseInt(process.env.TRUST_PROXY ?? "1", 10));

// ── Security headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
  }),
);

// ── Compression ────────────────────────────────────────────────────────────────
app.use(compression());

// ── Request logging ───────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(cors({ origin: allowedOrigin ?? true, credentials: true }));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// ── Sessions ───────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production");
}
if (!process.env.SESSION_SECRET) {
  logger.warn("SESSION_SECRET not set — using insecure default (development only)");
}

const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET ?? "ascension-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    },
  }),
);

// ── Rate limiting ─────────────────────────────────────────────────────────────
/**
 * Rate limit store selection:
 * - Redis available → RedisStore: limits are shared across all API server
 *   instances; correct for horizontal scaling.
 * - Redis unavailable → default in-process store: per-instance limits only;
 *   acceptable for single-server development.
 *
 * Failure behavior: fail OPEN. A Redis problem must not stop people using the
 * app — rate limiting is abuse protection, not correctness. AI quota is the
 * opposite and fails closed, because unlimited paid AI costs real money
 * (see services/ai-quota.ts).
 *
 * This does not happen by itself. The ioredis client is created with
 * `enableOfflineQueue: false`, so any command issued while it is connecting or
 * disconnected throws synchronously; rate-limit-redis passes that error on, and
 * express-rate-limit turns it into a 500. Left alone, every request during the
 * first moments after a restart — and every request during a Redis blip —
 * answers 500 rather than being allowed through. Hence `failOpen` below.
 */
function makeRedisStore(prefix: string): RedisStore | undefined {
  if (!redis) return undefined;
  return new RedisStore({
    prefix,
    // ioredis call() is the raw Redis command interface
    sendCommand: ((...args: string[]) =>
      (redis as InstanceType<typeof import("ioredis").default>).call(args[0], ...args.slice(1))) as SendCommandFn,
  });
}

/**
 * Let a request through when the rate-limit store cannot answer.
 *
 * express-rate-limit reports a store failure by calling `next(err)`. Swallowing
 * it and calling `next()` is what "fail open" actually means here — without
 * this the documented behaviour above is not the real behaviour.
 */
function failOpen(limiter: RequestHandler): RequestHandler {
  return (req, res, next) => {
    try {
      limiter(req, res, (err?: unknown) => {
        if (err) {
          logger.warn({ err }, "Rate limit store unavailable — allowing the request");
          next();
          return;
        }
        next();
      });
    } catch (err) {
      logger.warn({ err }, "Rate limit store threw — allowing the request");
      next();
    }
  };
}

// Broad limit: all API endpoints — protects against general abuse
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "900000", 10), // 15 min
  limit: parseInt(process.env.RATE_LIMIT_API ?? "200", 10),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeRedisStore("rl:api:"),
  message: { error: "Too many requests, please try again later" },
});

// Strict limit: auth endpoints — brute-force protection
const authLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "900000", 10),
  limit: parseInt(process.env.RATE_LIMIT_AUTH ?? "10", 10),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeRedisStore("rl:auth:"),
  skipSuccessfulRequests: true,
  message: { error: "Too many authentication attempts, please try again later" },
});

app.use("/api", failOpen(apiLimiter));
app.use("/api/auth/login", failOpen(authLimiter));
app.use("/api/auth/register", failOpen(authLimiter));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Global error handler ──────────────────────────────────────────────────────
// Express 5 forwards async errors automatically. This normalises them into
// a consistent { error: string } response with proper status codes.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction): void => {
  const status =
    typeof (err as { status?: number }).status === "number"
      ? (err as { status: number }).status
      : 500;

  const message =
    process.env.NODE_ENV !== "production" && err instanceof Error
      ? err.message
      : "An unexpected error occurred";

  logger.error({ err, url: req.url, method: req.method }, "Unhandled error");

  if (!res.headersSent) {
    res.status(status).json({ error: message });
  }
});

export default app;
