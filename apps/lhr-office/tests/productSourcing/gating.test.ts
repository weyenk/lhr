import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gateAutoClears, readGatingProfile } from '../../src/productSourcing/gating';

const ENV_KEY = 'PRODUCT_SOURCING_GATING_PROFILE';

describe('readGatingProfile', () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });
  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it('defaults to trust when unset', () => {
    expect(readGatingProfile()).toBe('trust');
  });

  it('reads trust', () => {
    process.env[ENV_KEY] = 'trust';
    expect(readGatingProfile()).toBe('trust');
  });

  it('reads strict', () => {
    process.env[ENV_KEY] = 'strict';
    expect(readGatingProfile()).toBe('strict');
  });

  it('defaults to trust when invalid', () => {
    process.env[ENV_KEY] = 'yolo';
    expect(readGatingProfile()).toBe('trust');
  });
});

describe('gateAutoClears', () => {
  it('auto-clears criteria and monetize under trust', () => {
    expect(gateAutoClears('trust', 'criteria')).toBe(true);
    expect(gateAutoClears('trust', 'monetize')).toBe(true);
  });

  it('never auto-clears under strict', () => {
    expect(gateAutoClears('strict', 'criteria')).toBe(false);
    expect(gateAutoClears('strict', 'monetize')).toBe(false);
  });
});
