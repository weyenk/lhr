import type { SourcedProductCycleResponse } from './types';

/**
 * How many sourced-product items are waiting on the author right now.
 * Shared by the Approvals "Sourced" tab badge and the Overview pending count so
 * the two never disagree.
 *
 * - brief awaiting approval counts as one decision
 * - each `sourced` candidate is a pick decision
 * - each `monetize_pass` candidate is a confirm decision (only while the cycle awaits it)
 * - each `pending_final` candidate is an approve/deny decision
 */
export function countSourcedActionable(data: SourcedProductCycleResponse | null | undefined): number {
  const cycle = data?.cycle;
  if (!cycle) return 0;
  const candidates = data.candidates;
  const count = (status: SourcedProductCycleResponse['candidates'][number]['status']) => candidates.filter((c) => c.status === status).length;

  let total = count('sourced') + count('pending_final');
  if (cycle.status === 'awaiting_criteria_approval') total += 1;
  if (cycle.status === 'awaiting_monetize_approval') total += count('monetize_pass');
  return total;
}
