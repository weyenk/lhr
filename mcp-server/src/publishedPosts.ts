import yaml from 'js-yaml';
import { listFiles, getFile, type GitHubClient } from './github.js';

export interface PublishedPost {
  slug: string;
  raw: string;
  title: string;
  ingredients: Array<{ item: string }>;
  affiliateLinkIds: string[];
}

interface RecipeFrontmatter {
  type?: string;
  title?: string;
  ingredients?: Array<{ item: string }>;
  affiliateLinkIds?: string[];
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

export async function listPublishedPosts(client: GitHubClient): Promise<PublishedPost[]> {
  const files = await listFiles(client, 'src/content/posts', 'main');
  const posts: PublishedPost[] = [];

  for (const filename of files.filter((f) => f.endsWith('.mdx'))) {
    const file = await getFile(client, `src/content/posts/${filename}`, 'main');
    if (!file) continue;

    const match = file.content.match(FRONTMATTER_RE);
    if (!match) continue;
    const frontmatter = yaml.load(match[1]) as RecipeFrontmatter;
    if (frontmatter.type !== 'recipe') continue;

    posts.push({
      slug: filename.replace(/\.mdx$/, ''),
      raw: file.content,
      title: frontmatter.title ?? '',
      ingredients: frontmatter.ingredients ?? [],
      affiliateLinkIds: frontmatter.affiliateLinkIds ?? [],
    });
  }

  return posts;
}
