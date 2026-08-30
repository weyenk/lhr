import { describe, expect, it } from 'vitest';
import { recipeVariantSchema, postSchema } from '@lhr/schemas';

describe('recipeVariantSchema', () => {
  it('accepts a valid variant', () => {
    const result = recipeVariantSchema.safeParse({
      diet: 'vegan',
      ingredients: [{ item: 'Plant-based ground meat', amount: '1 lb' }],
      steps: ['Brown the plant-based meat.'],
      notes: 'Swapped ground beef for plant-based ground meat',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a variant with no ingredients', () => {
    const result = recipeVariantSchema.safeParse({
      diet: 'vegan',
      ingredients: [],
      steps: ['Brown the plant-based meat.'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a variant with no steps', () => {
    const result = recipeVariantSchema.safeParse({
      diet: 'vegan',
      ingredients: [{ item: 'Plant-based ground meat' }],
      steps: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid diet enum value', () => {
    const result = recipeVariantSchema.safeParse({
      diet: 'keto',
      ingredients: [{ item: 'Plant-based ground meat' }],
      steps: ['Brown it.'],
    });
    expect(result.success).toBe(false);
  });
});

describe('recipePostSchema variants/sourceMealDbId', () => {
  const baseRecipe = {
    type: 'recipe' as const,
    title: 'Teriyaki Chicken Casserole',
    date: '2026-01-01',
    coverPhoto: 'https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg',
    coverPhotoAlt: 'Teriyaki chicken casserole',
    kitchenwareIds: [],
    affiliateLinkIds: [],
    ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
    steps: ['Preheat oven to 350F.'],
  };

  it('accepts a recipe post with variants and a sourceMealDbId', () => {
    const result = postSchema.safeParse({
      ...baseRecipe,
      sourceMealDbId: '52772',
      variants: [
        { diet: 'original', ingredients: baseRecipe.ingredients, steps: baseRecipe.steps },
        { diet: 'vegan', ingredients: [{ item: 'Plant-based chicken', amount: '2 lbs' }], steps: ['Preheat oven to 350F.'] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('still accepts a recipe post with neither field (hand-authored posts keep working)', () => {
    const result = postSchema.safeParse(baseRecipe);
    expect(result.success).toBe(true);
  });
});
