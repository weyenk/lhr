import type { JobRegistration } from './types.js';
import { validateJobRegistrations } from './validateRegistry.js';

export const jobs: JobRegistration[] = [];

validateJobRegistrations(jobs);
