/**
 * Tests (06 section 10): Trial Reels hook tests judged on shares per reach, the YouTube Test &
 * Compare log (manual), self-experiments, and the "confirmed by test" rule Playbook reads.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { LabPlatformSchema, LabTestArmSchema, LabTestKindSchema, LabTestResultSchema, LabTestStatusSchema, LabTestVariableSchema, type LabTest, type LabTestArm } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { newcombe } from '@/lib/lab/ledger/metrics';

export type TestMark = 'correlation' | 'confirmed' | 'contradicted' | 'tested_inconclusive';

export const TRIAL_MIN_REACH = 500;
export const SAME_BAND = 0.15;
export const RETENTION_MATCH_TOL_H = 12;

/** 06 10.3 hygiene rules shown in the Test sheet. */
export const TRIAL_REELS_RULES = [
  'Same body and caption. Change only the hook.',
  'Post all trials within 24 hours of each other.',
  'Compare trials only with trials.',
  'Judged at 72 hours on shares per reach.',
] as const;
export const SHORTS_REFUSAL = 'YouTube cannot test Shorts.';
export const MID_TEST_REFUSAL = 'Changing a variant mid-test stops it. Start a new test.';

export class TestWriteError extends Error {
  constructor(
    public status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'TestWriteError';
  }
}

/* ── create (06 10.7) ────────────────────────────────────────────────────────── */

const ArmInput = LabTestArmSchema.partial({ hookId: true, featureValue: true, postId: true, metrics: true, propensity: true, label: true });
export const CreateTestBody = z.object({
  kind: LabTestKindSchema,
  title: z.string().min(1).max(120),
  hypothesis: z.string().max(500).default(''),
  variable: LabTestVariableSchema,
  featureKey: z.string().nullable().optional(),
  expectedSign: z.union([z.literal(1), z.literal(-1)]).nullable().optional(),
  scriptId: z.string().nullable().optional(),
  platform: LabPlatformSchema,
  arms: z.array(ArmInput).min(1).max(3),
});
export type CreateTestInput = z.infer<typeof CreateTestBody>;

const EMPTY_METRICS: LabTestArm['metrics'] = { atAgeH: null, reach: null, views: null, likes: null, shares: null, saved: null, follows: null, watchTimeSharePct: null, source: null };

