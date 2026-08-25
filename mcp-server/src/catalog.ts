import { listFiles, type GitHubClient } from './github.js';

export { readCollection, type CatalogEntry } from '@lhr/github';

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function uniqueSlug(client: GitHubClient, title: string): Promise<string> {
  const base = slugify(title);
  const existingFiles = await listFiles(client, 'src/content/posts', 'main');
  const existingSlugs = new Set(existingFiles.map((f) => f.replace(/\.mdx$/, '')));
  if (!existingSlugs.has(base)) return base;
  let n = 2;
  while (existingSlugs.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
