import { getPool, reapOrphanedRunningRuns, ORCHESTRATOR_STALE_RUNNING_MS } from '@lhr/db';
import { createApp } from '../src/server.js';

const db = getPool();
// Cold-start cleanup so Agents & Jobs does not keep showing killed runs as "running".
void reapOrphanedRunningRuns(db, ORCHESTRATOR_STALE_RUNNING_MS).catch((err) => {
  console.error('[orchestrator] orphan reaper failed on cold start', err);
});

export default createApp(db);
