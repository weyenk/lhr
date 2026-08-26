import { requireEnv, storeImageBuffer } from '../blob.js';
import type { ImageEditProvider } from './types.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// A free, multimodal image-output-capable OpenRouter model as of this plan's writing.
// Confirm at implementation time that this (or an equivalent free model) is still available —
// free image-editing model availability on OpenRouter changes; that's exactly why this is a
// swappable, reviewed-before-publish step rather than a hardcoded assumption elsewhere.
const DEFAULT_MODEL = 'google/gemini-2.0-flash-exp:free';

interface OpenRouterImageChoice {
  message?: {
    images?: Array<{ type: 'image_url'; image_url: { url: string } }>;
  };
}

export const openrouterFreeProvider: ImageEditProvider = {
  async compositeProductIntoPhoto({ sourceImageUrl, productImageUrl, productName }) {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requireEnv('OPENROUTER_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.IMAGE_EDIT_MODEL ?? DEFAULT_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Composite this product ("${productName}") naturally into the scene of the first photo, matching its lighting and perspective.`,
              },
              { type: 'image_url', image_url: { url: sourceImageUrl } },
              { type: 'image_url', image_url: { url: productImageUrl } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      return { error: `OpenRouter request failed: ${response.status}` };
    }

    const data = (await response.json()) as { choices?: OpenRouterImageChoice[] };
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imageUrl) {
      return { error: 'OpenRouter response had no generated image' };
    }

    const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return { error: 'OpenRouter returned a non-data-URI image, which is not supported yet' };
    }
    const [, contentType, base64] = match;
    const resultImageUrl = await storeImageBuffer(Buffer.from(base64, 'base64'), contentType);
    return { resultImageUrl };
  },
};
