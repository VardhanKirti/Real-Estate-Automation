/**
 * Finished radar Apify runs to pings (05 1, 19). `advanceRuns` (lib/lab/sync.ts) dispatches every
 * finished run whose actor is in RADAR_ACTORS here instead of the post normalizer.
 */
import type { LabRun } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { PRODUCTHUNT_ACTOR, RADAR_ACTORS, TIKTOK_CC_ACTOR, X_ACTOR } from '@/lib/lab/radar/config';
import { parseTweets } from '@/lib/lab/radar/fetch/x';
import { parsePhActor } from '@/lib/lab/radar/fetch/producthunt';
import { parseTiktokCc } from '@/lib/lab/radar/fetch/tiktok';
import { radarCtx, storePings } from '@/lib/lab/radar/run';
import { xAttach } from '@/lib/lab/radar/events';

export const isRadarActor = (actor: string | null | undefined): boolean => Boolean(actor && (RADAR_ACTORS as readonly string[]).includes(actor));

export function ingestRadarRun(store: LabStore, run: Pick<LabRun, 'actor' | 'dry'>, items: readonly unknown[], now: Date): { pings: number } {
  const ctx = radarCtx(store, { now, dry: run.dry, dryReason: null });
  const raws = run.actor === X_ACTOR ? parseTweets(items) : run.actor === TIKTOK_CC_ACTOR ? parseTiktokCc(items) : run.actor === PRODUCTHUNT_ACTOR ? parsePhActor(items) : [];
  const n = storePings(ctx, raws);
  if (run.actor === X_ACTOR) xAttach(store, now, { dry: run.dry });
  return { pings: n };
}
