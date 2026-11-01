import type { JobRegistration } from '@lhr/jobs';
import { validateJobRegistrations } from '@lhr/jobs';
import { generateWeeklyVariantRecipe } from 'lhr-authoring-mcp-server/dist-lib/generateWeeklyVariantRecipe.js';
import { finishPendingRecipeVariants } from 'lhr-authoring-mcp-server/dist-lib/finishRecipeVariants.js';
import { sourceWeeklyTrends } from './trendsWatcher.js';
import { analyzeCompetitors } from './competitorAnalysis.js';
import { runProductSourcingCriteria } from './productSourcing/criteriaJob.js';
import { runProductSourcingSearch } from './productSourcing/searchJob.js';
import { runProductSourcingMonetize } from './productSourcing/monetizeJob.js';
import { runProductSourcingBrand } from './productSourcing/brandJob.js';

export const jobs: JobRegistration[] = [
  { name: 'recipe-variant-generator', cadenceDays: 7, run: generateWeeklyVariantRecipe },
  { name: 'recipe-variant-finisher', cadenceDays: 1, run: finishPendingRecipeVariants },
  { name: 'trends-watcher', cadenceDays: 7, run: sourceWeeklyTrends },
  { name: 'competitor-analysis', cadenceDays: 7, run: analyzeCompetitors },
  { name: 'product-sourcing-criteria', cadenceDays: 7, run: runProductSourcingCriteria },
  { name: 'product-sourcing-search', cadenceDays: 1, run: runProductSourcingSearch },
  { name: 'product-sourcing-monetize', cadenceDays: 1, run: runProductSourcingMonetize },
  { name: 'product-sourcing-brand', cadenceDays: 1, run: runProductSourcingBrand },
];

validateJobRegistrations(jobs);
