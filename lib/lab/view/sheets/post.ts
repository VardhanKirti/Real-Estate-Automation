/**
 * Post sheet (`?post=<id>`) model (01 14.2) and its builder: v1's specimen sheet plus 04's
 * age-matched read and checkpoints, 06's predictionChip, 07's comments and contact sheet.
 */
import type { LabMeasureV2, LabPost } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import type { LabLayerEnv } from '@/lib/lab/view/sheets/env';
import { context, specimenSheet } from '@/lib/lab/view/legacy';
import { predictionChip } from '@/lib/lab/ledger/view';
import { intentScore } from '@/lib/lab/gen/comments';
import { framesOn } from '@/lib/lab/gen/frames';
import { lineCapFor } from '@/lib/lab/spend';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fill, fmtCount, fmtRatio } from '@/lib/lab/view/format';
import { postCurve, readOf } from '@/lib/lab/view/posts';
import { READY, state, withSample } from '@/lib/lab/view/section';
import type { Measured, SpecimenSheet } from '@/lib/lab/view/legacy';
import type { AgeMatchedView, SectionState } from '@/lib/lab/view/shared';
import type { PostTileView } from '@/lib/lab/view/today';

export type PostSheetView = SpecimenSheet & {
  /** section 04 ageMatchedView */
  read: AgeMatchedView;
  checkpoints: { h: 6 | 24 | 72 | 168; label: string; state: 'read' | 'pending' | 'missed'; views: number | null; normal: number | null; ratioText: string | null; n: number }[];
  curve: PostTileView['curve'];
  nicheRatio: Measured;
  /** section 04 isDualHigh */
  dualHigh: boolean;
  exogenous: { flagged: boolean; by: 'brody' | 'auto' | null; reason: string | null };
  /** chip = section 06 predictionChip(store, { postId }) */
  prediction: { state: 'shown' | 'hidden' | 'none' | 'not_owned' | 'not_built'; chip: { text: string | null; record: string | null; hiddenReason: string | null } | null; href: string | null };
  /** owned posts */
  hypothesis: string | null;
  tests: { id: string; href: string; label: string }[];
  /** L4 bridge, owned only */
  retention: { state: SectionState; curve: { pct: number; ratio: number }[] | null; beatsText: string | null };
  /** section 07 7.14 contact sheet */
  frames: { state: SectionState; src: string | null; caption: string; canBuild: boolean };
  comments: {
    /** layers.comments: not_built -> tab hidden; off -> LAB_COPY.layer.commentsOff */
    state: SectionState;
    /** section 07 7.13.4 copy, or "Request rate: not enough yet (n {k})." */
    intentText: string | null;
    /** 07 classifyIntent; newest 40. Never an author name or hash. */
    rows: { id: string; text: string; likes: number; intent: 'bait' | 'request' | 'question' | 'objection' | 'praise' | 'other'; intentLabel: string; byCreator: boolean }[];
    /** comments live, cap above 0, none fetched yet */
    canFetch: boolean;
  };
  /** "X posts stop being read at 48h." | "YouTube Shorts before 31 Mar 2025 counted views differently." | null */
  platformNote: string | null;
  actions: { openOriginal: string; canFlag: boolean; canHypothesis: boolean; canAddToTest: boolean };
};

/* ── builder (01 14) ──────────────────────────────────────────────────── */

const HOUR = 3_600_000;
const CHECKPOINTS = [6, 24, 72, 168] as const;
const CP_LABEL: Record<number, string> = { 6: '6h', 24: '24h', 72: '72h', 168: '7d' };

/** 01 14.2: read, pending, or missed (no snapshot within plus or minus 25% of the checkpoint). */
export function checkpointsFor(post: Pick<LabPost, 'postedAt'>, snaps: readonly { capturedAt: string; ageH?: number | null; views: number | null }[], m: LabMeasureV2 | null, now: Date): PostSheetView['checkpoints'] {
  const t0 = post.postedAt ? Date.parse(post.postedAt) : NaN;
  const ageNow = Number.isFinite(t0) ? (now.getTime() - t0) / HOUR : 0;
  const ages = snaps.map((s) => ({ h: s.ageH ?? (Number.isFinite(t0) ? (Date.parse(s.capturedAt) - t0) / HOUR : NaN), views: s.views })).filter((s) => Number.isFinite(s.h));
  return CHECKPOINTS.map((h) => {
    const label = CP_LABEL[h];
    const near = ages.filter((s) => Math.abs(s.h - h) <= h * 0.25).sort((a, b) => Math.abs(a.h - h) - Math.abs(b.h - h))[0];
    const read = m?.ages?.[String(h)];
    const n = read?.n ?? 0;
    const ratioText = read && read.ratio !== null && n >= 5 ? fmtRatio(read.ratio) : null;
    if (near) {
      const views = near.views;
      const normal = views !== null && read && read.ratio && n >= 5 ? Math.round(views / read.ratio) : null;
      return { h, label, state: 'read' as const, views, normal, ratioText, n };
    }
    if (ageNow < h * 1.25) return { h, label, state: 'pending' as const, views: null, normal: null, ratioText: null, n };
    return { h, label, state: 'missed' as const, views: null, normal: null, ratioText: null, n };
  });
}

export function platformNote(post: Pick<LabPost, 'platform' | 'postedAt' | 'durationS'>): string | null {
  if (post.platform === 'twitter') return LAB_COPY.sheet.xNote;
  if (post.platform === 'youtube' && (post.durationS ?? 999) <= 180 && post.postedAt && post.postedAt < '2025-03-31') return LAB_COPY.sheet.shortsNote;
  return null;
}

