import type { SavedAd } from '@/lib/foreplay/saved';
import type { WatchEntry } from '@/lib/foreplay/watchlist';
import type { WallAd } from '@/lib/foreplay/wall';
import { dedupeSignals, type Signal } from '@/lib/foreplay/signals';

/**
 * Creative Engine Proof library rows → AdPilot deep links (S04 B26, SPEC G2).
 * Pure and client-safe: the drawer renders from these, the AdPilot page
 * resolves them, and tests/adpilot-proof-links.test.ts checks every row of
 * the drawer lands on an ad or brand AdPilot can show (ACG2.3).
 */

export type AdpilotLink = { kind: 'ad' | 'brand'; id: string };

/** Rows per Proof library section; more spill into "Show all N in AdPilot". */
export const PROOF_ROWS = 12;
/** Repeated signals within a day collapse into one row (X5). */
export const SIGNAL_WINDOW_MS = 24 * 60 * 60 * 1000;

export function adpilotHref(l: AdpilotLink): string {
  return `/adpilot?${l.kind}=${encodeURIComponent(l.id)}`;
}

/** A signal opens the ad it names, else its brand. */
export function signalLink(s: Pick<Signal, 'adId' | 'brandId'>): AdpilotLink {
  return s.adId ? { kind: 'ad', id: s.adId } : { kind: 'brand', id: s.brandId };
}

/** The Proof library sections exactly as the drawer shows them. */
export function proofLibrarySections(saved: SavedAd[], watchlist: WatchEntry[], signals: Signal[]) {
  const deduped = dedupeSignals(signals, { windowMs: SIGNAL_WINDOW_MS });
  return {
    saved: saved.slice(0, PROOF_ROWS),
    savedTotal: saved.length,
    watchlist: watchlist.slice(0, PROOF_ROWS),
    watchTotal: watchlist.length,
    signals: deduped.slice(0, PROOF_ROWS),
    signalsTotal: deduped.length,
  };
}

/** Every link the drawer renders, in order. */
export function proofLibraryLinks(saved: SavedAd[], watchlist: WatchEntry[], signals: Signal[]): AdpilotLink[] {
  const s = proofLibrarySections(saved, watchlist, signals);
  return [
    ...s.saved.map((x): AdpilotLink => ({ kind: 'ad', id: x.ad.id })),
    ...s.watchlist.map((w): AdpilotLink => ({ kind: 'brand', id: w.id })),
    ...s.signals.map((x) => signalLink(x)),
  ];
}

/** The ad an `?ad=` link names, from the first pool that has it (wall, saved, search, the page's own lookup). */
export function findLinkedAd(id: string, pools: ReadonlyArray<readonly WallAd[] | null | undefined>): WallAd | null {
  for (const pool of pools) {
    const hit = pool?.find((a) => a.id === id);
    if (hit) return hit;
  }
  return null;
}

/** Ids from the address bar are store ids; anything else is not looked up. */
export function isLinkId(v: unknown): v is string {
  return typeof v === 'string' && /^[\w.-]{1,80}$/.test(v);
}
