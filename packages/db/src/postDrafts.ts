import type { DraftPost } from '@lhr/schemas';
import type { Queryable } from './client.js';
import type { PostType } from './posts.js';

export interface NewPostDraft {
  postId?: string | null;
  authorSub: string;
  type?: PostType | null;
  draft: DraftPost;
}

export interface PostDraft extends NewPostDraft {
  id: string;
  postId: string | null;
  type: PostType | null;
  createdAt: Date;
  updatedAt: Date;
}

type PostDraftRow = {
  id: string;
  post_id: string | null;
  author_sub: string;
  type: PostType | null;
  draft: DraftPost;
  created_at: Date;
  updated_at: Date;
};

function mapRow(row: PostDraftRow): PostDraft {
  return {
    id: row.id,
    postId: row.post_id,
    authorSub: row.author_sub,
    type: row.type,
    draft: row.draft,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertPostDraft(db: Queryable, draft: NewPostDraft): Promise<PostDraft> {
  const result = await db.query<PostDraftRow>(
    `INSERT INTO post_drafts (post_id, author_sub, type, draft)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [draft.postId ?? null, draft.authorSub, draft.type ?? null, JSON.stringify(draft.draft)],
  );
  return mapRow(result.rows[0]);
}

export async function getPostDraftById(db: Queryable, id: string): Promise<PostDraft | null> {
  const result = await db.query<PostDraftRow>(`SELECT * FROM post_drafts WHERE id = $1`, [id]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function getPostDraftForAuthor(
  db: Queryable,
  id: string,
  authorSub: string,
): Promise<PostDraft | null> {
  const result = await db.query<PostDraftRow>(
    `SELECT * FROM post_drafts WHERE id = $1 AND author_sub = $2`,
    [id, authorSub],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function updatePostDraft(
  db: Queryable,
  id: string,
  authorSub: string,
  updates: { type?: PostType | null; draft: DraftPost },
): Promise<PostDraft | null> {
  const result = await db.query<PostDraftRow>(
    `UPDATE post_drafts SET
       type = COALESCE($3, type),
       draft = $4,
       updated_at = now()
     WHERE id = $1 AND author_sub = $2
     RETURNING *`,
    [id, authorSub, updates.type ?? null, JSON.stringify(updates.draft)],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function listPostDraftsByAuthor(db: Queryable, authorSub: string): Promise<PostDraft[]> {
  const result = await db.query<PostDraftRow>(
    `SELECT * FROM post_drafts WHERE author_sub = $1 ORDER BY updated_at DESC`,
    [authorSub],
  );
  return result.rows.map(mapRow);
}
