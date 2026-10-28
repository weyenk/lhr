import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';
import { postSchema } from '@lhr/schemas';
import type { PostView } from '../../src/lib/postView';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const postsDir = path.join(__dirname, '../../src/content/posts');

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

/** Published-post order used by `tests/pages/home.test.ts` (stable vs live DB). */
export const HOME_PAGE_POST_SLUGS = [
  'double-fried-sesame-chicken-recreating-an-atlanta-favorite-at-home',
  'pollo-alla-cacciatora',
  'smothered-in-green-a-30-minute-burrito-for-long-day-nights',
  'egg-roll-in-a-bowl',
  'southwest-burritos-with-southwest-ranch-dipping-sauce',
  'corn-dogs-under-the-grandstand-lights-a-wisconsin-state-fair-summer',
  'hugo-spritz',
  'when-gray-skies-call-for-warm-spice-an-apple-cinnamon-muffin-story',
  'date-night-chicken-crust-pizza-with-whiskey-caramelized-onions-amp-bacon',
  'oaxacan-velvet-the-grounding-ritual-of-chicken-mole-negro',
  'the-pursuit-of-wok-hei-sesame-chicken-at-home',
  'suan-la-fen-a-journey-to-the-heart-of-sichuan-from-my-own-kitchen',
  'lemon-pepper-wet-an-atlanta-homecoming',
  'pistachio-granita-with-brioche-con-tuppo-a-sicilian-morning-ritual',
  'chi-town-heat-a-spicy-homage-to-portillos',
  'from-atlanta-with-flavor-maple-candied-apple-burger-with-bourbon-bacon-jam',
  'an-homage-to-my-new-city',
  'taquitos-togetherness-and-a-taste-of-home',
  'taiyaki-and-tranquility-a-kyoto-comfort',
  'empanada-de-pato-a-colombian-culinary-adventure',
  'elevate-your-pizza-night-fig-arugula-and-feta-flatbread',
  'the-aussie-meat-pie-of-my-childhood-dreams-and-how-i-finally-made-it-real',
  'poncha-ed-under-the-portuguese-sun-a-madeira-misadventure',
  'omurice-at-pompompurin-cafe-a-culinary-adventure-in-the-hello-kitty-universe',
  'ramen-with-a-view-a-culinary-adventure-in-shibuya',
  'fueled-by-deep-dish-conquering-the-chicago-cold',
  'chili-con-carne-over-tatties-roadside-rescue-culinary-reward',
  'my-culinary-journey-to-madeira-discovering-the-perfect-prego-sandwich',
  'arancini-a-sicilian-street-food-sensation',
] as const;

function parseMdxPostView(slug: string): PostView {
  const filePath = path.join(postsDir, `${slug}.mdx`);
  const content = readFileSync(filePath, 'utf-8');
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error(`MDX file missing frontmatter: ${slug}`);
  }
  const data = postSchema.parse(loadYaml(match[1]));
  return { id: slug, data, bodyHtml: null };
}

export function loadHomePagePostViews(): PostView[] {
  return HOME_PAGE_POST_SLUGS.map(parseMdxPostView);
}

export function loadPostViewBySlug(slug: string): PostView {
  return parseMdxPostView(slug);
}
