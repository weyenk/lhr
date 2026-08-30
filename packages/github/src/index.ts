import { Octokit } from '@octokit/rest';

const REPO_OWNER = 'weyenk';
const REPO_NAME = 'lhr';

export interface GitHubClient {
  octokit: Octokit;
}

export interface FileWrite {
  path: string;
  content: string;
}

export function createGitHubClient(token: string): GitHubClient {
  return { octokit: new Octokit({ auth: token }) };
}

export async function getFile(
  client: GitHubClient,
  path: string,
  ref: string,
): Promise<{ content: string; sha: string } | null> {
  try {
    const res = await client.octokit.repos.getContent({ owner: REPO_OWNER, repo: REPO_NAME, path, ref });
    const data = res.data as { type: string; content: string; sha: string };
    if (Array.isArray(res.data) || data.type !== 'file') {
      throw new Error(`${path} is not a file`);
    }
    return { content: Buffer.from(data.content, 'base64').toString('utf-8'), sha: data.sha };
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

export async function listFiles(client: GitHubClient, dirPath: string, ref: string): Promise<string[]> {
  try {
    const res = await client.octokit.repos.getContent({ owner: REPO_OWNER, repo: REPO_NAME, path: dirPath, ref });
    if (!Array.isArray(res.data)) return [];
    return res.data.filter((entry) => entry.type === 'file').map((entry) => entry.name);
  } catch (err) {
    if ((err as { status?: number }).status === 404) return [];
    throw err;
  }
}

export async function createBranch(client: GitHubClient, branchName: string, fromRef = 'main'): Promise<void> {
  const base = await client.octokit.repos.getBranch({ owner: REPO_OWNER, repo: REPO_NAME, branch: fromRef });
  await client.octokit.git.createRef({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    ref: `refs/heads/${branchName}`,
    sha: base.data.commit.sha,
  });
}

export async function listBranches(client: GitHubClient, prefix: string): Promise<string[]> {
  const res = await client.octokit.repos.listBranches({ owner: REPO_OWNER, repo: REPO_NAME, per_page: 100 });
  return res.data.map((b: { name: string }) => b.name).filter((name: string) => name.startsWith(prefix));
}

export async function deleteBranch(client: GitHubClient, branchName: string): Promise<void> {
  await client.octokit.git.deleteRef({ owner: REPO_OWNER, repo: REPO_NAME, ref: `heads/${branchName}` });
}

export async function putFile(
  client: GitHubClient,
  params: { path: string; content: string; branch: string; message: string; sha?: string },
): Promise<void> {
  await client.octokit.repos.createOrUpdateFileContents({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    path: params.path,
    content: Buffer.from(params.content, 'utf-8').toString('base64'),
    branch: params.branch,
    message: params.message,
    sha: params.sha,
  });
}

export async function commitFilesToMain(client: GitHubClient, files: FileWrite[], message: string): Promise<string> {
  const mainRef = await client.octokit.git.getRef({ owner: REPO_OWNER, repo: REPO_NAME, ref: 'heads/main' });
  const baseSha = mainRef.data.object.sha;
  const baseCommit = await client.octokit.git.getCommit({ owner: REPO_OWNER, repo: REPO_NAME, commit_sha: baseSha });

  const blobs = await Promise.all(
    files.map(async (file) => {
      const blob = await client.octokit.git.createBlob({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        content: Buffer.from(file.content, 'utf-8').toString('base64'),
        encoding: 'base64',
      });
      return { path: file.path, sha: blob.data.sha };
    }),
  );

  const tree = await client.octokit.git.createTree({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    base_tree: baseCommit.data.tree.sha,
    tree: blobs.map((b) => ({ path: b.path, mode: '100644' as const, type: 'blob' as const, sha: b.sha })),
  });

  const commit = await client.octokit.git.createCommit({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    message,
    tree: tree.data.sha,
    parents: [baseSha],
  });

  await client.octokit.git.updateRef({ owner: REPO_OWNER, repo: REPO_NAME, ref: 'heads/main', sha: commit.data.sha });

  return commit.data.sha;
}
