import type { JobRegistration } from './types.js';

export function validateJobRegistrations(registry: JobRegistration[]): void {
  const seen = new Set<string>();
  for (const entry of registry) {
    if (typeof entry.name !== 'string' || entry.name.trim() === '') {
      throw new Error(`Invalid job registration: name must be a non-empty string (got ${JSON.stringify(entry.name)})`);
    }
    if (seen.has(entry.name)) {
      throw new Error(`Invalid job registration: duplicate job name "${entry.name}"`);
    }
    seen.add(entry.name);
    if (!Number.isInteger(entry.cadenceDays) || entry.cadenceDays <= 0) {
      throw new Error(
        `Invalid job registration "${entry.name}": cadenceDays must be a positive integer (got ${entry.cadenceDays})`,
      );
    }
    if (typeof entry.run !== 'function') {
      throw new Error(`Invalid job registration "${entry.name}": run must be a function`);
    }
  }
}
