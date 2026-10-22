/**
 * Contrastive grounding (07 7.5): breakouts plus duds from the same creators, so the contrast
 * isolates the content rather than the creator. Used by every idea (stored in grounding_json),
 * every script draft (the CONTRAST block) and section regenerate.
 *
 * Ratios are section 04's age-matched ratio where lane D has written it (`breakout` on the
 * measure row, judged at `judgedAgeH`); a breakout needs `isBreakout` and a baseline whose
 * confidence is not low. Owned posts never appear.
 */
import type { LabGrounding, LabGroundingRef, LaunchAngle } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { angleByRule } from '@/lib/lab/radar/angles';
import { LOCAL_EMBED_MODEL, cosine, localVec, postText } from '@/lib/lab/gen/embed';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const POOL_DAYS = 180;
export const MAX_EXEMPLARS = 5;
export const MAX_PER_CREATOR = 2;
export const MAX_DUDS = 2;
export const DUD_RATIO = 0.8;
export const DUD_MIN_AGE_H = 72;

export type PoolPost = {
  postId: string;
  creatorId: string;
  ratio: number;
  ageH: number;
  family: string;
  hookText: string;
  angle: LaunchAngle | null;
  angleText: string;
  isBreakout: boolean;
  confident: boolean;
  vec: Float32Array | null;
};

/** The angle a post is on: a trusted coverage row's angle (high confidence or confirmed), else 05's rule on its text. */
export function postAngle(store: LabStore, postId: string, text: string): LaunchAngle | null {
  const cov = store.eventCoverage.forPost(postId).find((c) => c.confidence === 'high' || c.confirmed === true);
  if (cov) return cov.angle;
  return angleByRule(text);
}

/** The 7.5 pool (competitor posts with a dissection and a measure, last 180 days); build once for many queries. */
export function groundingPool(store: LabStore, now: Date, model: string = LOCAL_EMBED_MODEL): PoolPost[] {
  const since = now.getTime() - POOL_DAYS * DAY;
  const dis = new Map(store.dissections.all().map((d) => [d.postId, d]));
  const tr = new Map(store.transcripts.all().map((t) => [t.postId, t]));
  const topics = new Map<string, { topic: string; angle: string }>();
  for (const t of store.topics.all()) if (t.isPrimary) topics.set(t.postId, { topic: t.topic, angle: t.angle });
  const out: PoolPost[] = [];
  for (const p of store.posts.all()) {
    if (p.isOwned || !p.postedAt) continue;
    const posted = Date.parse(p.postedAt);
    if (!(posted >= since)) continue;
    const d = dis.get(p.id);
    const m = store.measures.get(p.id);
    if (!d || !m || m.breakout === null) continue;
    const text = postText(p, d, topics.get(p.id) ?? null, tr.get(p.id)?.status === 'done' ? tr.get(p.id)!.text : null);
    const row = store.embeddings.get('post', p.id, model);
    const vec = row?.vec ?? (model === LOCAL_EMBED_MODEL ? localVec(text) : null);
    const ageH = m.judgedAgeH ?? Math.max(0, (now.getTime() - posted) / HOUR);
    out.push({
      postId: p.id,
      creatorId: p.sourceId,
      ratio: m.breakout,
      ageH: Math.round(ageH * 10) / 10,
      family: d.format,
      hookText: d.hookText,
      angle: postAngle(store, p.id, `${d.hookText}\n${p.caption}`),
      angleText: topics.get(p.id)?.angle ?? '',
      isBreakout: m.isBreakout,
      confident: m.baselineConfidence !== 'low',
      vec,
    });
  }
  return out;
}

const ref = (p: PoolPost): LabGroundingRef => ({ postId: p.postId, creatorId: p.creatorId, ratio: Math.round(p.ratio * 100) / 100, hookText: p.hookText, angle: p.angle ?? p.angleText, ageH: p.ageH });

export type GroundingQuery = {
  query: string;
  formatFamily?: string | null;
  /** a LaunchAngle; 'other' (or absent) applies no angle filter */
  angle?: LaunchAngle | null;
  excludeOwned?: true;
  now?: Date;
  /** the query vector for a non-local model (async embedders), with that model */
  model?: string;
  queryVec?: Float32Array | null;
  /** false: never widen past the angle (the 7.4.1 count asks "on this angle") */
  widenAngle?: boolean;
  /** a prebuilt groundingPool for the same model and time (batches) */
  pool?: PoolPost[];
};

