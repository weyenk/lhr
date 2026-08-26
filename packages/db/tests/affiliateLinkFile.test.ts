import { describe, expect, it } from 'vitest';
import { affiliateLinkSchema } from '@lhr/schemas';
import { buildAffiliateLinkFile, affiliateLinkFilename, slugifyProductTitle } from '../src/affiliateLinkFile';

const candidate = { asin: 'B0EXAMPLE1', title: 'Ceramic Mixing Bowl Set (3-Pack)', imageUrl: 'https://example.com/bowl.jpg' };

describe('slugifyProductTitle', () => {
  it('lowercases and hyphenates, stripping punctuation', () => {
    expect(slugifyProductTitle('Ceramic Mixing Bowl Set (3-Pack)')).toBe('ceramic-mixing-bowl-set-3-pack');
  });
});

describe('affiliateLinkFilename', () => {
  it('combines the slugified title with the last 4 chars of the ASIN', () => {
    expect(affiliateLinkFilename(candidate)).toBe('ceramic-mixing-bowl-set-3-pack-ple1.json');
  });
});

describe('buildAffiliateLinkFile', () => {
  it('builds a schema-valid affiliate-links file under the expected path', () => {
    const file = buildAffiliateLinkFile(candidate, 'lhr-20');
    expect(file.path).toBe('src/content/affiliate-links/ceramic-mixing-bowl-set-3-pack-ple1.json');
    const data = JSON.parse(file.content);
    expect(affiliateLinkSchema.safeParse(data).success).toBe(true);
    expect(data.url).toBe('https://www.amazon.com/dp/B0EXAMPLE1?tag=lhr-20');
    expect(data.label).toBe('Ceramic Mixing Bowl Set (3-Pack)');
    expect(data.image).toBe('https://example.com/bowl.jpg');
  });

  it('omits image/imageAlt (rather than emitting an invalid URL) when the candidate has no image', () => {
    const file = buildAffiliateLinkFile({ ...candidate, imageUrl: '' }, 'lhr-20');
    const data = JSON.parse(file.content);
    expect(affiliateLinkSchema.safeParse(data).success).toBe(true);
    expect(data.image).toBeUndefined();
    expect(data.imageAlt).toBeUndefined();
  });

  it('throws rather than returning a schema-invalid file when imageUrl is a non-empty, malformed URL', () => {
    expect(() => buildAffiliateLinkFile({ ...candidate, imageUrl: 'not-a-url' }, 'lhr-20')).toThrow(/schema validation/);
  });
});
