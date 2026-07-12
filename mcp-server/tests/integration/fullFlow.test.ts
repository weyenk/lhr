import { describe, expect, it, vi, beforeEach } from 'vitest';
import yaml from 'js-yaml';

interface FakeRepoState {
  branches: Map<string, string>; // branch name -> base sha (unused, just existence)
  files: Map<string, Map<string, string>>; // branch -> path -> content
  main: Map<string, string>; // path -> content
}

function makeFakeGitHub(): FakeRepoState {
  return { branches: new Map(), files: new Map(), main: new Map() };
}

let state: FakeRepoState;

vi.mock('../../src/github', () => ({
  createGitHubClient: vi.fn(() => ({})),
  createBranch: vi.fn(async (_client: unknown, branch: string) => {
    state.branches.set(branch, 'base');
    state.files.set(branch, new Map());
  }),
  listBranches: vi.fn(async (_client: unknown, prefix: string) =>
    Array.from(state.branches.keys()).filter((b) => b.startsWith(prefix)),
  ),
  deleteBranch: vi.fn(async (_client: unknown, branch: string) => {
    state.branches.delete(branch);
    state.files.delete(branch);
  }),
  getFile: vi.fn(async (_client: unknown, path: string, ref: string) => {
    const store = ref === 'main' ? state.main : state.files.get(ref);
    const content = store?.get(path);
    return content === undefined ? null : { content, sha: 'sha' };
  }),
  putFile: vi.fn(async (_client: unknown, params: { path: string; content: string; branch: string }) => {
    state.files.get(params.branch)!.set(params.path, params.content);
  }),
  listFiles: vi.fn(async (_client: unknown, dirPath: string) =>
    Array.from(state.main.keys())
      .filter((p) => p.startsWith(`${dirPath}/`))
      .map((p) => p.slice(dirPath.length + 1)),
  ),
  commitFilesToMain: vi.fn(async (_client: unknown, files: { path: string; content: string }[]) => {
    for (const file of files) state.main.set(file.path, file.content);
    return 'fake-commit-sha';
  }),
}));

vi.mock('../../src/blob', () => ({
  fetchAndStorePhoto: vi.fn(async (url: string) => `https://blob.vercel-storage.com/posts/${encodeURIComponent(url)}.jpg`),
}));

const { registerStartPost } = await import('../../src/tools/startPost');
const { registerAddContentStep } = await import('../../src/tools/addContentStep');
const { registerAttachPhoto } = await import('../../src/tools/attachPhoto');
const { registerLinkKitchenware } = await import('../../src/tools/linkKitchenware');
const { registerAddAffiliateLink } = await import('../../src/tools/addAffiliateLink');
const { registerConfirmAndPublish } = await import('../../src/tools/confirmAndPublish');
const { postSchema } = await import('../../../src/content/schemas');

function fakeServer() {
  const handlers = new Map<string, (input: unknown) => Promise<{ content: { type: string; text: string }[] }>>();
  return {
    registerTool: (name: string, _meta: unknown, handler: (input: unknown) => Promise<{ content: { type: string; text: string }[] }>) => {
      handlers.set(name, handler);
    },
    call: (name: string, input: unknown) => handlers.get(name)!(input),
  };
}

beforeEach(() => {
  state = makeFakeGitHub();
});

describe('full authoring flow', () => {
  it('start_post -> add_content_step -> attach_photo -> link_kitchenware -> add_affiliate_link -> confirm_and_publish', async () => {
    state.main.set('src/content/products/coastal-blue-platter.json', JSON.stringify({ name: 'Coastal Blue Serving Platter', priceCents: 4800, setId: 'coastal-blue' }));
    state.main.set('src/content/sets/coastal-blue.json', JSON.stringify({ name: 'Coastal Blue', startDate: '2020-01-01', endDate: '2099-12-31' }));

    const server = fakeServer();
    registerStartPost(server as never, 'token');
    registerAddContentStep(server as never, 'token');
    registerAttachPhoto(server as never, 'token');
    registerLinkKitchenware(server as never, 'token');
    registerAddAffiliateLink(server as never, 'token');
    registerConfirmAndPublish(server as never, 'token');

    const startResult = await server.call('start_post', { type: 'recipe' });
    const draftId = startResult.content[0].text.match(/Draft id: (\w+)/)![1];

    await server.call('add_content_step', { draftId, title: 'Jerk Chicken for a Crowd' });
    await server.call('add_content_step', { draftId, ingredient: { item: 'Chicken thighs', amount: '2 lbs' } });
    await server.call('add_content_step', { draftId, step: 'Marinate overnight.' });
    await server.call('attach_photo', { draftId, photoUrl: 'https://icloud.com/share/xyz', caption: 'Jerk chicken' });
    await server.call('link_kitchenware', { draftId, productIds: ['coastal-blue-platter'] });
    await server.call('add_affiliate_link', { draftId, label: 'Jerk seasoning', url: 'https://vendor.example.com/jerk-seasoning', tag: 'jerk-seasoning' });

    const publishResult = await server.call('confirm_and_publish', { draftId });
    expect(publishResult.content[0].text).toContain('Published');

    const publishedPath = Array.from(state.main.keys()).find((p) => p.startsWith('src/content/posts/'));
    expect(publishedPath).toBeDefined();
    const mdx = state.main.get(publishedPath!)!;

    const frontmatterYaml = mdx.replace(/^---\n/, '').replace(/---\n$/, '');
    const frontmatter = yaml.load(frontmatterYaml);
    const parsed = postSchema.safeParse(frontmatter);
    expect(parsed.success).toBe(true);

    const affiliateLinkPath = Array.from(state.main.keys()).find((p) => p.startsWith('src/content/affiliate-links/jerk-seasoning'));
    expect(affiliateLinkPath).toBeDefined();

    expect(state.branches.has(`draft/post-${draftId}`)).toBe(false);
  });
});
