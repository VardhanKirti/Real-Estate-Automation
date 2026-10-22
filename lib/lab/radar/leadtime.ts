/**
 * The lead-time ledger (05 section 13): which source family saw a launch before the first
 * tracked creator posted about it, per class, plus the "fired before" share (AND 7.1).
 */
import type { LabEventClass, LabRadarFamily } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { RADAR_LEAD_TIME_KEY } from '@/lib/lab/radar/config';
import { counts } from '@/lib/lab/radar/coverage';
import { HOUR, median } from '@/lib/lab/radar/util';

export const LEAD_MIN_N = 5;
export const NOT_ENOUGH = 'not enough yet';

export type LeadRow = { class: LabEventClass; family: LabRadarFamily; medianLeadH: number | null; n: number; shareLeading: number | null; label: string };
export type LeadTime = { rows: LeadRow[]; firedBeforePct: number | null; firedBeforeN: number; computedAt: string };

const round1 = (x: number) => Math.round(x * 10) / 10;

export function leadLabel(medianLeadH: number | null, share: number | null, n: number): string {
  if (n < LEAD_MIN_N || medianLeadH === null || share === null) return NOT_ENOUGH;
  const h = Math.abs(medianLeadH) < 48 ? `${round1(Math.abs(medianLeadH))}h` : `${round1(Math.abs(medianLeadH) / 24)}d`;
  return `${medianLeadH >= 0 ? `${h} ahead` : `${h} behind`}, leads ${Math.round(share * 100)}% (n ${n})`;
}

/** 13: per (class, family) median lead and share leading, over events with a breakout covering post. */
export function leadTimeTable(store: LabStore, now: Date = new Date()): LeadTime {
  const leads = new Map<string, { cls: LabEventClass; family: LabRadarFamily; xs: number[] }>();
  let firedEvents = 0;
  let after = 0;
  let total = 0;
  for (const e of store.events.all({ status: ['confirmed'] })) {
    const rows = store.eventCoverage.forEvent(e.id).filter((c) => !c.isOwned && counts(c));
    if (rows.length && e.confirmedAt) {
      firedEvents++;
      total += rows.length;
      after += rows.filter((c) => c.postedAt > e.confirmedAt!).length;
    }
    if (!rows.some((c) => c.isBreakout)) continue;
    const firstCreator = Math.min(...rows.map((c) => Date.parse(c.postedAt)));
    const firstSeen = new Map<LabRadarFamily, number>();
    for (const p of store.eventPings.forEvent(e.id)) {
      const t = Date.parse(p.firstSeenAt);
      if (!firstSeen.has(p.family) || t < firstSeen.get(p.family)!) firstSeen.set(p.family, t);
    }
    for (const [family, t] of firstSeen) {
      const k = `${e.class}|${family}`;
      if (!leads.has(k)) leads.set(k, { cls: e.class, family, xs: [] });
      leads.get(k)!.xs.push((firstCreator - t) / HOUR);
    }
  }
  const rows: LeadRow[] = [...leads.values()]
    .map(({ cls, family, xs }) => {
      const m = median(xs);
      const share = xs.length ? xs.filter((x) => x > 0).length / xs.length : null;
      return { class: cls, family, medianLeadH: m === null ? null : round1(m), n: xs.length, shareLeading: share === null ? null : Math.round(share * 100) / 100, label: leadLabel(m, share, xs.length) };
    })
    .sort((a, b) => a.class.localeCompare(b.class) || b.n - a.n || a.family.localeCompare(b.family));
  return { rows, firedBeforePct: firedEvents >= LEAD_MIN_N && total ? Math.round((after / total) * 100) : null, firedBeforeN: firedEvents, computedAt: now.toISOString() };
}

/** Persist after the daily tick so the view does not recompute (13). */
export function persistLeadTime(store: LabStore, now: Date): LeadTime {
  const t = leadTimeTable(store, now);
  store.priors.set({ key: RADAR_LEAD_TIME_KEY, value: t, n: t.firedBeforeN, supersedesDefault: false, updatedAt: now.toISOString() });
  return t;
}

/** The stored table when it has this section's shape, else null. */
export function storedLeadTime(store: LabStore): LeadTime | null {
  const v = store.priors.get(RADAR_LEAD_TIME_KEY)?.value as Partial<LeadTime> | null | undefined;
  return v && Array.isArray(v.rows) && typeof v.firedBeforeN === 'number' ? (v as LeadTime) : null;
}
