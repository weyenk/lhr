import type { PostData } from '@lhr/schemas';

/** Post shape consumed by listing cards and post layouts (slug is `id`). */
export interface PostView {
  id: string;
  data: PostData;
  bodyHtml?: string | null;
}
