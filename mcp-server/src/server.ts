import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createGitHubOAuthProvider } from './auth/githubOAuth.js';
import { registerTools } from './tools/index.js';
import { verifyUploadLink } from './uploadLink.js';
import { storeImageBuffer, requireEnv } from './blob.js';
import { createGitHubClient } from './github.js';
import { readDraft, writeDraft } from './drafts.js';

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function renderUploadPage(draftId: string, exp: string, token: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Upload photos</title>
    <style>
      body { font-family: sans-serif; max-width: 480px; margin: 2rem auto; padding: 0 1rem; }
      button { font-size: 1rem; padding: 0.75rem 1.5rem; margin-top: 1rem; }
      ul { list-style: none; padding: 0; }
      li { padding: 0.25rem 0; }
      .done { color: green; }
      .failed { color: red; }
    </style>
  </head>
  <body>
    <h1>Upload photos</h1>
    <input id="files" type="file" accept="image/*" multiple />
    <button id="submit">Upload</button>
    <ul id="status"></ul>
    <script>
      const draftId = ${jsonForScript(draftId)};
      const exp = ${jsonForScript(exp)};
      const token = ${jsonForScript(token)};
      document.getElementById('submit').addEventListener('click', async () => {
        const input = document.getElementById('files');
        const statusList = document.getElementById('status');
        const files = Array.from(input.files || []);
        statusList.innerHTML = '';
        for (const file of files) {
          const item = document.createElement('li');
          item.textContent = 'Uploading ' + file.name + '...';
          statusList.appendChild(item);
          try {
            const res = await fetch('/upload/' + draftId + '/photo?exp=' + exp + '&token=' + token, {
              method: 'POST',
              headers: { 'Content-Type': file.type },
              body: file,
            });
            const data = await res.json();
            if (res.ok && data.ok) {
              item.textContent = 'Uploaded ' + file.name;
              item.className = 'done';
            } else {
              item.textContent = 'Failed: ' + file.name + ' (' + (data.error || res.status) + ')';
              item.className = 'failed';
            }
          } catch (err) {
            item.textContent = 'Failed: ' + file.name + ' (network error)';
            item.className = 'failed';
          }
        }
      });
    </script>
  </body>
</html>`;
}

function queryString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const app = express();
// Vercel's edge proxies every request through exactly one hop, adding
// X-Forwarded-For/Forwarded headers. Without this, express-rate-limit (used
// by the MCP SDK's /register and /authorize routes) throws on those headers
// instead of just warning, turning every request into a 500.
app.set('trust proxy', 1);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const provider = createGitHubOAuthProvider();

if (process.env.MCP_SERVER_URL) {
  const baseUrl = new URL(process.env.MCP_SERVER_URL);
  app.use(mcpAuthRouter({ provider, issuerUrl: baseUrl, baseUrl }));
}

app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (typeof error === 'string') {
    res.status(400).send(`GitHub authorization failed: ${error}`);
    return;
  }
  if (typeof code !== 'string' || typeof state !== 'string') {
    res.status(400).send('Missing code or state from GitHub callback');
    return;
  }
  try {
    const { redirectTo } = await provider.handleGitHubCallback(code, state);
    res.redirect(redirectTo);
  } catch (err) {
    res.status(400).send(err instanceof Error ? err.message : 'GitHub authorization failed');
  }
});

app.get('/upload/:draftId', (req, res) => {
  const { draftId } = req.params;
  const exp = Number(req.query.exp);
  const token = queryString(req.query.token);

  if (!verifyUploadLink(draftId, exp, token)) {
    res.status(403).send('This link has expired or is invalid — ask Claude for a new one.');
    return;
  }

  res.type('html').send(renderUploadPage(draftId, String(exp), token));
});

app.post('/upload/:draftId/photo', express.raw({ type: () => true, limit: '26mb' }), async (req, res) => {
  const { draftId } = req.params;
  const exp = Number(req.query.exp);
  const token = queryString(req.query.token);

  if (!verifyUploadLink(draftId, exp, token)) {
    res.status(403).json({ ok: false, error: 'Link expired or invalid' });
    return;
  }

  const contentType = req.headers['content-type'] ?? '';

  try {
    const url = await storeImageBuffer(req.body as Buffer, contentType);

    const client = createGitHubClient(requireEnv('AUTHOR_GITHUB_TOKEN'));
    const draft = await readDraft(client, 'post', draftId);
    if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);
    draft.photos = [...draft.photos, { url }];
    await writeDraft(client, 'post', draftId, draft, `Attach mobile-uploaded photo to draft ${draftId}`);

    res.json({ ok: true, url });
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Upload failed' });
  }
});

const authMiddleware = requireBearerAuth({ verifier: provider });

function createServer(accessToken: string): McpServer {
  const server = new McpServer({ name: 'lhr-authoring', version: '1.0.0' });
  registerTools(server, accessToken);
  return server;
}

// Stateless mode: Vercel gives no guarantee that two requests in the same MCP
// session land on the same serverless instance, so a session tracked in
// in-memory state (e.g. a `Record<sessionId, transport>`) is invisible to
// whichever instance handles the next request and fails with a spurious
// "no valid session ID" error. Creating a fresh transport/server per request
// avoids relying on that continuity; the SDK supports this via
// `sessionIdGenerator: undefined`.
app.post('/mcp', authMiddleware, async (req, res) => {
  const accessToken = (req as unknown as { auth: { token: string } }).auth.token;
  const server = createServer(accessToken);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', authMiddleware, (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
});

app.delete('/mcp', authMiddleware, (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
});

export default app;
