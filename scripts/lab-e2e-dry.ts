/**
 * The dry end-to-end run (v2 spec 08.12.5): `npm run lab-e2e`. Thirteen steps over a fresh temp
 * install in LAB_DRY=1 with a spy on every fetch. Exits non-zero at the first failed assertion and
 * prints the step. Zero network: the spy must record no call and no DryNetworkError may surface.
 *
 * Every lane is merged, so every step runs real code.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-e2e-'));
process.env.LAB_DRY = '1';
process.env.GLADOS_DATA_DIR = path.join(T, 'data');
process.env.GLADOS_DB = path.join(T, 'data', 'glados.db');
process.env.GBRAIN_STORE = path.join(T, 'real-brain');
process.env.GLADOS_ENV_LOCAL = path.join(T, '.env.local');
process.env.GLADOS_AUTOMATION_DIR = path.join(T, 'automation');
process.env.GLADOS_MODE_FILE = path.join(T, '.glados-mode');
process.env.DEMO_MODE = '0';
fs.mkdirSync(path.join(T, 'data'), { recursive: true });
fs.mkdirSync(path.join(T, 'automation'), { recursive: true });
fs.writeFileSync(process.env.GLADOS_ENV_LOCAL, '');

const calls: string[] = [];
const spy = async (u: unknown) => {
  calls.push(String(u));
  return new Response('{}', { status: 599 });
};
(globalThis as { fetch: unknown }).fetch = spy;

let step = 0;
const fail = (msg: string): never => {
  console.error(`FAIL step ${step}: ${msg}`);
  process.exit(1);
};
const check = (cond: unknown, msg: string) => {
  if (!cond) fail(msg);
};
const post = (url: string, body: unknown) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function run(name: string, fn: () => Promise<void>) {
  step++;
  try {
    await fn();
    console.log(`ok   ${String(step).padStart(2)} ${name}`);
  } catch (err) {
    fail(`${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  const { setLabFetchImpl } = await import('../lib/lab/net');
  setLabFetchImpl(spy as never);
  const { getDb } = await import('../lib/data');
  const { setupView } = await import('../lib/lab/setup/view');
  const { runTick } = await import('../lib/lab/setup/jobs');
  const { LAB_JOB_IDS, LAB_SPEND_LINES, LabRunKindSchema, providerOf } = await import('../lib/schemas');
  const { seedSevenDayReads, seedFixtureRadar, eventRowCounts, seedPublishedPost } = await import('./lab-e2e-fixture');
  const { TARGET_AGES_H } = await import('../lib/lab/measure/age');
  const lab = () => getDb().lab;
  const now = new Date();

  await run('Open a fresh DB: checklist all skipped, key rows dry', async () => {
    const v = setupView(lab(), { dry: true, dryLabel: 'LAB_DRY=1 · fixtures, no charges', now });
    check(v.checklist.steps.every((s) => s.state === 'skipped'), 'a checklist step is not skipped');
    check(v.keys.every((k) => k.state === 'dry'), 'a key row is not dry');
  });

  await run('Add 1 owned, 5 tracked and 3 watch accounts through the API', async () => {
    const { POST } = await import('../app/api/lab/sources/route');
    const add = async (b: unknown) => check((await POST(post('http://localhost/api/lab/sources', b))).status === 200, `POST sources ${JSON.stringify(b)}`);
    await add({ kind: 'owned', handle: 'example.studio', platform: 'instagram' });
    for (let k = 1; k <= 5; k++) await add({ kind: 'tracked', handle: `sample.creator${k}`, platform: k % 2 ? 'tiktok' : 'instagram' });
    for (const h of ['sample_lab_a', 'sample_lab_b', 'sample_lab_c']) await add({ kind: 'watch', handle: h, platform: 'x' });
    check(lab().sources.all('owned').length === 1 && lab().sources.all('tracked').length === 5 && lab().sources.all('watch').length === 3, 'source counts');
  });

  await run('Preview the plan: checklist:plan_previewed is set', async () => {
    const { GET } = await import('../app/api/lab/run/route');
    const res = await GET(new Request('http://localhost/api/lab/run?plan=1'));
    check(res.status === 200, `GET run?plan=1 answered ${res.status}`);
    check(lab().priors.get('checklist:plan_previewed'), 'no plan_previewed prior');
  });

  let tick: Awaited<ReturnType<typeof runTick>> | null = null;
  await run('tick --force: every job recorded; the free and dry jobs ok (ledger.early on the next tick); frames and comments skipped by their flags; oauth skipped, retention on fixtures', async () => {
    tick = await runTick(lab(), { dry: true, force: true, now: new Date(), lockFile: null });
    for (const id of LAB_JOB_IDS) check(lab().priors.get(`job:${id}`), `no job:${id} state`);
    const must = ['advance', 'measure.verdicts', 'radar.vendor', 'radar.hn', 'radar.hf_models', 'radar.hf_spaces', 'radar.github', 'radar.wikipedia', 'radar.events', 'brief', 'snapshots', 'sync', 'analyse', 'gen.embed', 'intel', 'ledger'] as const;
    for (const id of must) check(tick.ran[id]?.ok, `${id}: ${tick.ran[id]?.detail ?? tick.skipped[id] ?? 'did not run'}`);
    check(/LAB_FRAMES/.test(tick.skipped['gen.frames'] ?? ''), `gen.frames: ${tick.skipped['gen.frames'] ?? 'ran'}`);
    check(/LAB_COMMENTS/.test(tick.skipped['gen.comments'] ?? ''), `gen.comments: ${tick.skipped['gen.comments'] ?? 'ran'}`);
    // ledger.early (08.5 row 16) runs before sync and needs an owned post under 30 h, so on a fresh store the
    // first tick skips it with that reason. The next tick (sync has run) must run it ok. Ruling: BUILD-REPORT 6.
    check(/under 30 hours/.test(tick.skipped['ledger.early'] ?? ''), `ledger.early on the first tick: ${tick.ran['ledger.early']?.detail ?? tick.skipped['ledger.early'] ?? 'no state'}`);
    const second = await runTick(lab(), { dry: true, force: true, only: ['ledger.early'], now: new Date(), lockFile: null });
    check(second.ran['ledger.early']?.ok, `ledger.early on the next tick: ${second.ran['ledger.early']?.detail ?? second.skipped['ledger.early'] ?? 'did not run'}`);
    // the ledger's oauth_refresh step is recorded as skipped (no OAuth, and dry)
    const ledgerRuns = lab().runs.recent(500);
    const oauth = ledgerRuns.filter((r) => r.kind === 'oauth_refresh');
    check(oauth.length > 0 && oauth.every((r) => (r.input as { skipped?: unknown } | null)?.skipped), 'the ledger did not record oauth_refresh as skipped');
    // retention: 06 (retention section and its dry AC) says dry writes fixture rows instead of calling Google or Meta, so the
    // step runs on fixtures rather than skipping (conflict with 08.12.5 step 4, BUILD-REPORT 6). Check that.
    const retention = ledgerRuns.filter((r) => r.kind === 'retention');
    check(retention.length === 2 && retention.every((r) => r.dry && !r.error), 'the ledger did not record a dry retention step per provider');
    check(lab().retention.all().every((x) => x.source === 'fixture'), 'a retention row that is not a fixture');
  });

  await run('Measures: owned posts carry age-matched ratios; breakouts exist', async () => {
    // Fixture (test layer, BUILD-REPORT 6): the one-shot dry sync read every post once, today, so
    // old posts have no read near 7 days and 04 3.1 cannot judge them. Add the 7-day read the dry
    // curve gives each such post, then let the real measure job judge it.
    const seeded = seedSevenDayReads(lab(), now);
    check(seeded.added > 0, 'the fixture added no 7-day read');
    const t = await runTick(lab(), { dry: true, force: true, only: ['measure.verdicts'], now, lockFile: null });
    check(t.ran['measure.verdicts']?.ok, `measure.verdicts: ${t.ran['measure.verdicts']?.detail ?? t.skipped['measure.verdicts'] ?? 'did not run'}`);
    const owned = new Set(lab().sources.all('owned').map((s) => s.id));
    const ms = lab().measures.all();
    // 04's age-matched read: a ratio against the account's normal at a judged age (24 h, 72 h or 7 d), kept per age in `ages`
    const ageMatched = (m: (typeof ms)[number]) => Object.values(m.ages ?? {}).some((r) => r.ratio !== null && r.ratio !== undefined);
    check(ms.some((m) => owned.has(lab().posts.get(m.postId)?.sourceId ?? '') && ageMatched(m)), 'no age-matched ratio on an owned post');
    const judged7d = ms.filter((m) => m.judgedAgeH === 168 && m.breakout !== null);
    check(judged7d.length > 0, 'no post judged at 7 days');
    check(ms.some((m) => m.isBreakout), 'no breakout');
  });

  await run('Radar: the dry run wrote no lab_event*; the fixture world has an event with pings from two or more sources', async () => {
    // AC-05-3 / 05 18: dry radar jobs return fixtures without writing. Check the tick above kept that.
    const afterDry = eventRowCounts(lab());
    check(afterDry.events === 0 && afterDry.pings === 0 && afterDry.coverage === 0, `the dry run wrote lab_event* rows: ${JSON.stringify(afterDry)}`);
    // Fixture (test layer): the fixture world's launches E1 to E8, as Filming persists them (05 18).
    const seeded = seedFixtureRadar(lab(), now);
    check(seeded.events > 0, 'the fixture seeded no event');
    const ev = lab().events.all().find((e) => new Set(lab().eventPings.forEvent(e.id).map((p) => p.source)).size >= 2);
    check(ev, 'no event with pings from 2 sources');
    // and the Radar read model (05 18: dry shows fixture launches) lists it
    const { radarView } = await import('../lib/lab/radar/view');
    check(radarView(lab(), now, { dry: true, sample: false }).events.some((r) => r.id === ev!.id), `radarView does not list ${ev!.id}`);
  });

  const ids = { post: '', event: '', idea: '', script: '', test: '', prediction: '' };
  await run('Studio: generate ideas, write a script, run the gate, freeze a prediction', async () => {
    check(lab().clusters.all().length > 0, 'no clusters to generate from');
    const ideas = await import('../app/api/lab/ideas/route');
    const res = await ideas.POST(post('http://localhost/api/lab/ideas', { action: 'generate' }));
    check(res.status === 200 || res.status === 201, `generate answered ${res.status}`);
    const open = lab().ideas.all('open');
    check(open.length > 0, 'no ideas');
    ids.idea = open[0].id;

    // write a script (07 7.8 generate: draft, then the gate runs on it)
    const scripts = await import('../app/api/lab/scripts/route');
    const sres = await scripts.POST(post('http://localhost/api/lab/scripts', { action: 'generate', ideaId: ids.idea }));
    const sbody = (await sres.json()) as { ok: boolean; scriptId?: string; version?: number; gatePassed?: boolean; error?: string };
    check(sres.status === 200 && sbody.ok && sbody.scriptId, `script generate answered ${sres.status}: ${sbody.error ?? ''}`);
    ids.script = sbody.scriptId!;
    const v = lab().scripts.latestVersion(ids.script);
    check(v && v.version === sbody.version, 'no stored script version');
    check(v!.body.sections?.length ?? Object.keys(v!.body).length, 'the script body is empty');

    // the gate ran: its checks are stored on the version and `passed` matches them (07 7.6)
    check(v!.gate.checks.length > 0, 'the gate stored no checks');
    const rulesOk = (v!.gate.rules ?? []).every((r) => r.severity !== 'block' || r.ok);
    check(v!.gate.passed === (v!.gate.checks.every((c) => c.ok) && rulesOk), 'gate.passed does not match its checks');
    check(sbody.gatePassed === v!.gate.passed, 'the route and the store disagree on the gate');

    // freeze a prediction (06 2.7) through the only write route, with a hypothesis (06 10.5 self-experiment)
    const preds = await import('../app/api/lab/predictions/route');
    const fres = await preds.POST(post('http://localhost/api/lab/predictions', { action: 'freeze', scriptId: ids.script, version: v!.version, band: 'above', hypothesis: 'A launch angle beats my normal' }));
    const fbody = (await fres.json()) as { ok: boolean; predictionId?: string; error?: string };
    check(fres.status === 201 && fbody.ok && fbody.predictionId, `freeze answered ${fres.status}: ${fbody.error ?? ''}`);
    ids.prediction = fbody.predictionId!;
    const row = lab().predictions.get(fbody.predictionId!);
    check(row && row.status === 'frozen' && row.predictor === 'brody' && row.scriptId === ids.script && row.scriptVersion === v!.version && row.payloadSha256, 'the frozen row is wrong');
    check(row!.dry, 'the frozen row is not marked dry');
    const again = await preds.POST(post('http://localhost/api/lab/predictions', { action: 'freeze', scriptId: ids.script, version: v!.version, band: 'normal' }));
    check(again.status === 409, `a second freeze answered ${again.status}, not 409`);
    const test = lab().tests.all().find((t) => t.scriptId === ids.script);
    check(test, 'the hypothesis made no self-experiment test');
    ids.test = test!.id;
  });

  // Ruling (BUILD-REPORT 6, provisional): 06 4.2 / AC-06-9 win over 08.12.5's "7 days". A grade is not due before
  // 180 h and a nearest read not before 210 h, so the clock advances 9 days (216 h after the freeze).
  await run('Mark published, advance the clock 9 days, tick --only ledger: the prediction is graded', async () => {
    const frozenAt = Date.parse(lab().predictions.get(ids.prediction)!.frozenAt);
    const postedAt = new Date(Math.max(Date.now(), frozenAt) + 3_600_000);
    // Fixture: the post goes up an hour after the freeze; the dry sync cannot discover new posts
    const postId = seedPublishedPost(lab(), postedAt);
    const scripts = await import('../app/api/lab/scripts/route');
    const mres = await scripts.POST(post('http://localhost/api/lab/scripts', { action: 'mark_published', id: ids.script, postId }));
    const mbody = (await mres.json()) as { ok: boolean; noPrediction?: boolean; error?: string };
    check(mres.status === 200 && mbody.ok, `mark_published answered ${mres.status}: ${mbody.error ?? ''}`);
    check(mbody.noPrediction === false, 'mark_published says the script has no live prediction');
    check(lab().scripts.get(ids.script)?.publishedPostId === postId, 'the script is not linked to the post');
    const linked = lab().predictions.get(ids.prediction)!;
    check(linked.postId === postId && !linked.late, `the prediction is not linked on time (postId ${linked.postId}, late ${linked.late})`);

    // the real dry snapshots job takes the post's reads at each target age up to 7 days
    for (const h of TARGET_AGES_H.filter((a) => a <= 168)) {
      const t = await runTick(lab(), { dry: true, force: true, only: ['snapshots'], now: new Date(postedAt.getTime() + h * 3_600_000 + 60_000), lockFile: null });
      check(t.ran.snapshots?.ok, `snapshots at ${h} h: ${t.ran.snapshots?.detail ?? t.skipped.snapshots}`);
    }
    check(lab().metrics.forPost(postId).some((m) => Math.abs((m.ageH ?? 0) - 168) <= 1), 'no 7-day read on the published post');

    const later = new Date(frozenAt + 9 * 86_400_000);
    const t = await runTick(lab(), { dry: true, force: true, only: ['ledger'], now: later, lockFile: null });
    check(t.ran.ledger?.ok, `ledger: ${t.ran.ledger?.detail}`);
    const graded = lab().predictions.get(ids.prediction)!;
    check(graded.status === 'graded', `the prediction is ${graded.status}, not graded`);
    check(graded.outcomeViews7d !== null && graded.gradedAt !== null, 'the graded row has no 7-day outcome');
    check(lab().runs.recent(5000).some((r) => r.kind === 'grade' && (r.input as { graded?: number } | null)?.graded), 'no grade run that graded a row');
  });

  await run('Spend: every row dry, actual_source dry, a valid line; every run kind valid', async () => {
    const rows = lab().spend.all();
    check(rows.every((r) => r.dry && r.actualSource === 'dry'), 'a non-dry spend row');
    check(rows.every((r) => r.line && (LAB_SPEND_LINES as readonly string[]).includes(r.line) && providerOf(r.line) === r.provider), 'a bad line');
    check(rows.reduce((a, r) => a + (r.actualUsd ?? 0), 0) === 0, 'SUM(actual_usd) is not 0');
    check(lab().runs.recent(5000).every((r) => LabRunKindSchema.safeParse(r.kind).success), 'a run kind outside the 21');
  });

  await run('Network: the spy recorded no call', async () => {
    check(calls.length === 0, `fetch was called: ${calls.slice(0, 3).join(', ')}`);
    const details = Object.values(tick?.ran ?? {}).map((r) => r?.detail ?? '');
    check(!details.some((d) => /Dry run: no network call/.test(d)), 'a DryNetworkError surfaced');
  });

  await run('Brain: files under data/lab-dry-brain/lab/; the real brain was never created', async () => {
    const dir = path.join(T, 'data', 'lab-dry-brain', 'lab');
    check(fs.existsSync(dir) && fs.readdirSync(dir).length > 0, 'no dry brain files');
    check(!fs.existsSync(path.join(T, 'real-brain')), 'the real brain store exists');
  });

  await run('Pages: GET /api/lab?page= x6, /api/lab/sheet x7, /api/lab/setup answer 200', async () => {
    const page = await import('../app/api/lab/route');
    for (const p of ['today', 'radar', 'breakouts', 'playbook', 'studio', 'ledger']) {
      const res = await page.GET(new Request(`http://localhost/api/lab?page=${p}`));
      check(res.status === 200, `page ${p} answered ${res.status}`);
    }
    // the 7 sheet kinds, ids from this store (08.12.5 step 12); an unknown id would answer 200 with view null, so check view
    const sheet = await import('../app/api/lab/sheet/route');
    ids.post = lab().posts.all().find((p) => p.isOwned)?.id ?? '';
    ids.event = lab().events.all()[0]?.id ?? '';
    const kinds: [string, string][] = [['post', ids.post], ['event', ids.event], ['idea', ids.idea], ['script', ids.script], ['test', ids.test], ['setup', 'sources'], ['ask', 'breakouts this week']];
    for (const [kind, id] of kinds) {
      check(id, `no ${kind} id in this store`);
      const res = await sheet.GET(new Request(`http://localhost/api/lab/sheet?${kind}=${encodeURIComponent(id)}`));
      check(res.status === 200, `sheet ${kind} answered ${res.status}`);
      const b = (await res.json()) as { ok: boolean; sheet: { kind: string; view: unknown } | null };
      check(b.ok && b.sheet?.kind === kind, `sheet ${kind}: wrong payload kind ${b.sheet?.kind}`);
      check(b.sheet!.view !== null && b.sheet!.view !== undefined, `sheet ${kind} ${id}: view is null (not found)`);
    }
    const setup = await import('../app/api/lab/setup/route');
    check((await setup.GET(new Request('http://localhost/api/lab/setup'))).status === 200, 'setup');
  });

  await run('Kill switch: PAUSED-lab stops a forced tick before any job', async () => {
    fs.writeFileSync(path.join(T, 'automation', 'PAUSED-lab'), '');
    const t = await runTick(lab(), { dry: true, force: true, now: new Date(), lockFile: null });
    check(t.paused && Object.keys(t.ran).length === 0, 'a job ran while paused');
  });

  console.log(`lab-e2e: all 13 steps passed, 0 network calls (${T})`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
