/**
 * The Content Lab fixture world, v2 (08.7.2). FICTIONAL: every creator, handle, launch, post,
 * comment and number is invented. It feeds Filming mode (demo-data's database) and the
 * `?sample=1` preview on a blank install (in memory, badged).
 *
 *   world.ts     the v1 world (creators, posts, metric reads, dissections, measures, profiles,
 *                ideas, scripts, runs) plus the v2 extensions (X watch list, an outside push,
 *                case-control rows)
 *   radar.ts     8 launches E1 to E8, 60 pings, coverage, the angle spread, lead times, the brief
 *   ledger.ts    predictions (sealed), evals, tests, planner slots, retention
 *   gen.ts       launch ideas, hashed comments with two seeds, contact-sheet markers, embeddings
 *   ops.ts       runs and spend on every line, job and health states, plan, forecasts
 *   scenarios.ts the scenario transforms (full here; the rest are lane S's)
 *
 * Same anchor hour, same world. v1 names are kept (FIXTURE_MARKER, FIXTURE_NAME, FIXTURE_IDS,
 * seedLabFixtures, ensureFilmingFixtures). Lane S owns ops.ts and scenarios.ts; the data lanes
 * replace their layer's numbers with their own maths when they land (08.12.2).
 */
import type { LabFixtureScenario } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { FIXTURE_MARKER, FIXTURE_NAME, seedWorld, seedWorldV2, type FixtureSummary } from '@/lib/lab/fixtures/world';
import { seedRadar } from '@/lib/lab/fixtures/radar';
import { seedLedger } from '@/lib/lab/fixtures/ledger';
import { seedGen } from '@/lib/lab/fixtures/gen';
import { seedOps } from '@/lib/lab/fixtures/ops';
import { applyScenario } from '@/lib/lab/fixtures/scenarios';
import { WATCH_HANDLES } from '@/lib/lab/fixtures/text';
import { labTz } from '@/lib/lab/setup/tz';

export { FIXTURE_MARKER, FIXTURE_NAME } from '@/lib/lab/fixtures/world';
export type { FixtureSummary } from '@/lib/lab/fixtures/world';
export { resolveScenario, applyScenario, LAB_FIXTURE_SCENARIOS } from '@/lib/lab/fixtures/scenarios';

/** v2 world version, stored in the `__fixtures` prior; Filming regenerates any world below it. */
export const FIXTURE_VERSION = 2;

/** Stable ids other code and tests may point at (08.7.3). */
export const FIXTURE_IDS = {
  firstPost: 'fx-p-0001',
  script: 'fx-script-1',
  idea: 'fx-idea-1',
  profileFamily: 'tutorial_walkthrough',
  event: 'fx-ev-e1',
  eventClosed: 'fx-ev-e4',
  test: 'fx-test-1',
  testInconclusive: 'fx-test-2',
  testRunning: 'fx-test-5',
  prediction: 'fx-pred-1',
} as const;

export type FixtureSummaryV2 = FixtureSummary & {
  version: number;
  scenario: LabFixtureScenario;
  watch: number;
  controls: number;
  events: number;
  pings: number;
  coverage: number;
  predictions: number;
  evals: number;
  tests: number;
  retention: number;
  comments: number;
  embeddings: number;
  forecasts: number;
};

/** The local calendar day (labTz) of an instant, 'YYYY-MM-DD'. */
function localDay(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: labTz(), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Write the whole fixture world into `store` (which should be empty). Deterministic for a given
 * anchor hour. `scenario` other than 'full' is applied after (lane S).
 */
export function seedLabFixtures(store: LabStore, now: Date = new Date(), scenario: LabFixtureScenario = 'full'): FixtureSummaryV2 {
  const v1 = seedWorld(store, now);
  const anchor = new Date(v1.anchor);
  const world = seedWorldV2(store, anchor, WATCH_HANDLES);
  const radar = seedRadar(store, anchor, localDay(anchor));
  const ledger = seedLedger(store, anchor);
  const gen = seedGen(store, anchor);
  const ops = seedOps(store, anchor);
  store.priors.set({ key: FIXTURE_MARKER, value: { anchor: anchor.toISOString(), name: FIXTURE_NAME, version: FIXTURE_VERSION, scenario }, n: 0, supersedesDefault: false, updatedAt: anchor.toISOString() });
  applyScenario(store, scenario, anchor);
  return {
    ...v1,
    ideas: v1.ideas + gen.ideas,
    runs: v1.runs + ops.runs,
    version: FIXTURE_VERSION,
    scenario,
    watch: world.watch,
    controls: world.controls,
    events: radar.events,
    pings: radar.pings,
    coverage: radar.coverage,
    predictions: ledger.predictions,
    evals: ledger.evals,
    tests: ledger.tests,
    retention: ledger.retention,
    comments: gen.comments,
    embeddings: gen.embeddings,
    forecasts: ops.forecasts,
  };
}

const DAY = 86_400_000;
/** Days after which a Filming fixture world is regenerated so "this week" stays this week. */
export const FIXTURE_STALE_DAYS = 2;

/**
 * Filming mode only: if the lab tables are empty, write the fixture world; if they hold a fixture
 * world (the marker prior) older than FIXTURE_STALE_DAYS or below FIXTURE_VERSION, wipe and
 * regenerate. Lab data that is not a fixture world (no marker) is never touched.
 */
export function ensureFilmingFixtures(store: LabStore, now: Date = new Date(), scenario: LabFixtureScenario = 'full'): 'seeded' | 'refreshed' | 'kept' {
  if (store.isEmpty()) {
    seedLabFixtures(store, now, scenario);
    return 'seeded';
  }
  const marker = store.priors.get(FIXTURE_MARKER);
  const value = marker?.value as { anchor?: string; version?: number } | null | undefined;
  if (value?.anchor && (now.getTime() - Date.parse(value.anchor) > FIXTURE_STALE_DAYS * DAY || (value.version ?? 1) < FIXTURE_VERSION)) {
    store.clearAll();
    seedLabFixtures(store, now, scenario);
    return 'refreshed';
  }
  return 'kept';
}
