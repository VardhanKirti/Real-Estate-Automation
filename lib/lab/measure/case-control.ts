/**
 * Case-control Viral Profile (04 5.2, 5.3): every tracked post gets one verdict at its verdict age
 * (168h, X 48h) as of verdict age + 24h, so a late read never changes it. Cases are breakouts at
 * verdict; controls are non-cases drawn by a seeded Bernoulli with a known probability. The
 * estimators are the Mantel-Haenszel odds ratio (the shown number), the inverse-weighted lift and
 * Benjamini-Hochberg q across one profile.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { LabControl } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { MeasureEngine, dayFloor, type EnginePost } from '@/lib/lab/measure/engine';
import { isBreakoutV2 } from '@/lib/lab/measure/breakout';
import { detectStepJump } from '@/lib/lab/measure/exogenous';

export type CaseControlRow = { postId: string; role: 'case' | 'control'; stratum: string; pi: number; eligibleN: number; drawnN: number; seed: string; drawnAt: string; status: 'selected' | 'transcribed' | 'dissected' | 'caption_only' | 'failed'; measureVersion: string };

export const VERDICT_AGE_H = 168;
export const X_VERDICT_AGE_H = 48;
/** The verdict is read as of verdict age + this, so a late read does not change it. */
export const VERDICT_GRACE_H = 24;
export const CONTROL_K = 1;
export const PI_MIN = 0.05;
export const PI_MAX = 0.5;
/** Case rate used until a creator has this many judged posts. */
export const MIN_JUDGED_FOR_RATE = 20;
export const DEFAULT_CASE_RATE = 0.05;
export const CASE_RATE_WINDOW_DAYS = 90;
export const CONTROL_SEED_KEY = 'control_seed';
export const CC_MEASURE_VERSION = 'measure-v2';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const verdictAgeFor = (platform: string): number => (platform === 'twitter' ? X_VERDICT_AGE_H : VERDICT_AGE_H);
export const stratumOf = (p: { sourceId: string; postedAt: string | null }): string => `${p.sourceId}|${(p.postedAt ?? '').slice(0, 7)}`;

/** pi = clamp(k x r / (1 - r), 0.05, 0.5); r = 0.05 under 20 judged posts. */
export function controlProbability(caseRate: number | null, judged: number): number {
  const r = caseRate === null || judged < MIN_JUDGED_FOR_RATE ? DEFAULT_CASE_RATE : caseRate;
  if (!(r < 1)) return PI_MAX;
  return Math.min(PI_MAX, Math.max(PI_MIN, (CONTROL_K * r) / (1 - r)));
}

/** u = first 8 hex of sha256(seed|postId) / 0xffffffff; selected when u < pi. Reads nothing else (6.5). */
export function drawControl(seed: string, postId: string, pi: number): boolean {
  const u = parseInt(createHash('sha256').update(`${seed}|${postId}`).digest('hex').slice(0, 8), 16) / 0xffffffff;
  return u < pi;
}

/** The control seed: created once at random on first use (lab_priors control_seed). */
export function controlSeed(store: LabStore, now: Date): string {
  const cur = store.priors.get(CONTROL_SEED_KEY)?.value;
  if (typeof cur === 'string' && cur) return cur;
  const seed = randomBytes(8).toString('hex');
  store.priors.set({ key: CONTROL_SEED_KEY, value: seed, n: 0, supersedesDefault: false, updatedAt: now.toISOString() });
  return seed;
}

export type Verdict = { post: EnginePost; atMs: number; judged: boolean; isCase: boolean; eligible: boolean; ratio: number | null };

