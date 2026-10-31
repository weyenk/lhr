# lhr

npm-workspaces monorepo: the Astro site at the root, `mcp-server/`, and `apps/lhr-office/`. Read `CLAUDE.md` first.

## Test gate

Every change must pass these commands, run in order from the repository root:

```sh
npm ci
npm run build
npm test
npm run build --workspace=mcp-server
npm test --workspace=mcp-server
npm run build --workspace=lhr-office
npm test --workspace=lhr-office
```
