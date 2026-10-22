/**
 * What generation reads from section 05's tables directly: open launch windows and, per event,
 * which angles are taken (05 12.3: a taken angle has at least one high-confidence or confirmed
 * tracked covering post) with the median ratio of the rated ones. Lane R's `angleMap` builds
 * the full cells for the Event sheet; this is the subset the prompts and the duplicate and
 * exhaustion rules need, computed from the same rows.
 */
import type { LabEvent, LaunchAngle } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { ANGLE_ORDER, type AngleId } from '@/lib/lab/radar/angles';

export type EventAngleStat = { angle: AngleId; taken: boolean; posts: number; n: number; median: number | null };

/** Confirmed events whose window is open or closing. */
export function openEvents(store: LabStore): LabEvent[] {
  return store.events.all({ status: ['confirmed'] }).filter((e) => e.windowState === 'open' || e.windowState === 'closing');
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** One row per AngleId for an event, from its trusted tracked coverage. */
export function eventAngleStats(store: LabStore, eventId: string): EventAngleStat[] {
  const rows = store.eventCoverage.forEvent(eventId).filter((c) => !c.isOwned && (c.confidence === 'high' || c.confirmed === true));
  return ANGLE_ORDER.map((angle) => {
    const on = rows.filter((c) => c.angle === angle);
    const rated = on.map((c) => c.ratio).filter((r): r is number => typeof r === 'number');
    return { angle, taken: on.length > 0, posts: on.length, n: rated.length, median: median(rated) };
  });
}

export const takenAngles = (store: LabStore, eventId: string): Set<LaunchAngle> => new Set(eventAngleStats(store, eventId).filter((s) => s.taken).map((s) => s.angle));
