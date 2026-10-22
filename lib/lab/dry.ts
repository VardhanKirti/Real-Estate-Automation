import { filmingMode } from '@/lib/paths';
import { readEnvLocal } from '@/lib/creds';

/**
 * LAB_DRY=1 or Filming mode: every Apify, speech-to-text and LLM call the Lab would
 * make returns a fixture instead, the ledger records a 0-cost `dry` row, and the page
 * says so ("Filming · no charges"). Same contract as lib/creative-engine/dry.ts.
 *
 * The dry check never relies on a blank key (SPEC §7): a blank APIFY_API_TOKEN means
 * "not configured", which is a different state from "dry". A fresh .env.local read wins
 * over process.env, like every other key.
 */

/** The explicit env switch only (a deliberate test session). */
export function envDry(): boolean {
  const local = readEnvLocal().LAB_DRY;
  return (local ?? process.env.LAB_DRY) === '1';
}

/** True when no paid request may leave this process. */
export function isDry(): boolean {
  return envDry() || filmingMode();
}

export type LabDryReason = 'env' | 'filming' | null;

export function dryReason(): LabDryReason {
  if (envDry()) return 'env';
  if (filmingMode()) return 'filming';
  return null;
}

/** One line for the Sources tab and the run strip. */
export function dryLabel(reason: LabDryReason = dryReason()): string | null {
  if (reason === 'filming') return 'Filming · no charges';
  if (reason === 'env') return 'LAB_DRY=1 · fixtures, no charges';
  return null;
}
