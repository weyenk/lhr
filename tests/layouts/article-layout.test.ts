import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import ArticleLayout from '../../src/layouts/ArticleLayout.astro';

const post = {
  data: {
    type: 'article' as const,
    title: 'Why We Chose the Coastal Blue Set',
    date: new Date('2025-01-01'),
    coverPhoto: 'https://placehold.co/1200x800?text=Coastal+Blue',
    coverPhotoAlt: 'The coastal blue set on a counter',
    excerpt: 'Every six months we rotate the set.',
    kitchenwareIds: ['coastal-blue-platter'],
    affiliateLinkIds: ['jerk-seasoning'],
    sections: [{ heading: 'Why we chose it', body: 'Every six months we rotate the set.' }],
  },
};

const products = [
  {
    id: 'coastal-blue-platter',
    data: {
      name: 'Coastal Blue Serving Platter',
      priceCents: 4800,
      image: 'https://placehold.co/800x600?text=Coastal+Blue+Platter',
      imageAlt: 'A coastal blue ceramic serving platter',
      vendorUrl: 'https://vendor.example.com/coastal-blue-platter',
      setId: 'coastal-blue',
    },
  },
];

const affiliateLinks = [
  {
    id: 'jerk-seasoning',
    data: {
      label: 'The jerk seasoning we used',
      url: 'https://vendor.example.com/jerk-seasoning',
      tag: 'jerk-seasoning',
    },
  },
];

describe('ArticleLayout affiliate disclosure banner', () => {
  it('shows the disclosure banner when the post has linked kitchenware or affiliate links', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(ArticleLayout, {
      props: { post, products, affiliateLinks },
    });
    expect(html).toContain('affiliate-disclosure-banner');
  });

  it('omits the disclosure banner when the post has no linked kitchenware or affiliate links', async () => {
    const container = await AstroContainer.create();
    const barePost = { data: { ...post.data, kitchenwareIds: [], affiliateLinkIds: [] } };
    const html = await container.renderToString(ArticleLayout, {
      props: { post: barePost, products, affiliateLinks },
    });
    expect(html).not.toContain('affiliate-disclosure-banner');
  });
});
