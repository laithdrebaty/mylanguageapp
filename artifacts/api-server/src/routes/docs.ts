import { Router, type IRouter } from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger";

/**
 * Browsable API reference (Swagger UI) over lib/api-spec/openapi.yaml.
 *
 * Mounted twice by app.ts: at /docs, and at /api/docs so it is also reachable
 * through the proxies that already forward /api (the Vite dev server, the Vercel
 * rewrite). The page therefore derives the spec URL from its own mount path
 * rather than hard-coding one.
 *
 * Swagger UI's assets are loaded from jsdelivr, pinned to an exact version and
 * checked with subresource integrity — the browser refuses a tampered file. To
 * drop the CDN entirely, add swagger-ui-dist as a dependency, externalise it in
 * build.mjs, and serve getAbsoluteFSPath() with express.static instead.
 */
const SWAGGER_UI_VERSION = "5.32.15";
const SWAGGER_UI_CSS_SRI = "sha384-fgyWYkUAamzuI8mJFu/xpRP0JWCJRwkwUwsYDoOYVHUJ8NQE5cENn8ib3ppwFFSX";
const SWAGGER_UI_JS_SRI = "sha384-m7zaGj7MPzU+G4lz2eyy73GxK9bbRDr9bB2CSdj8wodg2wu/Wnt6wsoLP3JD+RS9";
const CDN = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}`;

/**
 * Where openapi.yaml lives at runtime.
 *
 * Built output: build.mjs copies the spec next to dist/index.mjs.
 * Unbuilt (vitest, ts tooling): read it out of lib/api-spec directly.
 */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const SPEC_CANDIDATES = [
  path.join(moduleDir, "openapi.yaml"),
  path.resolve(moduleDir, "../../../../lib/api-spec/openapi.yaml"),
];

let cachedSpec: string | null = null;

function loadSpec(): string | null {
  if (cachedSpec !== null) return cachedSpec;

  for (const candidate of SPEC_CANDIDATES) {
    try {
      cachedSpec = readFileSync(candidate, "utf8");
      return cachedSpec;
    } catch {
      // Try the next candidate.
    }
  }

  logger.warn({ candidates: SPEC_CANDIDATES }, "openapi.yaml not found — /docs cannot serve the spec");
  return null;
}

/**
 * `withCredentials` matters: the API authenticates with a session cookie, so
 * without it every "Try it out" on a protected endpoint answers 401. Log in via
 * POST /auth/login on this page first, and the rest of the endpoints work.
 */
function renderPage(specUrl: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ascension / لغتي — API reference</title>
    <link
      rel="stylesheet"
      href="${CDN}/swagger-ui.css"
      integrity="${SWAGGER_UI_CSS_SRI}"
      crossorigin="anonymous"
    />
    <style>
      body { margin: 0; background: #fafafa; }
      .swagger-ui .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script
      src="${CDN}/swagger-ui-bundle.js"
      integrity="${SWAGGER_UI_JS_SRI}"
      crossorigin="anonymous"
    ></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: ${JSON.stringify(specUrl)},
        dom_id: "#swagger-ui",
        deepLinking: true,
        docExpansion: "none",
        defaultModelsExpandDepth: 1,
        tryItOutEnabled: true,
        persistAuthorization: true,
        withCredentials: true,
      });
    </script>
  </body>
</html>
`;
}

// One page per mount path; there are only ever two.
const pageCache = new Map<string, string>();

const router: IRouter = Router();

router.get("/", (req, res) => {
  // req.baseUrl is the mount path ("/docs" or "/api/docs"), so the spec is
  // always fetched from alongside the page the browser actually loaded.
  let html = pageCache.get(req.baseUrl);
  if (html === undefined) {
    html = renderPage(`${req.baseUrl}/openapi.yaml`);
    pageCache.set(req.baseUrl, html);
  }
  res.type("html").send(html);
});

router.get("/openapi.yaml", (_req, res) => {
  const spec = loadSpec();
  if (!spec) {
    res.status(503).json({ error: "API specification is unavailable" });
    return;
  }
  res.type("application/yaml").send(spec);
});

export default router;
