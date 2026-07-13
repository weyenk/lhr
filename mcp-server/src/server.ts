import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createGitHubOAuthProvider } from './auth/githubOAuth.js';
import { registerTools } from './tools/index.js';

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
