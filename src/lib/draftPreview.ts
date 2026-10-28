import { getPool, getPostDraftById } from '@lhr/db';
import { postSchema } from '@lhr/schemas';
import { buildPostFrontmatter } from 'lhr-authoring-mcp-server/dist-lib/render.js';
import { markdownToSafeHtml } from './markdown';
import type { PostView } from './postView';

export async function getDraftPostView(draftId: string): Promise<PostView | null> {
  const row = await getPostDraftById(getPool(), draftId);
  if (!row?.type) {
    return null;
  }

  const frontmatter = buildPostFrontmatter(row.draft);
  const parsed = postSchema.safeParse(frontmatter);
  if (!parsed.success) {
    return null;
  }

  const bodyHtml =
    row.draft.postType === 'recipe' && row.draft.narrativeBody?.trim()
      ? markdownToSafeHtml(row.draft.narrativeBody)
      : null;

  return {
    id: draftId,
    data: parsed.data,
    bodyHtml,
  };
}
