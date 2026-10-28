import {
  countPublishedPosts,
  getPool,
  getPostBySlug,
  listPublishedPosts,
  type Post,
} from '@lhr/db';
import type { PostView } from './postView';

function toPostView(row: Post): PostView {
  return {
    id: row.slug,
    data: row.data,
    bodyHtml: row.bodyHtml,
  };
}

export async function getPublishedPostBySlug(slug: string): Promise<PostView | null> {
  const row = await getPostBySlug(getPool(), slug);
  if (!row || row.status !== 'published') {
    return null;
  }
  return toPostView(row);
}

export async function getPublishedPostsPage(offset: number, limit: number): Promise<PostView[]> {
  const rows = await listPublishedPosts(getPool(), { offset, limit });
  return rows.map((row) => ({
    id: row.slug,
    data: row.data,
    bodyHtml: row.bodyHtml,
  }));
}

export async function countPublished(): Promise<number> {
  return countPublishedPosts(getPool());
}
