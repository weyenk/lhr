import yaml from 'js-yaml';

export class StaleImageTargetError extends Error {
  constructor() {
    super('The target image no longer matches the current post content; refusing to update.');
    this.name = 'StaleImageTargetError';
  }
}

export interface ProductPlacementUpdate {
  targetImageKind: 'cover' | 'body';
  targetImageUrl: string;
  targetImageLine: string | null;
  compositedImageUrl: string;
  affiliateLinkId: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

export function applyProductPlacement(raw: string, update: ProductPlacementUpdate): string {
  const frontmatterMatch = raw.match(FRONTMATTER_RE);
  if (!frontmatterMatch) throw new Error('No frontmatter delimiters found in post content');

  const frontmatter = yaml.load(frontmatterMatch[1]) as Record<string, unknown>;
  const body = raw.slice(frontmatterMatch[0].length);

  const existingIds = Array.isArray(frontmatter.affiliateLinkIds) ? (frontmatter.affiliateLinkIds as string[]) : [];
  frontmatter.affiliateLinkIds = existingIds.includes(update.affiliateLinkId)
    ? existingIds
    : [...existingIds, update.affiliateLinkId];

  if (update.targetImageKind === 'cover') {
    if (frontmatter.coverPhoto !== update.targetImageUrl) throw new StaleImageTargetError();
    frontmatter.coverPhoto = update.compositedImageUrl;
    return `---\n${yaml.dump(frontmatter)}---\n${body}`;
  }

  if (!update.targetImageLine || !body.includes(update.targetImageLine)) {
    throw new StaleImageTargetError();
  }
  const newLine = update.targetImageLine.replace(/\(([^)]+)\)$/, `(${update.compositedImageUrl})`);
  const newBody = body.replace(update.targetImageLine, newLine);
  return `---\n${yaml.dump(frontmatter)}---\n${newBody}`;
}
