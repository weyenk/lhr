import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { loadClient, saveClient } from './clientStore';
import {
  deleteIssuedCode,
  deletePendingAuthorization,
  loadIssuedCode,
  loadIssuedToken,
  loadPendingAuthorization,
  saveIssuedCode,
  saveIssuedToken,
  savePendingAuthorization,
} from './oauthStore';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const ACCESS_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const PENDING_AUTHORIZATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function fetchGitHubUser(githubAccessToken: string): Promise<{ login: string }> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${githubAccessToken}`, 'User-Agent': 'lhr-authoring-mcp-server' },
  });
  if (!res.ok) {
    throw new Error(`GitHub token verification failed: ${res.status}`);
  }
  return res.json();
}

/**
 * GitHub OAuth Apps have exactly one registered callback URL and require their
 * own fixed client_id/client_secret at the token endpoint — they cannot be
 * proxied transparently for a dynamically-registered downstream client (e.g.
 * claude.ai's DCR-issued client_id/redirect_uri): GitHub rejects both the
 * mismatched client_id and the mismatched redirect_uri domain. So this
 * provider runs a real two-legged flow: it is the actual OAuth authorization
 * server for downstream clients (minting its own codes and opaque access
 * tokens against the fixed `serverCallbackUrl`), and separately performs a
 * server-to-server exchange with GitHub in the background, storing the
 * resulting GitHub token keyed by its own opaque token.
 */
class GitHubOAuthServerProvider implements OAuthServerProvider {
  constructor(
    private readonly githubClientId: string,
    private readonly githubClientSecret: string,
    private readonly serverCallbackUrl: string,
    private readonly authorGitHubUsername: string,
  ) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: async (clientId: string) => (await loadClient(clientId)) ?? undefined,
      registerClient: async (client) => {
        const providedClientId = (client as Partial<OAuthClientInformationFull>).client_id;
        const clientId = typeof providedClientId === 'string' ? providedClientId : randomUUID();
        const fullClient = { ...client, client_id: clientId };
        await saveClient(fullClient);
        return fullClient;
      },
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const sessionId = randomUUID();
    await savePendingAuthorization(sessionId, {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      createdAt: Date.now(),
    });

    const target = new URL(GITHUB_AUTHORIZE_URL);
    target.searchParams.set('client_id', this.githubClientId);
    target.searchParams.set('redirect_uri', this.serverCallbackUrl);
    target.searchParams.set('scope', 'repo');
    target.searchParams.set('state', sessionId);
    res.redirect(target.toString());
  }

  /** Invoked by the fixed `/callback` route in server.ts, which GitHub redirects back to. */
  async handleGitHubCallback(code: string, sessionId: string): Promise<{ redirectTo: string }> {
    const pending = await loadPendingAuthorization(sessionId);
    if (!pending) {
      throw new Error('Unknown or expired authorization session');
    }
    if (Date.now() - pending.createdAt > PENDING_AUTHORIZATION_TTL_MS) {
      await deletePendingAuthorization(sessionId);
      throw new Error('Authorization session has expired');
    }
    await deletePendingAuthorization(sessionId);

    const tokenRes = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.githubClientId,
        client_secret: this.githubClientSecret,
        code,
        redirect_uri: this.serverCallbackUrl,
      }).toString(),
    });
    if (!tokenRes.ok) {
      throw new Error(`GitHub token exchange failed: ${tokenRes.status}`);
    }
    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      throw new Error(`GitHub token exchange failed: ${tokenData.error ?? 'no access_token in response'}`);
    }

    const user = await fetchGitHubUser(tokenData.access_token);
    if (user.login !== this.authorGitHubUsername) {
      throw new Error(`GitHub user ${user.login} is not the authorized author`);
    }

    const authorizationCode = randomUUID();
    await saveIssuedCode(authorizationCode, {
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      githubAccessToken: tokenData.access_token,
    });

    const redirectTo = new URL(pending.redirectUri);
    redirectTo.searchParams.set('code', authorizationCode);
    if (pending.state) {
      redirectTo.searchParams.set('state', pending.state);
    }
    return { redirectTo: redirectTo.toString() };
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const issued = await loadIssuedCode(authorizationCode);
    if (!issued || issued.clientId !== client.client_id) {
      throw new Error('Invalid authorization code');
    }
    return issued.codeChallenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<OAuthTokens> {
    const issued = await loadIssuedCode(authorizationCode);
    if (!issued || issued.clientId !== client.client_id) {
      throw new Error('Invalid authorization code');
    }
    await deleteIssuedCode(authorizationCode);

    const accessToken = randomUUID();
    await saveIssuedToken(accessToken, {
      clientId: client.client_id,
      githubAccessToken: issued.githubAccessToken,
      expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
    });

    return { access_token: accessToken, token_type: 'bearer', scope: 'repo' };
  }

  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new Error('Refresh tokens are not supported; re-run the authorization flow to get a new access token.');
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const issued = await loadIssuedToken(token);
    if (!issued) {
      throw new InvalidTokenError('Unknown access token');
    }
    if (issued.expiresAt < Date.now()) {
      throw new InvalidTokenError('Access token has expired');
    }
    const user = await fetchGitHubUser(issued.githubAccessToken);
    if (user.login !== this.authorGitHubUsername) {
      throw new InvalidTokenError(`GitHub user ${user.login} is not the authorized author`);
    }
    return {
      token: issued.githubAccessToken,
      clientId: issued.clientId,
      scopes: ['repo'],
      expiresAt: Math.floor(issued.expiresAt / 1000),
    };
  }
}

export function createGitHubOAuthProvider(): GitHubOAuthServerProvider {
  const authorGitHubUsername = process.env.AUTHOR_GITHUB_USERNAME;
  if (!authorGitHubUsername) {
    throw new Error(
      'AUTHOR_GITHUB_USERNAME is not set — the server cannot verify who is authorized to authenticate. Set it in the deployment environment (see docs/AUTHORING-SETUP.md).',
    );
  }
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  if (!githubClientId) {
    throw new Error(
      'GITHUB_CLIENT_ID is not set — required to complete the GitHub OAuth handshake. Set it in the deployment environment (see docs/AUTHORING-SETUP.md).',
    );
  }
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!githubClientSecret) {
    throw new Error(
      'GITHUB_CLIENT_SECRET is not set — required to complete the GitHub OAuth handshake. Set it in the deployment environment (see docs/AUTHORING-SETUP.md).',
    );
  }
  const mcpServerUrl = process.env.MCP_SERVER_URL;
  if (!mcpServerUrl) {
    throw new Error(
      'MCP_SERVER_URL is not set — required to build the fixed GitHub OAuth callback URL. Set it in the deployment environment (see docs/AUTHORING-SETUP.md).',
    );
  }
  const serverCallbackUrl = new URL('/callback', mcpServerUrl).toString();

  return new GitHubOAuthServerProvider(githubClientId, githubClientSecret, serverCallbackUrl, authorGitHubUsername);
}
