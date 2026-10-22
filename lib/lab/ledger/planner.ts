/**
 * The Thompson-sampling planner (06 section 11): one Normal bandit per dimension, rewards from
 * owned posts' 72 h age-matched ratios, priors from Playbook lifts, a 60-day half-life, a weekly
 * plan seeded by the ISO week. Closed until 20 owned posts have 72 h results. A suggestion only.
 */
import { createHash } from 'node:crypto';
import type { LabPlatform, LabPost, LabTest } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { durationBand, hourBand, median } from '@/lib/lab/measures';
import { normal, rng, variance } from '@/lib/lab/ledger/metrics';
import { testMark } from '@/lib/lab/ledger/tests';

export const PLANNER_DIMENSIONS = {
  hook: ['results_first', 'contrarian', 'open_loop', 'howto_promise', 'news_react', 'direct_question'],
  format: ['talking_head', 'screen_recording', 'tutorial_walkthrough', 'b_roll_voiceover', 'green_screen'],
  length: ['under 30 s', '30-60 s', '60-90 s', '90 s-3 min'],
  hour: ['00-06 UTC', '06-12 UTC', '12-18 UTC', '18-24 UTC'],
} as const;
export type PlannerDimension = keyof typeof PLANNER_DIMENSIONS;

/** 06 11.6 */
export type PlannerView = {
  /** '2026-W42' */
  week: string;
  slots: { testId: string; platform: LabPlatform; picks: { dimension: keyof typeof PLANNER_DIMENSIONS; value: string; pBest: number; n: number; lastTriedDaysAgo: number | null }[] }[];
  /** one per dimension, top pick */
  reasons: string[];
  /** owned posts with 72 h results */
  n: number;
};

export const PLANNER_GATE_N = 20;
export const PROPENSITY_DRAWS = 2000;
export const HALF_LIFE_DAYS = 60;
export const DEFAULT_SIGMA2 = 0.09;
const DAY = 86_400_000;
/** Playbook feature name per dimension (distill.ts names); `format` has no feature row (profiles are per format). */
const FEATURE_OF: Record<PlannerDimension, string | null> = { hook: 'hook_form', format: null, length: 'duration', hour: 'post_hour' };
const DIMENSION_LABEL: Record<PlannerDimension, string> = { hook: 'hook', format: 'format', length: 'length', hour: 'posting time' };
const valueLabel = (v: string) => v.replaceAll('_', ' ');

/** '2026-W41' for the ISO week containing d (UTC). */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / DAY + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/* ── rewards (06 11.3) ───────────────────────────────────────────────────────── */

export type PlannerObs = { postId: string; platform: LabPlatform; postedAt: string; y: number; arms: Partial<Record<PlannerDimension, string>> };

/** Owned posts with a 72 h age-matched ratio, exogenous posts out, clickbait capped at 0. */
export function plannerObservations(store: LabStore): PlannerObs[] {
  const measures = new Map(store.measures.all().map((m) => [m.postId, m]));
  const dissections = new Map(store.dissections.all().map((d) => [d.postId, d]));
  const out: PlannerObs[] = [];
  for (const p of store.posts.all()) {
    if (!p.isOwned || !p.postedAt || p.exoReason) continue;
    const m = measures.get(p.id);
    const ratio = m?.ages?.['72']?.ratio ?? null;
    if (!m || m.exoAuto || ratio === null || !(ratio > 0)) continue;
    let y = Math.log10(ratio);
    if (m.quadrant === 'clickbait') y = Math.min(y, 0);
    const d = dissections.get(p.id);
    const arms: PlannerObs['arms'] = {};
    if (d && (PLANNER_DIMENSIONS.hook as readonly string[]).includes(d.hookForm)) arms.hook = d.hookForm;
    if (d && (PLANNER_DIMENSIONS.format as readonly string[]).includes(d.format)) arms.format = d.format;
    const len = durationBand(p.durationS);
    if (len && (PLANNER_DIMENSIONS.length as readonly string[]).includes(len)) arms.length = len;
    const hr = hourBand(p.postedAt);
    if (hr) arms.hour = hr;
    out.push({ postId: p.id, platform: p.platform, postedAt: p.postedAt, y, arms });
  }
  return out;
}

