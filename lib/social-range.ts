/**
 * One range model for every Social total and delta (SPEC S03 §7, H17, H18).
 *
 * The audience tile, the combined-audience chart's "+N net", the pop-out
 * growth rows and /analytics all measure a range the same way, so the same
 * range can never print two different answers on one screen.
 *
 * The clock is the data's: a range ends on the newest data point and starts
 * `days` before it, the baseline is the value carried in at the start (the
 * newest point at or before it). The chart axis runs on to today, so a stale
 * sync shows as a carried (dashed) tail, never as an empty chart.
 *
 * Pure, no DB, safe in client components.
 */

export type SocialRange = 7 | 30 | 60 | 'all';
export const SOCIAL_RANGES: SocialRange[] = [7, 30, 60, 'all'];

export type RangePoint = { date: string; value: number };

export type RangeWindow = {
  range: SocialRange;
  /** First day of the measured window (the baseline is carried in at it). */
  start: string;
  /** Last day of the measured window: the newest data date, or today. */
  end: string;
  /** Where a chart axis ends: max(today, end). */
  axisEnd: string;
  /** The newest data is older than 48h. */
  stale: boolean;
};

const DAY_MS = 86_400_000;
const STALE_MS = 2 * DAY_MS;

const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * The window a range measures. `newestDate` is the newest data point (null
 * when there is no data: the window then ends today); `firstDate` is the
 * oldest point, used by "all".
 */
export function rangeWindow(
  range: SocialRange,
  newestDate: string | null,
  today: string,
  firstDate: string | null = null,
): RangeWindow {
  const end = newestDate ?? today;
  const start = range === 'all' ? (firstDate && firstDate <= end ? firstDate : end) : iso(ms(end) - range * DAY_MS);
  const axisEnd = end > today ? end : today;
  const stale = newestDate != null && ms(today) - ms(newestDate) >= STALE_MS;
  return { range, start, end, axisEnd, stale };
}

/** The window for a whole series (its own newest and oldest dates). */
export function seriesWindow(range: SocialRange, series: RangePoint[], today: string): RangeWindow {
  return rangeWindow(range, series.at(-1)?.date ?? null, today, series[0]?.date ?? null);
}

/** Newest point at or before `date` in an oldest → newest series. */
function carriedAt(series: RangePoint[], date: string): RangePoint | null {
  let hit: RangePoint | null = null;
  for (const p of series) {
    if (p.date <= date) hit = p;
    else break;
  }
  return hit;
}

export type NetChange = {
  baseline: number;
  current: number;
  /** current − baseline, in the series' unit. */
  net: number;
  /** Percent change, or null when the baseline is zero. */
  pct: number | null;
};

/**
 * Change over a window: the value at its end minus the value carried in at
 * its start. Null (honest, never a fake zero) when the series has fewer than
 * two points or does not reach back to the window start.
 */
export function netChange(series: RangePoint[], window: RangeWindow): NetChange | null {
  if (series.length < 2) return null;
  const current = carriedAt(series, window.end);
  const baseline = carriedAt(series, window.start);
  if (!current || !baseline) return null;
  const net = current.value - baseline.value;
  return {
    baseline: baseline.value,
    current: current.value,
    net,
    pct: baseline.value === 0 ? null : (net / baseline.value) * 100,
  };
}

/**
 * Change of a total made of several channels (the audience: each platform
 * plus email). Each channel is measured over the same window and counts
 * only when it reaches back to the window start with a non-zero baseline, so
 * connecting a new channel never reads as growth. "all" measures each
 * channel from its own first point. Null when no channel qualifies.
 */
export function channelsNetChange(channels: RangePoint[][], range: SocialRange, today: string): NetChange | null {
  const newest = channels.reduce<string | null>((max, s) => {
    const d = s.at(-1)?.date ?? null;
    return d && (!max || d > max) ? d : max;
  }, null);
  let baseline = 0;
  let current = 0;
  let qualified = 0;
  for (const s of channels) {
    const window = range === 'all' ? rangeWindow('all', newest, today, s[0]?.date ?? null) : rangeWindow(range, newest, today);
    const c = netChange(s, window);
    if (!c || c.baseline === 0) continue;
    baseline += c.baseline;
    current += c.current;
    qualified += 1;
  }
  if (qualified === 0) return null;
  const net = current - baseline;
  return { baseline, current, net, pct: baseline === 0 ? null : (net / baseline) * 100 };
}

/** The points a chart plots for a window: the carried-in baseline pinned to
 * the window start, then every point inside it. */
export function windowPoints(series: RangePoint[], window: RangeWindow): RangePoint[] {
  const inside = series.filter((p) => p.date > window.start && p.date <= window.end);
  const base = carriedAt(series, window.start);
  return base ? [{ date: window.start, value: base.value }, ...inside] : inside;
}
