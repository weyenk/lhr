import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  insertPostDraft,
  getPostDraftById,
  getPostDraftForAuthor,
  updatePostDraft,
  listPostDraftsByAuthor,
  type NewPostDraft,
} from '../src/postDrafts';

function mockDb(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const draftPayload = {
  kind: 'post' as const,
  postType: 'recipe' as const,
  title: 'Draft title',
  ingredients: [],
  steps: [],
  sections: [],
  photos: [],
  kitchenwareIds: [],
  affiliateLinkIds: [],
  pendingAffiliateLinks: [],
  pendingIngredientLinks: [],
  variants: [],
};

const newDraft: NewPostDraft = {
  authorSub: 'auth0|user123',
  type: 'recipe',
  draft: draftPayload,
};

const draftRow = {
  id: '660e8400-e29b-41d4-a716-446655440001',
  post_id: null,
  author_sub: 'auth0|user123',
  type: 'recipe' as const,
  draft: draftPayload,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertPostDraft', () => {
  it('inserts JSONB draft and returns the row', async () => {
    const db = mockDb([draftRow]);
    const result = await insertPostDraft(db as never, newDraft);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO post_drafts'),
      [null, 'auth0|user123', 'recipe', JSON.stringify(draftPayload)],
    );
    expect(result.draft.title).toBe('Draft title');
  });
});

describe('getPostDraftById', () => {
  it('returns null when missing', async () => {
    const db = mockDb([]);
    expect(await getPostDraftById(db as never, draftRow.id)).toBeNull();
  });
});

describe('getPostDraftForAuthor', () => {
  it('scopes by author_sub', async () => {
    const db = mockDb([draftRow]);
    await getPostDraftForAuthor(db as never, draftRow.id, 'auth0|user123');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('author_sub = $2'), [
      draftRow.id,
      'auth0|user123',
    ]);
  });
});

describe('updatePostDraft', () => {
  it('updates draft json and updated_at', async () => {
    const db = mockDb([{ ...draftRow, draft: { ...draftPayload, title: 'Updated' } }]);
    const updated = { ...draftPayload, title: 'Updated' };
    const result = await updatePostDraft(db as never, draftRow.id, 'auth0|user123', { draft: updated });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE post_drafts'), [
      draftRow.id,
      'auth0|user123',
      null,
      JSON.stringify(updated),
    ]);
    expect(result?.draft.title).toBe('Updated');
  });
});

describe('listPostDraftsByAuthor', () => {
  it('orders by updated_at desc', async () => {
    const db = mockDb([draftRow]);
    await listPostDraftsByAuthor(db as never, 'auth0|user123');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY updated_at DESC'), ['auth0|user123']);
  });
});
