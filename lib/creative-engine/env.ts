/**
 * Creative Engine env reads (S02 FR-12). The engine's switches were named
 * AD_ENGINE_* before the rename; the new CREATIVE_ENGINE_* name wins and the
 * old one is still read as a fallback, so a launchd plist or shell profile
 * that sets the old name keeps working.
 *
 * Names: DRY, CREDIT_CAP, STORE_DIR, ASSET_DIR, LIVE (tests only),
 * MIGRATE ('0' turns the on-disk rename off; vitest sets it, see store.ts).
 */
export type EngineEnvName = 'DRY' | 'CREDIT_CAP' | 'STORE_DIR' | 'ASSET_DIR' | 'LIVE' | 'MIGRATE';

export const ENV_PREFIX = 'CREATIVE_ENGINE_';
/** Pre-rename prefix, read only as a fallback. */
export const LEGACY_ENV_PREFIX = 'AD_ENGINE_';

/** The value of CREATIVE_ENGINE_<name>, else AD_ENGINE_<name>, else undefined. */
export function engineEnv(name: EngineEnvName): string | undefined {
  return process.env[ENV_PREFIX + name] ?? process.env[LEGACY_ENV_PREFIX + name];
}

/** The full variable name that supplied engineEnv(name), so copy can quote what is actually set. */
export function engineEnvName(name: EngineEnvName): string {
  if (process.env[ENV_PREFIX + name] !== undefined) return ENV_PREFIX + name;
  if (process.env[LEGACY_ENV_PREFIX + name] !== undefined) return LEGACY_ENV_PREFIX + name;
  return ENV_PREFIX + name;
}
