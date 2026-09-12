# API reference (Swagger UI)

For client developers — mobile especially — who need to see what the API offers
without reading the Express routes.

## Where it is

The API server serves a browsable Swagger UI over
[`lib/api-spec/openapi.yaml`](../lib/api-spec/openapi.yaml):

| URL | Notes |
| --- | --- |
| `http://localhost:8080/docs` | Local API server (`docker compose up`). The canonical URL. |
| `http://localhost:5173/api/docs` | Same page through the Vite dev server proxy. |
| `https://<api-host>/docs` | A deployed API server, once docs are enabled there. |
| `<any of the above>/openapi.yaml` | The raw spec, for code generators. |

`/api/docs` exists because the web app's origin only forwards `/api` — the Vite
dev proxy in development, the `rewrites` entry in `vercel.json` in production.
Hitting `/docs` on the **frontend** domain returns the React app, not the docs.

## Turning it on

Controlled by `API_DOCS_ENABLED`:

- **unset or empty** — on when `NODE_ENV` is not `production`, off when it is.
- **`true`** — on. Set this on the staging API so client developers can reach it.
- **anything else** — off.

## Authentication: session cookie, not a token

There is no bearer token. `POST /auth/login` and `POST /auth/register` set a
`connect.sid` session cookie; the session itself lives in Postgres. Every
endpoint requires that cookie unless the spec marks it `security: []`.

Consequences for a native client:

- **Persist cookies across requests.** Use a cookie jar — `CookieJar` /
  `okhttp3.JavaNetCookieJar` on Android, `URLSession`'s default
  `HTTPCookieStorage` on iOS, `cookie_jar` with Dio on Flutter. A client that
  drops `Set-Cookie` will get `401 {"error":"Authentication required"}` on
  everything after login.
- **In production the cookie is `Secure` and `SameSite=None`**, so the API must
  be reached over HTTPS.
- The session lasts 30 days (`maxAge` in
  [`app.ts`](../artifacts/api-server/src/app.ts)) and is renewed by use.
- Set `ALLOWED_ORIGIN` on the API for the web app only; a native app sends no
  `Origin`, so CORS does not apply to it.

Swagger UI is configured with `withCredentials: true`, so "Try it out" works the
same way: call `POST /auth/login` on the page first, and the protected endpoints
then answer normally.

## Roles

Beyond `student` (the default), the API has `content_manager`,
`content_reviewer`, and `admin`. `/admin/*` needs `admin`; `/cms/*` needs one of
the content roles. A mobile client is expected to only need student endpoints.

## Generating a client

The spec is OpenAPI 3.1. Point any generator at the served spec:

```bash
npx @openapitools/openapi-generator-cli generate -i http://localhost:8080/docs/openapi.yaml -g kotlin -o ./client-kotlin
```

Note that `servers:` in the spec is the relative path `/api`, so set the base
URL in the generated client to `https://<api-host>/api`.

## What the spec covers

The spec is written by hand, not derived from the routes. It documents
**60 of the 121 paths the server implements (65 operations)**, and that 60
covers **every student-facing endpoint** — a mobile client needs nothing that
is missing from it.

Verified both ways: every documented path and method exists on the server, and
no undocumented path outside `/cms/*` and `/admin/*` remains.

By area:

| Tag | Operations | Covers |
| --- | --- | --- |
| `auth`, `profile` | 6 | Register, login, logout, current user, student profile |
| `placement` | 2 | Placement test and submission |
| `levels`, `progression` | 4 | Curriculum levels, evaluation gates, promotion history |
| `lessons` | 7 | Lessons, blocks, activity submission, completion, progress, attempt polling |
| `exercises` | 1 | Exercise submission |
| `quizzes` | 6 | Quiz listing and detail, attempts, per-block answers, submission, review |
| `media` | 4 | The three-step recording upload handshake, plus playback URLs |
| `conversation` | 4 | AI conversation tutor sessions and turns |
| `practice` | 15 | Student-to-student voice practice: matching, WebRTC signalling, blocking, reporting |
| `review` | 3 | Recent lessons, weak areas, skill profile |
| `vocabulary`, `subscriptions`, `dashboard`, `languages`, `health` | 8 | Supporting reads |
| `admin` | 5 | A handful of admin reads and lesson writes |

**Deliberately not documented:** the rest of `/cms/*` (the authoring
back-office), `/admin/ai/*`, and the remaining `/admin/students/*` endpoints —
61 paths in total, none of which a mobile client has any use for. The routes
under [`artifacts/api-server/src/routes/`](../artifacts/api-server/src/routes)
remain the only description of those.

### Three flows worth reading before you start

**Recording audio** is a three-call handshake, not an upload. `POST
/media/uploads` returns a presigned PUT and a `mediaId`; the bytes go from the
device straight to object storage, never through the API; then `POST
/media/uploads/{mediaId}/complete` has the server confirm they landed. Only a
completed (`status: "ready"`) `mediaId` may be attached to a lesson activity, a
quiz response, or a spoken conversation turn. Check `GET /media/config` first —
a deployment without storage configured says `enabled: false`.

**Anything spoken or written-and-AI-graded is asynchronous.** Submitting a
lesson activity or a quiz attempt returns immediately with
`evaluationStatus: "pending"` or a `pendingReviewCount` above zero, and a quiz
attempt withholds `passed` (null) until every block has a verdict. Poll
`GET /lessons/{lessonId}/attempts/{attemptId}` or
`GET /quiz-attempts/{attemptId}` until that clears.

**Voice practice** is peer-to-peer WebRTC; the audio never reaches the server.
The client opts in via `PUT /practice/profile`, joins with
`POST /practice/queue`, then polls `POST /practice/poll` — a POST because it
deliberately changes state, refreshing presence and closing overdue calls, and a
client that stops polling drops out of matching by itself. Signalling goes
through `POST`/`GET /practice/sessions/{sessionId}/signal(s)`, where the signal
`id` is a cursor you pass back as `after`. Read `GET /practice/ice-servers` for
the `RTCPeerConnection` configuration: when `hasTurn` is false it is STUN only
and roughly one connection in five will not establish, so say so rather than
sitting on "connecting…".

## Changing the spec

`openapi.yaml` is the source of truth for the frontend's generated client, so
editing it has consequences beyond the docs page:

```bash
pnpm --filter @workspace/api-spec run codegen
```

regenerates `lib/api-client-react`. Follow
[openapi-codegen-rules.md](openapi-codegen-rules.md) — Orval 8.23 emits Zod v4
syntax for `type: integer` and `format: email`, which breaks this workspace's
Zod v3 consumers.
