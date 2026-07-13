import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createGitHubOAuthProvider } from './auth/githubOAuth.js';
import { registerTools } from './tools/index.js';

const app = express();
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

const transports: Record<string, StreamableHTTPServerTransport> = {};

function createServer(accessToken: string): McpServer {
  const server = new McpServer({ name: 'lhr-authoring', version: '1.0.0' });
  registerTools(server, accessToken);
  return server;
}

app.post('/mcp', authMiddleware, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports[sessionId]) {
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports[id] = transport;
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) delete transports[transport.sessionId];
    };
    const accessToken = (req as unknown as { auth: { token: string } }).auth.token;
    const server = createServer(accessToken);
    await server.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
      id: null,
    });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

async function handleSessionRequest(req: express.Request, res: express.Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await transports[sessionId].handleRequest(req, res);
}

app.get('/mcp', authMiddleware, handleSessionRequest);
app.delete('/mcp', authMiddleware, handleSessionRequest);

export default app;
