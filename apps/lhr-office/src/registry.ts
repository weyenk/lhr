import type { JobRegistration } from '@lhr/jobs';
import { validateJobRegistrations } from '@lhr/jobs';
import { generateWeeklyVariantRecipe } from 'lhr-authoring-mcp-server/dist-lib/generateWeeklyVariantRecipe.js';
import { finishPendingRecipeVariants } from 'lhr-authoring-mcp-server/dist-lib/finishRecipeVariants.js';
import { sourceAffiliateCandidates } from 'lhr-authoring-mcp-server/dist-lib/sourceAffiliateCandidates.js';
import { sourceWeeklyTrends } from './trendsWatcher.js';
import { analyzeCompetitors } from './competitorAnalysis.js';

export const jobs: JobRegistration[] = [
  { name: 'recipe-variant-generator', cadenceDays: 7, run: generateWeeklyVariantRecipe },
  { name: 'recipe-variant-finisher', cadenceDays: 1, run: finishPendingRecipeVariants },
  { name: 'affiliate-sourcing', cadenceDays: 7, run: sourceAffiliateCandidates },
  { name: 'trends-watcher', cadenceDays: 7, run: sourceWeeklyTrends },
  { name: 'competitor-analysis', cadenceDays: 7, run: analyzeCompetitors },
];

validateJobRegistrations(jobs);
