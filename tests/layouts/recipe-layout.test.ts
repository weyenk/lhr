import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import RecipeLayout from '../../src/layouts/RecipeLayout.astro';

const basePost = {
  data: {
    type: 'recipe' as const,
    title: 'Teriyaki Chicken Casserole',
    date: new Date('2026-01-01'),
    coverPhoto: 'https://placehold.co/1200x800?text=Teriyaki',
    coverPhotoAlt: 'A bowl of teriyaki chicken casserole',
    kitchenwareIds: [],
    affiliateLinkIds: [],
    ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
    steps: ['Preheat oven to 350F.'],
  },
};

describe('RecipeLayout variant tabs', () => {
  it('renders the plain ingredients/steps layout when there are no variants', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(RecipeLayout, {
      props: { post: basePost, products: [], affiliateLinks: [] },
    });
    expect(html).not.toContain('recipe-variant-tabs');
    expect(html).toContain('Chicken thighs');
  });

  it('renders RecipeVariantTabs when variants are present', async () => {
    const postWithVariants = {
      data: {
        ...basePost.data,
        variants: [
          { diet: 'original', ingredients: basePost.data.ingredients, steps: basePost.data.steps },
          { diet: 'vegan', ingredients: [{ item: 'Plant-based chicken', amount: '2 lbs' }], steps: ['Preheat oven to 350F.'] },
        ],
      },
    };
    const container = await AstroContainer.create();
    const html = await container.renderToString(RecipeLayout, {
      props: { post: postWithVariants, products: [], affiliateLinks: [] },
    });
    expect(html).toContain('recipe-variant-tabs');
    expect(html).toContain('Plant-based chicken');
  });
});
