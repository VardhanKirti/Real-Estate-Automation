import type Database from 'better-sqlite3';
import {
  LabBeatSchema,
  LabCreatorSnapshotSchema,
  LabDissectionSchema,
  LabFeatureLiftSchema,
  LabGateSchema,
  LabIdeaSchema,
  LabMeasureSchema,
  LabPostMetricsSchema,
  LabPostSchema,
  LabProfileSchema,
  LabRunSchema,
  LabScriptBodySchema,
  LabScriptSchema,
  LabSourceSchema,
  LabSpendSchema,
  LabTrendItemSchema,
  LabTrendSnapshotSchema,
  type LabCluster,
  type LabCreatorSnapshot,
  type LabDissection,
  type LabIdea,
  type LabIdeaStatus,
  type LabMeasure,
  type LabOutcome,
  type LabPost,
  type LabPostMetrics,
  type LabPostTopic,
  type LabPrior,
  type LabProfile,
  type LabRun,
  type LabScript,
  type LabScriptVersion,
  type LabSource,
  type LabSourceKind,
  type LabSourceStatus,
  type LabSpend,
  type LabSpendProvider,
  type LabTranscript,
  type LabTrendItem,
  type LabTrendSnapshot,
  LabCommentSchema,
  LabControlSchema,
  LabEvalSchema,
  LabEventCoverageSchema,
  LabEventPingSchema,
  LabEventSchema,
  LabForecastSchema,
  LabMeasureV2Schema,
  LabMorningBriefSchema,
  LabPredictionSchema,
  LabRetentionSchema,
  LabTestSchema,
  emptyGrounding,
  type LabComment,
  type LabControl,
  type LabControlStatus,
  type LabEmbedSubject,
  type LabEmbedding,
  type LabEval,
  type LabEvent,
  type LabEventCoverage,
  type LabEventPing,
  type LabEventStatus,
  type LabExoReason,
  type LabForecast,
  type LabForecastKind,
  type LabMeasureV2,
  type LabMorningBrief,
  type LabPrediction,
  type LabRadarSource,
  type LabRetention,
  type LabSpendLine,
  type LabTest,
} from '@/lib/schemas';
import { z } from 'zod';
// lib/db.ts imports this module too (getDb().lab); the cycle is safe because both names are only used at call time.
import { LEDGER_TRIGGERS_DDL, migrateLabV2 } from '@/lib/db';

/**
 * Content Lab repository (SPEC §6, CONTRACT.md "Store"). The only code that reads or
 * writes lab_* rows. Typed in and out (camelCase rows validated by the zod schemas in
 * lib/schemas.ts); JSON columns are parsed here so callers never see a string blob.
 *
 * Reached as `getDb().lab` (lib/db.ts) or, for the in-memory sample world, through
 * `labStore(new Database(':memory:'))` after `db.exec(LAB_DDL)`.
 *
 * Rules: metrics are append-only (a re-read is a new row, never an update); posts upsert
 * on (platform, external_id) and keep their first id; measures/profiles/trend snapshots
 * are derived and may be rebuilt wholesale.
 */

type Sqlite = InstanceType<typeof Database>;
type Row = Record<string, unknown>;

