import { describe, expect, it } from 'vitest';
import { computeBackfillEntries, parsePostFrontmatter } from '../src/backfillIngredientLinks';

describe('computeBackfillEntries', () => {
  it('seeds an entry for a post with exactly one affiliate link and one ingredient', () => {
    const posts = [{ id: 'jerk-chicken', ingredients: [{ item: '2 tbsp jerk seasoning' }], affiliateLinkIds: ['jerk-seasoning'] }];
    const result = computeBackfillEntries(posts, []);
    expect(result.seeded).toEqual([{ postId: 'jerk-chicken', ingredient: 'jerk seasoning', affiliateLinkId: 'jerk-seasoning' }]);
    expect(result.skipped).toEqual([]);
  });

  it('skips a post with more than one affiliate link', () => {
    const posts = [{ id: 'multi', ingredients: [{ item: 'salt' }], affiliateLinkIds: ['a', 'b'] }];
    const result = computeBackfillEntries(posts, []);
    expect(result.seeded).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].postId).toBe('multi');
  });

  it('skips a post with exactly one affiliate link but multiple ingredients', () => {
    const posts = [{ id: 'multi-ing', ingredients: [{ item: 'jerk seasoning' }, { item: 'chicken thighs' }], affiliateLinkIds: ['jerk-seasoning'] }];
    const result = computeBackfillEntries(posts, []);
    expect(result.seeded).toEqual([]);
    expect(result.skipped[0].postId).toBe('multi-ing');
  });

  it('ignores posts with zero affiliate links (nothing to infer, not reported as skipped)', () => {
    const posts = [{ id: 'no-links', ingredients: [{ item: 'salt' }], affiliateLinkIds: [] }];
    const result = computeBackfillEntries(posts, []);
    expect(result.seeded).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('skips (does not overwrite) when the normalized ingredient already has a library entry', () => {
    const posts = [{ id: 'jerk-chicken-2', ingredients: [{ item: 'jerk seasoning' }], affiliateLinkIds: ['jerk-seasoning'] }];
    const result = computeBackfillEntries(posts, [{ ingredient: 'jerk seasoning', affiliateLinkId: 'jerk-seasoning' }]);
    expect(result.seeded).toEqual([]);
    expect(result.skipped[0].postId).toBe('jerk-chicken-2');
  });

  it('does not seed duplicate ingredient keys across two posts in the same run', () => {
    const posts = [
      { id: 'post-a', ingredients: [{ item: 'jerk seasoning' }], affiliateLinkIds: ['jerk-seasoning'] },
      { id: 'post-b', ingredients: [{ item: '2 tbsp jerk seasoning' }], affiliateLinkIds: ['jerk-seasoning-2'] },
    ];
    const result = computeBackfillEntries(posts, []);
    expect(result.seeded).toEqual([{ postId: 'post-a', ingredient: 'jerk seasoning', affiliateLinkId: 'jerk-seasoning' }]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].postId).toBe('post-b');
  });
});

describe('parsePostFrontmatter', () => {
  it('parses a rendered post frontmatter block back into an object', () => {
    const mdx = '---\ntype: recipe\ntitle: Jerk Chicken\ningredients:\n  - item: jerk seasoning\n---\n\nBody content here.\n';
    const result = parsePostFrontmatter(mdx);
    expect(result.title).toBe('Jerk Chicken');
    expect((result.ingredients as Array<{ item: string }>)[0].item).toBe('jerk seasoning');
  });

  it('throws when no frontmatter delimiters are present', () => {
    expect(() => parsePostFrontmatter('just body text, no frontmatter')).toThrow();
  });
});
