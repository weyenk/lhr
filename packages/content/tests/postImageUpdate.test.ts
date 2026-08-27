import { describe, expect, it } from 'vitest';
import { applyProductPlacement, StaleImageTargetError } from '../src/postImageUpdate';

const post = `---
title: "Test"
coverPhoto: "https://example.com/cover.jpg"
coverPhotoAlt: "Cover alt text"
affiliateLinkIds: []
---

Intro text.

![A body photo](https://example.com/body.jpg)

More text.
`;

describe('applyProductPlacement', () => {
  it('replaces the cover photo and adds the affiliate link id', () => {
    const result = applyProductPlacement(post, {
      targetImageKind: 'cover',
      targetImageUrl: 'https://example.com/cover.jpg',
      targetImageLine: null,
      compositedImageUrl: 'https://example.com/composited-cover.jpg',
      affiliateLinkId: 'bamboo-skewers-1234',
    });
    expect(result).toContain('coverPhoto: https://example.com/composited-cover.jpg');
    expect(result).toContain('bamboo-skewers-1234');
    expect(result).toContain('![A body photo](https://example.com/body.jpg)');
  });

  it('throws StaleImageTargetError when the cover photo has since changed', () => {
    expect(() =>
      applyProductPlacement(post, {
        targetImageKind: 'cover',
        targetImageUrl: 'https://example.com/a-different-cover.jpg',
        targetImageLine: null,
        compositedImageUrl: 'https://example.com/composited-cover.jpg',
        affiliateLinkId: 'bamboo-skewers-1234',
      }),
    ).toThrow(StaleImageTargetError);
  });

  it('replaces a body image line, leaving the rest of the body untouched', () => {
    const result = applyProductPlacement(post, {
      targetImageKind: 'body',
      targetImageUrl: 'https://example.com/body.jpg',
      targetImageLine: '![A body photo](https://example.com/body.jpg)',
      compositedImageUrl: 'https://example.com/composited-body.jpg',
      affiliateLinkId: 'bamboo-skewers-1234',
    });
    expect(result).toContain('![A body photo](https://example.com/composited-body.jpg)');
    expect(result).toContain('coverPhoto: https://example.com/cover.jpg');
    expect(result).toContain('bamboo-skewers-1234');
  });

  it('throws StaleImageTargetError when the target body line no longer exists', () => {
    expect(() =>
      applyProductPlacement(post, {
        targetImageKind: 'body',
        targetImageUrl: 'https://example.com/body.jpg',
        targetImageLine: '![A body photo that was edited](https://example.com/body.jpg)',
        compositedImageUrl: 'https://example.com/composited-body.jpg',
        affiliateLinkId: 'bamboo-skewers-1234',
      }),
    ).toThrow(StaleImageTargetError);
  });

  it('does not duplicate an affiliate link id that is already present', () => {
    const postWithId = post.replace('affiliateLinkIds: []', 'affiliateLinkIds:\n  - bamboo-skewers-1234');
    const result = applyProductPlacement(postWithId, {
      targetImageKind: 'cover',
      targetImageUrl: 'https://example.com/cover.jpg',
      targetImageLine: null,
      compositedImageUrl: 'https://example.com/composited-cover.jpg',
      affiliateLinkId: 'bamboo-skewers-1234',
    });
    expect(result.match(/bamboo-skewers-1234/g)).toHaveLength(1);
  });
});
