import { describe, expect, it } from 'vitest';
import { renderPostMdx, escapeMdxBody } from '../src/render';
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
      pendingIngredientLinks: [],
      variants: [],
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
      pendingIngredientLinks: [],
      variants: [],
    };

    const mdx = renderPostMdx(draft);

    expect(mdx).toContain('type: article');
    expect(mdx).toContain('heading: Why blue');
    expect(mdx).toContain('- new-sauce-ab12');
    expect(mdx).not.toContain('ingredients:');
  });

  it('appends narrativeBody as MDX body prose below the frontmatter fence when present', () => {
    const draft: DraftPost = {
      kind: 'post',
      postType: 'recipe',
      title: 'Teriyaki Chicken Casserole',
      ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
      steps: ['Preheat oven to 350F.'],
      sections: [],
      photos: [{ url: 'https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg' }],
      kitchenwareIds: [],
      affiliateLinkIds: [],
      pendingAffiliateLinks: [],
      pendingIngredientLinks: [],
      variants: [],
      narrativeBody: 'Once upon a weeknight, dinner needed to be easy.',
    };

    const mdx = renderPostMdx(draft);

    expect(mdx).toMatch(/---\n\nOnce upon a weeknight, dinner needed to be easy\.\n$/);
  });

  it('writes variants and sourceMealDbId into recipe frontmatter when present', () => {
    const draft: DraftPost = {
      kind: 'post',
      postType: 'recipe',
      title: 'Teriyaki Chicken Casserole',
      ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
      steps: ['Preheat oven to 350F.'],
      sections: [],
      photos: [{ url: 'https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg' }],
      kitchenwareIds: [],
      affiliateLinkIds: [],
      pendingAffiliateLinks: [],
      pendingIngredientLinks: [],
      variants: [
        { diet: 'original', ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }], steps: ['Preheat oven to 350F.'] },
      ],
      sourceMealDbId: '52772',
    };

    const mdx = renderPostMdx(draft);

    expect(mdx).toContain('sourceMealDbId: \'52772\'');
    expect(mdx).toContain('diet: original');
  });

  it('omits variants/sourceMealDbId/narrativeBody from output when absent (unchanged behavior)', () => {
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
      pendingIngredientLinks: [],
      variants: [],
    };

    const mdx = renderPostMdx(draft);

    expect(mdx).not.toContain('variants:');
    expect(mdx).not.toContain('sourceMealDbId:');
    expect(mdx.endsWith('---\n')).toBe(true);
  });

  it('escapes braces and angle brackets in narrativeBody before writing it into the MDX body', () => {
    const draft: DraftPost = {
      kind: 'post',
      postType: 'recipe',
      title: 'Teriyaki Chicken Casserole',
      ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
      steps: ['Preheat oven to 350F.'],
      sections: [],
      photos: [{ url: 'https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg' }],
      kitchenwareIds: [],
      affiliateLinkIds: [],
      pendingAffiliateLinks: [],
      pendingIngredientLinks: [],
      variants: [],
      narrativeBody: 'Ready in <10 minutes, add sugar {optional} to taste.',
    };

    const mdx = renderPostMdx(draft);

    expect(mdx).toContain('Ready in &lt;10 minutes, add sugar \\{optional\\} to taste.');
    expect(mdx).not.toContain('<10 minutes');
    expect(mdx).not.toContain('{optional}');
  });
});

describe('escapeMdxBody', () => {
  it('escapes { and } with a leading backslash', () => {
    expect(escapeMdxBody('add sugar {optional}')).toBe('add sugar \\{optional\\}');
  });

  it('escapes < as &lt;', () => {
    expect(escapeMdxBody('ready in <10 minutes')).toBe('ready in &lt;10 minutes');
  });

  it('leaves plain prose untouched', () => {
    expect(escapeMdxBody('A short story about a weeknight dinner.')).toBe(
      'A short story about a weeknight dinner.',
    );
  });

  it('escapes braces and angle brackets together in one pass', () => {
    expect(escapeMdxBody('Ready in <10 minutes, add sugar {optional} to taste.')).toBe(
      'Ready in &lt;10 minutes, add sugar \\{optional\\} to taste.',
    );
  });
});
