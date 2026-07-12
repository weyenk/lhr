import { put } from '@vercel/blob';

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

export async function fetchAndStorePhoto(photoUrl: string): Promise<string> {
  const response = await fetch(photoUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch photo from ${photoUrl}: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`URL did not return an image (content-type: ${contentType || 'unknown'})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_PHOTO_BYTES) {
    throw new Error(`Photo is too large (${arrayBuffer.byteLength} bytes, max ${MAX_PHOTO_BYTES})`);
  }

  const buffer = Buffer.from(arrayBuffer);
  const extension = contentType.split('/')[1]?.split(';')[0] ?? 'jpg';
  const filename = `posts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const blob = await put(filename, buffer, { access: 'public', contentType });
  return blob.url;
}
