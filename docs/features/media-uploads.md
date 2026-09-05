# Feature: Media storage and recording upload

Spec section 4A (reading + pronunciation) and 4D/11 (speaking), which all depend on a student's voice actually reaching the server.

## What it does

The browser records audio, uploads it straight to object storage, and the server attaches the verified recording to the student's lesson attempt or quiz response. Curriculum staff use the same path for reference audio.

Before this, `lesson.tsx` recorded audio with `MediaRecorder`, kept the duration, and **threw the blob away** — there was no upload endpoint anywhere and `media_assets` was a metadata registry for files uploaded out of band. Speaking activities recorded into the void.

## How it works

**Bytes never pass through the API.** A 2MB recording from every student would otherwise sit on the Node event loop for no benefit. Instead:

1. `POST /media/uploads` — the server picks the key, records a `pending` row, and returns a presigned PUT.
2. The browser PUTs the blob directly at the bucket.
3. `POST /media/uploads/:id/complete` — the server HEADs the object and only then marks it `ready`.

Step 3 is the point of the whole design. Without it, a client could claim any key it liked and attach it to an attempt; with it, "this recording exists and is this size and type" is something the server measured rather than something the client asserted. Only a `ready` asset can be attached to an attempt.

**The client never chooses the key.** `recordings/{userId}/{yyyy-mm}/{uuid}.{ext}`, built server-side. A client-supplied key is a path-traversal and overwrite primitive; putting the owner id in the path also means ownership can be re-derived from the key alone.

**Content type is bound into the signature.** `getSignedUrl` signs only `host` by default, which makes the declared content type decoration — the holder of a URL could PUT HTML at a key named `.webm` and have the bucket serve it back as HTML. Passing `signableHeaders: new Set(["content-type"])` makes the bucket reject a mismatched PUT, and `completeUpload` re-checks the stored type as a second lock that does not depend on the provider honouring signed headers.

**Access control.** Curriculum material (`owner_user_id IS NULL`) is playable by anyone signed in — it is teaching content. A student's recording is playable by that student and by staff, who need it to grade speaking. Missing, unfinished and not-yours all answer 404 alike, so iterating ids reveals nothing.

**Provider-agnostic.** Everything speaks the S3 API: MinIO locally (`docker compose up` now brings up a bucket), Cloudflare R2 or DigitalOcean Spaces in production. Switching is an endpoint and a key pair. Unconfigured, storage degrades to a `disabled` provider that returns 503 on upload rather than stopping the server from booting — the same shape `services/ai.ts` uses.

`STORAGE_PUBLIC_ENDPOINT` exists because a containerised API reaches MinIO at `http://storage:9000` while the browser can only reach `http://localhost:9000`. Rewriting the host of a finished presigned URL does not work — SigV4 signs `Host` — so URLs are signed against the public endpoint by a second client. In production both endpoints are the same and only one client is created.

**A grading bug this exposed.** `gradeResponse` scored any response with no text as zero, "No answer submitted". A spoken answer carries no text — the words are in the audio — so a completed speaking task would have been marked wrong. It now takes a `hasMedia` flag and leaves such a block pending assessment.

## Where the code lives

- `artifacts/api-server/src/services/storage.ts` — S3 provider, key construction, limits
- `artifacts/api-server/src/services/media.ts` — the handshake, the daily cap, `canReadAsset`
- `artifacts/api-server/src/routes/media.ts` — the endpoints
- `artifacts/ascension/src/lib/media-api.ts` — the three-step client
- `artifacts/ascension/src/hooks/use-mic-recorder.ts` — shared by the lesson and quiz runners
- `artifacts/api-server/migrations/005_media_uploads.sql`
- Tests: `storage.test.ts` (26), `quiz-grading.test.ts` (17)

## Limits

| | Student recording | Curriculum media |
|---|---|---|
| Types | webm, ogg, mp4, mpeg, wav | + jpeg, png, webp, mp4, webm video |
| Size | 15MB | 100MB |
| Duration | 10 min | — |
| Rate | 200 per rolling 24h (`MEDIA_DAILY_UPLOAD_LIMIT`) | — |

The daily cap is counted in Postgres, not Redis. The AI quota fails closed when Redis is down because free AI costs real money; a recording costs a fraction of a cent, so blocking a lesson over a cache outage would be the more expensive failure.

## Gaps to be aware of

1. ~~Nothing transcribes or scores the audio.~~ **Resolved.** Recordings are transcribed, aligned against the passage and scored — see [pronunciation.md](pronunciation.md).
2. **No staff UI for reviewing recordings.** Staff *can* fetch any student's recording URL, but no CMS screen lists pending speaking work.
3. ~~No CMS upload screen.~~ **Resolved.** The media page uploads real files and previews audio. Attaching one to a *block* still has no picker — see [cms-authoring.md](cms-authoring.md).
4. **`content_blocks.reference_media_id` is settable through the API but has no UI picker.** The student payload carries it and the client can resolve it via `/media/:id/url`; the block editor has no way to choose an asset yet.
5. **Abandoned `pending` rows are never swept.** A student who starts a recording and closes the tab leaves a row (and possibly an object). There is an index for finding them (`media_assets_pending_idx`); no job uses it.
6. **The client does not check `/media/config` before offering to record.** If storage is unconfigured the student records, then sees an error. The endpoint exists for exactly this check; the UI does not call it yet.
7. **CORS on the bucket must be configured in production.** MinIO is permissive by default; R2 and Spaces need the app origin allowed for `PUT`, or every upload fails preflight in the browser.
