import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/github.js', () => ({ listFiles: vi.fn(), getFile: vi.fn() }));

import { listFiles, getFile } from '../src/github.js';
import { listPublishedPosts } from '../src/publishedPosts';

const recipeMdx = `---
type: recipe
title: "Test Recipe"
ingredients:
  - item: "Salt"
affiliateLinkIds: ["existing-link"]
---

Body text.
`;

const articleMdx = `---
type: article
title: "Test Article"
sections: []
affiliateLinkIds: []
---

Body text.
`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listPublishedPosts', () => {
  it('returns only recipe-type posts, with title/ingredients/affiliateLinkIds parsed from frontmatter', async () => {
    vi.mocked(listFiles).mockResolvedValue(['test-recipe.mdx', 'test-article.mdx', 'ignored.txt']);
    vi.mocked(getFile).mockImplementation(async (_client, path) => {
      if (path === 'src/content/posts/test-recipe.mdx') return { content: recipeMdx, sha: 'abc' };
      if (path === 'src/content/posts/test-article.mdx') return { content: articleMdx, sha: 'def' };
      return null;
    });

    const posts = await listPublishedPosts({} as never);

    expect(posts).toEqual([
      {
        slug: 'test-recipe',
        raw: recipeMdx,
        title: 'Test Recipe',
        ingredients: [{ item: 'Salt' }],
        affiliateLinkIds: ['existing-link'],
      },
    ]);
  });
});
