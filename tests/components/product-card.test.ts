import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import ProductCard from '../../src/components/ProductCard.astro';

const data = {
  name: 'Coastal Blue Serving Platter',
  priceCents: 4800,
  image: 'https://placehold.co/800x600?text=Coastal+Blue+Platter',
  imageAlt: 'A coastal blue ceramic serving platter',
  vendorUrl: 'https://vendor.example.com/coastal-blue-platter',
  setId: 'coastal-blue',
};

describe('ProductCard', () => {
  it('does not print the literal "(affiliate link)" disclosure text on the card', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(ProductCard, {
      props: { id: 'coastal-blue-platter', data },
    });
    expect(html).not.toContain('(affiliate link)');
  });

  it('still renders the product name, price, and image', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(ProductCard, {
      props: { id: 'coastal-blue-platter', data },
    });
    expect(html).toContain('Coastal Blue Serving Platter');
    expect(html).toContain('$48.00');
    expect(html).toContain('src="https://placehold.co/800x600?text=Coastal+Blue+Platter"');
  });
});
