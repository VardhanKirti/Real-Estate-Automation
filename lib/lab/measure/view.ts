/**
 * Measure view builders (04 section 7; 01 D13). Section 01 owns the AgeMatchedView type; lane D
 * owns these builders. Pure: every function takes its rows and `now`.
 */
import type { LabMeasureV2, LabPlatform, LabPost } from '@/lib/schemas';
import type { AgeMatchedView, HeroPlatform } from '@/lib/lab/view/shared';
import { judgeAge, judgeAgesFor } from '@/lib/lab/measure/age';
import { MIN_N } from '@/lib/lab/measures';

export { isBreakoutV2, isDualHigh } from '@/lib/lab/measure/breakout';

/** 04 7 copy (the values LAB_COPY carries; section 01 owns the file). */
export const MEASURE_COPY = {
  tooNew: 'too new',
  notEnough: 'not enough yet',
  notLive: 'not live yet',
  at: 'at {age}',
  projected: 'Compared with their 14-day normal, scaled to this age',
  volBand: 'Usually lands between {lo} and {hi} of normal (n {n})',
  insideSwing: '{ratio} their normal, inside their usual swing (n {n})',
  exoAuto: 'Possible outside push (views jumped after day 2)',
  exoManual: 'Outside push: {reason}. Counted in your stats, left out of patterns',
  xProxy: 'X action score, a proxy: link shares, DM shares and negative signals are not public',
  liBasis: 'Judged on reactions, LinkedIn shows no views',
  shortsEpoch: "Counted under YouTube's old Shorts view rule",
  thinned: 'Thinned: reading at 6h, 24h, 72h, 7d, 14d to stay under the cap',
  bhHidden: '{n} more patterns looked strong but did not survive the false-discovery check',
  profileNotEnough: 'Not enough yet: {cases} breakouts and {controls} comparison posts, needs 8 of each',
} as const;

/** One decimal, always (01 C7): 1.4x, 12.6x. */
const ratioText = (r: number): string => `${(Math.round(r * 10) / 10).toFixed(1)}x`;
const AGE_LABEL: Record<number, string> = { 6: '6h', 24: '24h', 72: '3d', 168: '7d' };

const NOT_BUILT: AgeMatchedView = { state: 'not_built', atH: null, atLabel: null, ratio: null, ratioText: null, lo: null, hi: null, rangeText: null, n: 0, text: MEASURE_COPY.notLive, nextAtH: null };

/** Section 01 AgeMatchedView, from a lab_measures row and the post's age now. */
export function ageMatchedView(m: LabMeasureV2 | null, post: Pick<LabPost, 'postedAt' | 'platform'>, now: Date, layerBuilt: boolean): AgeMatchedView {
  if (!layerBuilt) return NOT_BUILT;
  const ageH = post.postedAt ? (now.getTime() - Date.parse(post.postedAt)) / 3_600_000 : null;
  const at = ageH === null ? null : judgeAge(ageH, post.platform);
  const ages = judgeAgesFor(post.platform);
  if (at === null) {
    return { state: 'too_new', atH: null, atLabel: null, ratio: null, ratioText: null, lo: null, hi: null, rangeText: null, n: 0, text: MEASURE_COPY.tooNew, nextAtH: ageH === null ? null : 24 };
  }
  const next = (ages.find((a) => a > at) ?? null) as 24 | 72 | 168 | null;
  const read = m?.ages?.[String(at)];
  const ratio = read?.ratio ?? (m && m.judgedAgeH === at ? m.breakout : null);
  const lo = read ? read.lo : m && m.judgedAgeH === at ? m.breakoutLo : null;
  const hi = read ? read.hi : m && m.judgedAgeH === at ? m.breakoutHi : null;
  const n = read?.n ?? (m && m.judgedAgeH === at ? m.baselineN : 0);
  const atLabel = MEASURE_COPY.at.replace('{age}', AGE_LABEL[at]);
  if (ratio === null || ratio === undefined || n < MIN_N) {
    return { state: 'no_baseline', atH: at, atLabel, ratio: null, ratioText: null, lo: null, hi: null, rangeText: null, n, text: MEASURE_COPY.notEnough, nextAtH: next };
  }
  return {
    state: 'judged',
    atH: at,
    atLabel,
    ratio,
    ratioText: ratioText(ratio),
    lo: lo ?? null,
    hi: hi ?? null,
    rangeText: lo !== null && lo !== undefined && hi !== null && hi !== undefined ? `${ratioText(lo)} to ${ratioText(hi)}` : null,
    n,
    text: ratioText(ratio),
    nextAtH: next,
  };
}

const inRange = (iso: string, from: string, to: string) => iso >= from && iso < to;
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};
const onPlatform = (p: LabPlatform, h: HeroPlatform) => h === 'all' || p === h;

/**
 * Hero "Your posts vs your normal": the median age-matched ratio of owned posts judged in the
 * period (posted in [from, to)), and the previous period [prevFrom, from). Null under n 5.
 * Outside pushes count here (they are Brody's real results; 3.10).
 */
export function heroNormal(rows: readonly { postedAt: string; ratio: number | null; platform: LabPlatform }[], period: { from: string; to: string; prevFrom: string }, platform: HeroPlatform): { value: number | null; n: number; prev: number | null; prevN: number; enough: boolean } {
  const cur = rows.filter((r) => onPlatform(r.platform, platform) && r.ratio !== null && inRange(r.postedAt, period.from, period.to)).map((r) => r.ratio!);
  const prev = rows.filter((r) => onPlatform(r.platform, platform) && r.ratio !== null && inRange(r.postedAt, period.prevFrom, period.from)).map((r) => r.ratio!);
  const enough = cur.length >= MIN_N;
  return { value: enough ? median(cur) : null, n: cur.length, prev: prev.length >= MIN_N ? median(prev) : null, prevN: prev.length, enough };
}

/** Hero "Breakouts in your niche": tracked posts judged in the period, and how many are breakouts. */
export function heroBreakouts(rows: readonly { postedAt: string; isBreakout: boolean; owned: boolean; platform: LabPlatform }[], period: { from: string; to: string; prevFrom: string }, platform: HeroPlatform): { value: number; n: number; prev: number; judged: number } {
  const tracked = rows.filter((r) => !r.owned && onPlatform(r.platform, platform));
  const cur = tracked.filter((r) => inRange(r.postedAt, period.from, period.to));
  const prev = tracked.filter((r) => inRange(r.postedAt, period.prevFrom, period.from));
  return { value: cur.filter((r) => r.isBreakout).length, n: cur.length, prev: prev.filter((r) => r.isBreakout).length, judged: cur.length };
}

/** Your posts tile mini viz: the post's ratio at each reached age (from lab_measures.ages_json). */
export function ratioCurve(m: LabMeasureV2): { ageH: number; ratio: number }[] {
  return Object.entries(m.ages ?? {})
    .filter(([, a]) => a.ratio !== null && a.n >= MIN_N)
    .map(([k, a]) => ({ ageH: Number(k), ratio: a.ratio as number }))
    .sort((a, b) => a.ageH - b.ageH);
}
