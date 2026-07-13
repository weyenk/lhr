import { deleteJson, getJson, putJson } from './blobStore';

export interface PendingAuthorization {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  createdAt: number;
}

export interface IssuedCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  githubAccessToken: string;
}

export interface IssuedToken {
  clientId: string;
  githubAccessToken: string;
  expiresAt: number;
}

function pendingPath(sessionId: string): string {
  return `oauth-pending/${sessionId}.json`;
}

function codePath(code: string): string {
  return `oauth-codes/${code}.json`;
}

function tokenPath(token: string): string {
  return `oauth-tokens/${token}.json`;
}

export async function savePendingAuthorization(sessionId: string, value: PendingAuthorization): Promise<void> {
  await putJson(pendingPath(sessionId), value);
}

export async function loadPendingAuthorization(sessionId: string): Promise<PendingAuthorization | null> {
  return getJson<PendingAuthorization>(pendingPath(sessionId));
}

export async function deletePendingAuthorization(sessionId: string): Promise<void> {
  await deleteJson(pendingPath(sessionId));
}

export async function saveIssuedCode(code: string, value: IssuedCode): Promise<void> {
  await putJson(codePath(code), value);
}

export async function loadIssuedCode(code: string): Promise<IssuedCode | null> {
  return getJson<IssuedCode>(codePath(code));
}

export async function deleteIssuedCode(code: string): Promise<void> {
  await deleteJson(codePath(code));
}

export async function saveIssuedToken(token: string, value: IssuedToken): Promise<void> {
  await putJson(tokenPath(token), value);
}

export async function loadIssuedToken(token: string): Promise<IssuedToken | null> {
  return getJson<IssuedToken>(tokenPath(token));
}
