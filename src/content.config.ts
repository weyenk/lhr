import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { postSchema, productSchema, affiliateLinkSchema, setSchema, ingredientLinkSchema } from './content/schemas';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/posts' }),
  schema: postSchema,
});

const products = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/products' }),
  schema: productSchema,
});

const affiliateLinks = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/affiliate-links' }),
  schema: affiliateLinkSchema,
});

const sets = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/sets' }),
  schema: setSchema,
});

const ingredientLinks = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/ingredient-links' }),
  schema: ingredientLinkSchema,
});

export const collections = { posts, products, affiliateLinks, sets, ingredientLinks };
