import { createGitHubClient, listFiles, getFile, commitFilesToMain } from '../src/github.js';
import { readCollection } from '../src/catalog.js';
import { postSchema } from '@lhr/schemas';
import { parsePostFrontmatter, computeBackfillEntries, type BackfillPost } from '../src/backfillIngredientLinks.js';

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN env var is required (a GitHub personal access token with repo write access).');
    process.exit(1);
  }
  const client = createGitHubClient(token);

  const postFiles = await listFiles(client, 'src/content/posts', 'main');
  const posts: BackfillPost[] = [];
  for (const filename of postFiles.filter((f) => f.endsWith('.mdx'))) {
    const file = await getFile(client, `src/content/posts/${filename}`, 'main');
    if (!file) continue;
    const frontmatter = parsePostFrontmatter(file.content);
    const parsed = postSchema.safeParse(frontmatter);
    if (!parsed.success || parsed.data.type !== 'recipe') continue;
    posts.push({
      id: filename.replace(/\.mdx$/, ''),
      ingredients: parsed.data.ingredients,
      affiliateLinkIds: parsed.data.affiliateLinkIds,
    });
  }

  const existingIngredientLinks = await readCollection<{ ingredient: string; affiliateLinkId: string }>(
    client,
    'src/content/ingredient-links',
  );
  const { seeded, skipped } = computeBackfillEntries(posts, existingIngredientLinks.map((e) => e.data));

  console.log(`Seeded ${seeded.length} ingredient-link entr${seeded.length === 1 ? 'y' : 'ies'}:`);
  for (const s of seeded) console.log(`  ${s.postId}: "${s.ingredient}" -> ${s.affiliateLinkId}`);
  console.log(`Skipped ${skipped.length} case(s) needing manual resolution:`);
  for (const s of skipped) console.log(`  ${s.postId}: ${s.reason}`);

  if (seeded.length === 0) {
    console.log('Nothing to write.');
    return;
  }

  const files = seeded.map((s) => ({
    path: `src/content/ingredient-links/${s.ingredient.replace(/\s+/g, '-')}.json`,
    content: JSON.stringify({ ingredient: s.ingredient, affiliateLinkId: s.affiliateLinkId }, null, 2),
  }));
  await commitFilesToMain(client, files, 'Backfill ingredient-links from existing posts');
  console.log(`Committed ${files.length} file(s) to main.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
