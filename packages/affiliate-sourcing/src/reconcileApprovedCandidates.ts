import type { Pool } from 'pg';
import { listFiles, commitFilesToMain, type GitHubClient } from '@lhr/github';
import { getApprovedCandidates, affiliateLinkFilename, buildAffiliateLinkFile } from '@lhr/db';

export interface ReconcileResult {
  reconciledAsins: string[];
}

export async function reconcileApprovedCandidates(
  client: GitHubClient,
  pool: Pool,
  associatesTag: string,
): Promise<ReconcileResult> {
  const approved = await getApprovedCandidates(pool);
  if (approved.length === 0) return { reconciledAsins: [] };

  const existingFiles = new Set(await listFiles(client, 'src/content/affiliate-links', 'main'));
  const missing = approved.filter((c) => !existingFiles.has(affiliateLinkFilename(c)));
  if (missing.length === 0) return { reconciledAsins: [] };

  for (const candidate of missing) {
    const file = buildAffiliateLinkFile(candidate, associatesTag);
    await commitFilesToMain(client, [file], `Add affiliate link: ${candidate.title}`);
  }
  return { reconciledAsins: missing.map((c) => c.asin) };
}
