import { describe, expect, it } from 'vitest';
import { renderPostMdx } from '../src/render';
import type { DraftPost } from '../src/drafts';

describe('renderPostMdx', () => {
  it('renders recipe frontmatter with ingredients and steps', () => {
    const draft: DraftPost = {
      kind: 'post',
      postType: 'recipe',
      title: 'Jerk Chicken for a Crowd',
      ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
      steps: ['Marinate overnight.'],
      sections: [],
      photos: [{ url: 'https://blob.vercel-storage.com/posts/a.jpg', caption: 'Jerk chicken' }],
      kitchenwareIds: ['coastal-blue-platter'],
      affiliateLinkIds: ['jerk-seasoning'],
      pendingAffiliateLinks: [],
    };

    const mdx = renderPostMdx(draft);

    expect(mdx).toContain('type: recipe');
    expect(mdx).toContain('title: Jerk Chicken for a Crowd');
    expect(mdx).toContain('coverPhoto: https://blob.vercel-storage.com/posts/a.jpg');
    expect(mdx).toContain('item: Chicken thighs');
    expect(mdx).toContain('- Marinate overnight.');
    expect(mdx).toContain('- coastal-blue-platter');
    expect(mdx).toContain('- jerk-seasoning');
  });

  it('renders article frontmatter with sections instead of ingredients/steps', () => {
    const draft: DraftPost = {
      kind: 'post',
      postType: 'article',
      title: 'Why We Chose Coastal Blue',
      ingredients: [],
      steps: [],
      sections: [{ heading: 'Why blue', body: 'It photographs beautifully.' }],
      photos: [],
      kitchenwareIds: [],
      affiliateLinkIds: [],
      pendingAffiliateLinks: [{ id: 'new-sauce-ab12', label: 'New sauce', url: 'https://vendor.example.com/new-sauce', tag: 'new-sauce' }],
    };

    const mdx = renderPostMdx(draft);

    expect(mdx).toContain('type: article');
    expect(mdx).toContain('heading: Why blue');
    expect(mdx).toContain('- new-sauce-ab12');
    expect(mdx).not.toContain('ingredients:');
  });
});
