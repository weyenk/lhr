import { createGitHubClient } from '../src/github.js';
import { runWeeklyVariantRecipeGeneration } from '../src/generateWeeklyVariantRecipe.js';

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN env var is required (a GitHub personal access token with repo write access).');
    process.exit(1);
  }
  const client = createGitHubClient(token);

  const result = await runWeeklyVariantRecipeGeneration(client);

  if (result.skipped) {
    console.log('No unused TheMealDB recipe found this week after retrying across categories; skipping this run.');
    return;
  }

  console.log(`Created draft ${result.draftId}: "${result.title}" (source idMeal ${result.sourceMealDbId})`);
  if (result.flaggedDiets && result.flaggedDiets.length > 0) {
    console.log(`Diets needing a manual pass: ${result.flaggedDiets.join(', ')}`);
  } else {
    console.log('All 7 diet variants generated cleanly.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
