import type { GatingProfile } from '@lhr/db';

const ENV_KEY = 'PRODUCT_SOURCING_GATING_PROFILE';

export function readGatingProfile(): GatingProfile {
  return process.env[ENV_KEY] === 'trust' ? 'trust' : 'strict';
}

// Only criteria and monetize can auto-clear (under `trust`). The pick-products and final
// gates always require the author, so they are intentionally not accepted here.
export function gateAutoClears(profile: GatingProfile, gate: 'criteria' | 'monetize'): boolean {
  void gate;
  return profile === 'trust';
}
