# Authoring MCP Server Setup

Manual, one-time setup for the authoring MCP server (outside this repo's automated tasks):

1. **Register a GitHub OAuth App** (GitHub → Settings → Developer settings → OAuth Apps → New OAuth App) for the MCP server. Set its callback URL to `https://<your-mcp-server-domain>/callback`. Note the generated Client ID and Client Secret.
2. **Create a new Vercel project** for `mcp-server/` (import this repo, set the project's root directory to `mcp-server/`).
3. **Provision a Vercel KV store** and attach it to the project — this holds OAuth client registrations from the Dynamic Client Registration flow.
4. **Provision Vercel Blob** for the project (if not already shared with the main site project) and note its read/write token.
5. **Set project environment variables** on the new Vercel project:
   - `AUTHOR_GITHUB_USERNAME` — her GitHub username (the single allowlisted author).
   - `MCP_SERVER_URL` — the deployed project's URL (e.g. `https://lhr-authoring.vercel.app`).
   - `KV_REST_API_URL` / `KV_REST_API_TOKEN` — from step 3 (Vercel sets these automatically when you attach a KV store).
   - `BLOB_READ_WRITE_TOKEN` — from step 4.
   - GitHub OAuth App Client ID/Secret from step 1, as required by the deployed auth wiring.
6. **Deploy** the `mcp-server/` project.
7. In the **Claude.ai app**, add a **custom MCP connector** pointing at the deployed project's `/mcp` URL, and complete the GitHub OAuth login when prompted — logging in as the same GitHub account named in `AUTHOR_GITHUB_USERNAME`. A login from any other GitHub account will be rejected by the server's allowlist check.
8. Create a **Claude.ai Project**, attach the connector, and paste in the scripted authoring-flow instructions (pick post type → title → content → photos → kitchenware → affiliate links → preview → confirm).