function isShort(store: LabStore, postId: string | null | undefined): boolean {
  if (!postId) return false;
  const p = store.posts.get(postId);
  return Boolean(p && (p.contentType === 'short' || /\/shorts\//.test(p.url)));
}

export function createTest(store: LabStore, input: CreateTestInput, opts: { now: Date; dry: boolean }): LabTest {
  if (input.kind === 'trial_reels' && input.arms.length < 2) throw new TestWriteError(400, 'A Trial Reels test needs 2 or 3 hooks.');
  if (input.kind === 'yt_test_compare' && input.arms.some((a) => isShort(store, a.postId))) throw new TestWriteError(400, SHORTS_REFUSAL);
  const at = opts.now.toISOString();
  const arms: LabTestArm[] = input.arms.map((a, i) => ({
    id: a.id || String.fromCharCode(97 + i), label: a.label ?? `${input.variable === 'hook' ? 'Hook' : 'Variant'} ${String.fromCharCode(65 + i)}`, variantText: a.variantText,
    hookId: a.hookId ?? null, featureValue: a.featureValue ?? null, postId: a.postId ?? null, metrics: { ...EMPTY_METRICS, ...(a.metrics ?? {}) }, propensity: a.propensity ?? null,
  }));
  const t: LabTest = {
    id: `lt-${randomBytes(6).toString('hex')}`, kind: input.kind, title: input.title, hypothesis: input.hypothesis, variable: input.variable,
    featureKey: input.featureKey ?? null, expectedSign: input.expectedSign ?? null, scriptId: input.scriptId ?? null, platform: input.platform,
    status: arms.some((a) => a.postId) ? 'running' : 'planned', arms,
    judgeAgeH: input.kind === 'trial_reels' ? 72 : input.kind === 'self_experiment' ? 168 : input.kind === 'planned_post' ? 72 : null,
    primaryMetric: input.kind === 'trial_reels' ? 'shares_per_reach' : input.kind === 'yt_test_compare' ? 'watch_time_share' : input.kind === 'planned_post' ? 'ratio_72h' : 'ratio_7d',
    result: null, winnerArm: null, observedSign: null, confirms: null, judgeDetail: {}, notes: '', planWeek: null,
    startedAt: arms.some((a) => a.postId) ? at : null, judgedAt: null, createdAt: at, updatedAt: at, dry: opts.dry,
  };
  store.tests.create(t);
  return t;
}

/* ── Trial Reels judging (06 10.3) ───────────────────────────────────────────── */

export type TrialJudgement = { result: LabTest['result']; winnerArm: string | null; detail: Record<string, unknown> };

/** Shares per reach, best against second, Newcombe 90%; reach under 500 on any arm is inconclusive. */
export function judgeTrialReels(test: Pick<LabTest, 'arms'>): TrialJudgement {
  const arms = test.arms.map((a) => ({ id: a.id, reach: a.metrics.reach, shares: a.metrics.shares }));
  if (arms.some((a) => a.reach === null || a.shares === null)) return { result: null, winnerArm: null, detail: { reason: 'metrics missing' } };
  if (arms.some((a) => a.reach! < TRIAL_MIN_REACH)) return { result: 'inconclusive', winnerArm: null, detail: { rule: 'newcombe-90', reason: 'reach under 500' } };
  const rated = arms.map((a) => ({ ...a, rate: a.shares! / a.reach! })).sort((x, y) => y.rate - x.rate || (x.id < y.id ? -1 : 1));
  const [best, second] = rated;
  const { d, lo, hi } = newcombe(best.shares!, best.reach!, second.shares!, second.reach!);
  const pooled = (best.shares! + second.shares!) / (best.reach! + second.reach!);
  const detail = { rule: 'newcombe-90', rates: Object.fromEntries(rated.map((a) => [a.id, a.rate])), diff: d, lo, hi, pooled, band: SAME_BAND * pooled };
  if (lo > 0) return { result: 'winner', winnerArm: best.id, detail };
  if (lo >= -SAME_BAND * pooled && hi <= SAME_BAND * pooled) return { result: 'performed_same', winnerArm: null, detail };
  return { result: 'inconclusive', winnerArm: null, detail };
}

/** +1 when the winning arm carries the feature value of featureKey, -1 when it does not (06 10.3). */
export function observedSignOf(test: Pick<LabTest, 'featureKey' | 'arms'>, result: LabTest['result'], winnerArm: string | null): 1 | -1 | null {
  if (result !== 'winner' || !test.featureKey || !winnerArm) return null;
  const value = test.featureKey.split(':').slice(1).join(':');
  const win = test.arms.find((a) => a.id === winnerArm);
  if (!win) return null;
  return win.featureValue === value ? 1 : -1;
}

/** Fill arm metrics from Instagram retention rows within 12 h of the judge age (source instagram_api). */
export function fillArmsFromRetention(store: LabStore, test: LabTest): LabTestArm[] {
  const age = test.judgeAgeH ?? 72;
  return test.arms.map((a) => {
    if (!a.postId || a.metrics.source === 'manual') return a;
    const r = store.retention.newestAtAge(a.postId, age, RETENTION_MATCH_TOL_H);
    if (!r || r.platform !== 'instagram') return a;
    return { ...a, metrics: { ...a.metrics, atAgeH: r.ageH, reach: r.reach, views: r.views, likes: r.likes, shares: r.shares, saved: r.saved, source: 'instagram_api' } };
  });
}

/** Judge now (trial_reels only): fills metrics, judges, writes result, sign and confirms. */
export function judgeTest(store: LabStore, id: string, now: Date): LabTest {
  const t = store.tests.get(id);
  if (!t) throw new TestWriteError(404, 'unknown test');
  if (t.kind !== 'trial_reels') throw new TestWriteError(400, 'Only Trial Reels tests are judged here.');
  const arms = fillArmsFromRetention(store, t);
  const j = judgeTrialReels({ arms });
  if (j.result === null) return store.tests.update(id, { arms, judgeDetail: j.detail, updatedAt: now.toISOString() })!;
  const observedSign = observedSignOf(t, j.result, j.winnerArm);
  return store.tests.update(id, {
    arms, result: j.result, winnerArm: j.winnerArm, judgeDetail: j.detail, status: 'done', judgedAt: now.toISOString(), updatedAt: now.toISOString(),
    observedSign, confirms: observedSign !== null && t.expectedSign !== null ? observedSign === t.expectedSign : null,
  })!;
}

/* ── edit (06 10.7, 10.4) ────────────────────────────────────────────────────── */

export const PatchTestBody = z.object({
  title: z.string().min(1).max(120).optional(),
  hypothesis: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
  status: LabTestStatusSchema.optional(),
  arms: z.array(z.object({ id: z.string(), variantText: z.string().max(500).optional(), postId: z.string().nullable().optional(), metrics: LabTestArmSchema.shape.metrics.partial().optional() })).max(3).optional(),
  result: LabTestResultSchema.optional(),
  winnerArm: z.string().nullable().optional(),
});
export type PatchTestInput = z.infer<typeof PatchTestBody>;

export function patchTest(store: LabStore, id: string, p: PatchTestInput, now: Date): LabTest {
  const t = store.tests.get(id);
  if (!t) throw new TestWriteError(404, 'unknown test');
  if ((p.result !== undefined || p.winnerArm !== undefined) && t.kind !== 'yt_test_compare') throw new TestWriteError(400, 'Results are entered by hand only for YouTube Test & Compare.');
  let arms = t.arms;
  if (p.arms) {
    for (const a of p.arms) {
      const cur = arms.find((x) => x.id === a.id);
      if (!cur) throw new TestWriteError(400, `unknown arm ${a.id}`);
      if (a.variantText !== undefined && a.variantText !== cur.variantText && t.status === 'running') throw new TestWriteError(409, MID_TEST_REFUSAL);
      if (t.kind === 'yt_test_compare' && a.postId && isShort(store, a.postId)) throw new TestWriteError(400, SHORTS_REFUSAL);
    }
    arms = arms.map((cur) => {
      const a = p.arms!.find((x) => x.id === cur.id);
      if (!a) return cur;
      return { ...cur, variantText: a.variantText ?? cur.variantText, postId: a.postId === undefined ? cur.postId : a.postId, metrics: a.metrics ? { ...cur.metrics, ...a.metrics, source: a.metrics.source ?? 'manual' } : cur.metrics };
    });
  }
  const patch: Partial<LabTest> = { title: p.title, hypothesis: p.hypothesis, notes: p.notes, status: p.status, arms, updatedAt: now.toISOString() };
  // a planner slot linked to a post waits for its 72 h result (06 11.5)
  if (t.kind === 'planned_post' && t.status === 'planned' && arms.some((a) => a.postId) && !p.status) patch.status = 'awaiting_result';
  if (t.kind !== 'planned_post' && t.status === 'planned' && arms.some((a) => a.postId) && !p.status) { patch.status = 'running'; patch.startedAt = now.toISOString(); }
  if (t.kind === 'yt_test_compare' && p.result) {
    // 06 10.4: taken as entered; the Lab does not re-judge it
    const winnerArm = p.result === 'winner' ? (p.winnerArm ?? null) : null;
    if (p.result === 'winner' && (!winnerArm || !arms.some((a) => a.id === winnerArm))) throw new TestWriteError(400, 'pick the winning variant');
    const observedSign = observedSignOf(t, p.result, winnerArm);
    Object.assign(patch, { result: p.result, winnerArm, status: 'done', judgedAt: now.toISOString(), observedSign, confirms: observedSign !== null && t.expectedSign !== null ? observedSign === t.expectedSign : null, judgeDetail: { rule: 'manual' } });
  }
  return store.tests.update(id, patch)!;
}

/* ── confirmed by test (06 10.6) ─────────────────────────────────────────────── */

export function testMark(store: LabStore, featureKey: string, liftSign: 1 | -1): { mark: TestMark; agree: number; disagree: number; inconclusive: number; label: string } {
  const counted = store.tests.forFeature(featureKey).filter((t) => (t.kind === 'trial_reels' || t.kind === 'yt_test_compare') && t.status === 'done' && !t.dry);
  let agree = 0;
  let disagree = 0;
  let inconclusive = 0;
  for (const t of counted) {
    if (t.result === 'winner' && t.observedSign !== null) {
      if (t.observedSign === liftSign) agree++;
      else disagree++;
    } else if (t.result === 'inconclusive' || t.result === 'performed_same') inconclusive++;
  }
  if (agree >= 1 && agree > disagree) return { mark: 'confirmed', agree, disagree, inconclusive, label: `confirmed by test (${agree} of ${agree + disagree})` };
  if (disagree > agree) return { mark: 'contradicted', agree, disagree, inconclusive, label: `contradicted by test (${disagree} of ${agree + disagree})` };
  if (agree === 0 && disagree === 0 && inconclusive >= 1) return { mark: 'tested_inconclusive', agree, disagree, inconclusive, label: `tested, no clear winner (${inconclusive})` };
  return { mark: 'correlation', agree, disagree, inconclusive, label: 'correlation' };
}

/* ── copy (06 13.3) ──────────────────────────────────────────────────────────── */

export function resultCopy(t: LabTest): { label: string; sub: string } {
  if (t.result === 'winner') {
    const win = t.arms.find((a) => a.id === t.winnerArm);
    const rates = (t.judgeDetail.rates ?? {}) as Record<string, number>;
    const other = Object.entries(rates).filter(([id]) => id !== t.winnerArm).sort((a, b) => b[1] - a[1])[0];
    const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
    const sub = t.kind === 'trial_reels' && t.winnerArm && rates[t.winnerArm] !== undefined && other ? `${pct(rates[t.winnerArm])} vs ${pct(other[1])} shares per reach at ${t.judgeAgeH ?? 72}h` : '';
    return { label: `Winner: ${win?.label ?? t.winnerArm ?? ''}`, sub };
  }
  if (t.result === 'performed_same') return { label: 'Performed the same', sub: 'Both within 15% of each other. That is a real answer.' };
  if (t.result === 'inconclusive') return { label: 'Inconclusive', sub: 'Most tests end here. Run it again or test a bigger difference.' };
  return { label: '', sub: '' };
}
