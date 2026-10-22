/**
 * View helpers for the /social GladOS tree (glados-ui SPEC S03 F3 to F5, §8
 * edge 7). Pure, no DB: the server passes raw series, the client slices them
 * by the one page range, so every figure on the page moves together.
 */
import { bucketPostingByDay, dateAxis, forwardFillCarried, platformsPresent, type PostDay } from '@/lib/posting-activity';
import { channelsNetChange, rangeWindow, type NetChange, type RangePoint, type SocialRange } from '@/lib/social-range';

export const RANGE_OPTIONS: { value: string; label: string; range: SocialRange }[] = [
  { value: '7', label: '7d', range: 7 },
  { value: '30', label: '30d', range: 30 },
  { value: '60', label: '60d', range: 60 },
  { value: 'all', label: 'All', range: 'all' },
];

/** `?range=` → a SocialRange; anything else is the default 30 days. */
export function parseRange(raw: string | string[] | null | undefined): SocialRange {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return RANGE_OPTIONS.find((o) => o.value === v)?.range ?? 30;
}

export const rangeParam = (r: SocialRange): string => String(r);

/** "over 30 days" / "all time". */
export function rangePhrase(r: SocialRange): string {
  return r === 'all' ? 'all time' : `over ${r} days`;
}

/** At most this many marks per chart (edge 7): longer windows bucket by week. */
export const MAX_MARKS = 120;

export function fmtDay(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export type AudienceChartModel = {
  /** One label per mark ("Aug 24" or "Week of Aug 18"). */
  labels: string[];
  axisLabels: string[];
  values: (number | null)[];
  carried: boolean[];
  /** Per mark: the date the value came from. */
  from: (string | null)[];
  /** Per mark, per platform: posts in that mark. */
  posts: Record<string, number>[];
  /** Platforms that posted in the window, in stack order. */
  platforms: string[];
  /** Posts per platform over the window. */
  postTotals: Record<string, number>;
  /** "+N net" over the window (the same helper as the hero, H18). */
  net: NetChange | null;
  stale: boolean;
  lastSynced: string | null;
  weekly: boolean;
};

const PREFERRED = ['instagram', 'tiktok', 'twitter', 'youtube', 'linkedin', 'facebook'];

/**
 * The combined audience line and the posting bars on one axis (S03 F4). The
 * window ends on the newest audience point; the axis runs on to today so a
 * stale sync plots as a carried (dashed) tail. Over MAX_MARKS days the marks
 * are weeks: the audience takes each week's last value, posts are summed.
 */
export function audienceChartModel(input: {
  audience: RangePoint[];
  channels: RangePoint[][];
  postDays: PostDay[];
  range: SocialRange;
  today: string;
}): AudienceChartModel {
  const { audience, channels, postDays, range, today } = input;
  const sorted = [...audience].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const dates = [...sorted.map((a) => a.date), ...postDays.map((p) => p.date)].sort();
  const window = rangeWindow(range, sorted.at(-1)?.date ?? null, today, dates[0] ?? null);
  const axis = dateAxis(window.start, window.axisEnd);
  const filled = forwardFillCarried(sorted, axis);
  const inRange = postDays.filter((p) => p.date >= window.start && p.date <= window.axisEnd);
  const days = bucketPostingByDay(inRange, axis);
  const platforms = platformsPresent(inRange, PREFERRED);
  const postTotals: Record<string, number> = {};
  for (const d of days) for (const p of platforms) postTotals[p] = (postTotals[p] ?? 0) + (d.counts[p] ?? 0);
  const net = channelsNetChange(channels.length > 0 ? channels : [sorted], range, today);

  const weekly = axis.length > MAX_MARKS;
  if (!weekly) {
    const labels = axis.map(fmtDay);
    return {
      labels,
      axisLabels: axis.map((d, i) => (i === axis.length - 1 && d === today ? 'today' : fmtDay(d))),
      values: filled.values,
      carried: filled.carried,
      from: filled.from,
      posts: days.map((d) => d.counts),
      platforms,
      postTotals,
      net,
      stale: window.stale,
      lastSynced: sorted.at(-1)?.date ?? null,
      weekly,
    };
  }
  // Weeks counted back from the axis end, so the newest mark is a full week.
  const labels: string[] = [];
  const values: (number | null)[] = [];
  const carried: boolean[] = [];
  const from: (string | null)[] = [];
  const posts: Record<string, number>[] = [];
  const first = (axis.length - 1) % 7;
  for (let s = first - 6; s < axis.length; s += 7) {
    const lo = Math.max(0, s);
    const hi = s + 6;
    const last = hi;
    labels.push(`Week of ${fmtDay(axis[lo])}`);
    values.push(filled.values[last]);
    carried.push(filled.carried[last]);
    from.push(filled.from[last]);
    const counts: Record<string, number> = {};
    for (let i = lo; i <= hi; i++) for (const [k, v] of Object.entries(days[i].counts)) counts[k] = (counts[k] ?? 0) + v;
    posts.push(counts);
  }
  return {
    labels,
    axisLabels: labels.map((l) => l.replace('Week of ', '')),
    values,
    carried,
    from,
    posts,
    platforms,
    postTotals,
    net,
    stale: window.stale,
    lastSynced: sorted.at(-1)?.date ?? null,
    weekly,
  };
}

/**
 * The hero strip: one tick per day of the window (the summed audience),
 * capped at `max` ticks by keeping each bucket's last value.
 */
export function stripValues(audience: RangePoint[], range: SocialRange, today: string, max = 60): { values: number[]; titles: string[] } {
  const sorted = [...audience].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (sorted.length === 0) return { values: [], titles: [] };
  const window = rangeWindow(range, sorted.at(-1)!.date, today, sorted[0].date);
  const axis = dateAxis(window.start, window.end);
  const filled = forwardFillCarried(sorted, axis);
  const step = Math.max(1, Math.ceil(axis.length / max));
  const values: number[] = [];
  const titles: string[] = [];
  for (let end = axis.length - 1; end >= 0; end -= step) {
    const v = filled.values[end];
    if (v == null) continue;
    values.unshift(v);
    titles.unshift(`${fmtDay(axis[end])} · ${v.toLocaleString('en-US')}`);
  }
  return { values, titles };
}

/** "+7.01%" / "−1.2%" / "—". */
export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const r = Math.abs(n) < 10 ? Math.abs(n).toFixed(2) : Math.abs(n).toFixed(1);
  return `${n >= 0 ? '+' : '−'}${r}%`;
}

/** Every platform the composer offers, in series order (C19). */
export const SOCIAL_PLATFORMS_ORDER = ['instagram', 'tiktok', 'youtube', 'linkedin', 'twitter'] as const;
