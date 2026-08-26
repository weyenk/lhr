import { describe, expect, it } from 'vitest';
import { enumeratePostImages } from '../src/postImages';

const withCoverAndBody = `---
title: "Test"
coverPhoto: "https://example.com/cover.jpg"
coverPhotoAlt: "Cover alt text"
---

Some intro text.

![First body photo](https://example.com/body1.jpg)

More text.

![Second body photo](https://example.com/body2.jpg)
`;

const coverOnly = `---
title: "Test"
coverPhoto: "https://example.com/cover.jpg"
coverPhotoAlt: "Cover alt text"
---

No body images here, just prose.
`;

// A blank line between the frontmatter delimiters is a genuinely empty YAML document:
// js-yaml's \`load\` returns \`undefined\` for it (verified directly), which is what makes this
// fixture exercise the crash path — a frontmatter block with the two \`---\` lines immediately
// adjacent (no blank line between them) doesn't match the frontmatter regex at all, so it
// wouldn't reach the \`yaml.load\` call this test is meant to guard.
const emptyFrontmatter = `---

---

Some body text.
`;

const duplicateUrls = `---
title: "Test"
coverPhoto: "https://example.com/cover.jpg"
coverPhotoAlt: "Cover alt text"
---

![First occurrence](https://example.com/same.jpg)

![Second occurrence](https://example.com/same.jpg)
`;

describe('enumeratePostImages', () => {
  it('returns the cover photo followed by each body image in document order', () => {
    const images = enumeratePostImages(withCoverAndBody);
    expect(images).toEqual([
      { kind: 'cover', url: 'https://example.com/cover.jpg', alt: 'Cover alt text', line: null },
      {
        kind: 'body', url: 'https://example.com/body1.jpg', alt: 'First body photo',
        line: '![First body photo](https://example.com/body1.jpg)',
      },
      {
        kind: 'body', url: 'https://example.com/body2.jpg', alt: 'Second body photo',
        line: '![Second body photo](https://example.com/body2.jpg)',
      },
    ]);
  });

  it('returns only the cover photo when the post has zero body images', () => {
    const images = enumeratePostImages(coverOnly);
    expect(images).toEqual([
      { kind: 'cover', url: 'https://example.com/cover.jpg', alt: 'Cover alt text', line: null },
    ]);
  });

  it('returns an empty list, not a throw, when frontmatter parses to no usable object (empty YAML document)', () => {
    const images = enumeratePostImages(emptyFrontmatter);
    expect(images).toEqual([]);
  });

  it('distinguishes two body images sharing the same URL by their distinct lines', () => {
    const images = enumeratePostImages(duplicateUrls);
    const bodyImages = images.filter((img) => img.kind === 'body');
    expect(bodyImages).toHaveLength(2);
    expect(bodyImages[0].line).toBe('![First occurrence](https://example.com/same.jpg)');
    expect(bodyImages[1].line).toBe('![Second occurrence](https://example.com/same.jpg)');
  });
});
