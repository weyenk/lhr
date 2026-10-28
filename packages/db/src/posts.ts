import type { PostData } from '@lhr/schemas';
import type { Queryable } from './client.js';

export type PostType = 'recipe' | 'article';

export interface NewPost {
  slug: string;
  type: PostType;
  title: string | null;
  data: PostData;
  bodyHtml?: string | null;
  status?: string;
  publishedAt?: Date | null;
  revision?: number;
}

export interface Post extends NewPost {
  id: string;
  bodyHtml: string | null;
  status: string;
  publishedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

type PostRow = {
  id: string;
  slug: string;
  type: PostType;
  title: string | null;
  data: PostData;
  body_html: string | null;
  status: string;
  published_at: Date | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
};

function mapRow(row: PostRow): Post {
  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    title: row.title,
    data: row.data,
    bodyHtml: row.body_html,
    status: row.status,
    publishedAt: row.published_at,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertPost(db: Queryable, post: NewPost): Promise<Post> {
  const result = await db.query<PostRow>(
    `INSERT INTO posts (slug, type, title, data, body_html, status, published_at, revision)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      post.slug,
      post.type,
      post.title,
      JSON.stringify(post.data),
      post.bodyHtml ?? null,
      post.status ?? 'published',
      post.publishedAt ?? null,
      post.revision ?? 1,
    ],
  );
  return mapRow(result.rows[0]);
}

export async function getPostBySlug(db: Queryable, slug: string): Promise<Post | null> {
  const result = await db.query<PostRow>(`SELECT * FROM posts WHERE slug = $1`, [slug]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function getPostById(db: Queryable, id: string): Promise<Post | null> {
  const result = await db.query<PostRow>(`SELECT * FROM posts WHERE id = $1`, [id]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function upsertPost(db: Queryable, post: NewPost & { id?: string }): Promise<Post> {
  if (post.id) {
    const result = await db.query<PostRow>(
      `UPDATE posts SET
        slug = $2,
        type = $3,
        title = $4,
        data = $5,
        body_html = $6,
        status = $7,
        published_at = $8,
        revision = $9,
        updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        post.id,
        post.slug,
        post.type,
        post.title,
        JSON.stringify(post.data),
        post.bodyHtml ?? null,
        post.status ?? 'published',
        post.publishedAt ?? null,
        post.revision ?? 1,
      ],
    );
    if (result.rows[0]) return mapRow(result.rows[0]);
  }

  const result = await db.query<PostRow>(
    `INSERT INTO posts (id, slug, type, title, data, body_html, status, published_at, revision)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (slug) DO UPDATE SET
       type = EXCLUDED.type,
       title = EXCLUDED.title,
       data = EXCLUDED.data,
       body_html = EXCLUDED.body_html,
       status = EXCLUDED.status,
       published_at = EXCLUDED.published_at,
       revision = EXCLUDED.revision,
       updated_at = now()
     RETURNING *`,
    [
      post.id ?? null,
      post.slug,
      post.type,
      post.title,
      JSON.stringify(post.data),
      post.bodyHtml ?? null,
      post.status ?? 'published',
      post.publishedAt ?? null,
      post.revision ?? 1,
    ],
  );
  return mapRow(result.rows[0]);
}

export async function listPublishedPosts(
  db: Queryable,
  options: { offset?: number; limit?: number } = {},
): Promise<Post[]> {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 20;
  const result = await db.query<PostRow>(
    `SELECT * FROM posts
     WHERE status = 'published'
     ORDER BY published_at DESC NULLS LAST, created_at DESC
     OFFSET $1 LIMIT $2`,
    [offset, limit],
  );
  return result.rows.map(mapRow);
}

export async function countPublishedPosts(db: Queryable): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM posts WHERE status = 'published'`,
  );
  return Number(result.rows[0]?.count ?? 0);
}
