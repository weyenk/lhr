import { describe, expect, it } from 'vitest';
import { computeUnattachedCandidates, type AffiliateLinkCandidate } from '../src/productPlacementMatching';
import { buildMatchPrompt, parseMatchResponse, type MatchablePost } from '../src/productPlacementMatching';

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

const posts: MatchablePost[] = [
  {
    slug: 'chicago-deep-dish-pizza',
    title: 'Chicago Deep Dish Pizza',
    ingredients: ['Mozzarella', 'Italian sausage'],
    images: [
      { id: 0, kind: 'cover', alt: 'A whole deep dish pizza fresh from the oven' },
      { id: 1, kind: 'body', alt: 'Slicing the pizza with a wooden pizza server' },
    ],
  },
];

describe('buildMatchPrompt', () => {
  it('includes the product and each post with its images, as a system + user message pair', () => {
    const product = { id: 'wooden-pizza-server-1234', label: 'Wooden Pizza Server', url: 'https://amazon.com/x' };
    const messages = buildMatchPrompt(product, posts);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    const userContent = JSON.parse(messages[1].content);
    expect(userContent.product.label).toBe('Wooden Pizza Server');
    expect(userContent.posts[0].slug).toBe('chicago-deep-dish-pizza');
    expect(userContent.posts[0].images).toEqual(posts[0].images);
  });
});

describe('parseMatchResponse', () => {
  it('parses a valid match response', () => {
    const raw = JSON.stringify({ match: { slug: 'chicago-deep-dish-pizza', imageId: 1, rationale: 'Used to serve the slice' } });
    expect(parseMatchResponse(raw, posts)).toEqual({
      slug: 'chicago-deep-dish-pizza', imageId: 1, rationale: 'Used to serve the slice',
    });
  });

  it('returns null for an explicit no-match response', () => {
    expect(parseMatchResponse(JSON.stringify({ match: null }), posts)).toBeNull();
  });

  it('returns null for unparseable JSON, never throwing', () => {
    expect(parseMatchResponse('not json at all', posts)).toBeNull();
  });

  it('returns null when the referenced slug does not exist', () => {
    const raw = JSON.stringify({ match: { slug: 'nonexistent-post', imageId: 0, rationale: 'x' } });
    expect(parseMatchResponse(raw, posts)).toBeNull();
  });

  it('returns null when the referenced imageId does not exist on that post', () => {
    const raw = JSON.stringify({ match: { slug: 'chicago-deep-dish-pizza', imageId: 99, rationale: 'x' } });
    expect(parseMatchResponse(raw, posts)).toBeNull();
  });

  it('returns null when match is not an object', () => {
    const raw = JSON.stringify({ match: 'oops' });
    expect(parseMatchResponse(raw, posts)).toBeNull();
  });

  it('returns null when match is missing required fields', () => {
    const raw = JSON.stringify({ match: { slug: 'chicago-deep-dish-pizza' } });
    expect(parseMatchResponse(raw, posts)).toBeNull();
  });

  it('returns null when match has wrong field types', () => {
    const raw = JSON.stringify({ match: { slug: 123, imageId: 'x', rationale: 'y' } });
    expect(parseMatchResponse(raw, posts)).toBeNull();
  });
});
