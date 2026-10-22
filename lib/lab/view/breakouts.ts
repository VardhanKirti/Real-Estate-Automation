/**
 * Breakouts (`/lab/breakouts`) page model (01 9.2) and its builder. Reads 04's ageMatchedView and
 * the stored isBreakout / dualHigh verdicts (04 isBreakoutV2, isDualHigh) unchanged.
 */
import type { LabMeasureV2, LabPost, LabQuadrant } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import type { LabContext } from '@/lib/lab/context';
import type { LabParams } from '@/lib/lab/view/shared';
import { context, field, familyLabel, specimen, PLATFORM_LABEL, QUADRANT_LABEL } from '@/lib/lab/view/legacy';
import { currentGates } from '@/lib/lab/setup/forecasts';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fill, fmtRatio } from '@/lib/lab/view/format';
import { readOf } from '@/lib/lab/view/posts';
import { READY, section, state, withSample } from '@/lib/lab/view/section';
import type { FieldView, Measured, SpecimenCard } from '@/lib/lab/view/legacy';
import type { AgeMatchedView, LabPlatformId, SectionState } from '@/lib/lab/view/shared';
import type { LabFrameView } from '@/lib/lab/view/frame';
import type { SheetPayload } from '@/lib/lab/view/index';
import type { GateEta } from '@/lib/lab/setup/gates';

export type BreakoutsPageView = {
  frame: LabFrameView;
  sheet: SheetPayload | null;
  filters: {
    platforms: { id: LabPlatformId; label: string; n: number }[];
    formats: { id: string; label: string; n: number }[];
    quadrants: { id: 'ideal' | 'loyal' | 'clickbait' | 'dud'; label: string; n: number }[];
    windows: [7, 30, 90];
    /** layers.measure live */
    dualHighAvailable: boolean;
  };
  /** 09.3.8, the same predictGates() result that fills SetupView.gates; null in sample until computed. Empty state only (9.3) */
  gates: GateEta[] | null;
  applied: { platform: LabPlatformId | null; format: string | null; quadrant: string | null; window: 7 | 30 | 90; dual: boolean; mine: boolean; creator: { id: string; label: string } | null };
  /** null when nothing applied */
  clearHref: string | null;
  field: { state: SectionState; view: FieldView & { dualHighIds: string[] } };
  cards: { state: SectionState; items: PostCardView[]; total: number; nextOffset: number | null };
  /** "Ratios compare against mature posts until age matching is live." when measure not built */
  measureNote: string | null;
};

export type PostCardView = SpecimenCard & {
  /** replaces ladder as the headline number when measure live */
  read: AgeMatchedView;
  /** views over niche median at the same age (section 04) */
  nicheRatio: Measured;
  /** section 04 isDualHigh(creatorRatio, nicheRatio): both >= 3 */
  dualHigh: boolean;
  confidenceBars: { lo: number | null; hi: number | null; point: number | null; scaleMax: number };
  /** flagged outside push; excluded from mining */
  exogenous: boolean;
};

/* ── builder (01 9) ───────────────────────────────────────────────────── */

const DAY = 86_400_000;
export const BREAKOUTS_PAGE = 60;

export function postCardView(c: ReturnType<typeof context>, p: LabPost, now: Date, sample: boolean): PostCardView {
  const m = (c.measures.get(p.id) ?? null) as LabMeasureV2 | null;
  const spec = specimen(c, p);
  const niche = m?.nicheRatio ?? null;
  const nicheOk = niche !== null && (m?.baselineN ?? 0) >= 5;
  const read = readOf(m, p, now);
  const point = read.state === 'judged' ? read.ratio : spec.ladder.ratio;
  const hi = read.state === 'judged' ? read.hi : spec.ladder.hi;
  return {
    ...spec,
    href: withSample(`?post=${encodeURIComponent(p.id)}`, sample),
    read,
    nicheRatio: { value: nicheOk ? niche : null, n: m?.baselineN ?? 0, enough: nicheOk, text: nicheOk ? fmtRatio(niche!) : null },
    dualHigh: Boolean(m?.dualHigh),
    confidenceBars: { lo: read.state === 'judged' ? read.lo : spec.ladder.lo, hi, point, scaleMax: Math.max(5, Math.ceil(hi ?? point ?? 0)) },
    exogenous: Boolean(p.exoReason) || Boolean(m?.exoAuto),
  };
}

export function gatesLine(gates: BreakoutsPageView['gates']): string | null {
  if (!gates) return null;
  const wk = gates.find((g) => g.gate === 'breakouts_week' && g.platform === 'all') ?? gates.find((g) => g.gate === 'breakouts_week');
  const base = gates.find((g) => g.gate === 'baseline_24h' && g.platform === 'all') ?? gates.find((g) => g.gate === 'baseline_24h');
  if (!wk || !base || wk.state === 'blocked' || base.state === 'blocked' || wk.rate === null) return null;
  const d = base.state === 'met' ? 0 : base.days ? Math.round(base.days.med) : null;
  if (d === null) return null;
  return fill(LAB_COPY.breakouts.gatesLine, { n: Math.round(wk.rate), d });
}

