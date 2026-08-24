import { z } from 'zod';

const basePostFields = {
  title: z.string(),
  date: z.coerce.date(),
  coverPhoto: z.string().url(),
  coverPhotoAlt: z.string(),
  excerpt: z.string().optional(),
  kitchenwareIds: z.array(z.string()).default([]),
  affiliateLinkIds: z.array(z.string()).default([]),
};

export const recipeVariantSchema = z.object({
  diet: z.enum([
    'original', 'gluten-free', 'vegan', 'vegetarian',
    'pescatarian', 'low-carb', 'low-salt', 'low-fat',
  ]),
  ingredients: z.array(z.object({ item: z.string(), amount: z.string().optional() })).min(1),
  steps: z.array(z.string()).min(1),
  notes: z.string().optional(),
});

export const recipePostSchema = z.object({
  type: z.literal('recipe'),
  ...basePostFields,
  yields: z.number().int().positive().optional(),
  yieldsUnit: z.string().optional(),
  prepMinutes: z.number().int().positive().optional(),
  cookMinutes: z.number().int().positive().optional(),
  ingredients: z
    .array(
      z.object({
        item: z.string(),
        amount: z.string().optional(),
      }),
    )
    .min(1),
  steps: z.array(z.string()).min(1),
  variants: z.array(recipeVariantSchema).optional(),
  sourceMealDbId: z.string().optional(),
});

export const articlePostSchema = z.object({
  type: z.literal('article'),
  ...basePostFields,
  sections: z
    .array(
      z.object({
        heading: z.string(),
        body: z.string(),
      }),
    )
    .min(1),
});

export const postSchema = z.discriminatedUnion('type', [recipePostSchema, articlePostSchema]);

export const productSchema = z.object({
  name: z.string(),
  priceCents: z.number().int().positive(),
  image: z.string().url(),
  imageAlt: z.string(),
  vendorUrl: z.string().url(),
  setId: z.string(),
});

export const affiliateLinkSchema = z.object({
  label: z.string(),
  url: z.string().url(),
  tag: z.string(),
  image: z.string().url().optional(),
  imageAlt: z.string().optional(),
});

export const ingredientLinkSchema = z.object({
  ingredient: z.string().min(1),
  affiliateLinkId: z.string().min(1),
});

export const setSchema = z.object({
  name: z.string(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

export type PostData = z.infer<typeof postSchema>;
export type ProductData = z.infer<typeof productSchema>;
export type AffiliateLinkData = z.infer<typeof affiliateLinkSchema>;
export type IngredientLinkData = z.infer<typeof ingredientLinkSchema>;
export type SetData = z.infer<typeof setSchema>;
export type RecipeVariantData = z.infer<typeof recipeVariantSchema>;
