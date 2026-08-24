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
  const data = {
    label: candidate.title,
    url,
    tag: slugifyProductTitle(candidate.title),
    image: candidate.imageUrl,
    imageAlt: candidate.title,
  };
  return {
    path: `src/content/affiliate-links/${affiliateLinkFilename(candidate)}`,
    content: JSON.stringify(data, null, 2),
  };
}