/** 06 11.1 gate. */
export function plannerGate(store: LabStore): { n: number; need: 20; open: boolean } {
  const n = plannerObservations(store).length;
  return { n, need: 20, open: n >= PLANNER_GATE_N };
}

/* ── posterior (06 11.4) ─────────────────────────────────────────────────────── */

export function armPosterior(a: { mu0: number; n0: number; sigma2: number; obs: readonly { y: number; ageDays: number }[] }): { mean: number; var: number } {
  let sw = 0;
  let swy = 0;
  for (const o of a.obs) {
    const w = 0.5 ** (o.ageDays / HALF_LIFE_DAYS);
    sw += w;
    swy += w * o.y;
  }
  return { mean: (a.n0 * a.mu0 + swy) / (a.n0 + sw), var: a.sigma2 / (a.n0 + sw) };
}

/** mu0 = clamp(0.5 log10(lift), -0.2, 0.2); n0 = 5 confirmed, 3 shown, else 1; no lift: (0, 1). */
export function armPrior(store: LabStore, dim: PlannerDimension, value: string): { mu0: number; n0: number } {
  const feature = FEATURE_OF[dim];
  if (!feature) return { mu0: 0, n0: 1 };
  const lifts = store.profiles.latest().flatMap((p) => p.features).filter((f) => f.feature === feature && f.value === value && f.lift !== null && f.lift > 0);
  const best = lifts.sort((a, b) => b.n - a.n)[0];
  if (!best) return { mu0: 0, n0: 1 };
  const mu0 = Math.max(-0.2, Math.min(0.2, 0.5 * Math.log10(best.lift!)));
  const mark = testMark(store, `${feature}:${value}`, best.lift! >= 1 ? 1 : -1).mark;
  return { mu0, n0: mark === 'confirmed' ? 5 : best.shown ? 3 : 1 };
}

type ArmState = { value: string; mean: number; var: number; n: number; lastPostedAt: string | null };

/** Monday 00:00 UTC of the ISO week containing d: the plan's reference time, so a week's plan is the same on every day of it. */
export function weekStart(d: Date): Date {
  const mid = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(mid - ((new Date(mid).getUTCDay() + 6) % 7) * DAY);
}

function arms(store: LabStore, obs: readonly PlannerObs[], ref: Date): Record<PlannerDimension, ArmState[]> {
  const ys = obs.map((o) => o.y);
  const sigma2 = ys.length >= 10 ? (variance(ys) ?? DEFAULT_SIGMA2) : DEFAULT_SIGMA2;
  const out = {} as Record<PlannerDimension, ArmState[]>;
  for (const dim of Object.keys(PLANNER_DIMENSIONS) as PlannerDimension[]) {
    out[dim] = PLANNER_DIMENSIONS[dim].map((value) => {
      const mine = obs.filter((o) => o.arms[dim] === value);
      const ages = mine.map((o) => (ref.getTime() - Date.parse(o.postedAt)) / DAY);
      const post = armPosterior({ ...armPrior(store, dim, value), sigma2, obs: mine.map((o, i) => ({ y: o.y, ageDays: Math.max(0, ages[i]) })) });
      const last = mine.map((o) => o.postedAt).sort().at(-1) ?? null;
      return { value, mean: post.mean, var: post.var, n: mine.length, lastPostedAt: last };
    });
  }
  return out;
}

/* ── weekly plan (06 11.5) ───────────────────────────────────────────────────── */

const slotId = (week: string, platform: string, i: number) => `lt-${createHash('sha256').update(`plan|${week}|${platform}|${i}`).digest('hex').slice(0, 12)}`;

