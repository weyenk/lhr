import { describe, expect, it, vi, beforeEach } from 'vitest';

const github = { listFiles: vi.fn(), getFile: vi.fn() };
vi.mock('../src/github', () => ({
  listFiles: (...args: unknown[]) => github.listFiles(...args),
  getFile: (...args: unknown[]) => github.getFile(...args),
}));

const { readCollection, slugify, uniqueSlug } = await import('../src/catalog');

const client = {} as import('../src/github').GitHubClient;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readCollection', () => {
  // The implementation now lives in @lhr/github (covered by packages/github/tests/github.test.ts);
  // catalog.ts keeps a re-export so existing importers don't have to change.
  it('re-exports the @lhr/github implementation', async () => {
    const { readCollection: canonical } = await import('@lhr/github');
    expect(readCollection).toBe(canonical);
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates a title', () => {
    expect(slugify('Jerk Chicken for a Crowd!')).toBe('jerk-chicken-for-a-crowd');
  });
});

describe('uniqueSlug', () => {
  it('returns the base slug when unused', async () => {
    github.listFiles.mockResolvedValue(['why-coastal-blue.mdx']);
    const slug = await uniqueSlug(client, 'Jerk Chicken for a Crowd');
    expect(slug).toBe('jerk-chicken-for-a-crowd');
  });

  it('appends a number when the base slug is taken', async () => {
    github.listFiles.mockResolvedValue(['jerk-chicken-for-a-crowd.mdx']);
    const slug = await uniqueSlug(client, 'Jerk Chicken for a Crowd');
    expect(slug).toBe('jerk-chicken-for-a-crowd-2');
  });
});
