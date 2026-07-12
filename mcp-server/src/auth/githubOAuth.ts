import { randomUUID } from 'node:crypto';
import { ProxyOAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { loadClient, saveClient } from './clientStore';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

async function fetchGitHubUser(token: string): Promise<{ login: string }> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'lhr-authoring-mcp-server' },
  });
  if (!res.ok) {
    throw new Error(`GitHub token verification failed: ${res.status}`);
  }
  return res.json();
}

/**
 * The installed SDK's `ProxyOAuthServerProvider` constructor (see
 * node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/providers/proxyProvider.d.ts)
 * only accepts a top-level `getClient` read callback in its options — there is no
 * `clientsStore` constructor option. Its `clientsStore` getter is computed internally
 * from that `getClient` callback plus an optional `endpoints.registrationUrl`: if
 * `registrationUrl` is set, `registerClient` proxies registration to that remote URL over
 * HTTP; if it's unset, `registerClient` is absent entirely and Dynamic Client Registration
 * is unsupported.
 *
 * GitHub has no public DCR registration endpoint to proxy to, so registered clients (e.g.
 * from claude.ai's DCR flow) must be stored locally in our own KV-backed client store
 * instead. We subclass and override the read-only `clientsStore` getter to supply both
 * `getClient` and `registerClient` backed by `clientStore.ts`, while leaving
 * `verifyAccessToken` and the GitHub `endpoints` untouched from the base implementation.
 */
class GitHubOAuthServerProvider extends ProxyOAuthServerProvider {
  override get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: async (clientId: string) => {
        const stored = await loadClient(clientId);
        return stored ?? undefined;
      },
      registerClient: async (client) => {
        const providedClientId = (client as Partial<OAuthClientInformationFull>).client_id;
        const clientId = typeof providedClientId === 'string' ? providedClientId : randomUUID();
        const fullClient = { ...client, client_id: clientId };
        await saveClient(fullClient);
        return fullClient;
      },
    };
  }
}

export function createGitHubOAuthProvider(): ProxyOAuthServerProvider {
  const authorGitHubUsername = process.env.AUTHOR_GITHUB_USERNAME!;

  return new GitHubOAuthServerProvider({
    endpoints: {
      authorizationUrl: GITHUB_AUTHORIZE_URL,
      tokenUrl: GITHUB_TOKEN_URL,
    },
    verifyAccessToken: async (token: string) => {
      const user = await fetchGitHubUser(token);
      if (user.login !== authorGitHubUsername) {
        throw new Error(`GitHub user ${user.login} is not the authorized author`);
      }
      return { token, clientId: 'lhr-authoring', scopes: ['repo'] };
    },
    getClient: async (clientId: string) => {
      const stored = await loadClient(clientId);
      return stored ?? undefined;
    },
  });
}