/** One post's verdict as of verdict age + 24h (null until then). */
export function verdictOf(engine: MeasureEngine, p: EnginePost, nowMs: number): Verdict | null {
  const va = verdictAgeFor(p.platform);
  const atMs = p.postedAtMs + (va + VERDICT_GRACE_H) * HOUR;
  if (atMs > nowMs) return null;
  const j = engine.judge(p, va, atMs, dayFloor(atMs));
  const judged = j !== null && j.ratio !== null;
  const exoAuto = detectStepJump(engine.readsAsOf(p, atMs).map((r) => ({ ageH: r.h, basis: r.v }))).flagged;
  const exo = Boolean(p.post.exoReason) || exoAuto;
  const breakout = judged && isBreakoutV2({ ratio: j!.ratio, z: j!.z, confidence: j!.confidence, judgedAgeH: va });
  const isCase = breakout && !exo && !p.post.isOwned;
  // a control needs a trustworthy ratio at verdict: confidence ok or high
  const eligible = judged && !isCase && !p.post.isOwned && j!.confidence !== 'low';
  return { post: p, atMs, judged, isCase, eligible, ratio: j?.ratio ?? null };
}

/**
 * Give every tracked post that reached verdict age + 24h its role, once. Strata are
 * `<source_id>|<yyyy-mm>`; pi is fixed from the creator's case rate over the 90 days before the
 * stratum's first verdict. Returns the rows written now: cases, controls, and `skipped` (posts
 * at verdict this pass that are neither: not sampled, or no trustworthy ratio).
 */
export function assignVerdicts(store: LabStore, now: Date): { cases: number; controls: number; skipped: number } {
  const nowMs = now.getTime();
  const engine = new MeasureEngine({ posts: store.posts.all(), metrics: store.metrics.byPost(), creatorSnapshots: groupSnaps(store) });
  const existing = new Map(store.controls.all().map((c) => [c.postId, c]));
  const verdicts: Verdict[] = [];
  for (const p of engine.posts) {
    if (p.post.isOwned) continue;
    const v = verdictOf(engine, p, nowMs);
    if (v) verdicts.push(v);
  }
  verdicts.sort((a, b) => a.atMs - b.atMs || a.post.post.id.localeCompare(b.post.post.id));
  if (verdicts.length === 0) return { cases: 0, controls: 0, skipped: 0 };
  const seed = controlSeed(store, now);

  const history = new Map<string, { atMs: number; judged: boolean; isCase: boolean }[]>();
  const strata = new Map<string, { pi: number; eligible: number; drawn: number }>();
  const out: LabControl[] = [];
  let skipped = 0;
  for (const v of verdicts) {
    const src = v.post.post.sourceId;
    const s = stratumOf(v.post.post);
    let st = strata.get(s);
    if (!st) {
      const past = (history.get(src) ?? []).filter((h) => h.atMs < v.atMs && h.atMs >= v.atMs - CASE_RATE_WINDOW_DAYS * DAY && h.judged);
      const cases = past.filter((h) => h.isCase).length;
      st = { pi: controlProbability(past.length ? cases / past.length : null, past.length), eligible: 0, drawn: 0 };
      strata.set(s, st);
    }
    (history.get(src) ?? history.set(src, []).get(src)!).push({ atMs: v.atMs, judged: v.judged, isCase: v.isCase });
    let role: 'case' | 'control' | null = null;
    if (v.isCase) role = 'case';
    else if (v.eligible) {
      st.eligible++;
      if (drawControl(seed, v.post.post.id, st.pi)) {
        st.drawn++;
        role = 'control';
      }
    }
    if (existing.has(v.post.post.id)) continue;
    if (!role) {
      skipped++;
      continue;
    }
    out.push({
      postId: v.post.post.id,
      role,
      stratum: s,
      samplingProb: role === 'case' ? 1 : Math.round(st.pi * 1e6) / 1e6,
      eligibleN: st.eligible,
      drawnN: st.drawn,
      seed,
      verdictAgeH: verdictAgeFor(v.post.platform),
      verdictRatio: v.ratio === null ? null : Math.round(v.ratio * 10_000) / 10_000,
      drawnAt: new Date(v.atMs).toISOString(),
      status: 'selected',
      measureVersion: CC_MEASURE_VERSION,
    });
  }
  store.transaction(() => {
    for (const c of out) store.controls.upsert(c);
  });
  return { cases: out.filter((c) => c.role === 'case').length, controls: out.filter((c) => c.role === 'control').length, skipped };
}

function groupSnaps(store: LabStore) {
  const m = new Map<string, ReturnType<LabStore['creatorSnapshots']['all']>>();
  for (const s of store.creatorSnapshots.all()) (m.get(s.sourceId) ?? m.set(s.sourceId, []).get(s.sourceId)!).push(s);
  return m;
}

