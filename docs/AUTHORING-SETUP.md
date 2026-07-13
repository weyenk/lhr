# Authoring MCP Server Setup

Manual, one-time setup for the authoring MCP server (outside this repo's automated tasks).

## How auth works

Claude.ai (the downstream OAuth client) and GitHub (the upstream identity provider) can't be bridged with a transparent proxy: GitHub OAuth Apps have exactly one registered callback URL and require their own fixed Client ID/Secret at the token endpoint, but claude.ai registers itself dynamically with its own client_id and redirect_uri. So `mcp-server/src/auth/githubOAuth.ts` runs a real two-legged flow:

1. **Downstream leg** — the server is claude.ai's actual OAuth authorization server. It mints its own authorization codes and opaque access tokens against a fixed callback URL (`/callback`) that never changes.
2. **Upstream leg** — separately, server-to-server, the server exchanges a GitHub authorization code for a GitHub access token using the GitHub OAuth App's real Client ID/Secret, verifies the resulting user is the allowlisted author, and stores the GitHub token keyed by its own opaque token so tools can call the GitHub API with it.

## Setup steps

1. **Register a GitHub OAuth App** (GitHub → Settings → Developer settings → OAuth Apps → New OAuth App) for the MCP server. Set its callback URL to `https://<your-mcp-server-domain>/callback`. Note the generated **Client ID** and **Client Secret** — both are required (see "How auth works" above).
2. **Create a new Vercel project** for `mcp-server/` (import this repo, set the project's root directory to `mcp-server/`).
3. **Provision Vercel Blob** for the project (if not already shared with the main site project) and note its read/write token. `mcp-server/src/auth/clientStore.ts` and `mcp-server/src/auth/oauthStore.ts` store OAuth client registrations, in-flight authorization sessions, and issued tokens as JSON blobs in this same store, so no separate database is needed.
4. **Set project environment variables** on the new Vercel project:
   - `AUTHOR_GITHUB_USERNAME` — the author's GitHub username (the single allowlisted author).
   - `MCP_SERVER_URL` — the deployed project's URL (e.g. `https://lhr-authoring.vercel.app`). Also used to build the fixed `/callback` URL from step 1.
   - `GITHUB_CLIENT_ID` — the GitHub OAuth App's Client ID from step 1.
   - `GITHUB_CLIENT_SECRET` — the GitHub OAuth App's Client Secret from step 1.
   - `BLOB_READ_WRITE_TOKEN` — from step 3.
5. **Deploy** the `mcp-server/` project.
6. In the **Claude.ai app**, add a **custom MCP connector** pointing at the deployed project's `/mcp` URL, and complete the GitHub OAuth login when prompted — logging in as the same GitHub account named in `AUTHOR_GITHUB_USERNAME`. A login from any other GitHub account will be rejected by the server's allowlist check.
7. Create a **Claude.ai Project**, attach the connector, and paste in the scripted authoring-flow instructions (pick post type → title → content → photos → kitchenware → affiliate links → preview → confirm).

**Note on step 3's Blob-backed stores:** they write with `access: 'public'` (Vercel Blob's only read-via-URL access mode), at paths derived from an internal id (`oauth-clients/<client_id>.json`, `oauth-pending/<session_id>.json`, `oauth-codes/<code>.json`, `oauth-tokens/<token>.json`) with `addRandomSuffix: false` so records can be found again deterministically. This means anyone who can guess or obtain one of these ids can fetch its stored contents — for `oauth-tokens/`, that's a live GitHub access token. IDs are `crypto.randomUUID()` values (not guessable), and issued access tokens expire after 8 hours with no refresh support, but treat this as a low-security-margin pattern worth revisiting before storing anything more sensitive here.

**Resolved — step 2's project root and the shared schemas:** the first real deploy confirmed the risk flagged here previously: `confirmAndPublish.ts`'s original `../../../src/content/schemas` import (reaching outside `mcp-server/`) broke the build, not just the runtime bundle. It widened TypeScript's inferred `rootDir` to the repo root, which shifted the compiled output down an extra directory level and made Vercel's entrypoint search (`app.js`/`index.js`/`server.js`/`src/...`) come up empty. The fix: the schemas now live in `packages/schemas` (an `@lhr/schemas` npm workspace package), depended on normally by both the site and `mcp-server/`; `src/content/schemas.ts` is now a one-line re-export so the site's own imports were untouched. `mcp-server/package.json`'s `build` script builds `@lhr/schemas` first.

**Update — explicit bundling replaces relying on Vercel's entrypoint search:** rather than continuing to depend on Vercel auto-discovering a compiled entrypoint under `dist/`, `mcp-server/package.json`'s `build` script now runs `tsc --noEmit` for type-checking only and then `node scripts/bundle.mjs`, which uses esbuild to bundle `api/index.ts` and `src/server.ts` (dependencies left external, i.e. resolved from `node_modules` at runtime) directly into `dist/api/index.js` and `dist/src/server.js`. `vercel.json` rewrites all requests to `/api`, which Vercel's zero-config Node function detection picks up from `api/index.ts` — the explicit bundle output gives that a known, single-file artifact to run instead of depending on tsc's mirrored directory layout.
