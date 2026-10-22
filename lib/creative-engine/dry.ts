import { filmingMode } from '@/lib/paths';
import { engineEnv, engineEnvName } from '@/lib/creative-engine/env';

/**
 * CREATIVE_ENGINE_DRY=1 (or the legacy AD_ENGINE_DRY=1) — every Foreplay, Arcads and Claude call returns a
 * fixture, the ledger records 0 credits with dry:true, and the UI wears a
 * "dry run" badge. This is how the whole panel is developed and demoed
 * without spending a credit. Never silently on: the badge is the contract.
 *
 * Filming forces dry (SPEC Q-ENG-7, DECISIONS.md): the demo world never
 * spends real credits. Every paid action (research, probe, UGC, motion,
 * image, workflow run) already routes through isDry(), so this one switch
 * covers them all. The UI tells the two apart with dryReason().
 */

/** The explicit env switch only (a deliberate test session). */
export function envDry(): boolean {
  return engineEnv('DRY') === '1';
}

/** True when no paid request may leave this process. */
export function isDry(): boolean {
  return envDry() || filmingMode();
}

export type DryReason = 'env' | 'filming' | null;

export function dryReason(): DryReason {
  if (envDry()) return 'env';
  if (filmingMode()) return 'filming';
  return null;
}

/** The env variable that switched dry on, for copy that quotes it. */
export function dryEnvName(): string {
  return engineEnvName('DRY');
}

/** One line for fixture surfaces (catalog detail, probe notes). */
export function dryLabel(): string {
  return dryReason() === 'filming' ? 'Filming: fixtures, nothing is charged' : `${engineEnvName('DRY')}=1: fixtures, nothing is charged`;
}
