import { describe, expect, it } from 'vitest';
import { computeUnattachedCandidates, type AffiliateLinkCandidate } from '../src/productPlacementMatching';

const links: AffiliateLinkCandidate[] = [
  { id: 'bamboo-skewers-1234', label: 'Bamboo Skewers', url: 'https://amazon.com/x' },
  { id: 'ceramic-bowl-5678', label: 'Ceramic Bowl', url: 'https://amazon.com/y' },
  { id: 'chef-knife-9012', label: 'Chef Knife', url: 'https://amazon.com/z' },
];

describe('computeUnattachedCandidates', () => {
  it('excludes links already attached to a published post', () => {
    const result = computeUnattachedCandidates(links, new Set(['bamboo-skewers-1234']), new Set());
    expect(result.map((c) => c.id)).toEqual(['ceramic-bowl-5678', 'chef-knife-9012']);
  });

  it('excludes links with a pending proposal in flight', () => {
    const result = computeUnattachedCandidates(links, new Set(), new Set(['ceramic-bowl-5678']));
    expect(result.map((c) => c.id)).toEqual(['bamboo-skewers-1234', 'chef-knife-9012']);
  });

  it('returns all links when nothing is attached or pending', () => {
    const result = computeUnattachedCandidates(links, new Set(), new Set());
    expect(result).toHaveLength(3);
  });

  it('a product with a past rejected proposal remains a candidate (only pending is excluded)', () => {
    // Simulates: chef-knife-9012 had a proposal that was rejected — it does not appear in
    // pendingIds (only 'pending' status proposals do), so discovery naturally re-includes it.
    const result = computeUnattachedCandidates(links, new Set(), new Set());
    expect(result.map((c) => c.id)).toContain('chef-knife-9012');
  });
});
