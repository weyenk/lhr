export type BridgeConfig = { hubUrl: string; tenantKey: string };

export function loadBridgeConfig(
  env: NodeJS.ProcessEnv = process.env,
): BridgeConfig {
  const hubUrl = env.AIRLIE_HUB_URL?.trim().replace(/\/$/, '') ?? '';
  const tenantKey = env.AIRLIE_HUB_TENANT_KEY?.trim() ?? '';
  if (!hubUrl) throw new Error('AIRLIE_HUB_URL is not set');
  if (!tenantKey) throw new Error('AIRLIE_HUB_TENANT_KEY is not set');
  return { hubUrl, tenantKey };
}
