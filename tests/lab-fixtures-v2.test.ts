import { describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { LAB_DDL } from '@/lib/db';
import { LAB_TABLES, labStore } from '@/lib/lab/store';
import { FIXTURE_IDS, FIXTURE_MARKER, FIXTURE_VERSION, ensureFilmingFixtures, resolveScenario, seedLabFixtures } from '@/lib/lab/fixtures';
import { payloadSha256 } from '@/lib/lab/fixtures/ledger';
import { COMMENTER_HANDLES, WATCH_HANDLES } from '@/lib/lab/fixtures/text';
import { lineOffReason, lineSpend, monthSpend, spendMeter } from '@/lib/lab/spend';
import {
  LAB_JOB_IDS, LAB_RADAR_SOURCES, LAB_RUN_KINDS, LAB_SPEND_LINES, LabCommentSchema, LabControlSchema, LabEventCoverageSchema, LabEventPingSchema, LabEventSchema, LabEvalSchema,
  LabForecastSchema, LabMorningBriefSchema, LabPredictionSchema, LabPredictorIdSchema, LabRetentionSchema, LabTestSchema, providerOf,
} from '@/lib/schemas';

/**
 * The v2 fixture world (08.7.2), S0's share of AC-08-15 and AC-08-16: every lab table is populated
 * by `full`, the world is deterministic per anchor hour, every FIXTURE_IDS id exists, every row
 * parses with its owning section's schema, predictions are sealed, commenters are hashes only.
 * Lane S extends this file with the scenario counts and the exact 08.7.2 targets.
 */

const NOW = new Date('2026-10-11T12:34:00.000Z');
const fresh = () => {
  const db = new Database(':memory:');
  db.exec(LAB_DDL);
  return labStore(db);
};

describe('fixture world v2 (full)', () => {
  const s = fresh();
  const summary = seedLabFixtures(s, NOW);

  test('every lab table, v1 and v2, has rows', () => {
    const counts = s.counts();
    for (const t of LAB_TABLES) expect(counts[t], t).toBeGreaterThan(0);
    expect(summary).toMatchObject({ version: FIXTURE_VERSION, scenario: 'full', watch: 12, events: 8, pings: 60 });
  });

  test('deterministic: the same anchor hour gives identical rows', () => {
    const t = fresh();
    seedLabFixtures(t, new Date('2026-10-11T12:05:00.000Z'));
    const dump = (x: ReturnType<typeof fresh>) => ({
      events: x.events.all(), pings: x.eventPings.all(), coverage: x.eventCoverage.all(), predictions: x.predictions.list({ limit: 1000 }), evals: x.evals.all(), tests: x.tests.all(),
      retention: x.retention.all(), comments: x.comments.all(), controls: x.controls.all(), forecasts: x.forecasts.all(), ideas: x.ideas.all(), spend: x.spend.all(),
    });
    expect(dump(t)).toEqual(dump(s));
  });

  test('every FIXTURE_IDS id exists', () => {
    expect(s.posts.get(FIXTURE_IDS.firstPost)).not.toBeNull();
    expect(s.scripts.get(FIXTURE_IDS.script)).not.toBeNull();
    expect(s.ideas.get(FIXTURE_IDS.idea)).not.toBeNull();
    expect(s.profiles.latest().some((p) => p.formatFamily === FIXTURE_IDS.profileFamily)).toBe(true);
    expect(s.events.get(FIXTURE_IDS.event)).toMatchObject({ windowState: 'open', novelty: 'new_category' });
    expect(s.events.get(FIXTURE_IDS.eventClosed)).toMatchObject({ windowState: 'closed', class: 'spike' });
    expect(s.tests.get(FIXTURE_IDS.test)).toMatchObject({ result: 'winner' });
    expect(s.tests.get(FIXTURE_IDS.testInconclusive)).toMatchObject({ result: 'inconclusive' });
    expect(s.tests.get(FIXTURE_IDS.testRunning)).toMatchObject({ status: 'running' });
    expect(s.predictions.get(FIXTURE_IDS.prediction)).not.toBeNull();
  });

  test('every seeded v2 row parses with its owning section schema; ids and enums are the owners', () => {
    for (const e of s.events.all()) LabEventSchema.parse(e);
    for (const p of s.eventPings.all()) {
      LabEventPingSchema.parse(p);
      expect(LAB_RADAR_SOURCES).toContain(p.source);
    }
    for (const c of s.eventCoverage.all()) LabEventCoverageSchema.parse(c);
    LabMorningBriefSchema.parse(s.morningBrief.latest());
    for (const p of s.predictions.list({ limit: 1000 })) {
      LabPredictionSchema.parse(p);
      expect(LabPredictorIdSchema.safeParse(p.predictor).success).toBe(true);
      expect(p.predictor).not.toMatch(/^(llm_judge|idea_ranker)$/);
    }
    for (const e of s.evals.all()) LabEvalSchema.parse(e);
    for (const t of s.tests.all()) LabTestSchema.parse(t);
    for (const r of s.retention.all()) LabRetentionSchema.parse(r);
    for (const c of s.comments.all()) LabCommentSchema.parse(c);
    for (const c of s.controls.all()) LabControlSchema.parse(c);
    for (const f of s.forecasts.all()) LabForecastSchema.parse(f);
    for (const r of s.runs.recent(1000)) expect(LAB_RUN_KINDS).toContain(r.kind);
    for (const r of s.spend.all()) {
      expect(LAB_SPEND_LINES).toContain(r.line);
      expect(providerOf(r.line!)).toBe(r.provider);
    }
  });

  test('the 08.7.2 shapes: 8 events with E8 a candidate, every ping source, both seeds of comments, judge rows, 6 tests plus planner slots', () => {
    expect(s.events.all({ status: ['candidate'] }).map((e) => e.id)).toEqual(['fx-ev-e8']);
    expect(s.events.all().every((e) => e.name.startsWith('Sample'))).toBe(true);
    expect(new Set(s.eventPings.all().map((p) => p.source)).size).toBe(8); // wikipedia is a class meter, not a ping source (05 16)
    expect(s.eventPings.all().filter((p) => p.fakeStar === true)).toHaveLength(1);
    expect(s.comments.count()).toBe(120);
    const judge = s.predictions.list({ predictor: 'judge', limit: 100 });
    expect(judge).toHaveLength(10);
    expect(judge.filter((p) => p.status === 'graded')).toHaveLength(7);
    expect(judge.filter((p) => p.pairRight === true)).toHaveLength(5);
    expect(judge.filter((p) => p.note === 'abstained')).toHaveLength(2);
    expect(s.tests.all().filter((t) => t.kind !== 'planned_post')).toHaveLength(6);
    expect(s.tests.all({ kind: 'planned_post' })).toHaveLength(8);
    expect(s.retention.all().filter((r) => r.platform === 'youtube').every((r) => r.curve?.length === 100)).toBe(true);
    expect(s.sources.all('watch')).toHaveLength(WATCH_HANDLES.length);
    expect(s.sources.all('watch').every((w) => w.platform === 'x')).toBe(true);
    expect(s.posts.all().filter((p) => p.exoReason)).toHaveLength(1);
    expect(s.controls.all().some((c) => c.role === 'case') && s.controls.all().some((c) => c.status === 'failed')).toBe(true);
    expect(s.priors.get(FIXTURE_MARKER)?.value).toMatchObject({ version: FIXTURE_VERSION });
  });

  test('predictions are sealed with the 06 2.4(a) payload hash', () => {
    for (const p of s.predictions.list({ limit: 1000 })) {
      const { payloadSha256: seal, ...rest } = p;
      expect(payloadSha256(rest)).toBe(seal);
    }
  });

  test('commenters are 32-hex hashes; no fixture handle appears in any lab_comments column (AC-07-41, AC-08-16)', () => {
    const all = JSON.stringify(s.comments.all());
    for (const c of s.comments.all()) expect(c.authorHash).toMatch(/^[0-9a-f]{32}$/);
    for (const h of COMMENTER_HANDLES) expect(all).not.toContain(h);
  });
});

describe('Filming and scenarios', () => {
  test('a v1 fixture world (no version) is regenerated as v2', () => {
    const s = fresh();
    seedLabFixtures(s, NOW);
    s.priors.set({ key: FIXTURE_MARKER, value: { anchor: NOW.toISOString(), name: 'x' }, n: 0, supersedesDefault: false, updatedAt: NOW.toISOString() });
    expect(ensureFilmingFixtures(s, NOW)).toBe('refreshed');
    expect(s.priors.get(FIXTURE_MARKER)?.value).toMatchObject({ version: FIXTURE_VERSION });
    expect(ensureFilmingFixtures(s, NOW)).toBe('kept');
  });

  test('unknown scenario names fall back to full', () => {
    expect(resolveScenario('thin')).toBe('thin');
    expect(resolveScenario('nope')).toBe('full');
    expect(resolveScenario(null)).toBe('full');
  });
});

/* ── lane S: the Ops targets and the six scenario transforms (08.7.2, AC-08-15) ── */
describe('Ops (08.7.2): this month on every line', () => {
  test.each(['2026-10-11T12:34:00.000Z', '2026-11-01T00:40:00.000Z', '2026-12-31T23:10:00.000Z'])('anchor %s: apify $8.20 by line, stt $1.40, comments, downloads and embed at $0', (when) => {
    const s = fresh();
    seedLabFixtures(s, new Date(when));
    const anchor = new Date((s.priors.get(FIXTURE_MARKER)!.value as { anchor: string }).anchor);
    const meter = spendMeter(s, anchor);
    const line = (l: string) => meter.byLine.find((x) => x.line === l)!.spent;
    expect(line('apify.sync')).toBeCloseTo(4.1, 6);
    expect(line('apify.snapshots')).toBeCloseTo(2.6, 6);
    expect(line('apify.x')).toBeCloseTo(0.9, 6);
    expect(line('apify.radar_x')).toBeCloseTo(0.5, 6);
    expect(line('apify.radar_tiktok')).toBeCloseTo(0.08, 6);
    expect(line('apify.radar_producthunt')).toBeCloseTo(0.02, 6);
    expect(line('apify.verify')).toBe(0);
    expect(monthSpend(s, 'apify', anchor)).toBeCloseTo(8.2, 6);
    expect(monthSpend(s, 'stt', anchor)).toBeCloseTo(1.4, 6);
    expect(line('stt.controls')).toBeCloseTo(0.1, 6);
    for (const p of ['comments', 'downloads', 'embed'] as const) expect(monthSpend(s, p, anchor)).toBe(0);
    for (const id of LAB_JOB_IDS) expect((s.priors.get(`job:${id}`)!.value as { lastDetail: string }).lastDetail).toBe('ok');
    expect(s.runs.recent(1000).filter((r) => r.status === 'running')).toHaveLength(1);
  });
});

describe('scenarios (08.7.2)', () => {
  const world = (scenario: Parameters<typeof seedLabFixtures>[2]) => {
    const s = fresh();
    seedLabFixtures(s, NOW, scenario);
    return s;
  };
  test('thin: 3 owned posts, 4 breakouts, 3 graded predictions, 1 event with 2 coverage posts, no tests or planner slots, 2 judge verdicts', () => {
    const s = world('thin');
    expect(s.posts.all().filter((p) => p.isOwned)).toHaveLength(3);
    expect(s.measures.all().filter((m) => m.isBreakout)).toHaveLength(4);
    const preds = s.predictions.list({ limit: 1000 });
    expect(preds.filter((p) => p.status === 'graded' && p.predictor !== 'judge' && p.predictor !== 'creator_median')).toHaveLength(3);
    expect(preds.filter((p) => p.predictor === 'judge')).toHaveLength(2);
    expect(s.events.all().map((e) => e.id)).toEqual(['fx-ev-e1']);
    expect(s.eventCoverage.all()).toHaveLength(2);
    expect(s.tests.all()).toHaveLength(0);
    expect(s.tests.all({ kind: 'planned_post' })).toHaveLength(0);
  });
  test('fresh: no sources, no posts, no runs; health stays connected', () => {
    const s = world('fresh');
    expect(s.sources.all()).toHaveLength(0);
    expect(s.posts.count()).toBe(0);
    expect(s.runs.recent(10)).toHaveLength(0);
    expect((s.priors.get('health:apify.auth')!.value as { state: string }).state).toBe('ok');
    expect(s.priors.get('apify:plan')).toBeTruthy();
  });
  test('quiet: every confirmed event is past its window', () => {
    const s = world('quiet');
    const events = s.events.all().filter((e) => e.status !== 'candidate');
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.windowState).toBe('closed');
  });
  test('blocked: apify.snapshots at $22.00 of $22 with one scheduled blocked run; comments off', () => {
    const s = world('blocked');
    const anchor = new Date((s.priors.get(FIXTURE_MARKER)!.value as { anchor: string }).anchor);
    expect(lineSpend(s, 'apify.snapshots', anchor)).toBeCloseTo(22, 6);
    const blocked = s.runs.recent(1000).filter((r) => r.status === 'blocked');
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ line: 'apify.snapshots', scheduled: true });
    expect(lineOffReason('comments', { env: {} })).toMatch(/^Off\./);
  });
  test('running: 3 pending runs with reserves in one batch', () => {
    const s = world('running');
    const live = s.runs.byBatch('lbat-fxrunning0001');
    expect(live).toHaveLength(3);
    expect(live.every((r) => r.status === 'running')).toBe(true);
    expect(live.every((r) => (s.spend.forRun(r.id)[0]?.reservedUsd ?? 0) > 0)).toBe(true);
  });
  test('degraded: instagram expiring, youtube invalid_grant, radar.hn stale, lexicon mismatch, 2 unsettled over 24 h, a failed run', () => {
    const s = world('degraded');
    expect((s.priors.get('health:instagram.token')!.value as { detail: string }).detail).toBe('Expires in 3 days.');
    expect((s.priors.get('health:youtube.token')!.value as { state: string }).state).toBe('fail');
    expect((s.priors.get('job:radar.hn')!.value as { fails: number }).fails).toBe(3);
    expect(s.priors.get('lexicon:last_fetch')).toBeTruthy();
    expect(s.runs.recent(1000).filter((r) => r.id.startsWith('fx-run-unsettled'))).toHaveLength(2);
    expect(s.runs.get('fx-run-failed')!.status).toBe('failed');
  });
  test('the other scenarios keep the fixture ids and parse', () => {
    for (const sc of ['quiet', 'blocked', 'running', 'degraded'] as const) {
      const s = world(sc);
      for (const f of s.forecasts.all()) LabForecastSchema.parse(f);
      expect(s.posts.get(FIXTURE_IDS.firstPost), sc).toBeTruthy();
    }
  });
});
