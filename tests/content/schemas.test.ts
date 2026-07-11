import { describe, expect, it } from 'vitest';
import {
  recipePostSchema,
  articlePostSchema,
  productSchema,
  affiliateLinkSchema,
  setSchema,
} from '../../src/content/schemas';

describe('recipePostSchema', () => {
  it('accepts a valid recipe post', () => {
    const result = recipePostSchema.safeParse({
      type: 'recipe',
      title: 'Jerk Chicken for a Crowd',
      date: '2026-07-01',
      coverPhoto: 'https://example.com/jerk-chicken.jpg',
      coverPhotoAlt: 'Jerk chicken on a platter',
      kitchenwareIds: ['coastal-blue-platter'],
      affiliateLinkIds: ['jerk-seasoning'],
      ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
      steps: ['Marinate overnight.', 'Grill over indirect heat.'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a recipe post with no steps', () => {
    const result = recipePostSchema.safeParse({
      type: 'recipe',
      title: 'Jerk Chicken for a Crowd',
      date: '2026-07-01',
      coverPhoto: 'https://example.com/jerk-chicken.jpg',
      coverPhotoAlt: 'Jerk chicken on a platter',
      ingredients: [{ item: 'Chicken thighs' }],
      steps: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('articlePostSchema', () => {
  it('accepts a valid article post without ingredients/steps', () => {
    const result = articlePostSchema.safeParse({
      type: 'article',
      title: 'Why We Chose the Coastal Blue Set',
      date: '2026-07-01',
      coverPhoto: 'https://example.com/set-hero.jpg',
      coverPhotoAlt: 'The Coastal Blue kitchenware set styled on a table',
    });
    expect(result.success).toBe(true);
  });
});

describe('productSchema', () => {
  it('accepts a valid product', () => {
    const result = productSchema.safeParse({
      name: 'Coastal Blue Serving Platter',
      priceCents: 4800,
      image: 'https://example.com/platter.jpg',
      imageAlt: 'A coastal blue ceramic serving platter',
      vendorUrl: 'https://vendor.example.com/coastal-blue-platter',
      setId: 'coastal-blue',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a negative price', () => {
    const result = productSchema.safeParse({
      name: 'Coastal Blue Serving Platter',
      priceCents: -100,
      image: 'https://example.com/platter.jpg',
      imageAlt: 'A coastal blue ceramic serving platter',
      vendorUrl: 'https://vendor.example.com/coastal-blue-platter',
      setId: 'coastal-blue',
    });
    expect(result.success).toBe(false);
  });
});

describe('affiliateLinkSchema', () => {
  it('accepts a valid affiliate link', () => {
    const result = affiliateLinkSchema.safeParse({
      label: 'The jerk seasoning we used',
      url: 'https://vendor.example.com/jerk-seasoning',
      tag: 'jerk-seasoning',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed URL', () => {
    const result = affiliateLinkSchema.safeParse({
      label: 'The jerk seasoning we used',
      url: 'not-a-url',
      tag: 'jerk-seasoning',
    });
    expect(result.success).toBe(false);
  });
});

describe('setSchema', () => {
  it('accepts a valid kitchenware set', () => {
    const result = setSchema.safeParse({
      name: 'Coastal Blue',
      startDate: '2026-07-01',
      endDate: '2026-12-31',
      productIds: ['coastal-blue-platter'],
    });
    expect(result.success).toBe(true);
  });
});
