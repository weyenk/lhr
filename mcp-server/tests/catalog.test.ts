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
  it('reads and parses every JSON file in a directory', async () => {
    github.listFiles.mockResolvedValue(['coastal-blue.json']);
    github.getFile.mockResolvedValue({ content: JSON.stringify({ name: 'Coastal Blue' }), sha: 's1' });

    const result = await readCollection(client, 'src/content/sets');

    expect(result).toEqual([{ id: 'coastal-blue', data: { name: 'Coastal Blue' } }]);
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
