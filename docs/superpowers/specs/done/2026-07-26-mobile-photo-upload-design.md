# Mobile photo upload: signed link + upload page

**Status:** Done — merged PR #27 (dff50fd, 2026-07-27); `mcp-server/src/uploadLink.ts` and `getPhotoUploadLink.ts` exist on `main`

## Problem

`attach_photo` (`mcp-server/src/tools/attachPhoto.ts`) only accepts a
`photoUrl` — it fetches an already-hosted image and re-uploads it to R2. On
mobile, attaching a photo directly in the Claude chat doesn't work: Claude
perceives an attached image through a vision encoder, not as text, so it has
no way to type out the image's raw bytes as a tool argument. This is a
fundamental constraint of how multimodal tool-calling works, not a gap left
by PR #25 (Vercel Blob → R2 migration) — no MCP input-schema change fixes it.

MCP itself has no released mechanism for this either: SEP-2356 ("file input
support for tools") was closed unmerged in favor of SEP-2631 ("File Objects
and Transfer"), which remains in draft with no client (Claude.ai/Desktop)
implementation, and the MCP 2026-07-28 release candidate does not include
it. So this must be solved outside the MCP protocol.

## Design

### Flow

1. Author asks Claude to add photos to a draft while on mobile.
2. Claude calls a new tool, `get_photo_upload_link`, with the `draftId`.
3. The tool confirms the draft exists (same check as `attach_photo`) and
   returns a signed URL, valid for 1 hour, scoped to that one draft.
4. Claude shares the link in chat; the author taps it, which opens a small
   mobile-friendly page in the phone's browser.
5. The author picks one or more photos from their camera roll (native
   multi-select file picker). The page uploads them to the server
   **sequentially** (not in parallel — see "Why sequential" below), showing
   per-photo progress and per-photo failure without aborting the batch.
6. Each successfully uploaded photo is stored in R2 and appended to the
   draft's `photos` array server-side — no copy/paste of a URL back into
   chat, and no caption field on the page (per the brainstorming decision;
   see "Out of scope").

### Why sequential, not parallel

Each upload does a read-modify-write commit to the draft's file on its
`draft/post-<id>` branch (`writeDraft` in `src/drafts.ts`). Two concurrent
writes could both read the same pre-upload state and each commit a version
missing the other's photo. Uploading one at a time, awaiting each response
before starting the next, avoids this without needing server-side locking.

### Components

**`src/uploadLink.ts`** (new)

```
signUploadLink(draftId: string, ttlMs = 3_600_000): { token: string; expiresAt: number }
verifyUploadLink(draftId: string, expiresAt: number, token: string): boolean
```

`token` is `HMAC-SHA256(UPLOAD_LINK_SECRET, `${draftId}.${expiresAt}`)` as a
hex digest. `verifyUploadLink` recomputes the digest, compares it with
`crypto.timingSafeEqual`, and checks `expiresAt > Date.now()`. The link
itself carries no GitHub credential — it's purely an unforgeable "this
bearer may upload to draft X before time Y" grant, so a link sitting in
chat history past its expiry (or even before) can't be replayed to write to
GitHub directly.

**`get_photo_upload_link` tool** (new, `src/tools/getPhotoUploadLink.ts`)

Input: `{ draftId: string }`. Reads the draft (throws if missing or not a
post draft, matching `attach_photo`'s existing check), calls
`signUploadLink(draftId)`, and returns text content containing:
`${MCP_SERVER_URL}/upload/${draftId}?exp=${expiresAt}&token=${token}`, plus
a note that it expires in an hour.

**`src/blob.ts` refactor**

Extract the shared body of `fetchAndStorePhoto` into:

```
storeImageBuffer(buffer: Buffer, contentType: string): Promise<string>
```

This keeps the existing content-type check (`image/*`), size cap
(`MAX_PHOTO_BYTES`), R2 `PutObjectCommand` upload, and public-URL
construction as a single implementation. `fetchAndStorePhoto` becomes: fetch
the URL, extract `contentType` and bytes, call `storeImageBuffer`. The new
upload route calls it directly with the raw bytes it received.

**New Express routes** (`src/server.ts`, alongside the existing `/health`
and `/callback` plain routes)

- `GET /upload/:draftId` — parses `exp`/`token` query params, calls
  `verifyUploadLink`. Invalid or expired → 403 with a short plain-text page
  ("This link has expired — ask Claude for a new one"). Valid → serves a
  small self-contained HTML page (inline CSS/JS, no external assets):
  `<input type="file" accept="image/*" multiple>` plus a submit control.
  Client-side JS uploads each selected file sequentially via `POST
  /upload/:draftId/photo?exp=...&token=...` with the raw bytes as the body
  and `Content-Type` set to the file's MIME type, rendering a per-file
  status list ("2 of 5 uploaded", failures marked inline) as it goes.
- `POST /upload/:draftId/photo` — re-verifies the token (same check, so a
  leaked/guessed POST URL without a valid token is rejected identically to
  the GET). Reads the raw body via `express.raw({ type: () => true, limit:
  '26mb' })` scoped to this route only, so the global `express.json()`
  used by `/mcp` is unaffected. Validates the `Content-Type` header starts
  with `image/`, calls `storeImageBuffer`, then reads and writes the draft
  (`readDraft`/`writeDraft` from `src/drafts.ts`) to append `{ url }` to
  `photos`, committing as `Attach mobile-uploaded photo to draft <id>`.
  Responds with JSON `{ ok: true, url }` on success or `{ ok: false, error
  }` (with an appropriate 4xx) on a per-file failure — the page keeps this
  file marked failed and continues with the rest of the batch.

### Auth for the upload route

The GitHub writes in `POST /upload/:draftId/photo` need their own GitHub
credential, since by the time the author opens the link on their phone, the
original MCP request/OAuth session is long over (the server is stateless
per-request — see `src/server.ts`'s comment on why sessions aren't tracked
in memory). A new required env var, `AUTHOR_GITHUB_TOKEN` (a fine-grained
GitHub PAT scoped to Contents read/write on this one repo), is used only by
this route — the existing per-session OAuth token flow used by MCP tool
calls is unchanged.

### New env vars (documented in `docs/AUTHORING-SETUP.md`)

- `UPLOAD_LINK_SECRET` — random secret used to sign/verify upload links.
- `AUTHOR_GITHUB_TOKEN` — fine-grained PAT (Contents read/write on this
  repo) used by the upload route to commit photos to a draft branch.

### Testing

- `tests/uploadLink.test.ts` — sign/verify round trip; tampered token
  rejected; expired timestamp rejected; token signed for one draftId
  rejected against another.
- `tests/blob.test.ts` — updated for the extracted `storeImageBuffer`
  (content-type/size checks, R2 upload), with `fetchAndStorePhoto` kept
  covered as a thin wrapper.
- `tests/tools/getPhotoUploadLink.test.ts` — mirrors the existing
  `tests/tools/attachPhoto.test.ts` pattern: draft-not-found rejected,
  returned text contains a well-formed URL with `exp`/`token` params.
- `tests/server/upload.test.ts` (new, using the existing `supertest`
  dev dependency) — `GET /upload/:draftId` with valid/expired/tampered
  token; `POST /upload/:draftId/photo` with a valid image (asserts R2
  upload call and draft append), a non-image `Content-Type` (rejected), an
  oversize body (rejected), and an expired/tampered token (rejected without
  touching R2 or the draft).

## Out of scope

- Captions on the mobile upload page (decided during brainstorming — add
  them afterward via chat if wanted).
- Any change to the existing `attach_photo` tool or its iCloud-link
  workflow — this adds a second path, it doesn't replace the first.
- Revisiting this once MCP file-input support (SEP-2631 or successor)
  ships in both the spec and Claude.ai/Desktop — worth revisiting then, but
  no committed timeline exists today.
