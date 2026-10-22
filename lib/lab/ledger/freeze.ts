/**
 * Prediction freezing (06 section 2): the payload seal, the freeze and log_external actions,
 * judge verdicts, linking to the post and voiding. Every live write goes through here; the
 * SQLite triggers in LEDGER_TRIGGERS_DDL (lib/db.ts) make the frozen fields immutable.
 */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { LabBandSchema, LAB_PLATFORMS, type LabBand, type LabPlatform, type LabPost, type LabPrediction, type LabTest } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { labTz } from '@/lib/lab/setup/jobs';
import { asOfView } from '@/lib/lab/measure/asof';
import { surfaceOf } from '@/lib/lab/ledger/deps';
import { ledgerBaseline } from '@/lib/lab/ledger/outcome';
import { quantile } from '@/lib/lab/measures';

/** 06 2.4(a): the fields the payload hash seals. */
export const FROZEN_FIELDS = ['id', 'origin', 'predictor', 'predictorVersion', 'kind', 'scriptId', 'scriptVersion', 'sourceId', 'platform', 'surface', 'refAgeH', 'asOf', 'frozenAt', 'backtestOrigin', 'band', 'score', 'ratioPoint', 'ratioLo', 'ratioHi', 'viewsPoint', 'viewsLo', 'viewsHi', 'pBreakout', 'intervalLevel', 'baseline7dViews', 'baselineN', 'inputs', 'note'] as const;

/** 06 2.7: the 201 body of POST /api/lab/predictions. */
export type PredictionWriteResponse = {
  /** the row this action wrote (brody or external:<tool>) */
  predictionId: string;
  frozenAt: string;
  /** scriptVersion for freeze; null otherwise */
  version: number | null;
  late: boolean;
  /** freeze: LAB_COPY.frozenAt; log_external: '{toolLabel} {score}/{scaleMax}' */
  label: string;
  predictions: LabPrediction[];
};

/** 07 7.8 / 01 LAB_COPY.frozenAt. Lane V's LAB_COPY carries the same template. */
export const FROZEN_AT_COPY = 'Frozen {d MMM}, {HH:mm}';
export const FROZEN_LATE_COPY = 'Frozen after posting, not graded';

/* ── Seal (06 2.4a) ──────────────────────────────────────────────────────────── */

/** Canonical JSON: object keys sorted at every depth, numbers as JSON.stringify writes them. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

/** sha256(canonicalJson(pick(row, FROZEN_FIELDS))). */
export function payloadSha256(row: Omit<LabPrediction, 'payloadSha256'>): string {
  const picked = Object.fromEntries(FROZEN_FIELDS.map((f) => [f, (row as Record<string, unknown>)[f] ?? null]));
  return createHash('sha256').update(canonicalJson(picked)).digest('hex');
}

/** True when the stored seal matches the frozen fields (the Ledger shows "Seal broken" otherwise). */
export function verifyFrozen(row: LabPrediction): boolean {
  return payloadSha256(row) === row.payloadSha256;
}

export const newPredictionId = () => `lpr-${randomBytes(8).toString('hex')}`;

/** A blank live row; callers set what they froze, then `seal`. */
export function draftPrediction(p: Pick<LabPrediction, 'id' | 'predictor' | 'predictorVersion' | 'kind' | 'asOf' | 'frozenAt'> & Partial<LabPrediction>): Omit<LabPrediction, 'payloadSha256'> {
  return {
    origin: 'live', scriptId: null, scriptVersion: null, postId: null, sourceId: null, platform: null, surface: null, refAgeH: null, backtestOrigin: null,
    band: null, score: null, ratioPoint: null, ratioLo: null, ratioHi: null, viewsPoint: null, viewsLo: null, viewsHi: null, pBreakout: null, intervalLevel: null,
    baseline7dViews: null, baselineN: null, inputs: {}, note: '', late: false, status: 'frozen', voidReason: null, voidedAt: null,
    outcomeViews7d: null, outcomeRatio7d: null, outcomeBand: null, outcomeIsBreakout: null, outcomeMethod: null, hitBand: null, inInterval: null, absLogErr: null,
    testId: null, pairRight: null, gradedAt: null, dry: false,
    ...p,
  };
}

