import { createGitHubClient, commitFilesToMain } from './github.js';
import {
  getCandidateById,
  markCandidateStatus,
  insertDecisionHistory,
  buildAffiliateLinkFile,
  type Candidate,
  type Queryable,
} from '@lhr/db';

// Approve/deny for the weekly affiliate-sourcing candidates, kept as plain functions (a db handle,
// a token and a tag in; a result out) rather than anything request-shaped — apps/lhr-office wires
// them into its AffiliateCandidateOps interface itself, exactly as it does with recipeCandidates.ts.

export class CandidateNotFoundError extends Error {
  constructor(id: number) {
    super(`Candidate ${id} not found`);
    this.name = 'CandidateNotFoundError';
  }
}

export class CandidateAlreadyDecidedError extends Error {
  constructor(id: number, status: Candidate['status']) {
    super(`Candidate ${id} is already ${status}`);
    this.name = 'CandidateAlreadyDecidedError';
  }
}

async function loadPending(db: Queryable, id: number): Promise<Candidate> {
  const candidate = await getCandidateById(db, id);
  if (!candidate) throw new CandidateNotFoundError(id);
  if (candidate.status !== 'pending') throw new CandidateAlreadyDecidedError(id, candidate.status);
  return candidate;
}

export interface ApprovedAffiliateCandidate {
  asin: string;
  title: string;
  path: string;
}

// Commits the affiliate-links file first and only then records the decision: a failed GitHub write
// leaves the candidate pending and retryable, whereas marking it approved first could strand an
// approved candidate with no file. reconcileApprovedCandidates (run by the sourcing job) is the
// backstop for the narrower window where the commit lands but the DB write does not.
export async function approveAffiliateCandidate(
  db: Queryable,
  githubToken: string,
  associatesTag: string,
  id: number,
): Promise<ApprovedAffiliateCandidate> {
  const candidate = await loadPending(db, id);

  const file = buildAffiliateLinkFile(candidate, associatesTag);
  await commitFilesToMain(createGitHubClient(githubToken), [file], `Add affiliate link: ${candidate.title}`);

  await markCandidateStatus(db, id, 'approved');
  await insertDecisionHistory(db, {
    asin: candidate.asin,
    category: candidate.category,
    priceCents: candidate.priceCents,
    commissionRate: candidate.commissionRate,
    estimatedMonthlySales: candidate.estimatedMonthlySales,
    decision: 'approved',
  });

  return { asin: candidate.asin, title: candidate.title, path: file.path };
}

export interface DeniedAffiliateCandidate {
  asin: string;
  title: string;
}

// A denial writes nothing to GitHub — it only closes the candidate out and records the decision,
// which both excludes the ASIN from future cycles and feeds the preference-learning scorer.
export async function denyAffiliateCandidate(db: Queryable, id: number): Promise<DeniedAffiliateCandidate> {
  const candidate = await loadPending(db, id);

  await markCandidateStatus(db, id, 'denied');
  await insertDecisionHistory(db, {
    asin: candidate.asin,
    category: candidate.category,
    priceCents: candidate.priceCents,
    commissionRate: candidate.commissionRate,
    estimatedMonthlySales: candidate.estimatedMonthlySales,
    decision: 'denied',
  });

  return { asin: candidate.asin, title: candidate.title };
}
