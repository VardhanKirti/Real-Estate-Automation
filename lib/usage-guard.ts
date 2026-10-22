/**
 * Is /usage allowed to read this host's private model transcripts?
 * (pages/usage.md §2, ported from the 2026-10-06 parts bin.)
 *
 * Usage parses ~/.claude and ~/.codex on whatever machine serves the page, so
 * it is OFF on the public demo instance and in Filming:
 *
 *   1. DEMO_GATE=1                the demo instance's public gate; always wins
 *   2. DEMO_MODE=1 / DEMO_MODE=0  the filming switch (lib/paths.ts)
 *   3. GLADOS_DATA_DIR set        pinned to real data: the mode file is ignored
 *   4. .glados-mode               "filming" or "demo" turns it off
 *
 * Read per call, so flipping the toggle takes effect without a restart. While
 * off, nothing under the home directory is read (U-1).
 */
import fs from 'node:fs';
import { modeFile } from '@/lib/paths';

export type UsageAvailability = { available: true } | { available: false; reason: 'demo instance' | 'filming mode' };

export const USAGE_OFF_MESSAGE = 'Usage is not available on this instance.';

function fileMode(): string | null {
  try {
    return fs.readFileSync(modeFile(), 'utf8').trim().toLowerCase() || null;
  } catch {
    return null;
  }
}

export function usageAvailability(env: Record<string, string | undefined> = process.env): UsageAvailability {
  if (env.DEMO_GATE === '1') return { available: false, reason: 'demo instance' };
  if (env.DEMO_MODE === '1') return { available: false, reason: 'filming mode' };
  if (env.DEMO_MODE === '0' || env.GLADOS_DATA_DIR) return { available: true };
  const mode = fileMode();
  if (mode === 'filming') return { available: false, reason: 'filming mode' };
  if (mode === 'demo') return { available: false, reason: 'demo instance' };
  return { available: true };
}
