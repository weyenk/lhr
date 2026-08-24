// tests/components/recipe-variant-tabs.test.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import RecipeVariantTabs from '../../src/components/RecipeVariantTabs.astro';

const variants = [
  { diet: 'original', ingredients: [{ item: 'Ground beef', amount: '1 lb' }], steps: ['Brown the beef.'] },
  {
    diet: 'vegan',
    ingredients: [{ item: 'Plant-based ground meat', amount: '1 lb' }],
    steps: ['Brown the plant-based meat.'],
    notes: 'Swapped ground beef for plant-based ground meat',
  },
];

describe('RecipeVariantTabs', () => {
  it('renders a tab button labeled for every variant', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(RecipeVariantTabs, { props: { variants, recipeMeta: '' } });
    expect(html).toContain('Original');
    expect(html).toContain('Vegan');
  });

  it('shows only the first variant panel by default and hides the rest', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(RecipeVariantTabs, { props: { variants, recipeMeta: '' } });

    const originalPanel = html.match(/<div[^>]*data-diet-panel="original"[^>]*>/)?.[0] ?? '';
    const veganPanel = html.match(/<div[^>]*data-diet-panel="vegan"[^>]*>/)?.[0] ?? '';
    expect(originalPanel).not.toContain('hidden');
    expect(veganPanel).toContain('hidden');
  });

  it('renders each panel with its own ingredients, steps, and notes', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(RecipeVariantTabs, { props: { variants, recipeMeta: '' } });
    expect(html).toContain('Brown the beef.');
    expect(html).toContain('Brown the plant-based meat.');
    expect(html).toContain('Swapped ground beef for plant-based ground meat');
  });
});
