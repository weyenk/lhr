import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import AffiliateDisclosureBanner from '../../src/components/AffiliateDisclosureBanner.astro';

describe('AffiliateDisclosureBanner', () => {
  it('discloses that the page contains affiliate links', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(AffiliateDisclosureBanner);
    expect(html).toContain('affiliate link');
  });

  it('links to the full affiliate disclosure page', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(AffiliateDisclosureBanner);
    expect(html).toContain('href="/affiliate-disclosure/"');
  });

  it('is identifiable by a dedicated banner class', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(AffiliateDisclosureBanner);
    expect(html).toMatch(/class="affiliate-disclosure-banner/);
  });
});