const HYPOTHESIS_KEY = (postId: string) => `hypothesis:${postId}`;
export function readHypothesis(store: LabStore, postId: string): string | null {
  const v = store.priors.get(HYPOTHESIS_KEY(postId))?.value as { text?: string } | null | undefined;
  return v?.text ?? null;
}
export function writeHypothesis(store: LabStore, postId: string, text: string, now: Date): void {
  store.priors.set({ key: HYPOTHESIS_KEY(postId), value: { text }, n: 1, supersedesDefault: false, updatedAt: now.toISOString() });
}

export function buildPostSheet(store: LabStore, id: string, now: Date, env: LabLayerEnv): PostSheetView | null {
  const c = context(store, now, new Date(now.getTime() - 7 * 24 * HOUR));
  const sheet = specimenSheet(c, id);
  const post = c.postById.get(id);
  if (!sheet || !post) return null;
  const S = (h: string) => withSample(h, env.sample);
  const m = (c.measures.get(id) ?? null) as LabMeasureV2 | null;
  const read = readOf(m, post, now);
  const niche = m?.nicheRatio ?? null;
  const nicheOk = niche !== null && (m?.baselineN ?? 0) >= 5;
  const owned = post.isOwned;
  const L = LAB_COPY.sheet;

  let prediction: PostSheetView['prediction'];
  if (!owned) prediction = { state: 'not_owned', chip: null, href: null };
  else if (env.layers.ledger !== 'live') prediction = { state: 'not_built', chip: null, href: null };
  else {
    const chip = predictionChip(store, { postId: id });
    prediction = chip.text ? { state: 'shown', chip, href: '/lab/ledger' } : chip.hiddenReason ? { state: 'hidden', chip: { text: null, record: null, hiddenReason: chip.hiddenReason }, href: '/lab/ledger' } : { state: 'none', chip: null, href: null };
  }

  const dis = c.dissections.get(id);
  const hasSheet = Boolean(dis?.sheetPath);
  const frOn = framesOn(env.env);
  const frames: PostSheetView['frames'] = hasSheet
    ? { state: READY, src: S(`/api/lab/frames?post=${encodeURIComponent(id)}`), caption: L.contactCaption, canBuild: false }
    : frOn
      ? { state: state('empty', L.noContact), src: null, caption: L.contactCaption, canBuild: !env.readOnly && Boolean(dis) }
      : { state: state('off'), src: null, caption: L.contactCaption, canBuild: false };

  const cl = env.layers.comments;
  const rows = cl === 'not_built' ? [] : store.comments.forPost(id, 40).map((x) => ({ id: x.id, text: x.text, likes: x.likes ?? 0, intent: x.intent, intentLabel: L.intent[x.intent] ?? x.intent, byCreator: x.byCreator }));
  const score = cl === 'not_built' ? null : intentScore(store, id);
  const comments: PostSheetView['comments'] = {
    state: cl === 'not_built' ? state('not_built') : cl === 'off' ? state('off', LAB_COPY.layer.commentsOff, { label: LAB_COPY.frame.setUp, href: S('?setup=spend') }) : rows.length ? READY : state('empty', L.noComments),
    intentText: score ? (score.shown ? score.text : fill(L.requestRateThin, { k: score.n })) : null,
    rows,
    canFetch: cl === 'live' && !env.readOnly && rows.length === 0 && (lineCapFor('comments', env.env) ?? 0) > 0,
  };

  const ret = env.layers.retention;
  const retention: PostSheetView['retention'] = !owned
    ? { state: state('off'), curve: null, beatsText: null }
    : ret === 'needs_key'
      ? { state: state('needs_key', L.retentionNeedsKey, { label: LAB_COPY.frame.setUp, href: S('?setup=keys') }), curve: null, beatsText: null }
      : ret === 'not_built'
        ? { state: state('not_built', LAB_COPY.layer.ledger), curve: null, beatsText: null }
        : (() => {
            const r = store.retention.forPost(id).filter((x) => x.curve?.length).sort((a, b) => b.ageH - a.ageH)[0];
            return r?.curve ? { state: READY, curve: r.curve.map((p) => ({ pct: Math.round(p.x * 100), ratio: p.rrp ?? p.awr })), beatsText: null } : { state: state('empty'), curve: null, beatsText: null };
          })();

  const tests = store.tests.all().filter((t) => t.arms.some((a) => a.postId === id)).map((t) => ({ id: t.id, href: S(`?test=${encodeURIComponent(t.id)}`), label: t.title }));
  const exo = post.exoReason ? { flagged: true, by: 'brody' as const, reason: post.exoReason } : m?.exoAuto ? { flagged: true, by: 'auto' as const, reason: null } : { flagged: false, by: null, reason: null };

  return {
    ...sheet,
    href: S(`?post=${encodeURIComponent(id)}`),
    read,
    checkpoints: checkpointsFor(post, store.metrics.forPost(id), m, now),
    curve: postCurve(store, post, m),
    nicheRatio: { value: nicheOk ? niche : null, n: m?.baselineN ?? 0, enough: nicheOk, text: nicheOk ? fmtRatio(niche!) : null },
    dualHigh: Boolean(m?.dualHigh),
    exogenous: exo,
    prediction,
    hypothesis: owned ? readHypothesis(store, id) : null,
    tests,
    retention,
    frames,
    comments,
    platformNote: platformNote(post),
    actions: { openOriginal: post.url, canFlag: !env.readOnly, canHypothesis: owned && !env.readOnly, canAddToTest: owned && !env.readOnly && tests.length === 0 },
  };
}

export { fmtCount };
