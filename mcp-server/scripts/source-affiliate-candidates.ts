import { sourceAffiliateCandidates } from '@lhr/affiliate-sourcing';

sourceAffiliateCandidates()
  .then((result) => {
    console.log(`[${result.status}] ${result.summary}`);
    if (result.details) console.log(JSON.stringify(result.details, null, 2));
    if (result.status === 'failure') process.exit(1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
