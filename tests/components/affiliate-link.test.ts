import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import AffiliateLink from '../../src/components/AffiliateLink.astro';

const baseData = {
  label: 'The jerk seasoning we used',
  url: 'https://vendor.example.com/jerk-seasoning',
  tag: 'jerk-seasoning',
};

describe('AffiliateLink card', () => {
  it('does not print the literal "(affiliate link)" disclosure text on the card', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(AffiliateLink, {
      props: { id: 'jerk-seasoning', data: baseData },
    });
    expect(html).not.toContain('(affiliate link)');
  });

  it('renders the link label and destination', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(AffiliateLink, {
      props: { id: 'jerk-seasoning', data: baseData },
    });
    expect(html).toContain('The jerk seasoning we used');
    expect(html).toContain('href="https://vendor.example.com/jerk-seasoning"');
    expect(html).toContain('data-umami-event="affiliate-click"');
  });

  it('renders a product image when image data is present', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(AffiliateLink, {
      props: {
        id: 'jerk-seasoning',
        data: {
          ...baseData,
          image: 'https://placehold.co/800x600?text=Jerk+Seasoning',
          imageAlt: 'A jar of the jerk seasoning blend',
        },
      },
    });
    expect(html).toContain('src="https://placehold.co/800x600?text=Jerk+Seasoning"');
    expect(html).toContain('alt="A jar of the jerk seasoning blend"');
  });

  it('omits the image element when no image data is present', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(AffiliateLink, {
      props: { id: 'jerk-seasoning', data: baseData },
    });
    expect(html).not.toContain('<img');
  });

  it('gives the card the shared shadow-card styling', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(AffiliateLink, {
      props: { id: 'jerk-seasoning', data: baseData },
    });
    expect(html).toMatch(/class="affiliate-link[^"]*rounded-lg[^"]*shadow-md/);
  });
});
