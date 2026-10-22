/**
 * The window model (05 section 10): clock state from the class, early close on a crowd (E1) or
 * fading posts (E2), reopen on a new wave, `progress` from opened (0) to closes (1).
 */
import type { LabEvent, LabWindowState } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { HOUR } from '@/lib/lab/radar/util';
import { median } from '@/lib/lab/radar/util';

export const WINDOW_HOURS = {
  spike: { open: 72, closing: 168 },
  adopted: { open: 168, closing: 504 },
  unknown: { open: 72, closing: 168 },
} as const;

export const E1_SHARE = 0.6;
export const E1_MIN_ACTIVE = 5;
export const E2_POSTS = 3;
export const E2_MIN_AGE_H = 24;

export type WindowCoverage = {
  /** distinct tracked creators with a high-confidence covering post */
  creators: number;
  /** activeTrackedCount */
  active: number;
  /** tracked covering posts with a rated ratio at age 24 h or more, newest first */
  ratedRecent: readonly number[];
};

export type WindowResult = { state: LabWindowState; opensAt: string; closingAt: string; closesAt: string; progress: number; reason: string | null };

const iso = (ms: number) => new Date(ms).toISOString();

/** 10.2 (pure). */
export function windowFor(e: Pick<LabEvent, 't0' | 'class' | 'waveStartedAt' | 'waveN'>, cov: WindowCoverage, now: Date): WindowResult | null {
  if (!e.t0) return null;
  const clock = WINDOW_HOURS[e.class];
  const opens = Date.parse(e.class === 'adopted' && e.waveStartedAt ? e.waveStartedAt : e.t0);
  const closing = opens + clock.open * HOUR;
  const closes = opens + clock.closing * HOUR;
  const t = now.getTime();
  let state: LabWindowState = t < closing ? 'open' : t < closes ? 'closing' : 'closed';
  let reason: string | null = state === 'open' ? null : state === 'closing' ? 'The window clock is running out' : 'The window has ended';
  if (state === 'open') {
    if (cov.active >= E1_MIN_ACTIVE && cov.creators / cov.active >= E1_SHARE) {
      state = 'closing';
      reason = `${cov.creators} of ${cov.active} creators have covered it`;
    } else {
      const last = cov.ratedRecent.slice(0, E2_POSTS);
      const m = last.length === E2_POSTS ? median(last) : null;
      if (m !== null && m < 1) {
        state = 'closing';
        reason = "The last 3 posts on it ran under their creators' normal";
      }
    }
  }
  const progress = Math.min(1, Math.max(0, (t - opens) / (closes - opens)));
  return { state, opensAt: iso(opens), closingAt: iso(closing), closesAt: iso(closes), progress, reason };
}

/**
 * Persist a window result on the event, logging every state change (10.3). An early close is
 * sticky within a wave: a later tick whose clock still says open keeps `closing`.
 */
export function applyWindow(e: LabEvent, w: WindowResult | null, now: Date): LabEvent {
  if (!w) return e;
  let state = w.state;
  let reason = w.reason;
  if (e.windowState === 'closing' && state === 'open' && e.windowOpensAt === w.opensAt) {
    state = 'closing';
    reason = e.windowReason;
  }
  const changed = e.windowState !== state;
  const at = now.toISOString();
  return {
    ...e,
    windowState: state,
    windowOpensAt: w.opensAt,
    windowClosingAt: w.closingAt,
    windowClosesAt: w.closesAt,
    windowChangedAt: changed ? at : e.windowChangedAt,
    windowReason: changed ? (reason ?? (state === 'open' ? (e.waveN > 1 ? `wave ${e.waveN}` : 'confirmed') : null)) : e.windowReason,
    windowLog: changed ? [...e.windowLog, { at, from: e.windowState, to: state, reason: reason ?? (state === 'open' ? (e.waveN > 1 ? `wave ${e.waveN}` : 'confirmed') : '') }] : e.windowLog,
  };
}

/** Coverage inputs for windowFor from the store. */
export function windowCoverage(store: LabStore, e: LabEvent, active: number, now: Date): WindowCoverage {
  const rows = store.eventCoverage.forEvent(e.id).filter((c) => !c.isOwned && (c.confidence === 'high' || c.confirmed === true) && c.confirmed !== false);
  const creators = new Set(rows.map((c) => c.sourceId)).size;
  const rated = rows
    .filter((c) => c.ratio !== null && (now.getTime() - Date.parse(c.postedAt)) / HOUR >= E2_MIN_AGE_H)
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .map((c) => c.ratio!);
  return { creators, active, ratedRecent: rated };
}

/** 10.4 ordering key (never displayed). */
export function orderKey(e: Pick<LabEvent, 'windowState' | 'novelty' | 't0'>, progress: number, liftOf: (e: Pick<LabEvent, 'novelty'>) => number): [number, number, number] {
  const rank = e.windowState === 'open' ? 0 : e.windowState === 'closing' ? 1 : 2;
  return [rank, -(liftOf(e) * (1 - progress)), -(e.t0 ? Date.parse(e.t0) : 0)];
}
