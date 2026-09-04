import { sourceAffiliateCandidates } from '../src/sourceAffiliateCandidates.js';

async function main() {
  const result = await sourceAffiliateCandidates();
  console.log(`[${result.status}] ${result.summary}`);
  if (result.details) {
    console.log(JSON.stringify(result.details, null, 2));
  }
  if (result.status === 'failure') {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
