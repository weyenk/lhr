import yaml from 'js-yaml';

export interface PostImage {
  kind: 'cover' | 'body';
  url: string;
  alt: string;
  line: string | null;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const BODY_IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/gm;

export function enumeratePostImages(raw: string): PostImage[] {
  const images: PostImage[] = [];
  const frontmatterMatch = raw.match(FRONTMATTER_RE);

  if (frontmatterMatch) {
    const frontmatter = yaml.load(frontmatterMatch[1]) as { coverPhoto?: string; coverPhotoAlt?: string };
    if (frontmatter.coverPhoto) {
      images.push({ kind: 'cover', url: frontmatter.coverPhoto, alt: frontmatter.coverPhotoAlt ?? '', line: null });
    }
  }

  const body = frontmatterMatch ? raw.slice(frontmatterMatch[0].length) : raw;
  for (const match of body.matchAll(BODY_IMAGE_RE)) {
    images.push({ kind: 'body', url: match[2], alt: match[1], line: match[0] });
  }

  return images;
}
