import fs from 'node:fs';
import path from 'node:path';
import { parseEnvFile } from '../lib/creds';
import { resolveLab } from '../lib/lab/context';
import { liveApifyClient } from '../lib/lab/apify-live';
import { resolveApifyToken } from '../lib/connectors/apify';
import { sttClientFromCreds } from '../lib/connectors/openai-stt';
import { CapError, spendMeter } from '../lib/lab/spend';
import { advanceRuns, describePlan, planScrape } from '../lib/lab/sync';
import { analyse, discover, discoveryDue, scrape } from '../lib/lab/pipeline';
import { runLabIntel } from '../lib/lab/intel';
import { automationDirs, markScheduled, pausedBy, scheduleLabel, touchSchedule } from '../lib/lab/schedule';
import { snapshotsJob, verdictsJob } from '../lib/lab/measure/jobs';
import { actorReports, startActorVerification } from '../lib/lab/measure/actors';
import { LabJobIdSchema, type LabJobId } from '../lib/schemas';
import { jobsTable, runTick } from '../lib/lab/setup/jobs';
import { markPlanPreviewed } from '../lib/lab/setup/checklist';
import { runMigrateV2 } from '../lib/lab/setup/migrate';
import { radarCtx, runBrief, runRadarNow } from '../lib/lab/radar/run';
import { backtestSeed } from '../lib/lab/radar/seed';
import { runLedgerCycle } from '../lib/lab/ledger/job';

/**
 * Content Lab sync CLI (SPEC §4.2) — what the LaunchAgent `glados.agent.lab` runs.
 *
 *   npm run lab-sync -- sync [--force]    one scheduled cycle: advance open runs, scrape what is due
 *                                         (+ profiles), wait for Apify, transcribe, dissect, measure,
 *                                         then discovery once a week (new suggestions are sampled next cycle). Scheduled: never passes the cap; a cap
 *                                         stop is a `blocked` run the page asks about.
 *   npm run lab-sync -- plan              what a sync would start (actors, handles, item ceilings), nothing run
 *   npm run lab-sync -- advance           poll open Apify runs once and ingest finished ones
 *   npm run lab-sync -- analyse           transcribe, dissect, re-measure what is already scraped
 *   npm run lab-sync -- discover          run discovery search now
 *   npm run lab-sync -- intel             the intel cycle (profiles, DNA, clusters, feeds, ideas, priors); sync runs it last
 *   npm run lab-sync -- mark-scheduled    record that the LaunchAgent is installed (the installer calls this)
 *   npm run lab-sync -- status            store and spend, no API calls
 *   npm run lab-sync -- snapshots         one fixed-age snapshot tick by hand (04 4.2; the `snapshots` job's body)
 *   npm run lab-sync -- verify-actors [--override]   one tiny run per actor on your own handles (04 2.3)
 *   npm run lab-sync -- verdicts          case-control verdicts, then the measure recompute (04 5.2)
 *
 * v2 (08.5.1): `tick` is the only scheduled entry (what the LaunchAgent calls every 15 minutes).
 *   npm run lab-sync -- tick [--only <jobId>]... [--force] [--manual] [--batch <id>] [--override]
 *                                         run due LAB_JOBS; --force treats every job as due; --only may
 *                                         repeat; --manual records runs with scheduled 0 (Run now);
 *                                         --batch tags started runs (follow-on stages); --override
 *                                         passes a cap once (manual only, from the CapDialog)
 *   npm run lab-sync -- jobs              list jobs, last ok, due now, skip reason; no calls
 *   npm run lab-sync -- ledger [--dry]    grade, backtest, evals and the planner now (06 7.6); exit 1 on any step error
 *   npm run lab-sync -- migrate-v2        the v1 to v2 data jobs (08.11.2), once
 *
 * Kill switch: `PAUSED` or `PAUSED-lab` in the brain's Automation folder stops sync,
 * advance, analyse and discover before anything is read or spent. Dry (LAB_DRY=1 or
 * Filming) runs every stage on fixtures with 0-cost dry ledger rows.
 */

