/**
 * View model to shared-component props, Classic tree. Pure re-shaping of 01's page models into 02's
 * component props: no number becomes text here (every text arrives formatted) and nothing is computed
 * beyond picking fields.
 */
import type { HeroMetricProps, HeroPage, TileProps, TileViz } from '@/components/lab/v2/shared';
import type { HeroMetricView, HeroPlatform } from '@/lib/lab/view/shared';
import type { PostTileView, TodayPageView } from '@/lib/lab/view/today';
import type { RadarTile } from '@/lib/lab/radar/view';

/**
 * 02 6 sizes the hero dot field for 10 columns a group (the worked example, the 300px width check). A
 * 30-day series is shown as 10 columns, each the median of its days (null when none has data), the same
 * reduction the GladOS tree applies; 7-day series pass through.
 */
export function tenColumns(values: (number | null)[]): (number | null)[] {
  if (values.length <= 14) return values;
  const k = Math.ceil(values.length / 10);
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i += k) {
    const xs = values.slice(i, i + k).filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
    out.push(xs.length ? xs[xs.length >> 1] : null);
  }
  return out;
}

export function heroProps(h: HeroMetricView, format: 'ratio' | 'count', state: HeroMetricProps['state']): HeroMetricProps {
  return {
    id: h.id === 'your_normal' ? 'normal-ratio' : 'breakouts',
    label: h.label,
    value: h.value.value,
    valueText: h.value.enough ? h.value.text : null,
    format,
    n: h.value.n,
    nText: h.nText,
    delta: h.value.enough && h.delta.text ? { text: h.delta.text, dir: h.delta.tone === 'up' ? 'up' : h.delta.tone === 'down' ? 'down' : 'flat' } : null,
    groups: [
      { id: 'prev', label: h.dots.prevLabel, values: tenColumns(h.dots.prev), emphasis: 'prev' },
      { id: 'curr', label: h.dots.currLabel, values: tenColumns(h.dots.curr), emphasis: 'current' },
    ],
    href: h.href,
    state: h.value.enough ? state : 'thin',
  };
}

const PAGE_ID: Record<HeroPlatform, HeroPage['id']> = { all: 'all', instagram: 'instagram', tiktok: 'tiktok', youtube: 'youtube', linkedin: 'linkedin', twitter: 'x' };
export const heroPageId = (p: HeroPlatform): HeroPage['id'] => PAGE_ID[p];
export const heroPlatformOf = (id: HeroPage['id']): HeroPlatform => (id === 'x' ? 'twitter' : id);

/** `countUp`: while the today intro plays, the shown platform's numerals read the count-up frame (03.4). */
export type HeroCountUp = { platform: HeroPlatform; yourNormal: string | null; breakouts: string | null } | null;

export function heroPages(v: TodayPageView, countUp: HeroCountUp = null): HeroPage[] {
  const state: HeroMetricProps['state'] = v.frame.mode.sample ? 'sample' : 'ready';
  return v.heroPlatforms.flatMap((p) => {
    const h = v.heroes[p.id];
    if (!h) return [];
    const a = heroProps(h.yourNormal, 'ratio', state), b = heroProps(h.breakouts, 'count', state);
    if (countUp && countUp.platform === p.id) {
      if (a.valueText && countUp.yourNormal) a.valueText = countUp.yourNormal;
      if (b.valueText && countUp.breakouts) b.valueText = countUp.breakouts;
    }
    return [{ id: PAGE_ID[p.id], label: p.label, heroes: [a, b] as [HeroMetricProps, HeroMetricProps] }];
  });
}

export function postTileProps(t: PostTileView): TileProps {
  const r = t.read;
  const state: TileProps['state'] = r.state === 'too_new' ? 'too-new' : r.state === 'judged' ? 'ready' : r.state === 'not_built' ? 'ready' : 'thin';
  const viz: TileViz | null = t.curve && t.curve.points.length >= 2
    ? {
        kind: 'band',
        ageH: t.curve.points[t.curve.points.length - 1].h,
        points: t.curve.points.map((p) => ({ h: p.h, v: p.views })),
        band: t.curve.band.map((b) => ({ h: b.h, lo: b.lo, hi: b.hi, mid: Math.sqrt(b.lo * b.hi) })),
      }
    : null;
  return {
    id: `post-${t.postId}`,
    title: t.title,
    href: t.href,
    value: r.ratio,
    valueText: state === 'ready' ? r.text : null,
    format: 'ratio',
    n: r.state === 'not_built' ? Math.max(r.n, 5) : r.n,
    nText: `n ${r.n}`,
    foot: `${t.platformLabel}, ${t.footer}`,
    viz,
    state,
  };
}

/**
 * The tile wave (02 8.1): 05's cumulative creators-per-hour series resampled into equal time steps from
 * launch to now (6h, widened so there are at most 28 columns), starting at 0 at launch so a launch whose
 * first hour already holds every creator draws as a rise, not a flat slab. Same resampling as the GladOS
 * tree; each tile reads on its own axis, as the frames draw it (its foot carries the "k of n").
 */
export function waveBuckets(series: readonly { h: number; creators: number }[]): number[] {
  if (series.length < 2) return [];
  const maxH = series[series.length - 1].h;
  const size = Math.max(6, Math.ceil(maxH / 26 / 6) * 6);
  const at = (h: number) => {
    let c = 0;
    for (const p of series) {
      if (p.h > h) break;
      c = p.creators;
    }
    return c;
  };
  const out: number[] = [0];
  for (let h = 0; h < maxH; h += size) out.push(at(h));
  out.push(at(maxH));
  return out;
}

export function radarTileProps(t: RadarTile): TileProps {
  const buckets = waveBuckets(t.series);
  const s = t.stateLabel.toLowerCase();
  const win: 'open' | 'closing' | 'closed' = s.includes('clos') && !s.includes('closing') ? 'closed' : s.includes('closing') ? 'closing' : 'open';
  return {
    id: `event-${t.eventId}`,
    title: t.name,
    href: t.href,
    value: null,
    valueText: t.ageLabel,
    format: 'hours',
    n: 5,
    nText: t.waveLabel,
    foot: t.coverageLabel,
    viz: buckets.length > 1 ? { kind: 'wave', buckets, nowIndex: buckets.length - 1, window: win } : null,
    state: 'ready',
    valueWords: t.ageLabel,
  };
}


