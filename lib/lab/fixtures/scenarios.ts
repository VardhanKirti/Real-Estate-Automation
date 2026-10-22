/**
 * Fixture scenarios (08.7.2): each a transform over `full`. Lane S owns this file. Selection:
 * `?sample=1&scenario=<name>` (sample only; ignored with real data) or LAB_FIXTURE_SCENARIO in
 * Filming. Unknown names fall back to full. Transforms work on the fixture store only (bulk SQL
 * through the store's raw handle); a real store is never passed here.
 */
import { LAB_FIXTURE_SCENARIOS, type LabFixtureScenario } from '@/lib/schemas';
import { LEDGER_TRIGGERS_DDL } from '@/lib/db';
import type { LabStore } from '@/lib/lab/store';

export type { LabFixtureScenario } from '@/lib/schemas';
export { LAB_FIXTURE_SCENARIOS } from '@/lib/schemas';

/** `?sample=1&scenario=<name>` (sample only) or LAB_FIXTURE_SCENARIO (Filming). Unknown names fall back to full. */
export function resolveScenario(name: string | null | undefined): LabFixtureScenario {
  return (LAB_FIXTURE_SCENARIOS as readonly string[]).includes(name ?? '') ? (name as LabFixtureScenario) : 'full';
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
type Db = ReturnType<LabStore['rawDb']>;

/** Every lab table with a post_id column (dependent rows of a post). */
function postTables(db: Db): string[] {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'lab_%'").all() as { name: string }[]).map((t) => t.name);
  return tables.filter((t) => t !== 'lab_posts' && (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some((c) => c.name === 'post_id'));
}

/** Delete posts outside `keep` and every row that references them; predictions too (the no-delete trigger is lifted and restored). */
function keepPosts(db: Db, keep: Set<string>): void {
  const all = (db.prepare('SELECT id FROM lab_posts').all() as { id: string }[]).map((r) => r.id);
  const drop = all.filter((id) => !keep.has(id));
  db.exec('DROP TRIGGER IF EXISTS lab_predictions_no_delete');
  const tables = postTables(db);
  const stmts = tables.map((t) => db.prepare(`DELETE FROM ${t} WHERE post_id = ?`));
  const delPost = db.prepare('DELETE FROM lab_posts WHERE id = ?');
  for (const id of drop) {
    for (const s of stmts) s.run(id);
    delPost.run(id);
  }
  db.exec(LEDGER_TRIGGERS_DDL);
}

function withPredictionDeletes(db: Db, fn: () => void): void {
  db.exec('DROP TRIGGER IF EXISTS lab_predictions_no_delete');
  try {
    fn();
  } finally {
    db.exec(LEDGER_TRIGGERS_DDL);
  }
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Apply a scenario to a store seeded with `full`. */
export function applyScenario(store: LabStore, scenario: LabFixtureScenario, now: Date): void {
  if (scenario === 'full') return;
  const db = store.rawDb();
  const T = now.getTime();
  const setPrior = (key: string, value: unknown) => store.priors.set({ key, value, n: 0, supersedesDefault: false, updatedAt: iso(T) });
  db.transaction(() => {
    switch (scenario) {
      case 'thin': {
        // 3 owned posts, 4 breakouts (plus a few ordinary posts), 3 graded predictions, 1 event with
        // 2 coverage posts, no tests, no planner slots, 2 judge verdicts
        const posts = store.posts.all();
        const byId = new Map(posts.map((p) => [p.id, p]));
        const measures = new Map(store.measures.all().map((m) => [m.postId, m]));
        // the 3 graded predictions decide which owned posts stay (a prediction lives on its post)
        const graded = (db.prepare("SELECT id, post_id FROM lab_predictions WHERE status = 'graded' AND origin = 'live' AND predictor NOT IN ('judge', 'creator_median') AND post_id IS NOT NULL ORDER BY frozen_at").all() as { id: string; post_id: string }[])
          .filter((r) => byId.get(r.post_id)?.isOwned);
        const keepPredPosts: string[] = [];
        const keepGraded: string[] = [];
        for (const r of graded) {
          if (keepGraded.length >= 3) break;
          if (!keepPredPosts.includes(r.post_id) && keepPredPosts.length >= 3) continue;
          if (!keepPredPosts.includes(r.post_id)) keepPredPosts.push(r.post_id);
          keepGraded.push(r.id);
        }
        const owned = [...keepPredPosts, ...posts.filter((p) => p.isOwned && p.postedAt && !keepPredPosts.includes(p.id)).sort((a, b) => b.postedAt!.localeCompare(a.postedAt!)).map((p) => p.id)].slice(0, 3);
        const tracked = posts.filter((p) => !p.isOwned);
        const breakouts = tracked.filter((p) => measures.get(p.id)?.isBreakout).slice(0, 4);
        const ordinary = tracked.filter((p) => measures.get(p.id) && !measures.get(p.id)!.isBreakout).slice(0, 8);
        const coverage = store.eventCoverage.forEvent('fx-ev-e1').map((c) => c.postId).filter((id) => !byId.get(id)?.isOwned && !measures.get(id)?.isBreakout).slice(0, 2);
        withPredictionDeletes(db, () => {
          const judge = db.prepare("SELECT id FROM lab_predictions WHERE predictor = 'judge' ORDER BY frozen_at LIMIT 2").all() as { id: string }[];
          const keep = new Set([...keepGraded, ...judge.map((r) => r.id)]);
          const del = db.prepare('DELETE FROM lab_predictions WHERE id = ?');
          for (const r of db.prepare('SELECT id FROM lab_predictions').all() as { id: string }[]) if (!keep.has(r.id)) del.run(r.id);
        });
        keepPosts(db, new Set([...owned, ...breakouts.map((p) => p.id), ...ordinary.map((p) => p.id), ...coverage]));
        db.prepare("DELETE FROM lab_event_coverage WHERE event_id = 'fx-ev-e1' AND post_id NOT IN (SELECT post_id FROM lab_event_coverage WHERE event_id = 'fx-ev-e1' ORDER BY post_id LIMIT 2)").run();
        db.prepare("DELETE FROM lab_event_coverage WHERE event_id <> 'fx-ev-e1'").run();
        db.prepare("DELETE FROM lab_event_pings WHERE event_id IS NOT NULL AND event_id <> 'fx-ev-e1'").run();
        db.prepare("DELETE FROM lab_events WHERE id <> 'fx-ev-e1'").run();
        db.prepare('DELETE FROM lab_tests').run();
        db.prepare('DELETE FROM lab_evals').run();
        db.prepare('DELETE FROM lab_controls').run();
        break;
      }
      case 'fresh': {
        // configured, nothing added: no sources, no posts, no runs; key rows stay connected (health priors kept)
        const keepPrior = (k: string) => k.startsWith('health:') || k === 'apify:plan' || k === '__fixtures' || k === 'schema_version' || k.startsWith('pricing:');
        withPredictionDeletes(db, () => {
          const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'lab_%' AND name NOT IN ('lab_priors', 'lab_forecasts_lock')").all() as { name: string }[]).map((t) => t.name);
          for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
        });
        const del = db.prepare('DELETE FROM lab_priors WHERE key = ?');
        for (const p of store.priors.all()) if (!keepPrior(p.key)) del.run(p.key);
        break;
      }
      case 'quiet': {
        // every event is past its window
        db.prepare("UPDATE lab_events SET window_state = 'closed', window_opens_at = ?, window_closing_at = ?, window_closes_at = ?, window_changed_at = ?, window_reason = 'past its window', updated_at = ? WHERE status <> 'candidate'").run(iso(T - 30 * DAY), iso(T - 25 * DAY), iso(T - 21 * DAY), iso(T - 21 * DAY), iso(T));
        db.prepare("UPDATE lab_events SET window_state = NULL WHERE status = 'candidate'").run();
        break;
      }
      case 'blocked': {
        // apify.snapshots at its $22 cap (thinned), a scheduled blocked run on that line, comments off
        const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
        const spent = store.spend.since(since).filter((r) => !r.dry && r.line === 'apify.snapshots').reduce((a, r) => a + (r.actualUsd ?? r.estUsd ?? r.reservedUsd ?? 0), 0);
        const at = iso(Math.max(Date.parse(since), T - 2 * HOUR));
        const topUp = Math.round((22 - spent) * 100) / 100;
        if (topUp > 0) {
          store.runs.insert({ id: 'fx-run-cap-fill', kind: 'snapshot', apifyRunId: 'fxCapFill', datasetId: 'fxCapFillDs', actor: 'apify/instagram-post-scraper', input: {}, status: 'succeeded', items: 400, costUsd: topUp, dry: false, startedAt: at, finishedAt: at, error: null, line: 'apify.snapshots', job: 'snapshots', scheduled: true, batchId: null, progress: null });
          store.spend.add({ runId: 'fx-run-cap-fill', provider: 'apify', line: 'apify.snapshots', units: 400, estUsd: null, actualUsd: topUp, dry: false, at, actualSource: 'provider', settledAt: at });
        }
        store.runs.insert({ id: 'fx-run-blocked', kind: 'snapshot', apifyRunId: null, datasetId: null, actor: 'apify/instagram-post-scraper', input: {}, status: 'blocked', items: null, costUsd: null, dry: false, startedAt: iso(T - 30 * 60_000), finishedAt: iso(T - 30 * 60_000), error: 'apify.snapshots monthly cap reached: $22.00 of $22.00 spent. Confirm again to pass it once, or raise LAB_APIFY_SNAPSHOTS_CAP_USD.', line: 'apify.snapshots', job: 'snapshots', scheduled: true, batchId: null, progress: null });
        setPrior('job:snapshots', { lastAt: iso(T - 30 * 60_000), lastOkAt: iso(T - 3 * HOUR), lastDetail: 'apify.snapshots monthly cap reached', fails: 1, skippedReason: null });
        break;
      }
      case 'running': {
        // a live batch of 3 runs in flight, with reserves (09.4)
        const batch = 'lbat-fxrunning0001';
        const started = T - 75_000;
        const rows = [
          { actor: 'apify/instagram-post-scraper', platform: 'instagram', items: 108, usd: 0.25, est: 0.35, known: true, msg: null },
          { actor: 'clockworks/tiktok-scraper', platform: 'tiktok', items: 150, usd: 0.45, est: 0.45, known: true, msg: null },
          { actor: 'streamers/youtube-scraper', platform: 'youtube', items: 54, usd: 0.16, est: 0.23, known: false, msg: 'Scraping channel 4 of 5' },
        ];
        rows.forEach((r, k) => {
          const id = `fx-run-live-${k}`;
          store.runs.insert({ id, kind: 'scrape', apifyRunId: `fxLive${k}`, datasetId: `fxLiveDs${k}`, actor: r.actor, input: { platform: r.platform, sourceIds: [] }, status: 'running', items: null, costUsd: null, dry: false, startedAt: iso(started + k * 1000), finishedAt: null, error: null, line: 'apify.sync', job: null, scheduled: false, batchId: batch, progress: { items: r.items, usd: r.usd, statusMessage: r.msg, polledAt: iso(T - 2000) } });
          store.spend.add({ runId: id, provider: 'apify', line: 'apify.sync', units: 0, estUsd: r.est, actualUsd: null, dry: false, at: iso(started), reservedUsd: k === 1 ? 0.5 : Math.round(r.est * 1.5 * 100) / 100 });
          store.forecasts.insert({ id: `lfc-live${String(k).padStart(12, '0')}`, kind: 'run_cost', subject: id, frozenAt: iso(started), inputs: { actorId: r.actor, known: r.known }, predicted: r.est, lo: Math.round(r.est * 0.8 * 100) / 100, hi: r.est, expectedItems: 150, actual: null, actualItems: null, status: 'open', gradedAt: null, dry: false });
        });
        break;
      }
      case 'degraded': {
        // instagram token expiring in 3 days, youtube invalid_grant, radar.hn stale 4 h, lexicon hash
        // mismatch, 2 unsettled spend rows over 24 h, one failed run
        setPrior('health:instagram.token', { id: 'instagram.token', state: 'warn', detail: 'Expires in 3 days.', checkedAt: iso(T - HOUR), network: true });
        setPrior('health:youtube.token', { id: 'youtube.token', state: 'fail', detail: 'Google refused the refresh token (invalid_grant). If the app is in Testing, tokens last 7 days.', checkedAt: iso(T - HOUR), network: true });
        setPrior('job:radar.hn', { lastAt: iso(T - 10 * 60_000), lastOkAt: iso(T - 4 * HOUR), lastDetail: 'Hacker News did not answer (HTTP 503)', fails: 3, skippedReason: null });
        setPrior('lexicon:last_fetch', { ok: false, reason: 'hash', at: iso(T - 2 * DAY) });
        for (const [k, h] of [[0, 30], [1, 50]] as const) {
          const id = `fx-run-unsettled-${k}`;
          store.runs.insert({ id, kind: 'scrape', apifyRunId: `fxUnsettled${k}`, datasetId: null, actor: 'apify/instagram-post-scraper', input: {}, status: 'succeeded', items: 40, costUsd: null, dry: false, startedAt: iso(T - h * HOUR), finishedAt: iso(T - h * HOUR + 90_000), error: null, line: 'apify.sync', job: 'sync', scheduled: true, batchId: null, progress: null });
          store.spend.add({ runId: id, provider: 'apify', line: 'apify.sync', units: 40, estUsd: 0.09, actualUsd: null, dry: false, at: iso(T - h * HOUR), reservedUsd: 0.14 });
        }
        store.runs.insert({ id: 'fx-run-failed', kind: 'scrape', apifyRunId: 'fxFailed', datasetId: null, actor: 'clockworks/tiktok-scraper', input: {}, status: 'failed', items: 0, costUsd: 0, dry: false, startedAt: iso(T - 5 * HOUR), finishedAt: iso(T - 5 * HOUR + 30_000), error: 'Actor failed: profile is private', line: 'apify.sync', job: 'sync', scheduled: true, batchId: null, progress: null });
        break;
      }
    }
  })();
}
