import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { getPool, upsertPost } from '@lhr/db';
import { postSchema } from '@lhr/schemas';
import { markdownToSafeHtml } from '../src/lib/markdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const postsDir = path.join(__dirname, '../src/content/posts');

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

function parseMdxFile(content: string): { data: ReturnType<typeof postSchema.parse>; body: string } {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error('MDX file missing frontmatter');
  }
  const rawFrontmatter = yaml.load(match[1]) as unknown;
  const data = postSchema.parse(rawFrontmatter);
  return { data, body: match[2].trim() };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set; cannot import posts.');
    process.exit(1);
  }

  const db = getPool();
  const files = (await readdir(postsDir)).filter((name) => name.endsWith('.mdx'));

  for (const file of files) {
    const slug = file.replace(/\.mdx$/, '');
    const content = await readFile(path.join(postsDir, file), 'utf-8');
    const { data, body } = parseMdxFile(content);

    const bodyHtml = data.type === 'recipe' && body ? markdownToSafeHtml(body) : null;

    await upsertPost(db, {
      slug,
      type: data.type,
      title: data.title,
      data,
      bodyHtml,
      status: 'published',
      publishedAt: data.date,
      revision: 1,
    });

    console.log(`Imported ${slug}`);
  }

  console.log(`Done. Imported ${files.length} posts.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
