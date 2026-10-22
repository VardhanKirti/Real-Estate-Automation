/**
 * Pure helpers for the home posting/comms chart (SPEC S10 FR-11). The chart
 * draws at its real pixel width, so these decide how many bars fit and which
 * month labels have room. Dates are UTC day keys (YYYY-MM-DD).
 *
 * Bucketing is honest: a weekly bucket is the plain sum of the days in the
 * window that fall in that ISO week. Nothing is interpolated or smoothed.
 */

export type ChartSeries = { key: string; points: number[] };
export type ChartTick = { i: number; label: string };

export type BucketedChart<S extends ChartSeries> = {
  /** One key per bar: the day itself, or the Monday that starts the week. */
  days: string[];
  /** Tooltip heading per bar: "Oct 6" or "Week of Sep 8". */
  labels: string[];
  series: S[];
  /** True when the bars are ISO weeks rather than days. */
  weekly: boolean;
};

const DAY_MS = 86_400_000;

function utc(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** "Oct 6" for a UTC day key. */
export function dayLabel(day: string): string {
  return utc(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** The Monday (UTC) of the ISO week holding `day`, as a day key. */
export function isoWeekStart(day: string): string {
  const d = utc(day);
  const back = (d.getUTCDay() + 6) % 7; // Mon 0 … Sun 6
  return new Date(d.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Keep one bar per day while each bar gets at least `minBarPx` of the plot
 * width; below that, sum the days into ISO weeks.
 */
export function bucketSeries<S extends ChartSeries>(days: string[], series: S[], plotW: number, minBarPx = 5): BucketedChart<S> {
  if (days.length === 0 || plotW / days.length >= minBarPx) {
    return { days, labels: days.map(dayLabel), series, weekly: false };
  }
  const weeks: string[] = [];
  const index: number[] = [];
  for (const d of days) {
    const w = isoWeekStart(d);
    if (weeks[weeks.length - 1] !== w) weeks.push(w);
    index.push(weeks.length - 1);
  }
  const summed = series.map((s) => {
    const points = new Array<number>(weeks.length).fill(0);
    days.forEach((_, i) => {
      points[index[i]] += s.points[i] ?? 0;
    });
    return { ...s, points };
  });
  return { days: weeks, labels: weeks.map((w) => `Week of ${dayLabel(w)}`), series: summed, weekly: true };
}

/** One tick per month: the first bar whose key falls in a new month, labelled "Oct". */
export function monthTicks(days: string[]): ChartTick[] {
  const out: ChartTick[] = [];
  let last = '';
  days.forEach((d, i) => {
    const m = d.slice(0, 7);
    if (m !== last) {
      last = m;
      out.push({ i, label: utc(d).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) });
    }
  });
  return out;
}

/** Drop any tick whose x is within `minGapPx` of the last tick kept. */
export function visibleTicks(ticks: ChartTick[], xOf: (i: number) => number, minGapPx = 28): ChartTick[] {
  const out: ChartTick[] = [];
  let lastX = -Infinity;
  for (const t of ticks) {
    const x = xOf(t.i);
    if (x - lastX < minGapPx) continue;
    out.push(t);
    lastX = x;
  }
  return out;
}

/** Chart height for a measured width: today's 940x420 ratio, clamped to 180..420. */
export function chartHeight(width: number): number {
  return Math.min(420, Math.max(180, Math.round(width * 0.447)));
}
