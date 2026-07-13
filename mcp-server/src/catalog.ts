import { getFile, listFiles, type GitHubClient } from './github.js';

export interface CatalogEntry<T> {
  id: string;
  data: T;
}

export async function readCollection<T>(client: GitHubClient, dirPath: string, ref = 'main'): Promise<CatalogEntry<T>[]> {
  const files = await listFiles(client, dirPath, ref);
  const entries: CatalogEntry<T>[] = [];
  for (const filename of files.filter((f) => f.endsWith('.json'))) {
    const file = await getFile(client, `${dirPath}/${filename}`, ref);
    if (!file) continue;
    entries.push({ id: filename.replace(/\.json$/, ''), data: JSON.parse(file.content) as T });
  }
  return entries;
}

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