// tsx does not load .env.local the way Next does (same as scripts/adscout.ts).
try {
  const env = parseEnvFile(fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8'));
  for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v;
} catch {
  /* no .env.local: resolveCred still checks the canonical cred files */
}

const WAIT_MIN = Number(process.env.LAB_SYNC_WAIT_MIN ?? 20);
const POLL_S = 20;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function context() {
  const ctx = resolveLab();
  if (ctx.readOnly) throw new Error('sample world is read-only');
  const dry = Boolean(ctx.flags.dry);
  const token = dry ? undefined : resolveApifyToken();
  if (!dry && !token) {
    console.error(`Apify is not configured: set APIFY_API_TOKEN (${ctx.flags.setupHref}). Nothing was run.`);
    process.exit(1);
  }
  return { store: ctx.store, dry, client: token ? liveApifyClient(token) : null, label: ctx.flags.dryLabel };
}

function guardPaused(): void {
  const by = pausedBy(automationDirs(), fs.existsSync);
  if (by) {
    console.log(`Paused by ${by}: nothing read, nothing spent.`);
    process.exit(0);
  }
}

async function waitForRuns(c: ReturnType<typeof context>): Promise<void> {
  if (c.dry || !c.client) return;
  const deadline = Date.now() + WAIT_MIN * 60_000;
  while (Date.now() < deadline) {
    const open = c.store.runs.open().filter((r) => r.apifyRunId && !r.dry);
    if (open.length === 0) return;
    const r = await advanceRuns(c.store, c.client, { minAgeS: 0 });
    if (r.finished || r.failed) console.log(`  advanced: ${r.finished} finished, ${r.failed} failed, ${r.items} items`);
    for (const e of r.errors) console.log(`  poll error: ${e}`);
    if (c.store.runs.open().some((x) => x.apifyRunId && !x.dry)) await sleep(POLL_S * 1000);
  }
  console.log(`  still running after ${WAIT_MIN} min: the next read or sync picks them up`);
}

async function runAnalyse(c: ReturnType<typeof context>, scheduled: boolean) {
  const a = await analyse({ store: c.store, dry: c.dry, stt: c.dry ? null : sttClientFromCreds(), scheduled });
  console.log(`Transcribed ${a.transcribe.done} (${a.transcribe.none} caption-only, ${a.transcribe.failed} failed)${a.transcribe.blocked ? ` · blocked: ${a.transcribe.blocked}` : ''}`);
  console.log(`Dissected ${a.dissect.done} of ${a.dissect.considered}${a.dissect.failed ? ` (${a.dissect.failed} failed)` : ''}`);
  for (const e of a.dissect.errors.slice(0, 5)) console.log(`  ${e}`);
  console.log(`Measured ${a.measures.measured} of ${a.measures.posts} posts · ${a.measures.breakouts} breakouts · ${a.suggestionsScored} suggestions scored`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const force = rest.includes('--force');

  if (cmd === 'status') {
    const { store } = resolveLab();
    const c = store.counts();
    const m = spendMeter(store);
    console.log(`Sources ${c.lab_sources} · posts ${c.lab_posts} · metric reads ${c.lab_post_metrics} · transcripts ${c.lab_transcripts} · dissections ${c.lab_dissections}`);
    console.log(`Open runs ${store.runs.open().length} · spend ${m.month}: ${m.providers.map((p) => `${p.provider} $${p.spent.toFixed(2)}${p.cap !== null ? ` of $${p.cap.toFixed(2)}` : ''}${p.unsettled ? ` (${p.unsettled} unsettled)` : ''}`).join(' · ')}${m.dry ? ' · dry' : ''}`);
    return;
  }

  if (cmd === 'jobs') {
    const { store } = resolveLab();
    for (const j of jobsTable(store)) console.log(`${String(j.order).padStart(2)} ${j.id.padEnd(18)} ${j.owner}  ${j.dueNow ? 'due ' : '    '} last ok ${j.lastOkAt ?? 'never'}${j.skippedReason ? `  skipped: ${j.skippedReason}` : ''}`);
    return;
  }

  if (cmd === 'tick') {
    const only: LabJobId[] = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--only') {
        const id = LabJobIdSchema.safeParse(rest[++i]);
        if (!id.success) {
          console.error(`Unknown job: ${rest[i]}`);
          process.exit(1);
        }
        only.push(id.data);
      }
    }
    const batchAt = rest.indexOf('--batch');
    const ctx = resolveLab();
    if (ctx.readOnly) throw new Error('sample world is read-only');
    if (ctx.flags.dryLabel) console.log(ctx.flags.dryLabel);
    await runMigrateV2(ctx.store, { onlyOnce: true });
    const res = await runTick(ctx.store, { dry: Boolean(ctx.flags.dry), only, force, manual: rest.includes('--manual'), override: rest.includes('--override'), batchId: batchAt >= 0 ? rest[batchAt + 1] ?? null : null });
    if (res.paused) return console.log(`Paused by ${res.paused}: nothing read, nothing spent.`);
    if (res.locked) return console.log('tick already running');
    for (const [id, r] of Object.entries(res.ran)) console.log(`${r!.ok ? 'ok  ' : 'fail'} ${id}: ${r!.detail}`);
    for (const [id, why] of Object.entries(res.skipped)) console.log(`skip ${id}: ${why}`);
    if (!Object.keys(res.ran).length && !Object.keys(res.skipped).length) console.log('Nothing due.');
    return;
  }

  if (cmd === 'migrate-v2') {
    const { store } = resolveLab();
    const r = await runMigrateV2(store, { onlyOnce: false });
    console.log(r.detail);
    return;
  }

  if (cmd === 'mark-scheduled') {
    const { store } = resolveLab();
    markScheduled(store, new Date());
    console.log(`Recorded: ${scheduleLabel()}`);
    return;
  }

  if (cmd === 'plan') {
    const { store } = resolveLab();
    const plan = describePlan(planScrape(store, new Date(), { force }));
    if (!resolveLab().readOnly) markPlanPreviewed(store);
    console.log(plan.length ? plan.map((p) => `${p.kind} ${p.actor} · ${p.handles.length} handle(s) · limit ${p.limit} · ≤ ${p.maxItems} items`).join('\n') : 'Nothing due.');
    return;
  }

  // 05: the Radar. Free sources need no key; paid sources stay gated (scheduled: false, never override).
  if (cmd === 'radar-backtest') {
    const r = backtestSeed();
    console.log(`Class rule on the seed events: ${r.correct} of ${r.n}${r.misses.length ? ` (missed: ${r.misses.join(', ')})` : ''}`);
    return;
  }
  if (cmd === 'radar' || cmd === 'brief') {
    const by = pausedBy(automationDirs(), fs.existsSync, 'radar');
    if (by) return console.log(`Paused by ${by}: nothing read, nothing spent.`);
    const ctx = resolveLab();
    if (ctx.readOnly) throw new Error('sample world is read-only');
    if (ctx.flags.dryLabel) console.log(ctx.flags.dryLabel);
    if (cmd === 'brief') {
      const r = await runBrief(radarCtx(ctx.store, { now: new Date() }));
      return console.log(`Morning brief: ${r.items} items; ${r.sent ? 'sent to the Wizard' : `not sent (${r.reason})`}`);
    }
    const r = await runRadarNow(ctx.store, { now: new Date(), paused: null });
    console.log(`Radar: ran ${r.ran.join(', ') || 'nothing'}; events ${r.events.created} created, ${r.events.confirmed} confirmed`);
    for (const s of r.skipped) console.log(`  skipped ${s.source}: ${s.reason}`);
    for (const e of r.errors) console.log(`  error ${e.source}: ${e.error}`);
    return;
  }

  // 06 7.6: grade, fit, backtest, evals and the planner now; free (no Apify), dry under LAB_DRY=1, Filming or --dry
  if (cmd === 'ledger') {
    guardPaused();
    const ctx = resolveLab();
    const dry = Boolean(ctx.flags.dry) || rest.includes('--dry');
    const { runs } = await runLedgerCycle(ctx.store, { now: new Date(), dry });
    for (const r of runs) console.log(`${r.kind} ${r.status} · ${r.items ?? 0} item(s)${r.error ? ` · ${r.error}` : ''}`);
    process.exit(runs.some((r) => r.error) ? 1 : 0);
  }

  if (!['sync', 'advance', 'analyse', 'discover', 'intel', 'snapshots', 'verify-actors', 'verdicts'].includes(cmd ?? '')) {
    console.error('Usage: npm run lab-sync -- <tick [--only <job>]... [--force] [--manual] [--batch <id>] | jobs | migrate-v2 | sync [--force] | plan | advance | analyse | discover | intel | snapshots | verify-actors [--override] | verdicts | radar | brief | radar-backtest | ledger [--dry] | mark-scheduled | status>');
    process.exit(1);
  }

  guardPaused();
  const c = context();
  if (c.label) console.log(c.label);

  if (cmd === 'advance') {
    if (!c.client) return console.log('Dry: nothing to advance.');
    const r = await advanceRuns(c.store, c.client);
    console.log(`Checked ${r.checked} · finished ${r.finished} · failed ${r.failed} · ${r.items} items`);
    return;
  }
  if (cmd === 'analyse') return runAnalyse(c, true);
  if (cmd === 'snapshots') {
    const r = await snapshotsJob({ store: c.store, now: new Date(), scheduled: true, dry: c.dry, client: c.client });
    console.log(r.detail);
    return;
  }
  if (cmd === 'verdicts') {
    const r = await verdictsJob({ store: c.store, now: new Date(), scheduled: true, dry: c.dry });
    console.log(r.detail);
    return;
  }
  if (cmd === 'verify-actors') {
    try {
      const runs = await startActorVerification(c.store, c.client, { override: rest.includes('--override') });
      console.log(`Started ${runs.length} verify run(s)${c.dry ? ' (dry: reports filed from fixtures)' : '; advance files each report when it finishes'}.`);
      for (const [actor, r] of Object.entries(actorReports(c.store))) console.log(`  ${actor}: ${r.status}${r.missingRequired.length ? ` (missing ${r.missingRequired.join(', ')})` : ''}`);
    } catch (err) {
      if (!(err instanceof CapError)) throw err;
      console.log(`Blocked by the apify.verify cap: ${err.message}`);
    }
    return;
  }
  if (cmd === 'intel') return runIntel(c);
  if (cmd === 'discover') {
    const d = await discover({ store: c.store, client: c.client, scheduled: true });
    console.log(d.terms.length ? `Searched ${d.groups.length} platform(s) for ${d.terms.join(', ')}` : 'Nothing to search for yet: dissect your own posts first.');
    return;
  }

  // sync: scrape → wait → analyse → discovery (its terms come from the fresh dissections) → wait
  const now = new Date();
  let blocked = false;
  try {
    if (c.client) await advanceRuns(c.store, c.client, { now });
    const s = await scrape({ store: c.store, client: c.client, now, scheduled: true, force });
    console.log(s.runs.length ? `Started ${s.runs.length} run(s): ${s.runs.map((r) => `${r.run.actor} ${r.run.status}${r.ingest ? ` (${r.ingest.posts} posts)` : ''}`).join(', ')}` : 'Nothing due.');
    await waitForRuns(c);
  } catch (err) {
    if (!(err instanceof CapError)) throw err;
    blocked = true;
    console.log(`Blocked by the monthly cap: ${err.message}`);
  }
  await runAnalyse(c, true);
  if (!blocked && discoveryDue(c.store, now)) {
    try {
      const d = await discover({ store: c.store, client: c.client, now, scheduled: true });
      console.log(d.runs.length ? `Discovery: ${d.runs.length} search run(s) for ${d.terms.join(', ')}` : 'Discovery: nothing to search for yet');
      await waitForRuns(c);
    } catch (err) {
      if (!(err instanceof CapError)) throw err;
      console.log(`Discovery blocked by the monthly cap: ${err.message}`);
    }
  }
  // intelligence half (lab/intel): profiles, DNA, clusters, feeds, trends, ideas, priors, G-Brain docs
  await runIntel(c);
  touchSchedule(c.store, new Date());
}

async function runIntel(c: ReturnType<typeof context>) {
  const r = await runLabIntel(c.store, { scheduled: true });
  console.log(`Intel: ${r.summary}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
