import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { getCollection } from 'astro:content';
import { beforeAll, describe, expect, it } from 'vitest';
import RecipeLayout from '../../src/layouts/RecipeLayout.astro';
import { loadPostViewBySlug } from '../fixtures/contentPostViews';

const ARANCINI_SLUG = 'arancini-a-sicilian-street-food-sensation';

describe('recipe post page', () => {
  let post: ReturnType<typeof loadPostViewBySlug>;
  let products: Awaited<ReturnType<typeof getCollection<'products'>>>;
  let affiliateLinks: Awaited<ReturnType<typeof getCollection<'affiliateLinks'>>>;

  beforeAll(async () => {
    post = loadPostViewBySlug(ARANCINI_SLUG);
    products = await getCollection('products');
    affiliateLinks = await getCollection('affiliateLinks');
  });

  async function renderAranciniRecipe(): Promise<string> {
    const container = await AstroContainer.create();
    return container.renderToString(RecipeLayout, {
      props: { post, products, affiliateLinks },
    });
  }

  it('renders the recipe post with its ingredients and steps', async () => {
    const html = await renderAranciniRecipe();
    expect(html).toContain('Arancini: A Sicilian Street Food Sensation');
    expect(html).toContain('Arborio rice');
    expect(html).toContain('Fry arancini in batches for 3-4 minutes');
  });

  it('wraps steps and ingredients in a two-column layout grid', async () => {
    const html = await renderAranciniRecipe();
    expect(html).toContain('recipe-post__layout');
    expect(html).toContain('grid-cols-12');
  });

  it('gives the ingredients card the shared shadow-card styling, not a border', async () => {
    const html = await renderAranciniRecipe();
    expect(html).toMatch(/class="recipe-post__ingredients[^"]*shadow-md/);
  });

  it('stacks ingredients above steps on mobile while preserving desktop column order', async () => {
    const html = await renderAranciniRecipe();
    expect(html).toMatch(/class="order-2 md:order-none md:col-span-8"[\s\S]*recipe-post__steps/);
    expect(html).toMatch(/class="order-1 md:order-none md:col-span-4"[\s\S]*recipe-post__ingredients/);
  });
});
