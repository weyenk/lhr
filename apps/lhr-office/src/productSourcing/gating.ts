import type { GatingProfile } from '@lhr/db';

const ENV_KEY = 'PRODUCT_SOURCING_GATING_PROFILE';

export function readGatingProfile(): GatingProfile {
  // Default is `trust` (gate after search + final). Set PRODUCT_SOURCING_GATING_PROFILE=strict
  // for every-stage green-lights.
  return process.env[ENV_KEY] === 'strict' ? 'strict' : 'trust';
}

// Only criteria and monetize can auto-clear (under `trust`). The pick-products and final
// gates always require the author, so they are intentionally not accepted here.
export function gateAutoClears(profile: GatingProfile, gate: 'criteria' | 'monetize'): boolean {
  void gate;
  return profile === 'trust';
}
