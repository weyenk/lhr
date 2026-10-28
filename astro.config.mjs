import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

export default defineConfig({
  integrations: [mdx()],
  adapter: vercel({
    isr: {
      expiration: 300,
      bypassToken: process.env.ISR_BYPASS_TOKEN,
      exclude: ['/preview/[id]'],
    },
  }),
  vite: {
    plugins: [tailwindcss()],
  },
});