export function seal(row: Omit<LabPrediction, 'payloadSha256'>): LabPrediction {
  return { ...row, payloadSha256: payloadSha256(row) };
}

/* ── Request bodies (06 2.7) ─────────────────────────────────────────────────── */

const FreezeAction = z.object({
  action: z.literal('freeze'),
  scriptId: z.string().min(1),
  version: z.number().int().positive(),
  band: LabBandSchema,
  ratioLo: z.number().positive().optional(),
  ratioHi: z.number().positive().optional(),
  variantRanking: z.array(z.string()).min(2).max(3).optional(),
  hypothesis: z.string().max(500).optional(),
  featureKey: z.string().optional(),
  expectedSign: z.union([z.literal(1), z.literal(-1)]).optional(),
  note: z.string().max(280).optional(),
});
const LogExternalAction = z.object({
  action: z.literal('log_external'),
  postId: z.string().min(1).optional(),
  scriptId: z.string().min(1).optional(),
  tool: z.string().regex(/^[a-z0-9_]{2,24}$/).refine((t) => t !== 'brody', { message: 'brody is not an outside tool' }),
  toolLabel: z.string().min(2).max(40).optional(),
  score: z.number().min(0),
  scaleMax: z.number().positive(),
  note: z.string().max(280).optional(),
});
export const PredictionActionBody = z.discriminatedUnion('action', [FreezeAction, LogExternalAction]);
export type FreezeBody = z.infer<typeof FreezeAction>;
export type LogExternalBody = z.infer<typeof LogExternalAction>;

/** Validation beyond the zod shape; null when the body is fine. */
export function bodyProblem(b: z.infer<typeof PredictionActionBody>): string | null {
  if (b.action === 'freeze') {
    if ((b.ratioLo === undefined) !== (b.ratioHi === undefined)) return 'give both ends of the range or neither';
    if (b.ratioLo !== undefined && b.ratioHi !== undefined && !(b.ratioLo < b.ratioHi)) return 'the range must run low to high';
    return null;
  }
  if ((b.postId === undefined) === (b.scriptId === undefined)) return 'give a post or a script';
  if (b.score > b.scaleMax) return 'the score is above its scale';
  return null;
}