const json = <T>(raw: unknown, fallback: T): T => {
  if (typeof raw !== 'string' || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};
const bool = (v: unknown) => v === 1 || v === true;
const int = (b: boolean) => (b ? 1 : 0);

/** Every lab table, in dependency-free order (for clears and counts). */
export const LAB_TABLES = [
  'lab_sources', 'lab_creator_snapshots', 'lab_posts', 'lab_post_metrics', 'lab_transcripts', 'lab_dissections',
  'lab_post_topics', 'lab_measures', 'lab_clusters', 'lab_trend_snapshots', 'lab_trend_items', 'lab_profiles',
  'lab_ideas', 'lab_scripts', 'lab_script_versions', 'lab_outcomes', 'lab_priors', 'lab_runs', 'lab_spend',
  // v2 (S0; SPEC.md 3.4)
  'lab_controls', 'lab_events', 'lab_event_pings', 'lab_event_coverage', 'lab_brief',
  'lab_predictions', 'lab_evals', 'lab_retention', 'lab_tests', 'lab_embeddings', 'lab_comments', 'lab_forecasts',
] as const;
export type LabTable = (typeof LAB_TABLES)[number];

const toSource = (r: Row): LabSource =>
  LabSourceSchema.parse({ id: r.id, kind: r.kind, platform: r.platform, handle: r.handle, url: r.url ?? null, displayName: r.display_name ?? '', status: r.status, addedAt: r.added_at, reason: r.reason ?? null, score: r.score ?? null });
const toPost = (r: Row): LabPost =>
  LabPostSchema.parse({ id: r.id, sourceId: r.source_id, platform: r.platform, externalId: r.external_id, url: r.url, postedAt: r.posted_at ?? null, caption: r.caption ?? '', contentType: r.content_type ?? 'video', thumbnailUrl: r.thumbnail_url ?? null, mediaUrl: r.media_url ?? null, durationS: r.duration_s ?? null, isOwned: bool(r.is_owned), epoch: r.epoch ?? 'current', exoReason: r.exo_reason ?? null, exoNote: r.exo_note ?? null, exoAt: r.exo_at ?? null });
const toMetrics = (r: Row): LabPostMetrics =>
  LabPostMetricsSchema.parse({ postId: r.post_id, capturedAt: r.captured_at, views: r.views ?? null, likes: r.likes ?? null, comments: r.comments ?? null, shares: r.shares ?? null, saves: r.saves ?? null, ageH: r.age_h ?? null, targetAgeH: r.target_age_h ?? null, readKind: r.read_kind ?? 'cycle', quotes: r.quotes ?? null });
const toTranscript = (r: Row): LabTranscript => ({ postId: String(r.post_id), text: String(r.text ?? ''), wordCount: Number(r.word_count ?? 0), wpm: (r.wpm as number | null) ?? null, provider: String(r.provider ?? ''), costUsd: Number(r.cost_usd ?? 0), status: (r.status as LabTranscript['status']) ?? 'none' });
const toDissection = (r: Row): LabDissection =>
  LabDissectionSchema.parse({
    postId: r.post_id, format: r.format, hookForm: r.hook_form, emotionalTrigger: r.emotional_trigger, hookChannel: r.hook_channel,
    hookText: r.hook_text ?? '', firstFrameText: r.first_frame_text ?? '', structureType: r.structure_type,
    beats: json(r.beats_json, []), pacing: r.pacing, pillar: r.pillar, ctaType: r.cta_type, tension: json(r.tension_json, null),
    confidences: json(r.confidences_json, {}), qualityNotes: r.quality_notes ?? '', modelId: r.model_id, promptVersion: r.prompt_version, analysedAt: r.analysed_at,
    framesUsed: Number(r.frames_used ?? 0), onScreenTextDensity: r.on_screen_text_density ?? null, faceFirstFrame: r.face_first_frame == null ? null : bool(r.face_first_frame), sheetPath: r.sheet_path ?? null,
  });
const toTopic = (r: Row): LabPostTopic => ({ postId: String(r.post_id), topic: String(r.topic), angle: String(r.angle ?? ''), isPrimary: bool(r.is_primary), clusterId: (r.cluster_id as string | null) ?? null });
/** v2: every read returns the v2 shape (a superset of v1 LabMeasure); v1 rows get the column defaults. */
const toMeasure = (r: Row): LabMeasureV2 =>
  LabMeasureV2Schema.parse({
    postId: r.post_id, depth: r.depth ?? null, breakout: r.breakout ?? null, breakoutLo: r.breakout_lo ?? null, breakoutHi: r.breakout_hi ?? null, baselineN: r.baseline_n ?? 0, baselineConfidence: r.baseline_confidence ?? 'low', reach: r.reach ?? null, velocity: r.velocity ?? null, trajectory: r.trajectory ?? null, quadrant: r.quadrant ?? null, isBreakout: bool(r.is_breakout), computedAt: r.computed_at,
    measureVersion: r.measure_version ?? 'measure-v1', metricBasis: r.metric_basis ?? 'views', judgedAgeH: r.judged_age_h ?? null, basisAtAge: r.basis_at_age ?? null, baselineLog: r.baseline_log ?? null, baselineVar: r.baseline_var ?? null, priorLog: r.prior_log ?? null, shrinkB: r.shrink_b ?? null, baselineSource: r.baseline_source ?? null,
    robustZ: r.robust_z ?? null, volatility: r.volatility ?? null, volatilityClass: r.volatility_class ?? null, maxOverMedian: r.max_over_median ?? null, nicheRatio: r.niche_ratio ?? null, dualHigh: bool(r.dual_high), trajectoryClass: r.trajectory_class ?? null, peakDayShare: r.peak_day_share ?? null, exoAuto: bool(r.exo_auto),
    sharesPerView: r.shares_per_view ?? null, savesPerView: r.saves_per_view ?? null, xActionScore: r.x_action_score ?? null, followersAsOf: r.followers_as_of ?? null, ages: json(r.ages_json, {}),
  });
const toSnapshot = (r: Row): LabTrendSnapshot =>
  LabTrendSnapshotSchema.parse({ clusterId: r.cluster_id, day: r.day, posts: r.posts, breakouts: r.breakouts, creators: r.creators, platforms: r.platforms, feedMentions: r.feed_mentions, sourceCount: r.source_count, momentum: r.momentum ?? null, timing: r.timing ?? null });
const toTrendItem = (r: Row): LabTrendItem =>
  LabTrendItemSchema.parse({ id: r.id, feed: r.feed, url: r.url, title: r.title, score: r.score ?? null, comments: r.comments ?? null, sources: json(r.sources_json, []), sourceCount: r.source_count, clusterId: r.cluster_id ?? null, seenAt: r.seen_at, actedOnAt: r.acted_on_at ?? null });
const toProfile = (r: Row): LabProfile =>
  LabProfileSchema.parse({ id: r.id, formatFamily: r.format_family, label: r.label ?? '', version: r.version, windowDays: r.window_days, postsN: r.posts_n, breakoutsN: r.breakouts_n, features: z.array(LabFeatureLiftSchema).parse(json(r.features_json, [])), strand: z.array(LabBeatSchema).parse(json(r.strand_json, [])), stats: { wpm: null, durationS: null, ...json(r.stats_json, {}) }, createdAt: r.created_at, method: r.method ?? 'lift_wilson_v1', controlsN: Number(r.controls_n ?? 0), fdrQ: r.fdr_q ?? null });
const toIdea = (r: Row): LabIdea =>
  LabIdeaSchema.parse({ id: r.id, title: r.title, clusterId: r.cluster_id ?? null, angle: r.angle ?? '', tension: json(r.tension_json, null), formatFamily: r.format_family, strand: json(r.strand_json, []), hookRecs: json(r.hook_recs_json, []), evidence: json(r.evidence_json, []), timing: r.timing ?? null, fit: r.fit, thin: bool(r.thin), status: r.status, dismissReason: r.dismiss_reason ?? null, createdAt: r.created_at, actedOnAt: r.acted_on_at ?? null,
    eventId: r.event_id ?? null, launchAngle: r.launch_angle ?? null, source: r.source ?? 'sync', batchId: r.batch_id ?? null, seedId: r.seed_id ?? null, notes: r.notes ?? null, hookForm: r.hook_form ?? null, hookTrigger: r.hook_trigger ?? null, vsProbability: r.vs_probability ?? null, mmrRank: r.mmr_rank ?? null,
    grounding: (() => { const g = json<Record<string, unknown>>(r.grounding_json, {}); return Object.keys(g).length ? g : emptyGrounding; })(), promptVersion: r.prompt_version ?? null });
const toScript = (r: Row): LabScript =>
  LabScriptSchema.parse({ id: r.id, ideaId: r.idea_id ?? null, title: r.title, status: r.status, publishedPostId: r.published_post_id ?? null, createdAt: r.created_at });
const toVersion = (r: Row): LabScriptVersion => ({
  scriptId: String(r.script_id),
  version: Number(r.version),
  body: LabScriptBodySchema.parse(json(r.body_json, {})),
  gate: LabGateSchema.parse({ passed: false, checks: [], scores: null, ...json(r.gate_json, {}) }),
  createdAt: String(r.created_at),
  editDiff: (r.edit_diff as string | null) ?? null,
});
const toRun = (r: Row): LabRun =>
  LabRunSchema.parse({ id: r.id, kind: r.kind, apifyRunId: r.apify_run_id ?? null, datasetId: r.dataset_id ?? null, actor: r.actor ?? null, input: json(r.input_json, {}), status: r.status, items: r.items ?? null, costUsd: r.cost_usd ?? null, dry: bool(r.dry), startedAt: r.started_at, finishedAt: r.finished_at ?? null, error: r.error ?? null, line: r.line ?? null, job: r.job ?? null, scheduled: bool(r.scheduled), batchId: r.batch_id ?? null, progress: json(r.progress_json, null) });
const toSpend = (r: Row): LabSpend =>
  LabSpendSchema.parse({ id: r.id, runId: r.run_id ?? null, provider: r.provider, units: r.units, estUsd: r.est_usd ?? null, actualUsd: r.actual_usd ?? null, dry: bool(r.dry), at: r.at, line: r.line ?? defaultLine(r.provider as LabSpendProvider), reservedUsd: r.reserved_usd ?? null, actualSource: r.actual_source ?? null, events: json(r.events_json, null), settledAt: r.settled_at ?? null });
/** v1 writers name only a provider: Apify work was all sync, every other provider is its own general line (08.6.4). */
const defaultLine = (p: LabSpendProvider): LabSpendLine => (p === 'apify' ? 'apify.sync' : p);

/* ── v2 row mappers (S0). Column names are lib/db.ts LAB_V2_DDL's; shapes are lib/schemas.ts's. ── */
const nb = (v: unknown): boolean | null => (v === null || v === undefined ? null : bool(v));
const toControl = (r: Row): LabControl =>
  LabControlSchema.parse({ postId: r.post_id, role: r.role, stratum: r.stratum, samplingProb: r.sampling_prob, eligibleN: r.eligible_n, drawnN: r.drawn_n, seed: r.seed, verdictAgeH: r.verdict_age_h, verdictRatio: r.verdict_ratio ?? null, drawnAt: r.drawn_at, status: r.status, measureVersion: r.measure_version });
const toEvent = (r: Row): LabEvent =>
  LabEventSchema.parse({
    id: r.id, key: r.key, name: r.name, vendor: r.vendor ?? null, aliases: json(r.aliases_json, []), status: r.status, mergedInto: r.merged_into ?? null, dismissReason: r.dismiss_reason ?? null,
    novelty: r.novelty ?? null, noveltySource: r.novelty_source ?? null, class: r.class ?? 'unknown', classBasis: r.class_basis ?? null,
    classInfo: { peak: null, preMedian: null, baselineShare: null, day7Share: null, decidedAt: null, week5Share: null, classCorrect: null, ...json<Record<string, unknown>>(r.class_json, {}) },
    wikiArticle: r.wiki_article ?? null, attention: json(r.attention_json, []), t0: r.t0 ?? null, t0Rule: r.t0_rule ?? null, t0PingId: r.t0_ping_id ?? null, t0RevisedAt: r.t0_revised_at ?? null,
    confirmedAt: r.confirmed_at ?? null, firstSeenAt: r.first_seen_at, sourceCount: r.source_count ?? 0, sources: json(r.sources_json, []), waveN: r.wave_n ?? 1, waveStartedAt: r.wave_started_at ?? null,
    windowState: r.window_state ?? null, windowOpensAt: r.window_opens_at ?? null, windowClosingAt: r.window_closing_at ?? null, windowClosesAt: r.window_closes_at ?? null, windowChangedAt: r.window_changed_at ?? null, windowReason: r.window_reason ?? null,
    windowLog: json(r.window_log_json, []), clusterId: r.cluster_id ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  });
const toPing = (r: Row): LabEventPing =>
  LabEventPingSchema.parse({
    id: r.id, source: r.source, family: r.family, externalId: r.external_id, eventId: r.event_id ?? null, matchRule: r.match_rule ?? null, name: r.name ?? null, nameKey: r.name_key ?? null,
    title: r.title ?? '', url: r.url ?? '', author: r.author ?? null, vendor: r.vendor ?? null, sourceTime: r.source_time ?? null, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, prevSeenAt: r.prev_seen_at ?? null,
    metricFirst: r.metric_first ?? null, metricPrev: r.metric_prev ?? null, metricLast: r.metric_last ?? null, rank: r.rank ?? null, velocityPerH: r.velocity_per_h ?? null, robustZ: r.robust_z ?? null,
    isLaunch: bool(r.is_launch), isBaseline: bool(r.is_baseline), qualifies: bool(r.qualifies), qualifyReason: r.qualify_reason ?? null, fakeStar: nb(r.fake_star), fakeStarInfo: json(r.fake_star_json, null), lexicon: bool(r.lexicon), dry: bool(r.dry),
  });
const toCoverage = (r: Row): LabEventCoverage =>
  LabEventCoverageSchema.parse({
    eventId: r.event_id, postId: r.post_id, sourceId: r.source_id, platform: r.platform, isOwned: bool(r.is_owned), postedAt: r.posted_at, hoursSinceT0: r.hours_since_t0, waveN: r.wave_n, wavePosition: r.wave_position, creatorRank: r.creator_rank ?? null,
    matchRule: r.match_rule, confidence: r.confidence, confirmed: nb(r.confirmed), angle: r.angle, angleSource: r.angle_source, ratio: r.ratio ?? null, ratioAgeH: r.ratio_age_h ?? null, isBreakout: bool(r.is_breakout), computedAt: r.computed_at,
  });
const toBrief = (r: Row): LabMorningBrief =>
  LabMorningBriefSchema.parse({ id: r.id, day: r.day, composedAt: r.composed_at, items: json(r.items_json, []), dedupeKeys: json(r.dedupe_keys_json, []), text: r.text ?? '', sentAt: r.sent_at ?? null, sentVia: r.sent_via ?? null, sendError: r.send_error ?? null, dry: bool(r.dry) });
const toPrediction = (r: Row): LabPrediction =>
  LabPredictionSchema.parse({
    id: r.id, origin: r.origin, predictor: r.predictor, predictorVersion: r.predictor_version, kind: r.kind, scriptId: r.script_id ?? null, scriptVersion: r.script_version ?? null, postId: r.post_id ?? null, sourceId: r.source_id ?? null,
    platform: r.platform ?? null, surface: r.surface ?? null, refAgeH: r.ref_age_h ?? null, asOf: r.as_of, frozenAt: r.frozen_at, backtestOrigin: r.backtest_origin ?? null, band: r.band ?? null, score: r.score ?? null,
    ratioPoint: r.ratio_point ?? null, ratioLo: r.ratio_lo ?? null, ratioHi: r.ratio_hi ?? null, viewsPoint: r.views_point ?? null, viewsLo: r.views_lo ?? null, viewsHi: r.views_hi ?? null,
    pBreakout: r.p_breakout ?? null, intervalLevel: r.interval_level ?? null, baseline7dViews: r.baseline_7d_views ?? null, baselineN: r.baseline_n ?? null, inputs: json(r.inputs_json, {}), note: r.note ?? '',
    payloadSha256: r.payload_sha256, late: bool(r.late), status: r.status, voidReason: r.void_reason ?? null, voidedAt: r.voided_at ?? null,
    outcomeViews7d: r.outcome_views_7d ?? null, outcomeRatio7d: r.outcome_ratio_7d ?? null, outcomeBand: r.outcome_band ?? null, outcomeIsBreakout: nb(r.outcome_is_breakout), outcomeMethod: r.outcome_method ?? null,
    hitBand: nb(r.hit_band), inInterval: nb(r.in_interval), absLogErr: r.abs_log_err ?? null, testId: r.test_id ?? null, pairRight: nb(r.pair_right), gradedAt: r.graded_at ?? null, dry: bool(r.dry),
  });
const toEval = (r: Row): LabEval =>
  LabEvalSchema.parse({
    id: r.id, predictor: r.predictor, predictorVersion: r.predictor_version, scope: r.scope, population: r.population, platform: r.platform, windowWeeks: r.window_weeks, computedDate: r.computed_date, computedAt: r.computed_at, harnessVersion: r.harness_version,
    origins: r.origins, nPosts: r.n_posts, nCreators: r.n_creators, abstained: r.abstained, nPairs: r.n_pairs,
    pairwise: r.pairwise ?? null, pairwiseLo: r.pairwise_lo ?? null, pairwiseHi: r.pairwise_hi ?? null, spearman: r.spearman ?? null, spearmanLo: r.spearman_lo ?? null, spearmanHi: r.spearman_hi ?? null,
    logMae: r.log_mae ?? null, logMaeBaseline: r.log_mae_baseline ?? null, maeDeltaLo: r.mae_delta_lo ?? null, maeDeltaHi: r.mae_delta_hi ?? null,
    coverage: r.coverage ?? null, coverageLo: r.coverage_lo ?? null, coverageHi: r.coverage_hi ?? null, coverageN: r.coverage_n ?? 0,
    prAuc: r.pr_auc ?? null, prAucLo: r.pr_auc_lo ?? null, prAucHi: r.pr_auc_hi ?? null, baseRate: r.base_rate ?? null, positives: r.positives ?? 0, bandHits: json(r.band_hits_json, {}),
    verdictForecast: r.verdict_forecast ?? null, verdictRanking: r.verdict_ranking ?? null, verdictClassifier: r.verdict_classifier ?? null, dry: bool(r.dry),
  });
const toRetention = (r: Row): LabRetention =>
  LabRetentionSchema.parse({
    postId: r.post_id, platform: r.platform, source: r.source, capturedAt: r.captured_at, ageH: r.age_h, partial: bool(r.partial), curve: json(r.curve_json, null), views: r.views ?? null, avgViewDurationS: r.avg_view_duration_s ?? null, avgViewPct: r.avg_view_pct ?? null,
    reach: r.reach ?? null, likes: r.likes ?? null, comments: r.comments ?? null, saved: r.saved ?? null, shares: r.shares ?? null, totalInteractions: r.total_interactions ?? null, avgWatchTimeMs: r.avg_watch_time_ms ?? null, totalWatchTimeMs: r.total_watch_time_ms ?? null,
    skipRate: r.skip_rate ?? null, raw: json(r.raw_json, {}), dry: bool(r.dry),
  });
const toTest = (r: Row): LabTest =>
  LabTestSchema.parse({
    id: r.id, kind: r.kind, title: r.title, hypothesis: r.hypothesis ?? '', variable: r.variable, featureKey: r.feature_key ?? null, expectedSign: r.expected_sign ?? null, scriptId: r.script_id ?? null, platform: r.platform, status: r.status,
    arms: json(r.arms_json, []), judgeAgeH: r.judge_age_h ?? null, primaryMetric: r.primary_metric, result: r.result ?? null, winnerArm: r.winner_arm ?? null, observedSign: r.observed_sign ?? null, confirms: nb(r.confirms),
    judgeDetail: json(r.judge_detail_json, {}), notes: r.notes ?? '', planWeek: r.plan_week ?? null, startedAt: r.started_at ?? null, judgedAt: r.judged_at ?? null, createdAt: r.created_at, updatedAt: r.updated_at, dry: bool(r.dry),
  });
const blobToVec = (b: unknown) => {
  const buf = b as Buffer;
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
};
const vecToBlob = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
const toEmbedding = (r: Row): LabEmbedding => ({ subjectKind: r.subject_kind as LabEmbedSubject, subjectId: String(r.subject_id), model: String(r.model), dim: Number(r.dim), textHash: String(r.text_hash), vec: blobToVec(r.vec), createdAt: String(r.created_at) });
const toComment = (r: Row): LabComment =>
  LabCommentSchema.parse({
    id: r.id, postId: r.post_id, platform: r.platform, authorHash: r.author_hash, text: r.text, likes: r.likes ?? null, replies: r.replies ?? null, isReply: bool(r.is_reply), byCreator: bool(r.by_creator), creatorHeart: nb(r.creator_heart),
    postedAt: r.posted_at ?? null, capturedAt: r.captured_at, intent: r.intent, intentRule: r.intent_rule ?? null, runId: r.run_id ?? null,
  });
const toForecast = (r: Row): LabForecast =>
  LabForecastSchema.parse({ id: r.id, kind: r.kind, subject: r.subject, frozenAt: r.frozen_at, inputs: json(r.inputs_json, {}), predicted: r.predicted, lo: r.lo ?? null, hi: r.hi ?? null, expectedItems: r.expected_items ?? null, actual: r.actual ?? null, actualItems: r.actual_items ?? null, status: r.status, gradedAt: r.graded_at ?? null, dry: bool(r.dry) });
const nint = (v: boolean | null | undefined) => (v === null || v === undefined ? null : int(v));

/** 06 store.predictions.list filter. */
export type LabPredictionFilter = { origin?: LabPrediction['origin']; status?: LabPrediction['status']; predictor?: string; kind?: LabPrediction['kind']; scriptId?: string; postId?: string; dry?: boolean; limit?: number };
/** 06 grade(): the outcome fields, written once (trigger lab_predictions_grade_once). */
export type LabPredictionGrade = Pick<LabPrediction, 'outcomeViews7d' | 'outcomeRatio7d' | 'outcomeBand' | 'outcomeIsBreakout' | 'outcomeMethod' | 'hitBand' | 'inInterval' | 'absLogErr'> & { status: 'graded' | 'ungradable'; gradedAt: string };
export type LabTestFilter = { kind?: LabTest['kind']; status?: LabTest['status']; featureKey?: string; scriptId?: string; dry?: boolean };

export function labStore(db: Sqlite) {
  // v2: every store sees the v2 columns, whichever path opened the database (idempotent, cheap PRAGMA checks).
  migrateLabV2(db);
  const all = (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as Row[];
  const one = (sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as Row | undefined;
  const run = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...args);

  /*
   * Read memo (perf). A page build reads the same whole tables many times over (measures.all up to 30
   * times for one Studio render), and every read re-parses each row through zod. The hot whole-table
   * reads below are memoised for as long as the database is provably unchanged: the stamp is SQLite's
   * `data_version` (moves when another connection commits) plus `total_changes()` (moves on every row
   * this connection writes, even one later rolled back). Any write anywhere clears the memo, so a read
   * never returns anything but what a fresh query would. Nothing is memoised inside a transaction.
   * Rows are frozen and every call gets its own array/Map, so a caller can sort or filter its copy but
   * can never edit what the next caller reads.
   */
  const changesStmt = db.prepare('SELECT total_changes() AS n');
  let memoStamp = '';
  const memo = new Map<string, unknown>();
  const stampNow = () => `${db.pragma('data_version', { simple: true })}:${(changesStmt.get() as { n: number }).n}`;
  function memoised<T>(key: string, load: () => T): T {
    if (db.inTransaction) return load();
    const s = stampNow();
    if (s !== memoStamp) {
      memo.clear();
      memoStamp = s;
    }
    if (memo.has(key)) return memo.get(key) as T;
    const v = load();
    memo.set(key, v);
    return v;
  }
  /** A memoised list: frozen rows, a fresh array per call. */
  const memoList = <T extends object>(key: string, load: () => T[]): T[] => memoised(key, () => load().map((r) => Object.freeze(r))).slice();
  /** The memoised list's row for `id` when that list is already in the memo (else undefined: query it). */
  function memoRow<T extends object>(key: string, idOf: (r: T) => string, id: string): T | null | undefined {
    if (db.inTransaction) return undefined;
    if (stampNow() !== memoStamp || !memo.has(key)) return undefined;
    const idx = `${key}#index`;
    let map = memo.get(idx) as Map<string, T> | undefined;
    if (!map) {
      map = new Map((memo.get(key) as T[]).map((r) => [idOf(r), r]));
      memo.set(idx, map);
    }
    return map.get(id) ?? null;
  }

  const sources = {
    all(kind?: LabSourceKind): LabSource[] {
      return memoList(`sources.all:${kind ?? ''}`, () => (kind ? all('SELECT * FROM lab_sources WHERE kind = ? ORDER BY added_at, id', kind) : all('SELECT * FROM lab_sources ORDER BY added_at, id')).map(toSource));
    },
    get(id: string): LabSource | null {
      const r = one('SELECT * FROM lab_sources WHERE id = ?', id);
      return r ? toSource(r) : null;
    },
    byHandle(platform: string, handle: string): LabSource | null {
      const r = one('SELECT * FROM lab_sources WHERE platform = ? AND lower(handle) = lower(?)', platform, handle);
      return r ? toSource(r) : null;
    },
    upsert(s: LabSource): void {
      run(
        `INSERT INTO lab_sources (id, kind, platform, handle, url, display_name, status, added_at, reason, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, platform = excluded.platform, handle = excluded.handle, url = excluded.url, display_name = excluded.display_name, status = excluded.status, reason = excluded.reason, score = excluded.score`,
        s.id, s.kind, s.platform, s.handle, s.url, s.displayName, s.status, s.addedAt, s.reason, s.score,
      );
    },
    setStatus(id: string, status: LabSourceStatus): boolean {
      return run('UPDATE lab_sources SET status = ? WHERE id = ?', status, id).changes > 0;
    },
    /** Accepting a suggestion makes it tracked (it keeps its id, sample posts and reason). */
    setKind(id: string, kind: LabSourceKind): boolean {
      return run('UPDATE lab_sources SET kind = ? WHERE id = ?', kind, id).changes > 0;
    },
  };

  const creatorSnapshots = {
    add(s: LabCreatorSnapshot): void {
      const v = LabCreatorSnapshotSchema.parse(s);
      run('INSERT INTO lab_creator_snapshots (source_id, captured_at, followers, following, post_count) VALUES (?, ?, ?, ?, ?)', v.sourceId, v.capturedAt, v.followers, v.following, v.postCount);
    },
    forSource(sourceId: string): LabCreatorSnapshot[] {
      return all('SELECT * FROM lab_creator_snapshots WHERE source_id = ? ORDER BY captured_at', sourceId).map((r) => ({ sourceId: String(r.source_id), capturedAt: String(r.captured_at), followers: (r.followers as number | null) ?? null, following: (r.following as number | null) ?? null, postCount: (r.post_count as number | null) ?? null }));
    },
    all(): LabCreatorSnapshot[] {
      return all('SELECT * FROM lab_creator_snapshots ORDER BY source_id, captured_at').map((r) => ({ sourceId: String(r.source_id), capturedAt: String(r.captured_at), followers: (r.followers as number | null) ?? null, following: (r.following as number | null) ?? null, postCount: (r.post_count as number | null) ?? null }));
    },
  };

  const posts = {
    all(): LabPost[] {
      return memoList('posts.all', () => all('SELECT * FROM lab_posts ORDER BY posted_at DESC, id').map(toPost));
    },
    get(id: string): LabPost | null {
      const hit = memoRow<LabPost>('posts.all', (p) => p.id, id);
      if (hit !== undefined) return hit;
      const r = one('SELECT * FROM lab_posts WHERE id = ?', id);
      return r ? toPost(r) : null;
    },
    bySource(sourceId: string): LabPost[] {
      // Same rows and order as the query below, from the memo when posts.all is already in it.
      if (memoRow<LabPost>('posts.all', (p) => p.id, '') !== undefined) return (memo.get('posts.all') as LabPost[]).filter((p) => p.sourceId === sourceId);
      return all('SELECT * FROM lab_posts WHERE source_id = ? ORDER BY posted_at DESC, id', sourceId).map(toPost);
    },
    /** Upsert on (platform, external_id). Returns the stored id (the first one ever written wins). */
    upsert(p: LabPost): string {
      const v = LabPostSchema.parse(p);
      run(
        `INSERT INTO lab_posts (id, source_id, platform, external_id, url, posted_at, caption, content_type, thumbnail_url, media_url, duration_s, is_owned, epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(platform, external_id) DO UPDATE SET url = excluded.url, posted_at = COALESCE(excluded.posted_at, lab_posts.posted_at), caption = excluded.caption, content_type = excluded.content_type, thumbnail_url = COALESCE(excluded.thumbnail_url, lab_posts.thumbnail_url), media_url = COALESCE(excluded.media_url, lab_posts.media_url), duration_s = COALESCE(excluded.duration_s, lab_posts.duration_s), epoch = excluded.epoch`,
        v.id, v.sourceId, v.platform, v.externalId, v.url, v.postedAt, v.caption, v.contentType, v.thumbnailUrl, v.mediaUrl, v.durationS, int(v.isOwned), v.epoch ?? 'current',
      );
      // the exogenous flag is a user action (flagExo), never overwritten by a re-scrape; an insert may carry one (fixtures)
      if (v.exoReason) run('UPDATE lab_posts SET exo_reason = ?, exo_note = ?, exo_at = ? WHERE platform = ? AND external_id = ? AND exo_reason IS NULL', v.exoReason, v.exoNote ?? null, v.exoAt ?? null, v.platform, v.externalId);
      return String(one('SELECT id FROM lab_posts WHERE platform = ? AND external_id = ?', v.platform, v.externalId)!.id);
    },
    count(): number {
      return Number(one('SELECT COUNT(*) AS n FROM lab_posts')!.n);
    },
    /** 04 3.10: mark an outside push (owned posts; the API checks ownership). */
    flagExo(id: string, reason: LabExoReason, note: string | null, at: string): boolean {
      return run('UPDATE lab_posts SET exo_reason = ?, exo_note = ?, exo_at = ? WHERE id = ?', reason, note, at, id).changes > 0;
    },
    unflagExo(id: string): boolean {
      return run('UPDATE lab_posts SET exo_reason = NULL, exo_note = NULL, exo_at = NULL WHERE id = ?', id).changes > 0;
    },
  };

  const metrics = {
    /** Append-only: every read is a new row. */
    add(m: LabPostMetrics): void {
      const v = LabPostMetricsSchema.parse(m);
      // age_h: the writer's value, else hours since the post's posted_at (null when unknown or negative)
      run(
        `INSERT INTO lab_post_metrics (post_id, captured_at, views, likes, comments, shares, saves, age_h, target_age_h, read_kind, quotes)
         VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, (SELECT CASE WHEN julianday(?) >= julianday(p.posted_at) THEN (julianday(?) - julianday(p.posted_at)) * 24 END FROM lab_posts p WHERE p.id = ? AND p.posted_at IS NOT NULL)), ?, ?, ?)`,
        v.postId, v.capturedAt, v.views, v.likes, v.comments, v.shares, v.saves, v.ageH ?? null, v.capturedAt, v.capturedAt, v.postId, v.targetAgeH ?? null, v.readKind ?? 'cycle', v.quotes ?? null,
      );
    },
    forPost(postId: string): LabPostMetrics[] {
      return all('SELECT * FROM lab_post_metrics WHERE post_id = ? ORDER BY captured_at', postId).map(toMetrics);
    },
    /** Every snapshot, grouped by post, oldest first. */
    byPost(): Map<string, LabPostMetrics[]> {
      const rows = memoList('metrics.byPost', () => all('SELECT * FROM lab_post_metrics ORDER BY post_id, captured_at').map(toMetrics));
      const out = new Map<string, LabPostMetrics[]>();
      for (const m of rows) {
        const list = out.get(m.postId);
        if (list) list.push(m);
        else out.set(m.postId, [m]);
      }
      return out;
    },
    /** The latest read per post. */
    latest(): Map<string, LabPostMetrics> {
      const out = new Map<string, LabPostMetrics>();
      for (const [id, list] of metrics.byPost()) out.set(id, list[list.length - 1]);
      return out;
    },
  };

  const transcripts = {
    upsert(t: LabTranscript): void {
      run(
        `INSERT INTO lab_transcripts (post_id, text, word_count, wpm, provider, cost_usd, status) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(post_id) DO UPDATE SET text = excluded.text, word_count = excluded.word_count, wpm = excluded.wpm, provider = excluded.provider, cost_usd = excluded.cost_usd, status = excluded.status`,
        t.postId, t.text, t.wordCount, t.wpm, t.provider, t.costUsd, t.status,
      );
    },
    get(postId: string): LabTranscript | null {
      const r = one('SELECT * FROM lab_transcripts WHERE post_id = ?', postId);
      return r ? toTranscript(r) : null;
    },
    all(): LabTranscript[] {
      return memoList('transcripts.all', () => all('SELECT * FROM lab_transcripts').map(toTranscript));
    },
  };

  const dissections = {
    upsert(d: LabDissection): void {
      const v = LabDissectionSchema.parse(d);
      run(
        `INSERT OR REPLACE INTO lab_dissections (post_id, format, hook_form, emotional_trigger, hook_channel, hook_text, first_frame_text, structure_type, beats_json, pacing, pillar, cta_type, tension_json, confidences_json, quality_notes, model_id, prompt_version, analysed_at, frames_used, on_screen_text_density, face_first_frame, sheet_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        v.postId, v.format, v.hookForm, v.emotionalTrigger, v.hookChannel, v.hookText, v.firstFrameText, v.structureType, JSON.stringify(v.beats), v.pacing, v.pillar, v.ctaType, v.tension ? JSON.stringify(v.tension) : null, JSON.stringify(v.confidences), v.qualityNotes, v.modelId, v.promptVersion, v.analysedAt,
        v.framesUsed ?? 0, v.onScreenTextDensity ?? null, v.faceFirstFrame == null ? null : int(v.faceFirstFrame), v.sheetPath ?? null,
      );
    },
    get(postId: string): LabDissection | null {
      const hit = memoRow<LabDissection>('dissections.all', (d) => d.postId, postId);
      if (hit !== undefined) return hit;
      const r = one('SELECT * FROM lab_dissections WHERE post_id = ?', postId);
      return r ? toDissection(r) : null;
    },
    all(): LabDissection[] {
      return memoList('dissections.all', () => all('SELECT * FROM lab_dissections').map(toDissection));
    },
  };

  const topics = {
    /** Replaces a post's topics (a re-dissection supersedes the old ones). Embeddings are Float32 blobs. */
    replaceForPost(postId: string, list: (LabPostTopic & { embedding?: Float32Array | null })[]): void {
      db.transaction(() => {
        run('DELETE FROM lab_post_topics WHERE post_id = ?', postId);
        for (const t of list) {
          run('INSERT INTO lab_post_topics (post_id, topic, angle, is_primary, cluster_id, embedding) VALUES (?, ?, ?, ?, ?, ?)', postId, t.topic, t.angle, int(t.isPrimary), t.clusterId, t.embedding ? Buffer.from(t.embedding.buffer, t.embedding.byteOffset, t.embedding.byteLength) : null);
        }
      })();
    },
    forPost(postId: string): LabPostTopic[] {
      return all('SELECT * FROM lab_post_topics WHERE post_id = ? ORDER BY is_primary DESC', postId).map(toTopic);
    },
    all(): LabPostTopic[] {
      return memoList('topics.all', () => all('SELECT * FROM lab_post_topics').map(toTopic));
    },
    setCluster(postId: string, topic: string, clusterId: string | null): void {
      run('UPDATE lab_post_topics SET cluster_id = ? WHERE post_id = ? AND topic = ?', clusterId, postId, topic);
    },
    setEmbedding(postId: string, topic: string, v: Float32Array): void {
      run('UPDATE lab_post_topics SET embedding = ? WHERE post_id = ? AND topic = ?', Buffer.from(v.buffer, v.byteOffset, v.byteLength), postId, topic);
    },
    embedding(postId: string, topic: string): Float32Array | null {
      const r = one('SELECT embedding FROM lab_post_topics WHERE post_id = ? AND topic = ?', postId, topic);
      const b = r?.embedding as Buffer | null | undefined;
      return b ? new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) : null;
    },
  };

  const measures = {
    /** v1 writers pass a LabMeasure; v2 writers (04) pass the v2 fields too. Absent v2 fields take the column defaults. */
    upsert(m: LabMeasure & Partial<LabMeasureV2>): void {
      const v = LabMeasureSchema.parse(m);
      const x = m as Partial<LabMeasureV2>;
      run(
        `INSERT OR REPLACE INTO lab_measures (post_id, depth, breakout, breakout_lo, breakout_hi, baseline_n, baseline_confidence, reach, velocity, trajectory, quadrant, is_breakout, computed_at,
           measure_version, metric_basis, judged_age_h, basis_at_age, baseline_log, baseline_var, prior_log, shrink_b, baseline_source, robust_z, volatility, volatility_class, max_over_median, niche_ratio, dual_high, trajectory_class, peak_day_share, exo_auto, shares_per_view, saves_per_view, x_action_score, followers_as_of, ages_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        v.postId, v.depth, v.breakout, v.breakoutLo, v.breakoutHi, v.baselineN, v.baselineConfidence, v.reach, v.velocity, v.trajectory, v.quadrant, int(v.isBreakout), v.computedAt,
        x.measureVersion ?? 'measure-v1', x.metricBasis ?? 'views', x.judgedAgeH ?? null, x.basisAtAge ?? null, x.baselineLog ?? null, x.baselineVar ?? null, x.priorLog ?? null, x.shrinkB ?? null, x.baselineSource ?? null, x.robustZ ?? null, x.volatility ?? null, x.volatilityClass ?? null, x.maxOverMedian ?? null, x.nicheRatio ?? null, int(Boolean(x.dualHigh)), x.trajectoryClass ?? null, x.peakDayShare ?? null, int(Boolean(x.exoAuto)), x.sharesPerView ?? null, x.savesPerView ?? null, x.xActionScore ?? null, x.followersAsOf ?? null, JSON.stringify(x.ages ?? {}),
      );
    },
    get(postId: string): LabMeasureV2 | null {
      const hit = memoRow<LabMeasureV2>('measures.all', (m) => m.postId, postId);
      if (hit !== undefined) return hit;
      const r = one('SELECT * FROM lab_measures WHERE post_id = ?', postId);
      return r ? toMeasure(r) : null;
    },
    all(): LabMeasureV2[] {
      return memoList('measures.all', () => all('SELECT * FROM lab_measures').map(toMeasure));
    },
    clear(): void {
      run('DELETE FROM lab_measures');
    },
  };

  const clusters = {
    upsert(c: LabCluster & { centroid?: Float32Array | null }): void {
      run('INSERT INTO lab_clusters (id, label, centroid, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, centroid = COALESCE(excluded.centroid, lab_clusters.centroid)', c.id, c.label, c.centroid ? Buffer.from(c.centroid.buffer, c.centroid.byteOffset, c.centroid.byteLength) : null, c.createdAt);
    },
    centroid(id: string): Float32Array | null {
      const r = one('SELECT centroid FROM lab_clusters WHERE id = ?', id);
      const b = r?.centroid as Buffer | null | undefined;
      return b ? new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) : null;
    },
    all(): LabCluster[] {
      return all('SELECT id, label, created_at FROM lab_clusters ORDER BY created_at, id').map((r) => ({ id: String(r.id), label: String(r.label), createdAt: String(r.created_at) }));
    },
  };

  const trendSnapshots = {
    upsert(s: LabTrendSnapshot): void {
      const v = LabTrendSnapshotSchema.parse(s);
      run(
        'INSERT OR REPLACE INTO lab_trend_snapshots (cluster_id, day, posts, breakouts, creators, platforms, feed_mentions, source_count, momentum, timing) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        v.clusterId, v.day, v.posts, v.breakouts, v.creators, v.platforms, v.feedMentions, v.sourceCount, v.momentum, v.timing,
      );
    },
    /** Days on or after `sinceDay` (YYYY-MM-DD), oldest first. */
    all(sinceDay?: string): LabTrendSnapshot[] {
      return (sinceDay ? all('SELECT * FROM lab_trend_snapshots WHERE day >= ? ORDER BY day, cluster_id', sinceDay) : all('SELECT * FROM lab_trend_snapshots ORDER BY day, cluster_id')).map(toSnapshot);
    },
  };

  const trendItems = {
    upsert(t: LabTrendItem): void {
      const v = LabTrendItemSchema.parse(t);
      run(
        `INSERT INTO lab_trend_items (id, feed, url, title, score, comments, sources_json, source_count, cluster_id, seen_at, acted_on_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, score = excluded.score, comments = excluded.comments, sources_json = excluded.sources_json, source_count = excluded.source_count, cluster_id = excluded.cluster_id`,
        v.id, v.feed, v.url, v.title, v.score, v.comments, JSON.stringify(v.sources), v.sourceCount, v.clusterId, v.seenAt, v.actedOnAt,
      );
    },
    all(): LabTrendItem[] {
      return all('SELECT * FROM lab_trend_items ORDER BY seen_at DESC, id').map(toTrendItem);
    },
  };

  const profiles = {
    /** Profiles are versioned: insert a new row per distillation, never update one. */
    insert(p: LabProfile): void {
      const v = LabProfileSchema.parse(p);
      run(
        'INSERT INTO lab_profiles (id, format_family, label, version, window_days, posts_n, breakouts_n, features_json, strand_json, stats_json, created_at, method, controls_n, fdr_q) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        v.id, v.formatFamily, v.label, v.version, v.windowDays, v.postsN, v.breakoutsN, JSON.stringify(v.features), JSON.stringify(v.strand), JSON.stringify(v.stats), v.createdAt, v.method ?? 'lift_wilson_v1', v.controlsN ?? 0, v.fdrQ ?? null,
      );
    },
    /** The newest version of each format family, most breakouts first. */
    latest(): LabProfile[] {
      return all(
        `SELECT p.* FROM lab_profiles p JOIN (SELECT format_family, MAX(version) AS v FROM lab_profiles GROUP BY format_family) m ON m.format_family = p.format_family AND m.v = p.version ORDER BY p.breakouts_n DESC, p.format_family`,
      ).map(toProfile);
    },
    get(id: string): LabProfile | null {
      const r = one('SELECT * FROM lab_profiles WHERE id = ?', id);
      return r ? toProfile(r) : null;
    },
    /** Every version of one family, newest first. */
    history(formatFamily: string): LabProfile[] {
      return all('SELECT * FROM lab_profiles WHERE format_family = ? ORDER BY version DESC', formatFamily).map(toProfile);
    },
    nextVersion(formatFamily: string): number {
      return Number(one('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM lab_profiles WHERE format_family = ?', formatFamily)!.v);
    },
  };

  const ideas = {
    upsert(i: LabIdea): void {
      const v = LabIdeaSchema.parse(i);
      run(
        `INSERT OR REPLACE INTO lab_ideas (id, title, cluster_id, angle, tension_json, format_family, strand_json, hook_recs_json, evidence_json, timing, fit, thin, status, dismiss_reason, created_at, acted_on_at,
           event_id, launch_angle, source, batch_id, seed_id, notes, hook_form, hook_trigger, vs_probability, mmr_rank, grounding_json, prompt_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        v.id, v.title, v.clusterId, v.angle, v.tension ? JSON.stringify(v.tension) : null, v.formatFamily, JSON.stringify(v.strand), JSON.stringify(v.hookRecs), JSON.stringify(v.evidence), v.timing, v.fit, int(v.thin), v.status, v.dismissReason, v.createdAt, v.actedOnAt,
        v.eventId ?? null, v.launchAngle ?? null, v.source ?? 'sync', v.batchId ?? null, v.seedId ?? null, v.notes ?? null, v.hookForm ?? null, v.hookTrigger ?? null, v.vsProbability ?? null, v.mmrRank ?? null, JSON.stringify(v.grounding ?? emptyGrounding), v.promptVersion ?? null,
      );
    },
    get(id: string): LabIdea | null {
      const r = one('SELECT * FROM lab_ideas WHERE id = ?', id);
      return r ? toIdea(r) : null;
    },
    all(status?: LabIdeaStatus): LabIdea[] {
      return (status ? all('SELECT * FROM lab_ideas WHERE status = ? ORDER BY fit DESC, created_at DESC', status) : all('SELECT * FROM lab_ideas ORDER BY fit DESC, created_at DESC')).map(toIdea);
    },
    setStatus(id: string, status: LabIdeaStatus, opts: { reason?: string | null; at?: string } = {}): boolean {
      const at = opts.at ?? new Date().toISOString();
      return run('UPDATE lab_ideas SET status = ?, dismiss_reason = ?, acted_on_at = ? WHERE id = ?', status, status === 'dismissed' ? (opts.reason ?? null) : null, status === 'open' ? null : at, id).changes > 0;
    },
  };

  const scripts = {
    upsert(s: LabScript): void {
      const v = LabScriptSchema.parse(s);
      run('INSERT OR REPLACE INTO lab_scripts (id, idea_id, title, status, published_post_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', v.id, v.ideaId, v.title, v.status, v.publishedPostId, v.createdAt);
    },
    get(id: string): LabScript | null {
      const r = one('SELECT * FROM lab_scripts WHERE id = ?', id);
      return r ? toScript(r) : null;
    },
    all(): LabScript[] {
      return all('SELECT * FROM lab_scripts ORDER BY created_at DESC, id').map(toScript);
    },
    addVersion(v: LabScriptVersion): void {
      run('INSERT INTO lab_script_versions (script_id, version, body_json, gate_json, created_at, edit_diff) VALUES (?, ?, ?, ?, ?, ?)', v.scriptId, v.version, JSON.stringify(LabScriptBodySchema.parse(v.body)), JSON.stringify(LabGateSchema.parse(v.gate)), v.createdAt, v.editDiff);
    },
    versions(scriptId: string): LabScriptVersion[] {
      return all('SELECT * FROM lab_script_versions WHERE script_id = ? ORDER BY version', scriptId).map(toVersion);
    },
    latestVersion(scriptId: string): LabScriptVersion | null {
      const r = one('SELECT * FROM lab_script_versions WHERE script_id = ? ORDER BY version DESC LIMIT 1', scriptId);
      return r ? toVersion(r) : null;
    },
    markPublished(id: string, postId: string): boolean {
      return run("UPDATE lab_scripts SET status = 'published', published_post_id = ? WHERE id = ?", postId, id).changes > 0;
    },
  };

  const outcomes = {
    add(o: LabOutcome): void {
      run('INSERT INTO lab_outcomes (script_id, post_id, captured_at, breakout, depth) VALUES (?, ?, ?, ?, ?)', o.scriptId, o.postId, o.capturedAt, o.breakout, o.depth);
    },
    all(): LabOutcome[] {
      return all('SELECT * FROM lab_outcomes ORDER BY captured_at').map((r) => ({ scriptId: String(r.script_id), postId: String(r.post_id), capturedAt: String(r.captured_at), breakout: (r.breakout as number | null) ?? null, depth: (r.depth as number | null) ?? null }));
    },
  };

  const priors = {
    set(p: LabPrior): void {
      run('INSERT OR REPLACE INTO lab_priors (key, value_json, n, supersedes_default, updated_at) VALUES (?, ?, ?, ?, ?)', p.key, JSON.stringify(p.value ?? null), p.n, int(p.supersedesDefault), p.updatedAt);
    },
    get(key: string): LabPrior | null {
      const r = one('SELECT * FROM lab_priors WHERE key = ?', key);
      return r ? { key: String(r.key), value: json(r.value_json, null), n: Number(r.n), supersedesDefault: bool(r.supersedes_default), updatedAt: String(r.updated_at) } : null;
    },
    all(): LabPrior[] {
      return all('SELECT * FROM lab_priors ORDER BY key').map((r) => ({ key: String(r.key), value: json(r.value_json, null), n: Number(r.n), supersedesDefault: bool(r.supersedes_default), updatedAt: String(r.updated_at) }));
    },
    /** v2: every prior whose key starts with `prefix` (`job:`, `health:`, `jobcfg:`, `pricing:`), in key order. */
    byPrefix(prefix: string): LabPrior[] {
      return all('SELECT * FROM lab_priors WHERE substr(key, 1, ?) = ? ORDER BY key', prefix.length, prefix).map((r) => ({ key: String(r.key), value: json(r.value_json, null), n: Number(r.n), supersedesDefault: bool(r.supersedes_default), updatedAt: String(r.updated_at) }));
    },
    remove(key: string): boolean {
      return run('DELETE FROM lab_priors WHERE key = ?', key).changes > 0;
    },
  };

  const runs = {
    insert(r: LabRun): void {
      const v = LabRunSchema.parse(r);
      run(
        'INSERT INTO lab_runs (id, kind, apify_run_id, dataset_id, actor, input_json, status, items, cost_usd, dry, started_at, finished_at, error, line, job, scheduled, batch_id, progress_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        v.id, v.kind, v.apifyRunId, v.datasetId, v.actor, JSON.stringify(v.input ?? {}), v.status, v.items, v.costUsd, int(v.dry), v.startedAt, v.finishedAt, v.error, v.line ?? null, v.job ?? null, int(Boolean(v.scheduled)), v.batchId ?? null, v.progress ? JSON.stringify(v.progress) : null,
      );
    },
    update(id: string, patch: Partial<Omit<LabRun, 'id'>>): LabRun | null {
      const cur = runs.get(id);
      if (!cur) return null;
      const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      const next = LabRunSchema.parse({ ...cur, ...defined, id });
      run(
        'UPDATE lab_runs SET kind = ?, apify_run_id = ?, dataset_id = ?, actor = ?, input_json = ?, status = ?, items = ?, cost_usd = ?, dry = ?, started_at = ?, finished_at = ?, error = ?, line = ?, job = ?, scheduled = ?, batch_id = ?, progress_json = ? WHERE id = ?',
        next.kind, next.apifyRunId, next.datasetId, next.actor, JSON.stringify(next.input ?? {}), next.status, next.items, next.costUsd, int(next.dry), next.startedAt, next.finishedAt, next.error, next.line ?? null, next.job ?? null, int(Boolean(next.scheduled)), next.batchId ?? null, next.progress ? JSON.stringify(next.progress) : null, id,
      );
      return next;
    },
    get(id: string): LabRun | null {
      const r = one('SELECT * FROM lab_runs WHERE id = ?', id);
      return r ? toRun(r) : null;
    },
    recent(limit = 50): LabRun[] {
      return all('SELECT * FROM lab_runs ORDER BY started_at DESC, id LIMIT ?', limit).map(toRun);
    },
    /** Runs started at or after `sinceIso`, newest first, optionally of one kind (the sync planner reads cadence from these). */
    since(sinceIso: string, kind?: LabRun['kind']): LabRun[] {
      return (kind ? all('SELECT * FROM lab_runs WHERE started_at >= ? AND kind = ? ORDER BY started_at DESC, id', sinceIso, kind) : all('SELECT * FROM lab_runs WHERE started_at >= ? ORDER BY started_at DESC, id', sinceIso)).map(toRun);
    },
    /** Runs still waiting on Apify (advance-on-read picks these up). */
    open(): LabRun[] {
      return all("SELECT * FROM lab_runs WHERE status IN ('queued', 'running') ORDER BY started_at").map(toRun);
    },
    /** 09.4.2: every run of one batch (`lbat-...`), oldest first. */
    byBatch(batchId: string): LabRun[] {
      return all('SELECT * FROM lab_runs WHERE batch_id = ? ORDER BY started_at, id', batchId).map(toRun);
    },
    /** 09.5.3 single-run guard: open runs of one actor. */
    openForActor(actor: string): LabRun[] {
      return all("SELECT * FROM lab_runs WHERE actor = ? AND status IN ('queued', 'running') ORDER BY started_at", actor).map(toRun);
    },
  };

  const spend = {
    add(s: LabSpend): number {
      const v = LabSpendSchema.parse(s);
      return Number(
        run(
          'INSERT INTO lab_spend (run_id, provider, units, est_usd, actual_usd, dry, at, line, reserved_usd, actual_source, events_json, settled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          v.runId, v.provider, v.units, v.estUsd, v.actualUsd, int(v.dry), v.at, v.line ?? defaultLine(v.provider), v.reservedUsd ?? null,
          v.actualSource ?? (v.dry ? 'dry' : null), v.events ? JSON.stringify(v.events) : null, v.settledAt ?? null,
        ).lastInsertRowid,
      );
    },
    /** Record the actual charge once the run finished (Apify usageTotalUsd). v2: events, source and time (08.6.3 item 3). */
    settle(runId: string, actualUsd: number, units?: number, opts: { events?: Record<string, number> | null; source?: 'provider' | 'published_price'; at?: string } = {}): boolean {
      const source = opts.source ?? 'provider';
      const at = opts.at ?? new Date().toISOString();
      const events = opts.events ? JSON.stringify(opts.events) : null;
      return units === undefined
        ? run('UPDATE lab_spend SET actual_usd = ?, actual_source = ?, events_json = COALESCE(?, events_json), settled_at = ? WHERE run_id = ?', actualUsd, source, events, at, runId).changes > 0
        : run('UPDATE lab_spend SET actual_usd = ?, units = ?, actual_source = ?, events_json = COALESCE(?, events_json), settled_at = ? WHERE run_id = ?', actualUsd, units, source, events, at, runId).changes > 0;
    },
    forRun(runId: string): LabSpend[] {
      return all('SELECT * FROM lab_spend WHERE run_id = ? ORDER BY id', runId).map(toSpend);
    },
    /** Rows at or after `sinceIso`, oldest first. */
    since(sinceIso: string, provider?: LabSpendProvider): LabSpend[] {
      return (provider ? all('SELECT * FROM lab_spend WHERE at >= ? AND provider = ? ORDER BY at, id', sinceIso, provider) : all('SELECT * FROM lab_spend WHERE at >= ? ORDER BY at, id', sinceIso)).map(toSpend);
    },
    all(): LabSpend[] {
      return all('SELECT * FROM lab_spend ORDER BY at, id').map(toSpend);
    },
  };

  /* ── v2 accessors (S0; signatures from 04 8, 05 16, 06 12, 07 7.11 and 7.13.3, 09 09.6) ── */

  const controls = {
    upsert(c: LabControl): void {
      const v = LabControlSchema.parse(c);
      run(
        `INSERT OR REPLACE INTO lab_controls (post_id, role, stratum, sampling_prob, eligible_n, drawn_n, seed, verdict_age_h, verdict_ratio, drawn_at, status, measure_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        v.postId, v.role, v.stratum, v.samplingProb, v.eligibleN, v.drawnN, v.seed, v.verdictAgeH, v.verdictRatio, v.drawnAt, v.status, v.measureVersion,
      );
    },
    get(postId: string): LabControl | null {
      const r = one('SELECT * FROM lab_controls WHERE post_id = ?', postId);
      return r ? toControl(r) : null;
    },
    byStratum(stratum: string): LabControl[] {
      return all('SELECT * FROM lab_controls WHERE stratum = ? ORDER BY drawn_at, post_id', stratum).map(toControl);
    },
    all(): LabControl[] {
      return all('SELECT * FROM lab_controls ORDER BY drawn_at, post_id').map(toControl);
    },
    setStatus(postId: string, status: LabControlStatus): boolean {
      return run('UPDATE lab_controls SET status = ? WHERE post_id = ?', status, postId).changes > 0;
    },
  };

  const events = {
    get(id: string): LabEvent | null {
      const r = one('SELECT * FROM lab_events WHERE id = ?', id);
      return r ? toEvent(r) : null;
    },
    /** The live (not merged, not dismissed) event with this canonical key. */
    byKey(key: string): LabEvent | null {
      const r = one("SELECT * FROM lab_events WHERE key = ? AND status NOT IN ('merged','dismissed')", key);
      return r ? toEvent(r) : null;
    },
    all(filter: { status?: LabEventStatus[]; since?: string } = {}): LabEvent[] {
      const where: string[] = [];
      const args: unknown[] = [];
      if (filter.status?.length) {
        where.push(`status IN (${filter.status.map(() => '?').join(', ')})`);
        args.push(...filter.status);
      }
      if (filter.since) {
        where.push('COALESCE(t0, first_seen_at) >= ?');
        args.push(filter.since);
      }
      return all(`SELECT * FROM lab_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY COALESCE(t0, first_seen_at) DESC, id`, ...args).map(toEvent);
    },
    upsert(e: LabEvent): void {
      const v = LabEventSchema.parse(e);
      run(
        `INSERT OR REPLACE INTO lab_events (id, key, name, vendor, aliases_json, status, merged_into, dismiss_reason, novelty, novelty_source, class, class_basis, class_json, wiki_article, attention_json, t0, t0_rule, t0_ping_id, t0_revised_at, confirmed_at, first_seen_at, source_count, sources_json, wave_n, wave_started_at, window_state, window_opens_at, window_closing_at, window_closes_at, window_changed_at, window_reason, window_log_json, cluster_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        v.id, v.key, v.name, v.vendor, JSON.stringify(v.aliases), v.status, v.mergedInto, v.dismissReason, v.novelty, v.noveltySource, v.class, v.classBasis, JSON.stringify(v.classInfo), v.wikiArticle, JSON.stringify(v.attention),
        v.t0, v.t0Rule, v.t0PingId, v.t0RevisedAt, v.confirmedAt, v.firstSeenAt, v.sourceCount, JSON.stringify(v.sources), v.waveN, v.waveStartedAt,
        v.windowState, v.windowOpensAt, v.windowClosingAt, v.windowClosesAt, v.windowChangedAt, v.windowReason, JSON.stringify(v.windowLog), v.clusterId, v.createdAt, v.updatedAt,
      );
    },
    setStatus(id: string, status: LabEventStatus, extra: { mergedInto?: string | null; dismissReason?: string | null; at?: string } = {}): boolean {
      return run('UPDATE lab_events SET status = ?, merged_into = COALESCE(?, merged_into), dismiss_reason = COALESCE(?, dismiss_reason), updated_at = ? WHERE id = ?', status, extra.mergedInto ?? null, extra.dismissReason ?? null, extra.at ?? new Date().toISOString(), id).changes > 0;
    },
  };

  const eventPings = {
    get(id: string): LabEventPing | null {
      const r = one('SELECT * FROM lab_event_pings WHERE id = ?', id);
      return r ? toPing(r) : null;
    },
    upsert(p: LabEventPing): void {
      const v = LabEventPingSchema.parse(p);
      run(
        `INSERT OR REPLACE INTO lab_event_pings (id, source, family, external_id, event_id, match_rule, name, name_key, title, url, author, vendor, source_time, first_seen_at, last_seen_at, prev_seen_at, metric_first, metric_prev, metric_last, rank, velocity_per_h, robust_z, is_launch, is_baseline, qualifies, qualify_reason, fake_star, fake_star_json, lexicon, dry)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        v.id, v.source, v.family, v.externalId, v.eventId, v.matchRule, v.name, v.nameKey, v.title, v.url, v.author, v.vendor, v.sourceTime, v.firstSeenAt, v.lastSeenAt, v.prevSeenAt,
        v.metricFirst, v.metricPrev, v.metricLast, v.rank, v.velocityPerH, v.robustZ, int(v.isLaunch), int(v.isBaseline), int(v.qualifies), v.qualifyReason, nint(v.fakeStar), v.fakeStarInfo == null ? null : JSON.stringify(v.fakeStarInfo), int(v.lexicon), int(v.dry),
      );
    },
    forEvent(eventId: string): LabEventPing[] {
      return all('SELECT * FROM lab_event_pings WHERE event_id = ? ORDER BY first_seen_at, id', eventId).map(toPing);
    },
    forSource(source: LabRadarSource, since: string): LabEventPing[] {
      return all('SELECT * FROM lab_event_pings WHERE source = ? AND first_seen_at >= ? ORDER BY first_seen_at, id', source, since).map(toPing);
    },
    unattached(since: string): LabEventPing[] {
      return all('SELECT * FROM lab_event_pings WHERE event_id IS NULL AND first_seen_at >= ? ORDER BY first_seen_at, id', since).map(toPing);
    },
    /** 05 5.6: unattached pings older than `before` are deleted; attached pings are kept. */
    deleteOlderUnattached(before: string): number {
      return run('DELETE FROM lab_event_pings WHERE event_id IS NULL AND last_seen_at < ?', before).changes;
    },
    all(): LabEventPing[] {
      return all('SELECT * FROM lab_event_pings ORDER BY first_seen_at, id').map(toPing);
    },
  };

  const eventCoverage = {
    upsert(c: LabEventCoverage): void {
      const v = LabEventCoverageSchema.parse(c);
      run(
        `INSERT OR REPLACE INTO lab_event_coverage (event_id, post_id, source_id, platform, is_owned, posted_at, hours_since_t0, wave_n, wave_position, creator_rank, match_rule, confidence, confirmed, angle, angle_source, ratio, ratio_age_h, is_breakout, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        v.eventId, v.postId, v.sourceId, v.platform, int(v.isOwned), v.postedAt, v.hoursSinceT0, v.waveN, v.wavePosition, v.creatorRank, v.matchRule, v.confidence, nint(v.confirmed), v.angle, v.angleSource, v.ratio, v.ratioAgeH, int(v.isBreakout), v.computedAt,
      );
    },
    forEvent(eventId: string): LabEventCoverage[] {
      return all('SELECT * FROM lab_event_coverage WHERE event_id = ? ORDER BY posted_at, post_id', eventId).map(toCoverage);
    },
    forPost(postId: string): LabEventCoverage[] {
      return all('SELECT * FROM lab_event_coverage WHERE post_id = ? ORDER BY event_id', postId).map(toCoverage);
    },
    remove(eventId: string, postId: string): boolean {
      return run('DELETE FROM lab_event_coverage WHERE event_id = ? AND post_id = ?', eventId, postId).changes > 0;
    },
    all(): LabEventCoverage[] {
      return all('SELECT * FROM lab_event_coverage ORDER BY event_id, posted_at, post_id').map(toCoverage);
    },
  };

  /** The lab_brief table (05 16). */
  const morningBrief = {
    get(day: string): LabMorningBrief | null {
      const r = one('SELECT * FROM lab_brief WHERE day = ?', day);
      return r ? toBrief(r) : null;
    },
    latest(): LabMorningBrief | null {
      const r = one('SELECT * FROM lab_brief ORDER BY day DESC LIMIT 1');
      return r ? toBrief(r) : null;
    },
    upsert(b: LabMorningBrief): void {
      const v = LabMorningBriefSchema.parse(b);
      run(
        `INSERT OR REPLACE INTO lab_brief (id, day, composed_at, items_json, dedupe_keys_json, text, sent_at, sent_via, send_error, dry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        v.id, v.day, v.composedAt, JSON.stringify(v.items), JSON.stringify(v.dedupeKeys), v.text, v.sentAt, v.sentVia, v.sendError, int(v.dry),
      );
    },
    /** Days on or after `day` (YYYY-MM-DD), newest first. */
    since(day: string): LabMorningBrief[] {
      return all('SELECT * FROM lab_brief WHERE day >= ? ORDER BY day DESC', day).map(toBrief);
    },
  };

  const predictions = {
    insert(p: LabPrediction): void {
      const v = LabPredictionSchema.parse(p);
      run(
        `INSERT INTO lab_predictions (id, origin, predictor, predictor_version, kind, script_id, script_version, post_id, source_id, platform, surface, ref_age_h, as_of, frozen_at, backtest_origin, band, score,
           ratio_point, ratio_lo, ratio_hi, views_point, views_lo, views_hi, p_breakout, interval_level, baseline_7d_views, baseline_n, inputs_json, note, payload_sha256, late, status, void_reason, voided_at,
           outcome_views_7d, outcome_ratio_7d, outcome_band, outcome_is_breakout, outcome_method, hit_band, in_interval, abs_log_err, test_id, pair_right, graded_at, dry)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        v.id, v.origin, v.predictor, v.predictorVersion, v.kind, v.scriptId, v.scriptVersion, v.postId, v.sourceId, v.platform, v.surface, v.refAgeH, v.asOf, v.frozenAt, v.backtestOrigin, v.band, v.score,
        v.ratioPoint, v.ratioLo, v.ratioHi, v.viewsPoint, v.viewsLo, v.viewsHi, v.pBreakout, v.intervalLevel, v.baseline7dViews, v.baselineN, JSON.stringify(v.inputs), v.note, v.payloadSha256, int(v.late), v.status, v.voidReason, v.voidedAt,
        v.outcomeViews7d, v.outcomeRatio7d, v.outcomeBand, nint(v.outcomeIsBreakout), v.outcomeMethod, nint(v.hitBand), nint(v.inInterval), v.absLogErr, v.testId, nint(v.pairRight), v.gradedAt, int(v.dry),
      );
    },
    get(id: string): LabPrediction | null {
      const r = one('SELECT * FROM lab_predictions WHERE id = ?', id);
      return r ? toPrediction(r) : null;
    },
    forScript(scriptId: string): LabPrediction[] {
      return all('SELECT * FROM lab_predictions WHERE script_id = ? ORDER BY frozen_at, id', scriptId).map(toPrediction);
    },
    forPost(postId: string): LabPrediction[] {
      return all('SELECT * FROM lab_predictions WHERE post_id = ? ORDER BY frozen_at, id', postId).map(toPrediction);
    },
    /** Newest first. Default limit 200. */
    list(filter: LabPredictionFilter = {}): LabPrediction[] {
      const where: string[] = [];
      const args: unknown[] = [];
      const eq = (col: string, v: unknown) => {
        where.push(`${col} = ?`);
        args.push(v);
      };
      if (filter.origin) eq('origin', filter.origin);
      if (filter.status) eq('status', filter.status);
      if (filter.predictor) eq('predictor', filter.predictor);
      if (filter.kind) eq('kind', filter.kind);
      if (filter.scriptId) eq('script_id', filter.scriptId);
      if (filter.postId) eq('post_id', filter.postId);
      if (filter.dry !== undefined) eq('dry', int(filter.dry));
      return all(`SELECT * FROM lab_predictions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY frozen_at DESC, id LIMIT ?`, ...args, filter.limit ?? 200).map(toPrediction);
    },
    /** 06 2.5: link a script's live, non-void pre-post rows to the published post, once. */
    linkPost(scriptId: string, postId: string, late: boolean): number {
      return run("UPDATE lab_predictions SET post_id = ?, late = ? WHERE script_id = ? AND post_id IS NULL AND origin = 'live' AND kind = 'pre_post' AND status <> 'void'", postId, int(late), scriptId).changes;
    },
    /** 06 2.5 (lane L): link one row, with its own `late` (rows of one script can be frozen at different times). */
    linkOne(id: string, postId: string, late: boolean): boolean {
      return run("UPDATE lab_predictions SET post_id = ?, late = ? WHERE id = ? AND post_id IS NULL AND status <> 'void'", postId, int(late), id).changes > 0;
    },
    grade(id: string, g: LabPredictionGrade): boolean {
      return run(
        'UPDATE lab_predictions SET outcome_views_7d = ?, outcome_ratio_7d = ?, outcome_band = ?, outcome_is_breakout = ?, outcome_method = ?, hit_band = ?, in_interval = ?, abs_log_err = ?, status = ?, graded_at = ? WHERE id = ?',
        g.outcomeViews7d, g.outcomeRatio7d, g.outcomeBand, nint(g.outcomeIsBreakout), g.outcomeMethod, nint(g.hitBand), nint(g.inInterval), g.absLogErr, g.status, g.gradedAt, id,
      ).changes > 0;
    },
    /** 06 4.4. `note` is a frozen field on live rows (06 2.4), so it is not rewritten here; the reason lives in the test row. */
    gradePairwise(id: string, g: { testId: string | null; pairRight: boolean | null; status: 'graded' | 'ungradable'; note?: string; gradedAt?: string }): boolean {
      return run('UPDATE lab_predictions SET test_id = ?, pair_right = ?, status = ?, graded_at = ? WHERE id = ?', g.testId, nint(g.pairRight), g.status, g.gradedAt ?? new Date().toISOString(), id).changes > 0;
    },
    void(id: string, reason: string, at: string): boolean {
      return run("UPDATE lab_predictions SET status = 'void', void_reason = ?, voided_at = ? WHERE id = ?", reason, at, id).changes > 0;
    },
    /** 06 7.4: the nightly backtest replaces its own rows for one predictor version; live rows are never touched. */
    replaceBacktest(predictor: string, version: string, rows: LabPrediction[]): void {
      db.transaction(() => {
        run("DELETE FROM lab_predictions WHERE origin = 'backtest' AND predictor = ? AND predictor_version = ?", predictor, version);
        for (const r of rows) predictions.insert({ ...r, origin: 'backtest' });
      })();
    },
  };

  const evals = {
    /** One row per (predictor, scope, population, platform, window, day, dry): a re-run the same day replaces it. */
    upsert(e: LabEval): void {
      const v = LabEvalSchema.parse(e);
      run(
        `INSERT OR REPLACE INTO lab_evals (predictor, predictor_version, scope, population, platform, window_weeks, computed_date, computed_at, harness_version, origins, n_posts, n_creators, abstained, n_pairs,
           pairwise, pairwise_lo, pairwise_hi, spearman, spearman_lo, spearman_hi, log_mae, log_mae_baseline, mae_delta_lo, mae_delta_hi, coverage, coverage_lo, coverage_hi, coverage_n,
           pr_auc, pr_auc_lo, pr_auc_hi, base_rate, positives, band_hits_json, verdict_forecast, verdict_ranking, verdict_classifier, dry)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        v.predictor, v.predictorVersion, v.scope, v.population, v.platform, v.windowWeeks, v.computedDate, v.computedAt, v.harnessVersion, v.origins, v.nPosts, v.nCreators, v.abstained, v.nPairs,
        v.pairwise, v.pairwiseLo, v.pairwiseHi, v.spearman, v.spearmanLo, v.spearmanHi, v.logMae, v.logMaeBaseline, v.maeDeltaLo, v.maeDeltaHi, v.coverage, v.coverageLo, v.coverageHi, v.coverageN,
        v.prAuc, v.prAucLo, v.prAucHi, v.baseRate, v.positives, JSON.stringify(v.bandHits), v.verdictForecast, v.verdictRanking, v.verdictClassifier, int(v.dry),
      );
    },
    latest(predictor: string, scope: LabEval['scope'], population: LabEval['population'], platform: LabEval['platform'], windowWeeks: number): LabEval | null {
      const r = one('SELECT * FROM lab_evals WHERE predictor = ? AND scope = ? AND population = ? AND platform = ? AND window_weeks = ? ORDER BY computed_date DESC, id DESC LIMIT 1', predictor, scope, population, platform, windowWeeks);
      return r ? toEval(r) : null;
    },
    /** Oldest first, the last `weeks` computed dates. */
    history(predictor: string, platform: LabEval['platform'], weeks: number): LabEval[] {
      return all('SELECT * FROM (SELECT * FROM lab_evals WHERE predictor = ? AND platform = ? ORDER BY computed_date DESC, id DESC LIMIT ?) ORDER BY computed_date, id', predictor, platform, weeks).map(toEval);
    },
    all(): LabEval[] {
      return all('SELECT * FROM lab_evals ORDER BY computed_date, id').map(toEval);
    },
  };

  const retention = {
    add(r: LabRetention): void {
      const v = LabRetentionSchema.parse(r);
      run(
        `INSERT OR REPLACE INTO lab_retention (post_id, platform, source, captured_at, age_h, partial, curve_json, views, avg_view_duration_s, avg_view_pct, reach, likes, comments, saved, shares, total_interactions, avg_watch_time_ms, total_watch_time_ms, skip_rate, raw_json, dry)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        v.postId, v.platform, v.source, v.capturedAt, v.ageH, int(v.partial), v.curve ? JSON.stringify(v.curve) : null, v.views, v.avgViewDurationS, v.avgViewPct, v.reach, v.likes, v.comments, v.saved, v.shares, v.totalInteractions,
        v.avgWatchTimeMs, v.totalWatchTimeMs, v.skipRate, JSON.stringify(v.raw), int(v.dry),
      );
    },
    forPost(postId: string): LabRetention[] {
      return all('SELECT * FROM lab_retention WHERE post_id = ? ORDER BY age_h', postId).map(toRetention);
    },
    /** The newest read whose age is within `tolH` of `ageH`, or null. */
    newestAtAge(postId: string, ageH: number, tolH: number): LabRetention | null {
      const r = one('SELECT * FROM lab_retention WHERE post_id = ? AND age_h BETWEEN ? AND ? ORDER BY captured_at DESC LIMIT 1', postId, ageH - tolH, ageH + tolH);
      return r ? toRetention(r) : null;
    },
    all(): LabRetention[] {
      return all('SELECT * FROM lab_retention ORDER BY post_id, age_h').map(toRetention);
    },
  };

  const tests = {
    create(t: LabTest): void {
      const v = LabTestSchema.parse(t);
      run(
        `INSERT INTO lab_tests (id, kind, title, hypothesis, variable, feature_key, expected_sign, script_id, platform, status, arms_json, judge_age_h, primary_metric, result, winner_arm, observed_sign, confirms, judge_detail_json, notes, plan_week, started_at, judged_at, created_at, updated_at, dry)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        v.id, v.kind, v.title, v.hypothesis, v.variable, v.featureKey, v.expectedSign, v.scriptId, v.platform, v.status, JSON.stringify(v.arms), v.judgeAgeH, v.primaryMetric, v.result, v.winnerArm, v.observedSign, nint(v.confirms),
        JSON.stringify(v.judgeDetail), v.notes, v.planWeek ?? null, v.startedAt, v.judgedAt, v.createdAt, v.updatedAt, int(v.dry),
      );
    },
    get(id: string): LabTest | null {
      const r = one('SELECT * FROM lab_tests WHERE id = ?', id);
      return r ? toTest(r) : null;
    },
    all(filter: LabTestFilter = {}): LabTest[] {
      const where: string[] = [];
      const args: unknown[] = [];
      if (filter.kind) { where.push('kind = ?'); args.push(filter.kind); }
      if (filter.status) { where.push('status = ?'); args.push(filter.status); }
      if (filter.featureKey) { where.push('feature_key = ?'); args.push(filter.featureKey); }
      if (filter.scriptId) { where.push('script_id = ?'); args.push(filter.scriptId); }
      if (filter.dry !== undefined) { where.push('dry = ?'); args.push(int(filter.dry)); }
      return all(`SELECT * FROM lab_tests ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id`, ...args).map(toTest);
    },
    /** Merge a patch (validated as a whole row); `updatedAt` defaults to now. */
    update(id: string, patch: Partial<Omit<LabTest, 'id'>>): LabTest | null {
      const cur = tests.get(id);
      if (!cur) return null;
      const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      const next = LabTestSchema.parse({ ...cur, updatedAt: new Date().toISOString(), ...defined, id });
      run(
        `UPDATE lab_tests SET kind = ?, title = ?, hypothesis = ?, variable = ?, feature_key = ?, expected_sign = ?, script_id = ?, platform = ?, status = ?, arms_json = ?, judge_age_h = ?, primary_metric = ?, result = ?, winner_arm = ?, observed_sign = ?, confirms = ?, judge_detail_json = ?, notes = ?, plan_week = ?, started_at = ?, judged_at = ?, created_at = ?, updated_at = ?, dry = ? WHERE id = ?`,
        next.kind, next.title, next.hypothesis, next.variable, next.featureKey, next.expectedSign, next.scriptId, next.platform, next.status, JSON.stringify(next.arms), next.judgeAgeH, next.primaryMetric, next.result, next.winnerArm, next.observedSign, nint(next.confirms),
        JSON.stringify(next.judgeDetail), next.notes, next.planWeek ?? null, next.startedAt, next.judgedAt, next.createdAt, next.updatedAt, int(next.dry), id,
      );
      return next;
    },
    forFeature(featureKey: string): LabTest[] {
      return tests.all({ featureKey });
    },
  };

  const embeddings = {
    upsert(e: LabEmbedding): void {
      run(
        'INSERT OR REPLACE INTO lab_embeddings (subject_kind, subject_id, model, dim, text_hash, vec, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        e.subjectKind, e.subjectId, e.model, e.dim, e.textHash, vecToBlob(e.vec), e.createdAt,
      );
    },
    get(subjectKind: LabEmbedSubject, subjectId: string, model: string): LabEmbedding | null {
      const r = one('SELECT * FROM lab_embeddings WHERE subject_kind = ? AND subject_id = ? AND model = ?', subjectKind, subjectId, model);
      return r ? toEmbedding(r) : null;
    },
    /** Every vector of one kind and one model (search compares within one model only, 07 7.11). */
    forKind(subjectKind: LabEmbedSubject, model: string): LabEmbedding[] {
      return all('SELECT * FROM lab_embeddings WHERE subject_kind = ? AND model = ? ORDER BY subject_id', subjectKind, model).map(toEmbedding);
    },
    count(subjectKind?: LabEmbedSubject, model?: string): number {
      const where: string[] = [];
      const args: unknown[] = [];
      if (subjectKind) { where.push('subject_kind = ?'); args.push(subjectKind); }
      if (model) { where.push('model = ?'); args.push(model); }
      return Number(one(`SELECT COUNT(*) AS n FROM lab_embeddings ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`, ...args)!.n);
    },
  };

  const comments = {
    upsert(c: LabComment): void {
      const v = LabCommentSchema.parse(c);
      run(
        `INSERT OR REPLACE INTO lab_comments (id, post_id, platform, author_hash, text, likes, replies, is_reply, by_creator, creator_heart, posted_at, captured_at, intent, intent_rule, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        v.id, v.postId, v.platform, v.authorHash, v.text, v.likes, v.replies, int(v.isReply), int(v.byCreator), nint(v.creatorHeart), v.postedAt, v.capturedAt, v.intent, v.intentRule, v.runId,
      );
    },
    /** Newest first. */
    forPost(postId: string, limit = 500): LabComment[] {
      return all('SELECT * FROM lab_comments WHERE post_id = ? ORDER BY COALESCE(posted_at, captured_at) DESC, id LIMIT ?', postId, limit).map(toComment);
    },
    all(): LabComment[] {
      return all('SELECT * FROM lab_comments ORDER BY post_id, captured_at, id').map(toComment);
    },
    count(postId?: string): number {
      return Number((postId ? one('SELECT COUNT(*) AS n FROM lab_comments WHERE post_id = ?', postId) : one('SELECT COUNT(*) AS n FROM lab_comments'))!.n);
    },
  };

  /** 09.6 lab_forecasts. Rows are immutable once graded or void (trigger lab_forecasts_lock). */
  const forecasts = {
    insert(f: LabForecast): void {
      const v = LabForecastSchema.parse(f);
      run(
        `INSERT INTO lab_forecasts (id, kind, subject, frozen_at, inputs_json, predicted, lo, hi, expected_items, actual, actual_items, status, graded_at, dry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        v.id, v.kind, v.subject, v.frozenAt, JSON.stringify(v.inputs), v.predicted, v.lo, v.hi, v.expectedItems, v.actual, v.actualItems, v.status, v.gradedAt, int(v.dry),
      );
    },
    get(id: string): LabForecast | null {
      const r = one('SELECT * FROM lab_forecasts WHERE id = ?', id);
      return r ? toForecast(r) : null;
    },
    bySubject(subject: string): LabForecast[] {
      return all('SELECT * FROM lab_forecasts WHERE subject = ? ORDER BY frozen_at, id', subject).map(toForecast);
    },
    /** Rows still waiting to be graded (`open`, and `late` ones that may be re-graded once). */
    open(kind?: LabForecastKind): LabForecast[] {
      return (kind ? all("SELECT * FROM lab_forecasts WHERE status IN ('open','late') AND kind = ? ORDER BY frozen_at, id", kind) : all("SELECT * FROM lab_forecasts WHERE status IN ('open','late') ORDER BY frozen_at, id")).map(toForecast);
    },
    grade(id: string, g: { actual: number | null; actualItems?: number | null; status: 'graded' | 'late' | 'void'; gradedAt: string }): boolean {
      return run('UPDATE lab_forecasts SET actual = ?, actual_items = ?, status = ?, graded_at = ? WHERE id = ?', g.actual, g.actualItems ?? null, g.status, g.gradedAt, id).changes > 0;
    },
    all(kind?: LabForecastKind): LabForecast[] {
      return (kind ? all('SELECT * FROM lab_forecasts WHERE kind = ? ORDER BY frozen_at, id', kind) : all('SELECT * FROM lab_forecasts ORDER BY frozen_at, id')).map(toForecast);
    },
  };

  return {
    sources,
    creatorSnapshots,
    posts,
    metrics,
    transcripts,
    dissections,
    topics,
    measures,
    clusters,
    trendSnapshots,
    trendItems,
    profiles,
    ideas,
    scripts,
    outcomes,
    priors,
    runs,
    spend,
    // v2 (S0)
    controls,
    events,
    eventPings,
    eventCoverage,
    morningBrief,
    predictions,
    evals,
    retention,
    tests,
    embeddings,
    comments,
    forecasts,
    /** Row counts per table (cheap; for states and the screen context). */
    counts(): Record<LabTable, number> {
      const out = {} as Record<LabTable, number>;
      for (const t of LAB_TABLES) out[t] = Number(one(`SELECT COUNT(*) AS n FROM ${t}`)!.n);
      return out;
    },
    /** Nothing added and nothing scraped: no sources and no posts. */
    isEmpty(): boolean {
      return Number(one('SELECT (SELECT COUNT(*) FROM lab_sources) + (SELECT COUNT(*) FROM lab_posts) AS n')!.n) === 0;
    },
    /** Delete every lab row. Only the fixture world and tests call this. Live predictions cannot be
     *  deleted (06 2.4 trigger), so the trigger is dropped and re-created inside the same transaction. */
    clearAll(): void {
      db.transaction(() => {
        db.exec('DROP TRIGGER IF EXISTS lab_predictions_no_delete');
        for (const t of LAB_TABLES) run(`DELETE FROM ${t}`);
        db.exec(LEDGER_TRIGGERS_DDL);
      })();
    },
    /* ── lane S sub-block: the raw handle, for the fixture scenario transforms only (08.7.2) ── */
    /** The underlying database. Only lib/lab/fixtures/scenarios.ts uses it (bulk transforms of the sample world). */
    rawDb(): InstanceType<typeof Database> {
      return db;
    },
    /* ── end lane S sub-block ── */
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },
  };
}

export type LabStore = ReturnType<typeof labStore>;
