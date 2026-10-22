/**
 * Pure funnel view maths for the GladOS tree (glados-ui SPEC S02 §4.2, §7:
 * "all new numbers derive from data already on the client"). The same rules
 * as the Classic FunnelDashboard, lifted out so they are unit-tested; the
 * Classic file keeps its own copy until the Classic decision (X5, Phase 6).
 * Client-safe: no node imports.
 */
import { FUNNEL_STAGES, funnelSummary } from '@/lib/funnel';
import type { FunnelJourney, FunnelStage } from '@/lib/schemas';
import type { Compare, Lane, Period } from './state';

export const DAY = 86_400_000;
export const PERIODS: { id: Period; label: string }[] = [
  { id: 30, label: 'Last 30 days' },
  { id: 90, label: 'Last 90 days' },
  { id: 365, label: 'Last 12 months' },
  { id: 0, label: 'All time' },
];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const LANE_LABEL: Record<Lane, string> = { organic: 'Organic', ads: 'Ads', crm: 'CRM inbound' };

export const dateOf = (s: string) => new Date(`${s}T00:00:00Z`).getTime();
export const firstAt = (j: FunnelJourney) => j.touches[0]?.at ?? j.createdAt;
export const convertedAt = (j: FunnelJourney) => j.touches.find((t) => t.stage === 'converted')?.at ?? j.touches[j.touches.length - 1]?.at ?? j.createdAt;
export const laneOf = (j: FunnelJourney): Lane => {
  const t = j.touches[0];
  if (t?.source === 'attio' || t?.source === 'ghl') return 'crm';
  if (t?.channel === 'ads') return 'ads';
  return 'organic';
};
export const weekday = (s: string) => (new Date(`${s}T00:00:00Z`).getUTCDay() + 6) % 7;
export const fmtDay = (ms: number, withYear = false) => {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${withYear ? ` ${d.getUTCFullYear()}` : ''}`;
};
export const fmtDate = (s: string) => fmtDay(dateOf(s), true);
export const stageLabel = (id: FunnelStage) => FUNNEL_STAGES.find((s) => s.id === id)?.label ?? id;
export const stageIndex = (id: FunnelStage) => FUNNEL_STAGES.findIndex((s) => s.id === id);

export type PeriodStats = {
  from: number;
  end: number;
  cmp: [number, number] | null;
  leadsIn: FunnelJourney[];
  leadsPrev: FunnelJourney[];
  convIn: FunnelJourney[];
  convPrev: FunnelJourney[];
  revenue: number;
  revenuePrev: number;
  byLane: Record<Lane, number>;
  leadCols: number[];
  convCols: number[];
  leadPeak: string | null;
  convPeak: string | null;
};

/** The period cards' windows and counts (New leads, Converted, Revenue). */
export function periodStats(journeys: FunnelJourney[], now: Date, period: Period, compare: Compare): PeriodStats {
  const end = now.getTime() + DAY;
  const days = period || 100_000;
  const from = end - days * DAY;
  const cmp: [number, number] | null = period === 0 || compare === 'none' ? null : compare === 'year' ? [from - 365 * DAY, end - 365 * DAY] : [from - days * DAY, from];
  const inWin = (ts: number, lo: number, hi: number) => ts >= lo && ts < hi;
  const inCmp = (ts: number) => (cmp ? inWin(ts, cmp[0], cmp[1]) : false);
  const leadsIn = journeys.filter((j) => inWin(dateOf(firstAt(j)), from, end));
  const leadsPrev = journeys.filter((j) => inCmp(dateOf(firstAt(j))));
  const convIn = journeys.filter((j) => j.status === 'converted' && inWin(dateOf(convertedAt(j)), from, end));
  const convPrev = journeys.filter((j) => j.status === 'converted' && inCmp(dateOf(convertedAt(j))));
  const revenue = convIn.reduce((s, j) => s + (j.amountUsd ?? 0), 0);
  const revenuePrev = convPrev.reduce((s, j) => s + (j.amountUsd ?? 0), 0);
  const byLane: Record<Lane, number> = { organic: 0, ads: 0, crm: 0 };
  for (const j of convIn) byLane[laneOf(j)] += j.amountUsd ?? 0;
  const wk = (list: FunnelJourney[], at: (j: FunnelJourney) => string) => {
    const cols = [0, 0, 0, 0, 0, 0, 0];
    for (const j of list) cols[weekday(at(j))]++;
    return cols;
  };
  const leadCols = wk(leadsIn, firstAt);
  const convCols = wk(convIn, convertedAt);
  const peakOf = (cols: number[]) => (Math.max(...cols) > 0 ? WEEKDAYS[cols.indexOf(Math.max(...cols))] : null);
  return { from, end, cmp, leadsIn, leadsPrev, convIn, convPrev, revenue, revenuePrev, byLane, leadCols, convCols, leadPeak: peakOf(leadCols), convPeak: peakOf(convCols) };
}

/** Touches per month (last 6) or per week (last 12), every journey including the archive (it is history). */
export function touchSeries(all: FunnelJourney[], now: Date, grain: 'monthly' | 'weekly'): { series: number[]; labels: string[]; longLabels: string[] } {
  const touches = all.flatMap((j) => j.touches);
  if (grain === 'monthly') {
    const buckets: { key: string; label: string; long: string; n: number }[] = [];
    for (let k = 5; k >= 0; k--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
      buckets.push({ key: d.toISOString().slice(0, 7), label: MONTHS[d.getUTCMonth()], long: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, n: 0 });
    }
    for (const t of touches) {
      const b = buckets.find((x) => x.key === t.at.slice(0, 7));
      if (b) b.n++;
    }
    return { series: buckets.map((b) => b.n), labels: buckets.map((b) => b.label), longLabels: buckets.map((b) => b.long) };
  }
  const weeks = 12;
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY;
  const series = Array.from({ length: weeks }, () => 0);
  const labels = Array.from({ length: weeks }, (_, i) => fmtDay(end - (weeks - i) * 7 * DAY));
  for (const t of touches) {
    const idx = weeks - 1 - Math.floor((end - 1 - dateOf(t.at)) / (7 * DAY));
    if (idx >= 0 && idx < weeks) series[idx]++;
  }
  return { series, labels, longLabels: labels.map((l) => `Week of ${l}`) };
}

/** The step with the biggest drop (the leak), or null. */
export function worstStep(summary: ReturnType<typeof funnelSummary>): { from: FunnelStage; to: FunnelStage; drop: number } | null {
  let w: { from: FunnelStage; to: FunnelStage; drop: number } | null = null;
  for (let i = 1; i < summary.stages.length; i++) {
    const s = summary.stages[i];
    if (s.conversionFromPrev === null) continue;
    const drop = Math.round(100 - s.conversionFromPrev);
    if (w === null || drop > w.drop) w = { from: summary.stages[i - 1].stage, to: s.stage, drop };
  }
  return w;
}

/** The hero's default focus: the stage where the funnel leaks most. */
export function defaultStage(summary: ReturnType<typeof funnelSummary>): FunnelStage {
  let worst: FunnelStage = 'opted_in';
  let worstConv = Infinity;
  for (const s of summary.stages) {
    if (s.conversionFromPrev !== null && s.conversionFromPrev < worstConv) {
      worstConv = s.conversionFromPrev;
      worst = s.stage;
    }
  }
  return worst;
}

/** FR-F8: the table shows this many rows, then "Show 50 more". */
export const PAGE_ROWS = 50;