/** Median owned posts per week over the last 4 weeks per platform, min 1, max 14. */
export function slotsPerPlatform(store: LabStore, now: Date): Map<LabPlatform, number> {
  const owned = store.posts.all().filter((p): p is LabPost & { postedAt: string } => p.isOwned && Boolean(p.postedAt));
  const platforms = [...new Set([...owned.map((p) => p.platform), ...store.sources.all('owned').map((s) => s.platform)])].filter((p): p is LabPlatform => typeof p === 'string' && ['tiktok', 'instagram', 'youtube', 'linkedin', 'twitter'].includes(p)).sort();
  const out = new Map<LabPlatform, number>();
  for (const pl of platforms) {
    const counts = [0, 1, 2, 3].map((w) => owned.filter((p) => p.platform === pl && now.getTime() - Date.parse(p.postedAt) >= w * 7 * DAY && now.getTime() - Date.parse(p.postedAt) < (w + 1) * 7 * DAY).length);
    out.set(pl, Math.max(1, Math.min(14, Math.round(median(counts) ?? 1))));
  }
  return out;
}

export type WeekPlan = { week: string; slots: { platform: LabPlatform; index: number; picks: Record<PlannerDimension, string> }[]; propensity: Record<PlannerDimension, Record<string, number>>; arms: Record<PlannerDimension, ArmState[]> };

/** Pure plan for a week: per slot and dimension, draw theta per arm and take the argmax; propensities from 2,000 further draws. */
export function computePlan(store: LabStore, now: Date): WeekPlan | null {
  const obs = plannerObservations(store);
  if (obs.length < PLANNER_GATE_N) return null;
  const week = isoWeek(now);
  const ref = weekStart(now);
  const next = rng(week);
  const st = arms(store, obs, ref);
  const dims = Object.keys(PLANNER_DIMENSIONS) as PlannerDimension[];
  const draw = (dim: PlannerDimension) => {
    let best = 0;
    let bestTheta = -Infinity;
    st[dim].forEach((a, i) => {
      const theta = a.mean + Math.sqrt(a.var) * normal(next);
      if (theta > bestTheta) { bestTheta = theta; best = i; }
    });
    return st[dim][best].value;
  };
  const slots: WeekPlan['slots'] = [];
  for (const [platform, n] of slotsPerPlatform(store, ref)) {
    for (let i = 0; i < n; i++) slots.push({ platform, index: i, picks: Object.fromEntries(dims.map((d) => [d, draw(d)])) as Record<PlannerDimension, string> });
  }
  const propensity = {} as WeekPlan['propensity'];
  for (const d of dims) {
    const wins: Record<string, number> = Object.fromEntries(st[d].map((a) => [a.value, 0]));
    for (let k = 0; k < PROPENSITY_DRAWS; k++) wins[draw(d)]++;
    propensity[d] = Object.fromEntries(Object.entries(wins).map(([v, w]) => [v, w / PROPENSITY_DRAWS]));
  }
  return { week, slots, propensity, arms: st };
}

/**
 * Writes the week's slots as planned_post tests. Slots still `planned` are regenerated; linked or
 * done slots are kept. LabTestSchema allows at most 3 arms, so the slot's single arm carries the
 * hook pick and judgeDetail.picks carries all four dimensions with their propensities.
 */
