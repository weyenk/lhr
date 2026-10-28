import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  insertPost,
  getPostBySlug,
  getPostById,
  upsertPost,
  listPublishedPosts,
  countPublishedPosts,
  type NewPost,
} from '../src/posts';

function mockDb(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const sampleData = {
  type: 'recipe' as const,
  title: 'Test Recipe',
  date: new Date('2026-01-01'),
  coverPhoto: 'https://example.com/cover.jpg',
  coverPhotoAlt: 'cover',
  ingredients: [{ item: 'flour' }],
  steps: ['mix'],
};

const newPost: NewPost = {
  slug: 'test-recipe',
  type: 'recipe',
  title: 'Test Recipe',
  data: sampleData,
  bodyHtml: '<p>Hello</p>',
  publishedAt: new Date('2026-01-02T00:00:00Z'),
};

const postRow = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  slug: 'test-recipe',
  type: 'recipe' as const,
  title: 'Test Recipe',
  data: sampleData,
  body_html: '<p>Hello</p>',
  status: 'published',
  published_at: new Date('2026-01-02T00:00:00Z'),
  revision: 1,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertPost', () => {
  it('inserts JSONB data and returns the mapped row', async () => {
    const db = mockDb([postRow]);
    const result = await insertPost(db as never, newPost);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO posts'),
      [
        'test-recipe',
        'recipe',
        'Test Recipe',
        JSON.stringify(sampleData),
        '<p>Hello</p>',
        'published',
        newPost.publishedAt,
        1,
      ],
    );
    expect(result.slug).toBe('test-recipe');
    expect(result.data).toEqual(sampleData);
  });
});

describe('getPostBySlug', () => {
  it('returns null when no row exists', async () => {
    const db = mockDb([]);
    const result = await getPostBySlug(db as never, 'missing');
    expect(result).toBeNull();
  });

  it('maps the row when found', async () => {
    const db = mockDb([postRow]);
    const result = await getPostBySlug(db as never, 'test-recipe');
    expect(result?.id).toBe(postRow.id);
  });
});

describe('getPostById', () => {
  it('queries by id', async () => {
    const db = mockDb([postRow]);
    await getPostById(db as never, postRow.id);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1'), [postRow.id]);
  });
});

describe('upsertPost', () => {
  it('upserts on slug conflict', async () => {
    const db = mockDb([postRow]);
    const result = await upsertPost(db as never, newPost);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (slug)'), expect.any(Array));
    expect(result.slug).toBe('test-recipe');
  });
});

describe('listPublishedPosts', () => {
  it('paginates with offset and limit', async () => {
    const db = mockDb([postRow]);
    const result = await listPublishedPosts(db as never, { offset: 10, limit: 5 });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("status = 'published'"), [10, 5]);
    expect(result).toHaveLength(1);
  });
});

describe('countPublishedPosts', () => {
  it('returns the count as a number', async () => {
    const db = mockDb([{ count: '42' }]);
    const result = await countPublishedPosts(db as never);
    expect(result).toBe(42);
  });
});
