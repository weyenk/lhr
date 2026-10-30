import { describe, expect, it, afterEach } from 'vitest';
import { loadBridgeConfig } from '../../src/bridge/config.js';

const KEYS = ['AIRLIE_HUB_URL', 'AIRLIE_HUB_TENANT_KEY'] as const;

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe('loadBridgeConfig', () => {
  it('returns trimmed url and key when both are set', () => {
    process.env.AIRLIE_HUB_URL = ' https://airlie-hub.vercel.app/api/v1/ ';
    process.env.AIRLIE_HUB_TENANT_KEY = ' tenant-secret ';
    expect(loadBridgeConfig()).toEqual({
      hubUrl: 'https://airlie-hub.vercel.app/api/v1',
      tenantKey: 'tenant-secret',
    });
  });

  it('throws when AIRLIE_HUB_URL is missing', () => {
    process.env.AIRLIE_HUB_TENANT_KEY = 'x';
    expect(() => loadBridgeConfig()).toThrow(/AIRLIE_HUB_URL/);
  });

  it('throws when AIRLIE_HUB_TENANT_KEY is missing', () => {
    process.env.AIRLIE_HUB_URL = 'https://example/api/v1';
    expect(() => loadBridgeConfig()).toThrow(/AIRLIE_HUB_TENANT_KEY/);
  });
});
