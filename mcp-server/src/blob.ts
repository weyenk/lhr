import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function getR2Client(): S3Client {
  const accountId = requireEnv('R2_ACCOUNT_ID');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
  });
}

export async function storeImageBuffer(buffer: Buffer, contentType: string): Promise<string> {
  if (!contentType.startsWith('image/')) {
    throw new Error(`Unsupported content type (expected an image, got ${contentType || 'unknown'})`);
  }
  if (buffer.byteLength > MAX_PHOTO_BYTES) {
    throw new Error(`Photo is too large (${buffer.byteLength} bytes, max ${MAX_PHOTO_BYTES})`);
  }

  const extension = contentType.split('/')[1]?.split(';')[0] ?? 'jpg';
  const key = `posts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: requireEnv('R2_BUCKET_NAME'),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  return `${requireEnv('R2_PUBLIC_URL').replace(/\/$/, '')}/${key}`;
}

export async function fetchAndStorePhoto(photoUrl: string): Promise<string> {
  const response = await fetch(photoUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch photo from ${photoUrl}: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const arrayBuffer = await response.arrayBuffer();
  return storeImageBuffer(Buffer.from(arrayBuffer), contentType);
}