/* ── estimators (5.3) ─────────────────────────────────────────────────── */

export type MhResult = { or: number | null; lo: number | null; hi: number | null; se: number | null; z: number | null; p: number | null; cases: number; controls: number; casesWith: number; controlsWith: number; strata: number };

/** erfc via Abramowitz-Stegun 7.1.26 refined (max error about 1e-7). */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** Mantel-Haenszel odds ratio with the Robins-Breslow-Greenland variance and a 90% interval. */
export function mantelHaenszel(strata: readonly { a: number; b: number; c: number; d: number }[]): MhResult {
  let R = 0;
  let S = 0;
  let PR = 0;
  let PSQR = 0;
  let QS = 0;
  let used = 0;
  let cases = 0;
  let controls = 0;
  let casesWith = 0;
  let controlsWith = 0;
  for (const k of strata) {
    cases += k.a + k.b;
    controls += k.c + k.d;
    casesWith += k.a;
    controlsWith += k.c;
    const N = k.a + k.b + k.c + k.d;
    if (k.a + k.b === 0 || k.c + k.d === 0 || N === 0) continue;
    used++;
    const Rk = (k.a * k.d) / N;
    const Sk = (k.b * k.c) / N;
    const Pk = (k.a + k.d) / N;
    const Qk = (k.b + k.c) / N;
    R += Rk;
    S += Sk;
    PR += Pk * Rk;
    PSQR += Pk * Sk + Qk * Rk;
    QS += Qk * Sk;
  }
  const base = { cases, controls, casesWith, controlsWith, strata: used };
  if (!(R > 0) || !(S > 0)) return { or: null, lo: null, hi: null, se: null, z: null, p: null, ...base };
  const or = R / S;
  const v = PR / (2 * R * R) + PSQR / (2 * R * S) + QS / (2 * S * S);
  const se = Math.sqrt(v);
  const ln = Math.log(or);
  const z = ln / se;
  return { or, lo: Math.exp(ln - 1.645 * se), hi: Math.exp(ln + 1.645 * se), se, z, p: erfc(Math.abs(z) / Math.SQRT2), ...base };
}

/** lift_w = P(breakout | v) / P(breakout), controls weighted by 1 / pi. */
export function weightedLift(strata: readonly { a: number; b: number; c: number; d: number; pi: number }[]): number | null {
  let A = 0;
  let B = 0;
  let C = 0;
  let D = 0;
  for (const k of strata) {
    if (!(k.pi > 0)) continue;
    A += k.a;
    B += k.b;
    C += k.c / k.pi;
    D += k.d / k.pi;
  }
  if (A + C === 0 || A + B + C + D === 0) return null;
  const pv = A / (A + C);
  const p = (A + B) / (A + B + C + D);
  return p > 0 ? pv / p : null;
}

/** Benjamini-Hochberg q values, in the input order: q_(i) = min over j >= i of m p_(j) / j, capped at 1. */
export function benjaminiHochberg(ps: readonly number[]): number[] {
  const m = ps.length;
  const order = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const q = new Array<number>(m);
  let run = 1;
  for (let k = m - 1; k >= 0; k--) {
    run = Math.min(run, (m * order[k].p) / (k + 1));
    q[order[k].i] = Math.min(1, run);
  }
  return q;
}

export const FDR_Q = 0.1;
export const MIN_CASES_WITH = 8;
export const MIN_CONTROLS_WITH = 3;
/** A family needs this many cases and controls before a profile version is written (5.5). */
export const MIN_FAMILY_CASES = 8;
export const MIN_FAMILY_CONTROLS = 8;

/** Shown when a >= 8, c >= 3, the 90% interval excludes 1 and BH q <= 0.10. */
export function profileGate(r: MhResult, q: number | null): boolean {
  return r.or !== null && r.lo !== null && r.hi !== null && r.casesWith >= MIN_CASES_WITH && r.controlsWith >= MIN_CONTROLS_WITH && (r.lo > 1 || r.hi < 1) && q !== null && q <= FDR_Q;
}
