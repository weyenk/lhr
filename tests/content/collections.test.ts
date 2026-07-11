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
});