export class PredictionWriteError extends Error {
  constructor(
    public status: 400 | 404 | 409,
    public code: string,
  ) {
    super(code);
    this.name = 'PredictionWriteError';
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────────────── */

const BAND_ORDINAL: Record<LabBand, number> = { below: 0, normal: 1, above: 2, breakout: 3 };

/** 'Frozen 11 Oct, 14:05' in the Lab's local time (labTz). */
export function frozenLabel(frozenAt: string, late: boolean): string {
  if (late) return FROZEN_LATE_COPY;
  const d = new Date(frozenAt);
  const tz = labTz();
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric' }).format(d);
  const mon = new Intl.DateTimeFormat('en-GB', { timeZone: tz, month: 'short' }).format(d);
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return FROZEN_AT_COPY.replace('{d MMM}', `${day} ${mon}`).replace('{HH:mm}', hm);
}

const isPlatform = (p: unknown): p is LabPlatform => typeof p === 'string' && (LAB_PLATFORMS as readonly string[]).includes(p);

/**
 * The post a pre-post prediction is about, as ledgerBaseline needs it. A published script uses
 * its post. An unposted one uses the script's platform (07: absent or 'multi' falls back to the
 * owned platform posted on most recently) and the most common owned contentType there, posted now.
 */
export function prePostTarget(store: LabStore, scriptId: string, now: Date): Pick<LabPost, 'sourceId' | 'platform' | 'contentType' | 'postedAt'> | null {
  const script = store.scripts.get(scriptId);
  if (!script) return null;
  if (script.publishedPostId) {
    const post = store.posts.get(script.publishedPostId);
    if (post) return { sourceId: post.sourceId, platform: post.platform, contentType: post.contentType, postedAt: post.postedAt ?? now.toISOString() };
  }
  const owned = store.posts.all().filter((p) => p.isOwned && p.postedAt).sort((a, b) => (a.postedAt! < b.postedAt! ? 1 : -1));
  const bodyPlatform = store.scripts.latestVersion(scriptId)?.body.platform;
  const platform = isPlatform(bodyPlatform) ? bodyPlatform : owned[0]?.platform;
  if (!platform) return null;
  const onPlatform = owned.filter((p) => p.platform === platform);
  const source = onPlatform[0]?.sourceId ?? store.sources.all('owned').find((s) => s.platform === platform)?.id;
  if (!source) return null;
  const counts = new Map<string, number>();
  for (const p of onPlatform) counts.set(p.contentType, (counts.get(p.contentType) ?? 0) + 1);
  const contentType = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'video';
  return { sourceId: source, platform, contentType, postedAt: now.toISOString() };
}

/** The creator's normal at 7 days as of now, or null (the baseline abstains). */
export function baselineAtFreeze(store: LabStore, target: Pick<LabPost, 'sourceId' | 'platform' | 'contentType' | 'postedAt'>, now: Date): { views: number; n: number; p10: number | null; p90: number | null; surface: string | null } | null {
  const b = ledgerBaseline(asOfView(store, now.toISOString()), target, { store, now });
  if (!b) return null;
  return { views: b.views, n: b.n, p10: b.sample.length >= 5 ? quantile(b.sample, 0.1) : null, p90: b.sample.length >= 5 ? quantile(b.sample, 0.9) : null, surface: surfaceOf(target) };
}

function surfaceOrNull(target: Pick<LabPost, 'platform' | 'contentType'> | null): string | null {
  if (!target) return null;
  return surfaceOf(target);
}

/* ── freeze (06 2.7) ─────────────────────────────────────────────────────────── */

export function freezePrediction(store: LabStore, b: FreezeBody, opts: { now: Date; dry: boolean }): PredictionWriteResponse {
  const { now, dry } = opts;
  const script = store.scripts.get(b.scriptId);
  if (!script) throw new PredictionWriteError(404, 'unknown script');
  if (!store.scripts.versions(b.scriptId).some((v) => v.version === b.version)) throw new PredictionWriteError(404, 'unknown version');
  const existing = store.predictions.list({ origin: 'live', predictor: 'brody', scriptId: b.scriptId }).filter((p) => p.status !== 'void' && p.kind === 'pre_post');
  if (existing.length) throw new PredictionWriteError(409, 'already_frozen');

  const frozenAt = now.toISOString();
  const target = prePostTarget(store, b.scriptId, now);
  const base = target ? baselineAtFreeze(store, target, now) : null;
  const post = script.publishedPostId ? store.posts.get(script.publishedPostId) : null;
  const late = Boolean(post?.postedAt && Date.parse(post.postedAt) <= now.getTime());
  const linkPost = late && post ? post.id : null;
  const common = {
    asOf: frozenAt, frozenAt, kind: 'pre_post' as const, scriptId: b.scriptId, scriptVersion: b.version,
    postId: linkPost, late, sourceId: target?.sourceId ?? null, platform: target?.platform ?? null, surface: base?.surface ?? surfaceOrNull(target),
    baseline7dViews: base?.views ?? null, baselineN: base?.n ?? null, dry,
  };
  const brody = seal(draftPrediction({
    ...common, id: newPredictionId(), predictor: 'brody', predictorVersion: 'brody-1',
    band: b.band, score: BAND_ORDINAL[b.band], ratioLo: b.ratioLo ?? null, ratioHi: b.ratioHi ?? null, intervalLevel: b.ratioLo !== undefined ? 0.8 : null,
    inputs: b.variantRanking ? { variantRanking: b.variantRanking } : {}, note: b.note ?? '',
  }));
  const rows: LabPrediction[] = [brody];
  if (base) {
    rows.push(seal(draftPrediction({
      ...common, id: newPredictionId(), predictor: 'creator_median', predictorVersion: 'cm-1',
      band: 'normal', score: 0, ratioPoint: 1, viewsPoint: base.views, viewsLo: base.p10, viewsHi: base.p90, intervalLevel: base.p10 !== null ? 0.8 : null,
      inputs: { n: base.n },
    })));
  }
  store.transaction(() => {
    for (const r of rows) store.predictions.insert(r);
    if (b.hypothesis) store.tests.create(selfExperiment(store, b, now, dry));
  });
  return { predictionId: brody.id, frozenAt, version: b.version, late, label: frozenLabel(frozenAt, late), predictions: rows };
}

/** 06 10.5: one-arm self_experiment test created with the freeze. */
function selfExperiment(store: LabStore, b: FreezeBody, now: Date, dry: boolean): LabTest {
  const script = store.scripts.get(b.scriptId)!;
  const target = prePostTarget(store, b.scriptId, now);
  const iso = now.toISOString();
  return {
    id: `lt-${randomBytes(6).toString('hex')}`, kind: 'self_experiment', title: script.title.slice(0, 120) || 'Self-experiment', hypothesis: b.hypothesis ?? '', variable: 'other',
    featureKey: b.featureKey ?? null, expectedSign: b.expectedSign ?? null, scriptId: b.scriptId, platform: target?.platform ?? 'instagram', status: 'running',
    arms: [{ id: 'a', label: 'This post', variantText: script.title.slice(0, 500), hookId: null, featureValue: b.featureKey?.split(':')[1] ?? null, postId: script.publishedPostId, metrics: { atAgeH: null, reach: null, views: null, likes: null, shares: null, saved: null, follows: null, watchTimeSharePct: null, source: null }, propensity: null }],
    judgeAgeH: 168, primaryMetric: 'ratio_7d', result: null, winnerArm: null, observedSign: null, confirms: null, judgeDetail: {}, notes: '', planWeek: null,
    startedAt: iso, judgedAt: null, createdAt: iso, updatedAt: iso, dry,
  };
}

/* ── log_external (06 2.7) ───────────────────────────────────────────────────── */

export function logExternal(store: LabStore, b: LogExternalBody, opts: { now: Date; dry: boolean }): PredictionWriteResponse {
  const { now, dry } = opts;
  const predictor = `external:${b.tool}`;
  const toolLabel = b.toolLabel ?? b.tool;
  let post: LabPost | null = null;
  let target: Pick<LabPost, 'sourceId' | 'platform' | 'contentType' | 'postedAt'> | null = null;
  if (b.scriptId) {
    const script = store.scripts.get(b.scriptId);
    if (!script) throw new PredictionWriteError(404, 'unknown script');
    post = script.publishedPostId ? store.posts.get(script.publishedPostId) : null;
    target = prePostTarget(store, b.scriptId, now);
  } else {
    post = store.posts.get(b.postId!);
    if (!post) throw new PredictionWriteError(404, 'unknown post');
    target = { sourceId: post.sourceId, platform: post.platform, contentType: post.contentType, postedAt: post.postedAt ?? now.toISOString() };
  }
  const dup = store.predictions.list({ origin: 'live', predictor, ...(b.scriptId ? { scriptId: b.scriptId } : { postId: b.postId }) }).filter((p) => p.status !== 'void' && (b.scriptId ? true : p.scriptId === null));
  if (dup.length) throw new PredictionWriteError(409, 'already_frozen');

  const frozenAt = now.toISOString();
  const late = Boolean(post?.postedAt && Date.parse(post.postedAt) <= now.getTime());
  const base = target ? baselineAtFreeze(store, target, now) : null;
  const row = seal(draftPrediction({
    id: newPredictionId(), predictor, predictorVersion: 'ext-1', kind: 'pre_post', asOf: frozenAt, frozenAt,
    scriptId: b.scriptId ?? null, postId: b.scriptId ? (late ? post!.id : null) : post!.id, late,
    sourceId: target?.sourceId ?? null, platform: target?.platform ?? null, surface: base?.surface ?? surfaceOrNull(target),
    score: b.score / b.scaleMax, inputs: { rawScore: b.score, scaleMax: b.scaleMax, toolLabel }, note: b.note ?? '',
    baseline7dViews: base?.views ?? null, baselineN: base?.n ?? null, dry,
  }));
  store.predictions.insert(row);
  return { predictionId: row.id, frozenAt, version: null, late, label: `${toolLabel} ${b.score}/${b.scaleMax}`, predictions: [row] };
}

/* ── judge verdicts (06 2.7, in process only) ────────────────────────────────── */

export function recordJudgeVerdict(store: LabStore, v: { scriptId: string; aId: string; bId: string; winner: string | null; abstained: boolean; promptVersion: string; dry: boolean; now: Date }): LabPrediction {
  const pair = [v.aId, v.bId].sort().join('|');
  const existing = store.predictions.list({ origin: 'live', predictor: 'judge', scriptId: v.scriptId, limit: 1000 })
    .find((p) => p.status !== 'void' && [String(p.inputs.aId), String(p.inputs.bId)].sort().join('|') === pair);
  if (existing) return existing;
  const at = v.now.toISOString();
  const row = seal(draftPrediction({
    id: newPredictionId(), predictor: 'judge', predictorVersion: v.promptVersion, kind: 'pairwise', asOf: at, frozenAt: at, scriptId: v.scriptId,
    inputs: { aId: v.aId, bId: v.bId, winner: v.winner, abstained: v.abstained, promptVersion: v.promptVersion },
    note: v.abstained ? 'abstained' : '', status: v.abstained ? 'ungradable' : 'frozen', dry: v.dry,
  }));
  store.predictions.insert(row);
  return row;
}

/* ── link to post (06 2.5) ───────────────────────────────────────────────────── */

/** Links a script's live, non-void, unlinked pre-post rows to the published post. Returns rows linked. */
export function linkPredictionsToPost(store: LabStore, scriptId: string, postId: string, now: Date): number {
  void now;
  const post = store.posts.get(postId);
  if (!post?.postedAt) return 0; // never write `late` from an unknown time; gradeDue retries
  const posted = Date.parse(post.postedAt);
  const rows = store.predictions.list({ origin: 'live', kind: 'pre_post', scriptId, limit: 1000 }).filter((p) => p.postId === null && p.status !== 'void');
  let n = 0;
  store.transaction(() => {
    for (const r of rows) n += store.predictions.linkOne(r.id, postId, Date.parse(r.frozenAt) > posted) ? 1 : 0;
  });
  return n;
}

/** True when the script has a live, non-void, non-late brody row (else Studio says it will not count). */
export function hasLivePrediction(store: LabStore, scriptId: string): boolean {
  return store.predictions.list({ origin: 'live', predictor: 'brody', scriptId }).some((p) => p.status !== 'void' && !p.late);
}

/* ── void (06 2.7) ───────────────────────────────────────────────────────────── */

export function voidPrediction(store: LabStore, id: string, reason: string, now: Date): LabPrediction {
  const row = store.predictions.get(id);
  if (!row) throw new PredictionWriteError(404, 'unknown prediction');
  if (row.origin === 'backtest') throw new PredictionWriteError(400, 'backtest rows cannot be voided');
  if (row.status === 'void') throw new PredictionWriteError(409, 'already void');
  store.predictions.void(id, reason, now.toISOString());
  return store.predictions.get(id)!;
}