export function planWeek(store: LabStore, now: Date, opts: { dry?: boolean } = {}): { week: string; slots: number } | null {
  const plan = computePlan(store, now);
  if (!plan) return null;
  const at = now.toISOString();
  store.transaction(() => {
    for (const s of plan.slots) {
      const id = slotId(plan.week, s.platform, s.index);
      const picks = (Object.keys(s.picks) as PlannerDimension[]).map((d) => ({ dimension: d, value: s.picks[d], pBest: plan.propensity[d][s.picks[d]] }));
      const arm = { id: 'a', label: 'Plan', variantText: `Try a ${valueLabel(s.picks.hook)} hook, ${valueLabel(s.picks.format)}, ${s.picks.length}, ${s.picks.hour}`, hookId: null, featureValue: s.picks.hook, postId: null, metrics: { atAgeH: null, reach: null, views: null, likes: null, shares: null, saved: null, follows: null, watchTimeSharePct: null, source: null }, propensity: plan.propensity.hook[s.picks.hook] };
      const existing = store.tests.get(id);
      if (existing && existing.status !== 'planned') continue;
      const row: LabTest = {
        id, kind: 'planned_post', title: `Planned ${s.platform} post ${s.index + 1}`, hypothesis: '', variable: 'other', featureKey: `hook_form:${s.picks.hook}`, expectedSign: 1, scriptId: null,
        platform: s.platform, status: 'planned', arms: [arm], judgeAgeH: 72, primaryMetric: 'ratio_72h', result: null, winnerArm: null, observedSign: null, confirms: null,
        judgeDetail: { picks, week: plan.week }, notes: '', planWeek: plan.week, startedAt: null, judgedAt: null, createdAt: existing?.createdAt ?? at, updatedAt: at, dry: Boolean(opts.dry),
      };
      if (existing) store.tests.update(id, row);
      else store.tests.create(row);
    }
  });
  return { week: plan.week, slots: plan.slots.length };
}

/** awaiting_result slots whose post has its 72 h ratio: done, observedSign = sign(y). */
export function settlePlannedPosts(store: LabStore, now: Date): number {
  const obs = new Map(plannerObservations(store).map((o) => [o.postId, o]));
  let n = 0;
  for (const t of store.tests.all({ kind: 'planned_post', status: 'awaiting_result' })) {
    const postId = t.arms.find((a) => a.postId)?.postId;
    const o = postId ? obs.get(postId) : undefined;
    if (!o) continue;
    store.tests.update(t.id, { status: 'done', result: 'winner', winnerArm: 'a', observedSign: o.y >= 0 ? 1 : -1, judgedAt: now.toISOString(), judgeDetail: { ...t.judgeDetail, y: o.y } });
    n++;
  }
  return n;
}

/* ── view (06 11.6) ──────────────────────────────────────────────────────────── */

export function plannerView(store: LabStore, now: Date): PlannerView | null {
  const plan = computePlan(store, now);
  if (!plan) return null;
  const rows = store.tests.all({ kind: 'planned_post' }).filter((t) => t.planWeek === plan.week);
  const stateOf = (d: PlannerDimension, v: string) => plan.arms[d].find((a) => a.value === v)!;
  const daysAgo = (a: ArmState | undefined) => (a?.lastPostedAt ? Math.max(0, Math.round((now.getTime() - Date.parse(a.lastPostedAt)) / DAY)) : null);
  const slots: PlannerView['slots'] = plan.slots.map((s) => {
    const id = slotId(plan.week, s.platform, s.index);
    const row = rows.find((t) => t.id === id);
    const stored = (row?.judgeDetail.picks as { dimension: PlannerDimension; value: string; pBest: number }[] | undefined) ?? null;
    const picks = (stored ?? (Object.keys(s.picks) as PlannerDimension[]).map((d) => ({ dimension: d, value: s.picks[d], pBest: plan.propensity[d][s.picks[d]] }))).map((p) => ({ ...p, n: stateOf(p.dimension, p.value)?.n ?? 0, lastTriedDaysAgo: daysAgo(stateOf(p.dimension, p.value)) }));
    return { testId: row?.id ?? id, platform: s.platform, picks };
  });
  const reasons = (Object.keys(PLANNER_DIMENSIONS) as PlannerDimension[]).map((d) => {
    const [value, p] = Object.entries(plan.propensity[d]).sort((a, b) => b[1] - a[1])[0];
    const a = stateOf(d, value);
    if (!a || a.n === 0) return `Try ${valueLabel(value)}: never tried, so the Lab cannot rule it out.`;
    return `Try ${valueLabel(value)}: ${Math.round(p * 100)}% chance it is your best ${DIMENSION_LABEL[d]}, last tried ${daysAgo(a)} days ago (n ${a.n}).`;
  });
  return { week: plan.week, slots, reasons, n: plannerObservations(store).length };
}

export type { LabTest };
