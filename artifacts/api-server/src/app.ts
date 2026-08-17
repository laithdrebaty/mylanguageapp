import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

const app: Express = express();

// Trust the first reverse proxy (Replit's nginx / Cloudflare).
// Required for express-rate-limit to correctly identify client IPs from
// X-Forwarded-For, and for secure cookies to work behind HTTPS termination.
// Set to the number of proxy hops in your deployment (1 for Replit).
app.set("trust proxy", parseInt(process.env.TRUST_PROXY ?? "1", 10));

// ── Security headers ──────────────────────────────────────────────────────────
// helmet sets a safe suite of HTTP response headers (CSP, HSTS, X-Frame, etc.)
app.use(
  helmet({
    // Allow cross-origin requests from the frontend in development/preview;
    // in production tighten crossOriginResourcePolicy to "same-origin"
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // CSP is disabled here so the React SPA can load inline scripts;
    // add a policy when the frontend is stable
    contentSecurityPolicy: false,
  }),
);

// ── Compression ────────────────────────────────────────────────────────────────
// gzip/deflate all JSON and text responses — critical for users on slow connections
app.use(compression());

// ── Request logging ───────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// ── CORS ──────────────────────────────────────────────────────────────────────
// In production, lock down to the known frontend origin via ALLOWED_ORIGIN env var.
// In development, allow all origins so Vite dev server and Replit preview work.
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(
  cors({
    origin: allowedOrigin ?? true,
    credentials: true,
  }),
);

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
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    },
  }),
);

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Broad limit on all API endpoints — protects against general abuse
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 200,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

// Strict limit on auth endpoints — brute-force protection
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many authentication attempts, please try again later" },
  skipSuccessfulRequests: true, // only count failed attempts
});

app.use("/api", apiLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Global error handler ──────────────────────────────────────────────────────
// Express 5 forwards async errors automatically; this normalises them into a
// consistent { error: string } response regardless of where they originate.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction): void => {
  const status = typeof (err as { status?: number }).status === "number"
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
