import type { ImageEditProvider } from './types.js';
import { openrouterFreeProvider } from './openrouterFreeProvider.js';

export type { ImageEditProvider } from './types.js';

const providers: Record<string, ImageEditProvider> = {
  'openrouter-free': openrouterFreeProvider,
};

export function getImageEditProvider(): ImageEditProvider {
  const key = process.env.IMAGE_EDIT_PROVIDER ?? 'openrouter-free';
  const provider = providers[key];
  if (!provider) throw new Error(`Unknown IMAGE_EDIT_PROVIDER: ${key}`);
  return provider;
}
