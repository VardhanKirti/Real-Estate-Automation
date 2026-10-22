/**
 * View model to shared-component props, GladOS tree. Pure presentation: no maths beyond grouping
 * already-computed daily values into at most 12 dot columns (03.3.1, 02 6), and every number arrives
 * as 01's text.
 */
import type { DotGroup, HeroMetricProps, TileProps, TileViz } from '@/components/lab/v2/shared';
import type { HeroMetricView } from '@/lib/lab/view/shared';
import type { PostTileView } from '@/lib/lab/view/today';
import type { RadarTile } from '@/lib/lab/radar/view';

/** At most 12 columns per group: consecutive days merged by their mean, nulls stay null. */
export function columns(values: (number | null)[], max = 12): (number | null)[] {
  if (values.length <= max) return values;
  const size = Math.ceil(values.length / max);
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i += size) {
    const xs = values.slice(i, i + size).filter((v): v is number => v !== null && Number.isFinite(v));
    out.push(xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  }
  return out;
}

const clip = (v: number | null, max: number) => (v === null ? null : Math.min(v, max));

export function heroProps(h: HeroMetricView, opts: { sample: boolean; valueText?: string }): HeroMetricProps {
  const groups: DotGroup[] = [
    { id: `${h.id}-prev`, label: h.dots.prevLabel, values: columns(h.dots.prev).map((v) => clip(v, h.dots.scaleMax)), emphasis: 'prev' },
    { id: `${h.id}-curr`, label: h.dots.currLabel, values: columns(h.dots.curr).map((v) => clip(v, h.dots.scaleMax)), emphasis: 'current' },
  ];
  const n = h.value.n;
  const state: HeroMetricProps['state'] = n === 0 && h.value.value === null ? 'empty' : !h.value.enough ? 'thin' : opts.sample ? 'sample' : 'ready';
  const deltaWords =
    h.delta.text && h.delta.tone
      ? `${h.delta.tone === 'up' ? 'up' : h.delta.tone === 'down' ? 'down' : 'flat'} ${h.delta.text.replace(/^[+−-]/, '').replace('%', ' percent')}`
      : undefined;
  return {
    id: h.id,
    label: h.label,
    value: h.value.value,
    valueText: opts.valueText ?? h.value.text,
    format: h.id === 'your_normal' ? 'ratio' : 'count',
    n,
    nText: h.nText,
    delta: h.delta.text && h.delta.tone ? { text: h.delta.text, dir: h.delta.tone } : null,
    deltaWords,
    groups,
    href: h.href,
    state,
  };
}

export function postTileProps(t: PostTileView): TileProps {
  const viz: TileViz | null = t.curve
    ? {
        kind: 'band',
        ageH: Math.max(...t.curve.points.map((p) => p.h), 1),
        points: t.curve.points.map((p) => ({ h: p.h, v: p.views })),
        band: t.curve.band.map((b) => ({ h: b.h, lo: b.lo, hi: b.hi, mid: Math.sqrt(Math.max(1, b.lo) * Math.max(1, b.hi)) })),
      }
    : null;
  const state: TileProps['state'] = t.read.state === 'judged' ? 'ready' : t.read.state === 'too_new' ? 'too-new' : 'thin';
  return {
    id: t.postId,
    title: t.title,
    href: t.href,
    value: t.read.ratio,
    valueText: t.read.state === 'judged' ? t.read.text : null,
    format: 'ratio',
    n: t.read.n,
    nText: `n ${t.read.n}`,
    foot: t.read.state === 'too_new' ? `${t.platformLabel}, ${t.footer}` : `${t.platformLabel}, ${t.footer}`,
    viz,
    state,
    sharedId: `post-${t.postId}`,
  };
}

/**
 * The coverage wave as the frames draw it (lib/lab/view/frames.ts): creators covering so far, read at
 * 6 h steps from launch to now (steps widened so there are at most 28 columns), ending on the tile's
 * "k of n in". 05's waveSeries is that same cumulative count per hour, so this only resamples it.
 */
export function waveBuckets(series: { h: number; creators: number }[]): number[] {
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
  // The wave starts at launch, when nobody had covered it yet: without that zero a launch whose
  // first hour already holds every creator draws as a flat slab instead of a rise.
  const out: number[] = [0];
  for (let h = 0; h < maxH; h += size) out.push(at(h));
  out.push(at(maxH));
  return out.length >= 2 ? out : [];
}

export function radarTileProps(t: RadarTile): TileProps {
  const closing = /clos/i.test(t.stateLabel);
  // The series is cumulative creators per hour since launch (05 coverage.waveSeries): sample it evenly
  // into at most 28 columns across the whole window, so the wave shows its rise, not the flat tail.
  const buckets = waveBuckets(t.series);
  return {
    id: t.eventId,
    title: t.name,
    href: t.href.startsWith('?') ? t.href : `?event=${t.eventId}`,
    value: null,
    valueText: t.ageLabel,
    format: 'hours',
    n: 5,
    nText: '',
    foot: [t.coverageLabel, t.waveLabel].filter(Boolean).join(', '),
    viz: buckets.length > 1 ? { kind: 'wave', buckets, nowIndex: buckets.length - 1, window: closing ? 'closing' : 'open' } : null,
    state: 'ready',
    sharedId: `event-${t.eventId}`,
    valueWords: t.ageLabel,
  };
}