/** 7.5 selection. Deterministic: ties break by ratio then post id. */
export function retrieveGrounding(store: LabStore, q: GroundingQuery): LabGrounding {
  const now = q.now ?? new Date();
  const model = q.model ?? LOCAL_EMBED_MODEL;
  const qv = q.queryVec ?? (model === LOCAL_EMBED_MODEL ? localVec(q.query) : null);
  const posts = q.pool ?? groundingPool(store, now, model);
  const sim = (p: PoolPost) => (qv && p.vec ? cosine(qv, p.vec) : 0);
  const breakouts = posts.filter((p) => p.isBreakout && p.confident).map((p) => ({ p, cos: sim(p), score: sim(p) * Math.log2(1 + p.ratio) })).filter((x) => x.score > 0);
  const order = (a: { score: number; p: PoolPost }, b: { score: number; p: PoolPost }) => b.score - a.score || b.p.ratio - a.p.ratio || a.p.postId.localeCompare(b.p.postId);

  const pick = (cands: typeof breakouts, familyFirst: boolean): PoolPost[] => {
    const sorted = [...cands].sort((a, b) => {
      if (familyFirst && q.formatFamily) {
        const fa = a.p.family === q.formatFamily ? 0 : 1;
        const fb = b.p.family === q.formatFamily ? 0 : 1;
        if (fa !== fb) return fa - fb;
      }
      return order(a, b);
    });
    const per = new Map<string, number>();
    const out: PoolPost[] = [];
    for (const c of sorted) {
      if (out.length >= MAX_EXEMPLARS) break;
      const k = per.get(c.p.creatorId) ?? 0;
      if (k >= MAX_PER_CREATOR) continue;
      per.set(c.p.creatorId, k + 1);
      out.push(c.p);
    }
    return out;
  };

  const angled = q.angle && q.angle !== 'other' ? breakouts.filter((b) => b.p.angle === q.angle) : breakouts;
  const familyOnly = (xs: typeof breakouts) => (q.formatFamily ? xs.filter((b) => b.p.family === q.formatFamily) : xs);
  let exemplars = pick(familyOnly(angled), false);
  if (exemplars.length < 3 && q.formatFamily) exemplars = pick(angled, true);
  if (exemplars.length < 3 && angled !== breakouts && q.widenAngle !== false) {
    exemplars = pick(familyOnly(breakouts), false);
    if (exemplars.length < 3 && q.formatFamily) exemplars = pick(breakouts, true);
  }

  const creators = new Map<string, Set<string>>();
  for (const e of exemplars) {
    if (!creators.has(e.creatorId)) creators.set(e.creatorId, new Set());
    creators.get(e.creatorId)!.add(e.family);
  }
  const chosen = new Set(exemplars.map((e) => e.postId));
  const duds = posts
    .filter((p) => !chosen.has(p.postId) && creators.has(p.creatorId) && creators.get(p.creatorId)!.has(p.family) && p.ratio <= DUD_RATIO && p.ageH >= DUD_MIN_AGE_H && p.confident)
    .map((p) => ({ p, score: sim(p) }))
    .sort((a, b) => b.score - a.score || a.p.ratio - b.p.ratio || a.p.postId.localeCompare(b.p.postId))
    .slice(0, MAX_DUDS)
    .map((x) => x.p);

  return { exemplars: exemplars.map(ref), duds: duds.map(ref), contrast: '', query: q.query, embedModel: model, thin: exemplars.length < 3 };
}

/**
 * 7.4.1: distinct breakout post ids grounding an idea: the event's trusted, tracked coverage
 * breakouts on that angle, plus `retrieveGrounding(...).exemplars` (the angle filter dropped
 * when the angle is `other`). Owned posts and low-confidence unconfirmed coverage never count.
 */
export function groundingCount(store: LabStore, a: { angle: LaunchAngle; eventId?: string | null; query: string; formatFamily?: string | null; now?: Date }): { count: number; coverage: string[]; grounding: LabGrounding; postIds: string[] } {
  const coverage: { postId: string; ratio: number }[] = [];
  if (a.eventId) {
    for (const c of store.eventCoverage.forEvent(a.eventId)) {
      if (c.isOwned || !c.isBreakout || c.angle !== a.angle) continue;
      if (!(c.confidence === 'high' || c.confirmed === true)) continue;
      const p = store.posts.get(c.postId);
      if (!p || p.isOwned) continue;
      coverage.push({ postId: c.postId, ratio: c.ratio ?? store.measures.get(c.postId)?.breakout ?? 0 });
    }
  }
  const grounding = retrieveGrounding(store, { query: a.query, angle: a.angle === 'other' ? null : a.angle, formatFamily: a.formatFamily ?? null, now: a.now, widenAngle: false });
  coverage.sort((x, y) => y.ratio - x.ratio || x.postId.localeCompare(y.postId));
  const list2 = [...grounding.exemplars].sort((x, y) => y.ratio - x.ratio || x.postId.localeCompare(y.postId)).map((e) => e.postId);
  const postIds = [...new Set([...coverage.map((c) => c.postId), ...list2])];
  return { count: postIds.length, coverage: coverage.map((c) => c.postId), grounding, postIds };
}

/** 7.4.1 refusal copy. */
export const groundingRefusal = (g: number): string => `Found ${g} ${g === 1 ? 'breakout' : 'breakouts'} on this angle. An idea needs 2 to be grounded.`;

const fmtX = (r: number) => `${(Math.round(r * 10) / 10).toFixed(1)}x`;

/** The CONTRAST block for scriptPrompt (7.5). Lists exactly the stored exemplars and duds. */
export function contrastBlock(g: LabGrounding, handleOf: (creatorId: string) => string, opts: { short?: boolean } = {}): string {
  if (g.exemplars.length === 0) return '';
  const lines = [
    '## CONTRAST',
    "These broke out for their creators (ratio is views over that creator's normal at the same age):",
    ...g.exemplars.map((e) => `- post=${e.postId} · @${handleOf(e.creatorId)} · ${fmtX(e.ratio)} · hook: "${e.hookText}" · angle: ${e.angle || 'n/a'}`),
  ];
  if (g.duds.length) lines.push('These, by the same creators, did not (ratio 0.8x or below):', ...g.duds.map((e) => `- post=${e.postId} · @${handleOf(e.creatorId)} · ${fmtX(e.ratio)} · hook: "${e.hookText}" · angle: ${e.angle || 'n/a'}`));
  else lines.push('No duds from these creators yet.');
  if (!opts.short) lines.push('Before writing, state in one short paragraph (field "contrast") what the breakouts did that the duds did not. Use that, not the breakouts\' wording. Never copy a hook.');
  else lines.push('Use what separated them, not their wording. Never copy a hook.');
  return lines.join('\n');
}
