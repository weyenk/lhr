import { z } from 'astro:content';

const basePostFields = {
  title: z.string(),
  date: z.coerce.date(),
  coverPhoto: z.string().url(),
  coverPhotoAlt: z.string(),
  excerpt: z.string().optional(),
  kitchenwareIds: z.array(z.string()).default([]),
  affiliateLinkIds: z.array(z.string()).default([]),
};

export const recipePostSchema = z.object({
  type: z.literal('recipe'),
  ...basePostFields,
  ingredients: z
    .array(
      z.object({
        item: z.string(),
        amount: z.string().optional(),
      }),
    )
    .min(1),
  steps: z.array(z.string()).min(1),
});

export const articlePostSchema = z.object({
  type: z.literal('article'),
  ...basePostFields,
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
});

export const setSchema = z.object({
  name: z.string(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

export type PostData = z.infer<typeof postSchema>;
export type ProductData = z.infer<typeof productSchema>;
export type AffiliateLinkData = z.infer<typeof affiliateLinkSchema>;
export type SetData = z.infer<typeof setSchema>;
