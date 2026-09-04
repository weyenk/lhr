import type { JobRegistration } from './types.js';
import { validateJobRegistrations } from './validateRegistry.js';
import { generateWeeklyVariantRecipe } from 'lhr-authoring-mcp-server/dist-lib/generateWeeklyVariantRecipe.js';
import { finishPendingRecipeVariants } from 'lhr-authoring-mcp-server/dist-lib/finishRecipeVariants.js';
import { sourceAffiliateCandidates } from 'lhr-authoring-mcp-server/dist-lib/sourceAffiliateCandidates.js';

export const jobs: JobRegistration[] = [
  { name: 'recipe-variant-generator', cadenceDays: 7, run: generateWeeklyVariantRecipe },
  { name: 'recipe-variant-finisher', cadenceDays: 1, run: finishPendingRecipeVariants },
  { name: 'affiliate-sourcing', cadenceDays: 7, run: sourceAffiliateCandidates },
];

validateJobRegistrations(jobs);
