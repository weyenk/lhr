import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockOctokit = {
  repos: {
    getContent: vi.fn(),
    getBranch: vi.fn(),
    listBranches: vi.fn(),
    createOrUpdateFileContents: vi.fn(),
  },
  git: {
    createRef: vi.fn(),
    deleteRef: vi.fn(),
    getRef: vi.fn(),
    getCommit: vi.fn(),
    createBlob: vi.fn(),
    createTree: vi.fn(),
    createCommit: vi.fn(),
    updateRef: vi.fn(),
  },
};

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn(() => mockOctokit),
}));

const {
  createGitHubClient,
  getFile,
  listFiles,
  createBranch,
  listBranches,
  deleteBranch,
  putFile,
  commitFilesToMain,
  readCollection,
} = await import('../src/index');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getFile', () => {
  it('returns decoded content and sha for an existing file', async () => {
    mockOctokit.repos.getContent.mockResolvedValue({
      data: { type: 'file', content: Buffer.from('hello').toString('base64'), sha: 'abc123' },
    });
    const client = createGitHubClient('token');
    const result = await getFile(client, '.drafts/x.json', 'main');
    expect(result).toEqual({ content: 'hello', sha: 'abc123' });
  });

  it('returns null for a 404', async () => {
    mockOctokit.repos.getContent.mockRejectedValue({ status: 404 });
    const client = createGitHubClient('token');
    const result = await getFile(client, '.drafts/missing.json', 'main');
    expect(result).toBeNull();
  });
});

describe('listFiles', () => {
  it('lists file names in a directory, ignoring subdirectories', async () => {
    mockOctokit.repos.getContent.mockResolvedValue({
      data: [
        { type: 'file', name: 'coastal-blue.json' },
        { type: 'dir', name: 'nested' },
      ],
    });
    const client = createGitHubClient('token');
    const result = await listFiles(client, 'src/content/sets', 'main');
    expect(result).toEqual(['coastal-blue.json']);
  });

  it('returns an empty array for a 404', async () => {
    mockOctokit.repos.getContent.mockRejectedValue({ status: 404 });
    const client = createGitHubClient('token');
    const result = await listFiles(client, 'src/content/sets', 'main');
    expect(result).toEqual([]);
  });
});

describe('createBranch', () => {
  it('creates a ref pointing at the base branch head', async () => {
    mockOctokit.repos.getBranch.mockResolvedValue({ data: { commit: { sha: 'base-sha' } } });
    const client = createGitHubClient('token');
    await createBranch(client, 'draft/post-abc1');
    expect(mockOctokit.git.createRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'refs/heads/draft/post-abc1', sha: 'base-sha' }),
    );
  });
});

describe('listBranches', () => {
  it('filters branches by prefix', async () => {
    mockOctokit.repos.listBranches.mockResolvedValue({
      data: [{ name: 'main' }, { name: 'draft/post-abc1' }, { name: 'draft/post-def2' }],
    });
    const client = createGitHubClient('token');
    const result = await listBranches(client, 'draft/post-');
    expect(result).toEqual(['draft/post-abc1', 'draft/post-def2']);
  });
});

describe('deleteBranch', () => {
  it('deletes the ref for the given branch', async () => {
    const client = createGitHubClient('token');
    await deleteBranch(client, 'draft/post-abc1');
    expect(mockOctokit.git.deleteRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'heads/draft/post-abc1' }),
    );
  });
});

describe('putFile', () => {
  it('base64-encodes content and passes sha when updating', async () => {
    const client = createGitHubClient('token');
    await putFile(client, { path: '.drafts/abc1.json', content: '{}', branch: 'draft/post-abc1', message: 'update', sha: 'old-sha' });
    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '.drafts/abc1.json',
        content: Buffer.from('{}').toString('base64'),
        branch: 'draft/post-abc1',
        message: 'update',
        sha: 'old-sha',
      }),
    );
  });
});

describe('readCollection', () => {
  // Routes the shared getContent mock: the directory path lists its entries, and each
  // file path resolves to its content (or 404s when the mapped content is null).
  function mockDirectory(dirPath: string, files: Record<string, string | null>) {
    mockOctokit.repos.getContent.mockImplementation(async ({ path }: { path: string }) => {
      if (path === dirPath) {
        return { data: Object.keys(files).map((name) => ({ type: 'file', name })) };
      }
      const content = files[path.slice(dirPath.length + 1)];
      if (content == null) throw { status: 404 };
      return { data: { type: 'file', content: Buffer.from(content).toString('base64'), sha: 'file-sha' } };
    });
  }

  it('reads and parses every JSON file in a directory into id/data entries', async () => {
    mockDirectory('src/content/sets', {
      'coastal-blue.json': JSON.stringify({ name: 'Coastal Blue' }),
      'harvest-copper.json': JSON.stringify({ name: 'Harvest Copper' }),
    });
    const client = createGitHubClient('token');
    const result = await readCollection(client, 'src/content/sets');
    expect(result).toEqual([
      { id: 'coastal-blue', data: { name: 'Coastal Blue' } },
      { id: 'harvest-copper', data: { name: 'Harvest Copper' } },
    ]);
  });

  it('skips files that are not .json', async () => {
    mockDirectory('src/content/sets', {
      'coastal-blue.json': JSON.stringify({ name: 'Coastal Blue' }),
      'README.md': '# not a set',
    });
    const client = createGitHubClient('token');
    const result = await readCollection(client, 'src/content/sets');
    expect(result).toEqual([{ id: 'coastal-blue', data: { name: 'Coastal Blue' } }]);
  });

  it('skips files that no longer exist when fetched', async () => {
    mockDirectory('src/content/sets', {
      'coastal-blue.json': JSON.stringify({ name: 'Coastal Blue' }),
      'vanished.json': null,
    });
    const client = createGitHubClient('token');
    const result = await readCollection(client, 'src/content/sets');
    expect(result).toEqual([{ id: 'coastal-blue', data: { name: 'Coastal Blue' } }]);
  });
});

describe('commitFilesToMain', () => {
  it('creates blobs, a tree, a commit, and updates the main ref', async () => {
    mockOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: 'main-sha' } } });
    mockOctokit.git.getCommit.mockResolvedValue({ data: { tree: { sha: 'base-tree-sha' } } });
    mockOctokit.git.createBlob.mockResolvedValue({ data: { sha: 'blob-sha' } });
    mockOctokit.git.createTree.mockResolvedValue({ data: { sha: 'new-tree-sha' } });
    mockOctokit.git.createCommit.mockResolvedValue({ data: { sha: 'new-commit-sha' } });

    const client = createGitHubClient('token');
    const sha = await commitFilesToMain(client, [{ path: 'src/content/posts/x.mdx', content: '---\n---\n' }], 'Publish post: X');

    expect(mockOctokit.git.createTree).toHaveBeenCalledWith(
      expect.objectContaining({
        base_tree: 'base-tree-sha',
        tree: [{ path: 'src/content/posts/x.mdx', mode: '100644', type: 'blob', sha: 'blob-sha' }],
      }),
    );
    expect(mockOctokit.git.createCommit).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Publish post: X', tree: 'new-tree-sha', parents: ['main-sha'] }),
    );
    expect(mockOctokit.git.updateRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'heads/main', sha: 'new-commit-sha' }),
    );
    expect(sha).toBe('new-commit-sha');
  });
});