export function buildBreakouts(store: LabStore, params: LabParams, flags: LabContext['flags'], now: Date, inp: { frame: LabFrameView; sheet: SheetPayload | null; from?: number }): BreakoutsPageView {
  const sample = Boolean(flags.sample);
  const b = LAB_COPY.breakouts;
  const measureLive = inp.frame.layers.measure === 'live';
  const creatorSrc = params.creator ? store.sources.get(params.creator) : null;
  const creator = creatorSrc ? { id: creatorSrc.id, label: creatorSrc.handle ? `@${creatorSrc.handle.replace(/^@/, '')}` : creatorSrc.displayName } : null;
  const applied = { platform: params.platform, format: params.format, quadrant: params.quadrant as string | null, window: params.window, dual: params.dual && measureLive, mine: params.mine, creator };
  const any = applied.platform || applied.format || applied.quadrant || applied.window !== 30 || applied.dual || applied.mine || applied.creator;
  const view: BreakoutsPageView = {
    frame: inp.frame,
    sheet: inp.sheet,
    filters: { platforms: [], formats: [], quadrants: [], windows: [7, 30, 90], dualHighAvailable: measureLive },
    gates: null,
    applied,
    clearHref: any ? withSample('/lab/breakouts', sample) : null,
    field: { state: state('empty'), view: { points: [], medians: { breakout: null, depth: null }, domain: { x: [0.1, 10], y: [0.005, 0.2] }, counts: { ideal: 0, loyal: 0, clickbait: 0, dud: 0 }, newBreakouts: 0, strong: 0, n: 0, enough: false, dualHighIds: [] } },
    cards: { state: state('empty', b.noPosts, { label: LAB_COPY.frame.runNow, href: '#run' }), items: [], total: 0, nextOffset: null },
    measureNote: measureLive ? null : b.measureNote,
  };
  if (inp.frame.mode.state === 'not_configured') return view;
  const P = 'breakouts';
  const c = context(store, now, new Date(now.getTime() - 7 * DAY));
  const fromT = now.getTime() - params.window * DAY;
  const inWindow = c.posts.filter((p) => p.postedAt && Date.parse(p.postedAt) >= fromT);
  const fmt = (p: LabPost) => c.dissections.get(p.id)?.format ?? null;
  const mOf = (p: LabPost) => (c.measures.get(p.id) ?? null) as LabMeasureV2 | null;
  const filtered = inWindow.filter((p) =>
    (!applied.platform || p.platform === applied.platform) &&
    (!applied.format || fmt(p) === applied.format) &&
    (!applied.quadrant || mOf(p)?.quadrant === applied.quadrant) &&
    (!applied.dual || Boolean(mOf(p)?.dualHigh)) &&
    (!applied.mine || p.isOwned) &&
    (!applied.creator || p.sourceId === applied.creator.id));

  section(P, 'filters', () => {
    const count = <K extends string>(key: (p: LabPost) => K | null) => {
      const m = new Map<K, number>();
      for (const p of inWindow) { const k = key(p); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
      return m;
    };
    const qc = field(c, inWindow).counts;
    view.filters = {
      platforms: [...count((p) => p.platform).entries()].map(([id, n]) => ({ id: id as BreakoutsPageView['filters']['platforms'][number]['id'], label: PLATFORM_LABEL[id] ?? id, n })).sort((a, b) => b.n - a.n),
      formats: [...count(fmt).entries()].map(([id, n]) => ({ id, label: familyLabel(id), n })).sort((a, b) => b.n - a.n),
      quadrants: (['ideal', 'loyal', 'clickbait', 'dud'] as LabQuadrant[]).map((id) => ({ id, label: QUADRANT_LABEL[id], n: qc[id] })),
      windows: [7, 30, 90],
      dualHighAvailable: measureLive,
    };
  }, () => undefined);

  view.field = section(P, 'field', () => {
    const fv = field(c, filtered);
    const dualHighIds = fv.points.filter((pt) => Boolean(c.measures.get(pt.postId) && (c.measures.get(pt.postId) as LabMeasureV2).dualHigh)).map((pt) => pt.postId);
    return { state: fv.n >= 5 ? READY : state('thin', fill(b.fieldThin, { n: fv.n })), view: { ...fv, dualHighIds } };
  }, (s) => ({ ...view.field, state: s }));

  view.cards = section(P, 'cards', () => {
    const ratioOf = (p: LabPost) => {
      const r = readOf(mOf(p), p, now);
      return r.state === 'judged' ? (r.ratio ?? 0) : (mOf(p)?.breakout ?? 0);
    };
    const list = applied.mine
      ? filtered.slice().sort((a, b2) => (b2.postedAt ?? '').localeCompare(a.postedAt ?? ''))
      : filtered.filter((p) => mOf(p)?.isBreakout).sort((a, b2) => ratioOf(b2) - ratioOf(a) || a.id.localeCompare(b2.id));
    const from = Math.max(0, inp.from ?? 0);
    const items = list.slice(from, from + BREAKOUTS_PAGE).map((p) => postCardView(c, p, now, sample));
    const next = from + BREAKOUTS_PAGE < list.length ? from + BREAKOUTS_PAGE : null;
    let st = READY;
    if (!list.length) {
      if (!c.posts.length) st = state('empty', b.noPosts, { label: LAB_COPY.frame.runNow, href: '#run' });
      else if (any) st = state('empty', b.noMatch, view.clearHref ? { label: LAB_COPY.radar.clearFilters, href: view.clearHref } : null);
      else st = state('empty', applied.mine ? b.noPosts : b.noMatch);
    }
    return { state: st, items, total: list.length, nextOffset: next };
  }, (s) => ({ ...view.cards, state: s }));

  if (view.cards.state.kind === 'empty' && !any) {
    view.gates = section(P, 'gates', () => currentGates(store, now), () => null);
    const line = gatesLine(view.gates);
    if (line && view.cards.state.message) view.cards = { ...view.cards, state: { ...view.cards.state, message: `${view.cards.state.message} ${line}` } };
  }
  return view;
}
