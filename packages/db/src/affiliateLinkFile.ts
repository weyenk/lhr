import { affiliateLinkSchema } from '@lhr/schemas';

export interface AffiliateLinkFileInput {
  asin: string;
  title: string;
  imageUrl: string;
}

export function slugifyProductTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function affiliateLinkFilename(candidate: AffiliateLinkFileInput): string {
  const suffix = candidate.asin.slice(-4).toLowerCase();
  return `${slugifyProductTitle(candidate.title)}-${suffix}.json`;
}

export function buildAffiliateLinkFile(
  candidate: AffiliateLinkFileInput,
  associatesTag: string,
): { path: string; content: string } {
  const url = `https://www.amazon.com/dp/${candidate.asin}?tag=${associatesTag}`;
  const data: Record<string, string> = {
    label: candidate.title,
    url,
    tag: slugifyProductTitle(candidate.title),
  };
  if (candidate.imageUrl) {
    data.image = candidate.imageUrl;
    data.imageAlt = candidate.title;
  }

  const parsed = affiliateLinkSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Built affiliate-link data failed schema validation: ${parsed.error.message}`);
  }

  return {
    path: `src/content/affiliate-links/${affiliateLinkFilename(candidate)}`,
    content: JSON.stringify(data, null, 2),
  };
}
