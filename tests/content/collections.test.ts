import { describe, expect, it } from 'vitest';
import { getCollection } from 'astro:content';

describe('content collections', () => {
  it('loads the seed kitchenware set', async () => {
    const sets = await getCollection('sets');
    const coastalBlue = sets.find((s) => s.id === 'coastal-blue');
    expect(coastalBlue?.data.name).toBe('Coastal Blue');
  });

  it('loads the seed product and links it to its set', async () => {
    const products = await getCollection('products');
    const platter = products.find((p) => p.id === 'coastal-blue-platter');
    expect(platter?.data.setId).toBe('coastal-blue');
  });

  it('loads the seed affiliate link', async () => {
    const links = await getCollection('affiliateLinks');
    const jerkSeasoning = links.find((l) => l.id === 'jerk-seasoning');
    expect(jerkSeasoning?.data.tag).toBe('jerk-seasoning');
  });

  it('loads the seed ingredient link', async () => {
    const ingredientLinks = await getCollection('ingredientLinks');
    const jerkSeasoning = ingredientLinks.find((l) => l.id === 'jerk-seasoning');
    expect(jerkSeasoning?.data.affiliateLinkId).toBe('jerk-seasoning');
  });

  it('has no duplicate ingredient values in the ingredient-links collection', async () => {
    const ingredientLinks = await getCollection('ingredientLinks');
    const values = ingredientLinks.map((l) => l.data.ingredient);
    expect(new Set(values).size).toBe(values.length);
  });

  it('every ingredient-link points at an affiliate-link that actually exists', async () => {
    const ingredientLinks = await getCollection('ingredientLinks');
    const affiliateLinks = await getCollection('affiliateLinks');
    const affiliateLinkIds = new Set(affiliateLinks.map((l) => l.id));
    for (const link of ingredientLinks) {
      expect(affiliateLinkIds.has(link.data.affiliateLinkId)).toBe(true);
    }
  });
});
