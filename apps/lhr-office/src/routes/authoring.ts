import express from 'express';
import type { Queryable, PostType } from '@lhr/db';
import {
  getPostById,
  insertPostDraft,
  getPostDraftForAuthor,
  listPostDraftsByAuthor,
  updatePostDraft,
  upsertPost,
} from '@lhr/db';
import { ZodError, type ZodError as ZodErrorType } from 'zod';
import { draftPostSchema, postSchema, type DraftPost } from '@lhr/schemas';
import { buildPostFrontmatter } from 'lhr-authoring-mcp-server/dist-lib/render.js';
import { storeImageBuffer } from 'lhr-authoring-mcp-server/dist-lib/blob.js';
import { markdownToSafeHtml } from '../markdown.js';
import { signPreviewToken } from '../previewToken.js';
import { revalidatePublishedPost } from '../revalidate.js';
import { uniqueSlugForTitle } from '../slug.js';

function emptyDraft(postType: PostType, title: string): DraftPost {
  return draftPostSchema.parse({
    kind: 'post',
    postType,
    title,
  });
}

function zodFieldErrors(error: ZodErrorType) {
  return error.flatten();
}

export function createAuthoringRouter(db: Queryable): express.Router {
  const router = express.Router();

  router.post('/drafts', async (req, res) => {
    const authorSub = req.authorSub;
    if (!authorSub) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const type = req.body?.type;
    const title = typeof req.body?.title === 'string' ? req.body.title : '';
    if (type !== 'recipe' && type !== 'article') {
      res.status(400).json({ error: 'type must be recipe or article' });
      return;
    }

    try {
      const row = await insertPostDraft(db, {
        authorSub,
        type,
        draft: emptyDraft(type, title),
      });
      res.status(201).json({ draftId: row.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.get('/drafts', async (req, res) => {
    const authorSub = req.authorSub;
    if (!authorSub) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    try {
      const rows = await listPostDraftsByAuthor(db, authorSub);
      res.json(rows);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.get('/drafts/:id', async (req, res) => {
    const authorSub = req.authorSub;
    if (!authorSub) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    try {
      const row = await getPostDraftForAuthor(db, req.params.id, authorSub);
      if (!row) {
        res.status(404).json({ error: 'draft not found' });
        return;
      }
      res.json(row);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.patch('/drafts/:id', async (req, res) => {
    const authorSub = req.authorSub;
    if (!authorSub) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    try {
      const existing = await getPostDraftForAuthor(db, req.params.id, authorSub);
      if (!existing) {
        res.status(404).json({ error: 'draft not found' });
        return;
      }

      const { kind: _kind, postType: _postType, ...patch } = req.body ?? {};
      const merged = draftPostSchema.parse({
        ...existing.draft,
        ...patch,
        kind: 'post',
        postType: existing.draft.postType,
      });

      const updated = await updatePostDraft(db, req.params.id, authorSub, {
        type: existing.type,
        draft: merged,
      });
      if (!updated) {
        res.status(404).json({ error: 'draft not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: 'invalid draft', ...zodFieldErrors(err) });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.post('/drafts/:id/photo', async (req, res) => {
    const authorSub = req.authorSub;
    if (!authorSub) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    try {
      const existing = await getPostDraftForAuthor(db, req.params.id, authorSub);
      if (!existing) {
        res.status(404).json({ error: 'draft not found' });
        return;
      }

      const contentType = typeof req.body?.contentType === 'string' ? req.body.contentType : '';
      const imageBase64 = typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64 : '';
      const caption = typeof req.body?.caption === 'string' ? req.body.caption : undefined;

      if (!contentType || !imageBase64) {
        res.status(400).json({ error: 'contentType and imageBase64 are required' });
        return;
      }

      const buffer = Buffer.from(imageBase64, 'base64');
      const url = await storeImageBuffer(buffer, contentType);

      const draft = draftPostSchema.parse({
        ...existing.draft,
        photos: [...existing.draft.photos, { url, caption }],
      });

      const updated = await updatePostDraft(db, req.params.id, authorSub, {
        type: existing.type,
        draft,
      });
      if (!updated) {
        res.status(404).json({ error: 'draft not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.post('/drafts/:id/preview-token', async (req, res) => {
    const authorSub = req.authorSub;
    if (!authorSub) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    try {
      const existing = await getPostDraftForAuthor(db, req.params.id, authorSub);
      if (!existing) {
        res.status(404).json({ error: 'draft not found' });
        return;
      }

      const signed = signPreviewToken(req.params.id);
      res.json(signed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.post('/drafts/:id/publish', async (req, res) => {
    const authorSub = req.authorSub;
    if (!authorSub) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    try {
      const existing = await getPostDraftForAuthor(db, req.params.id, authorSub);
      if (!existing) {
        res.status(404).json({ error: 'draft not found' });
        return;
      }

      const draft = existing.draft;
      if (!draft.title.trim()) {
        res.status(422).json({
          error: 'validation_failed',
          fieldErrors: { title: ['Title is required'] },
          formErrors: [],
        });
        return;
      }
      if (draft.photos.length === 0) {
        res.status(422).json({
          error: 'validation_failed',
          fieldErrors: { photos: ['At least one photo is required'] },
          formErrors: [],
        });
        return;
      }

      const frontmatter = buildPostFrontmatter(draft);
      const parsed = postSchema.safeParse(frontmatter);
      if (!parsed.success) {
        res.status(422).json({ error: 'validation_failed', ...zodFieldErrors(parsed.error) });
        return;
      }

      const excludePostId = existing.postId;
      const slug = await uniqueSlugForTitle(db, draft.title, excludePostId);

      let revision = 1;
      if (existing.postId) {
        const prior = await getPostById(db, existing.postId);
        if (prior) revision = prior.revision + 1;
      }

      const bodyHtml =
        draft.postType === 'recipe' && draft.narrativeBody?.trim()
          ? markdownToSafeHtml(draft.narrativeBody)
          : null;

      const published = await upsertPost(db, {
        id: existing.postId ?? undefined,
        slug,
        type: draft.postType,
        title: draft.title,
        data: parsed.data,
        bodyHtml,
        status: 'published',
        publishedAt: new Date(),
        revision,
      });

      await revalidatePublishedPost(published.slug);

      const siteBase = process.env.SITE_BASE_URL?.replace(/\/$/, '') ?? '';
      const url = siteBase ? `${siteBase}/posts/${published.slug}/` : `/posts/${published.slug}/`;

      res.json({ slug: published.slug, url });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
