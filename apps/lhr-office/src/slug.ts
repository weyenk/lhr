import type { Queryable } from '@lhr/db';
import { getPostBySlug } from '@lhr/db';

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function uniqueSlugForTitle(
  db: Queryable,
  title: string,
  excludePostId?: string | null,
): Promise<string> {
  const base = slugify(title);
  if (!base) throw new Error('Title does not produce a valid slug');

  let candidate = base;
  let n = 2;
  while (true) {
    const existing = await getPostBySlug(db, candidate);
    if (!existing || (excludePostId && existing.id === excludePostId)) return candidate;
    candidate = `${base}-${n}`;
    n += 1;
  }
}
