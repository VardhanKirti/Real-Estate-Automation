#!/usr/bin/env node
/**
 * Navigation speed probe. Measures every primary nav route (lib/nav.ts) and
 * every Content Lab route against a running GladOS server.
 *
 *   node scripts/perf-nav.mjs --base http://127.0.0.1:4351 [--ui glados|classic|legacy]
 *        [--warm 3] [--cdp] [--only /lab] [--json out.json] [--label dev-before]
 *
 * Per route, over plain HTTP (no browser):
 *   cold     first full-document GET (in `next dev` this includes the compile)
 *   ttfb     median time to first byte of the document over --warm hits
 *   html     median time to the last byte of the document
 *   rsc      median time to the last byte of the RSC payload a client-side
 *            <Link> navigation fetches (header RSC: 1). With a loading.tsx the
 *            first bytes arrive early and this is the time to the full page.
 *
 * With --cdp it also drives headless Chrome (/Applications/Google Chrome.app)
 * and clicks the real sidebar links and Lab tabs, each twice (a first pass and
 * a warm pass), recording the two metrics of founderos-ui SPEC 4.1:
 *   first    click to first VISIBLE change: the nav progress bar or the route
 *            skeleton reaching opacity > 0 (both are invisible for their first
 *            80/120 ms by design), or the main column changing with no hidden
 *            skeleton in it (the new page itself)
 *   settled  click to settled content: the URL matches and nothing in main is
 *            aria-busy (no skeleton, no Suspense fallback left)
 * and a summary per pass: p50, p95 and max of both, checked against the spec
 * targets (first <= 100 ms everywhere; settled p95 <= 300 ms, none over 500 ms).
 * Every non-GET request to /api is aborted in the browser, so a walk can never
 * write or spend.
 *
 * With --sidebar it skips the timing passes and runs the sidebar respect walk
 * instead (FounderOS UI SPEC 4.2): --sidebar-w must not change across a full
 * sidebar walk at 232, 320 and the rail, nor on first paint of a workspace
 * route. See the block above sidebarWalk().
 *
 * Reads nothing but the server's responses; never writes app data except
 * what a page GET itself does.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const BASE = String(opt('base', 'http://127.0.0.1:4351')).replace(/\/$/, '');
const UI = String(opt('ui', 'glados'));
const WARM = Number(opt('warm', 3));
const CDP = Boolean(opt('cdp', false));
const ONLY = opt('only', null);
const JSON_OUT = opt('json', null);
const LABEL = String(opt('label', ''));

// The appearance cookie picks the UI tree (lib/appearance.ts): glados.* = GladOS, classic.* = Classic, legacy.* = Bennett Legacy.
const COOKIE = `glados-appearance=${UI === 'classic' ? 'classic.ice.dark' : UI === 'legacy' ? 'legacy.mono.dark' : 'glados.ice.dark'}`;

function navRoutes() {
  const src = readFileSync(path.join(process.cwd(), 'lib/nav.ts'), 'utf8');
  const hrefs = [...src.matchAll(/href:\s*'([^']+)'/g)].map((m) => m[1]);
  // ENGINE_HREF is an identifier in nav.ts, not a literal.
  if (/href:\s*ENGINE_HREF/.test(src)) hrefs.push('/creative-engine');
  return [...new Set(hrefs)];
}

const LAB = ['/lab', '/lab/radar', '/lab/breakouts', '/lab/playbook', '/lab/studio', '/lab/ledger', '/lab/creatorverse'];
const LAB_ROUTES = [
  ...LAB,
  ...LAB.map((r) => `${r}?sample=1`),
  '/lab?sample=1&setup=sources',
  '/lab/studio?sample=1&ask=what%20hooks%20work',
];

let routes = [...navRoutes().filter((r) => r !== '/lab'), ...LAB_ROUTES];
if (ONLY) routes = routes.filter((r) => r.startsWith(String(ONLY)));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};

async function timed(url, headers = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { cookie: COOKIE, ...headers }, redirect: 'manual' });
  const reader = res.body?.getReader();
  let ttfb = null;
  let bytes = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (ttfb === null) ttfb = performance.now() - t0;
      if (done) break;
      bytes += value.length;
    }
  }
  const total = performance.now() - t0;
  return { status: res.status, ttfb: ttfb ?? total, total, bytes };
}

// Minimal router state for a client navigation from "/" (what the Link sends).
const TREE = encodeURIComponent(JSON.stringify(['', { children: ['__PAGE__', {}] }, null, null, true]));

async function httpPass() {
  const rows = [];
  for (const r of routes) {
    const url = BASE + r;
    const cold = await timed(url);
    const docs = [];
    const rscs = [];
    for (let i = 0; i < WARM; i++) docs.push(await timed(url));
    for (let i = 0; i < WARM; i++) rscs.push(await timed(url, { RSC: '1', 'Next-Router-State-Tree': TREE }));
    const row = {
      route: r,
      status: cold.status,
      cold: cold.total,
      ttfb: median(docs.map((d) => d.ttfb)),
      html: median(docs.map((d) => d.total)),
      rscTtfb: median(rscs.map((d) => d.ttfb)),
      rsc: median(rscs.map((d) => d.total)),
      kb: Math.round(median(docs.map((d) => d.bytes)) / 1024),
    };
    rows.push(row);
    process.stderr.write(`. ${r} ${row.ttfb.toFixed(0)}ms\n`);
  }
  return rows;
}

/* ── Chrome DevTools Protocol (no dependency: Node's global WebSocket) ── */

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function startChrome() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'perf-nav-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch {}
  }
  if (!target) throw new Error('chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) for (const l of listeners) l(msg);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const close = () => {
    try { ws.close(); } catch {}
    proc.kill('SIGKILL');
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  };
  return { send, listeners, close };
}

async function evaluate(c, expression) {
  const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value;
}

async function load(c, url) {
  const t0 = performance.now();
  await c.send('Page.navigate', { url });
  // wait for load
  for (let i = 0; i < 300; i++) {
    const s = await evaluate(c, 'document.readyState');
    if (s === 'complete') break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return performance.now() - t0;
}

// Click the in-app link to `to` and time first visible change and settled content (see header).
const CLICK = (to) => `new Promise((resolve) => {
  const want = ${JSON.stringify(to)};
  const a = [...document.querySelectorAll('a[href]')].find((x) => x.getAttribute('href') === want);
  if (!a) return resolve({ missing: true });
  const main = document.querySelector('main') || document.body;
  const shown = (el) => !!el && Number(getComputedStyle(el).opacity) > 0;
  const t0 = performance.now();
  let mutated = false;
  let feedback = null;
  const mo = new MutationObserver(() => { mutated = true; });
  mo.observe(main, { childList: true, subtree: true });
  a.click();
  const here = () => location.pathname + location.search;
  const tick = () => {
    const now = performance.now() - t0;
    if (feedback === null) {
      const skel = main.querySelector('.route-skel');
      if (shown(document.querySelector('.nav-progress')) || shown(skel) || (mutated && !skel)) feedback = now;
    }
    // a control's own busy state (the Lab's Running pill during a live run) is state, not loading
    const busy = main.querySelector('[aria-busy="true"]:not(button)');
    if (here() === want && !busy) {
      mo.disconnect();
      return resolve({ feedback: feedback ?? now, done: now });
    }
    if (now > 30000) { mo.disconnect(); return resolve({ feedback, done: null, timeout: true }); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})`;

const aborted = [];

async function cdpPass() {
  const c = await startChrome();
  const out = {};
  try {
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Network.enable');
    // Abort every non-GET /api request: a measurement walk never writes or spends.
    await c.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
    c.listeners.push((msg) => {
      if (msg.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = msg.params;
      if (request.method === 'GET' || request.method === 'HEAD') c.send('Fetch.continueRequest', { requestId });
      else {
        aborted.push(`${request.method} ${new URL(request.url).pathname}`);
        c.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
      }
    });
    await c.send('Network.setCookie', { name: 'glados-appearance', value: COOKIE.split('=')[1], url: BASE });
    const nav = routes.filter((r) => !r.startsWith('/lab'));
    const lab = routes.filter((r) => LAB.includes(r));
    // Sidebar walk: every nav link from the page before it, twice (second = warm).
    for (const pass of ['first', 'warm']) {
      out[pass] = {};
      out[pass]['/ (full load)'] = { done: await load(c, BASE + '/') };
      for (const r of [...nav, '/lab']) {
        await new Promise((res) => setTimeout(res, 400)); // let viewport prefetch settle, as a person would
        const m = await evaluate(c, CLICK(r));
        if (m?.missing) {
          const t = await load(c, BASE + r);
          out[pass][r] = { done: t, note: 'no link, full load' };
        } else out[pass][r] = m;
      }
      // Lab tabs, clicked from within the Lab.
      for (const r of lab.filter((x) => x !== '/lab').concat('/lab')) {
        await new Promise((res) => setTimeout(res, 400));
        const m = await evaluate(c, CLICK(r));
        out[pass][`tab ${r}`] = m?.missing ? { missing: true } : m;
      }
      process.stderr.write(`cdp ${pass} done\n`);
    }
  } finally {
    c.close();
  }
  return out;
}

const fmt = (n) => (n === null || n === undefined || Number.isNaN(n) ? '-' : Math.round(n).toString());

/* ── Sidebar respect walk (FounderOS UI SPEC 4.2, fix b; SB-1 to SB-3) ──
 *
 *   node scripts/perf-nav.mjs --base http://127.0.0.1:4381 --sidebar [--ui glados|classic] [--settle 2500]
 *
 * Skips the timing passes. For each stored width (232, 320, the rail, and a
 * v1 value from before the fix) it records, from the first byte of every
 * document, each value of --sidebar-w on <html> and the sidebar's painted
 * width on every animation frame, then:
 *   first paint  full-loads each workspace route (/workflows, /wizard,
 *                /blueprint, /inbox) and Home: the sidebar is painted at the
 *                stored width from its first frame and never moves (SB-3)
 *   walk         clicks every sidebar link in turn: --sidebar-w and the
 *                painted width never change (SB-1)
 *   toggle       toggles on /inbox, then walks: the rail holds on every page
 *                and is what is stored (SB-2)
 *   viewport     320 stored at 1000 and 700 px windows: 232 and the rail on
 *                workspace and normal routes alike (SB-4, O9)
 * Exits 1 on any failure. Window 1440 x 900 unless stated.
 */
const SIDEBAR_WALK = Boolean(opt('sidebar', false));
const SETTLE = Number(opt('settle', 2500));
const WORKSPACES = ['/workflows', '/wizard', '/blueprint', '/inbox'];

const SB_RECORDER = `(() => {
  const log = (window.__sbVar = []);
  const paint = (window.__sbPaint = []);
  const push = (arr, v) => { const last = arr[arr.length - 1]; if (v && (!last || last.v !== v)) arr.push({ v, path: location.pathname, t: Math.round(performance.now()) }); };
  const rec = () => { const d = document.documentElement; if (d) push(log, d.style.getPropertyValue('--sidebar-w').trim()); };
  // <html> may not exist yet when this runs: watch the document for the root's attributes
  new MutationObserver((ms) => { if (ms.some((m) => m.target === document.documentElement)) rec(); }).observe(document, { attributes: true, subtree: true, childList: true, attributeFilter: ['style', 'data-sidebar'] });
  const frame = () => {
    rec();
    const a = document.getElementById('os-sidebar');
    if (a) push(paint, Math.round(a.getBoundingClientRect().width) + 'px');
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sidebarWalk() {
  const c = await startChrome();
  const failures = [];
  const report = [];
  const check = (state, what, ok, detail) => {
    report.push({ state, what, ok, detail });
    if (!ok) failures.push(`${state} ${what}: ${detail}`);
  };
  const distinct = (arr) => [...new Set((arr ?? []).map((x) => x.v))];
  try {
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Network.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await c.send('Network.setCookie', { name: 'glados-appearance', value: COOKIE.split('=')[1], url: BASE });
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: SB_RECORDER });
    const nav = routes.filter((r) => !r.startsWith('/lab') || r === '/lab').filter((r) => !r.includes('?'));
    if (!nav.includes('/lab')) nav.push('/lab');
    const states = [
      { label: '232', stored: { v: 2, w: 232, lastFull: 232 }, want: '232px' },
      { label: '320', stored: { v: 2, w: 320, lastFull: 320 }, want: '320px' },
      { label: 'rail', stored: { v: 2, w: 64, lastFull: 232 }, want: '64px' },
      { label: 'v1 default (pre-fix store)', stored: { v: 1, w: 232, canvasW: 64, lastFull: 232 }, want: '232px' },
    ];
    const setStored = async (s) => {
      await load(c, BASE + '/');
      await evaluate(c, `localStorage.setItem('glados-sidebar', ${JSON.stringify(JSON.stringify(s))}), true`);
    };
    for (const st of states) {
      await setStored(st.stored);
      // first paint on every workspace route, plus Home for comparison
      for (const r of [...WORKSPACES, '/']) {
        await load(c, BASE + r);
        await sleep(SETTLE); // hydration and the Sidebar's first effect
        const v = await evaluate(c, 'window.__sbVar');
        const p = await evaluate(c, 'window.__sbPaint');
        const dv = distinct(v);
        const dp = distinct(p);
        check(st.label, `first paint ${r}`, dv.length === 1 && dv[0] === st.want && dp.length === 1 && dp[0] === st.want, `--sidebar-w ${dv.join(' → ') || 'none'} · painted ${dp.join(' → ') || 'none'}`);
      }
      // click walk across the whole sidebar (one document, client navigations)
      await load(c, BASE + '/');
      await sleep(SETTLE);
      const visited = [];
      for (const r of nav) {
        await sleep(300);
        const m = await evaluate(c, CLICK(r));
        if (m?.missing) continue;
        visited.push(r + (m?.timeout ? ' (timeout)' : ''));
      }
      await sleep(500);
      const v = await evaluate(c, 'window.__sbVar');
      const p = await evaluate(c, 'window.__sbPaint');
      const dv = distinct(v);
      const dp = distinct(p);
      const moved = (p ?? []).slice(1).map((x) => `${x.v} on ${x.path}`);
      check(st.label, `walk (${visited.length} links)`, dv.length === 1 && dv[0] === st.want && dp.length === 1 && dp[0] === st.want, `--sidebar-w ${dv.join(' → ')} · painted ${dp.join(' → ')}${moved.length ? ' · moved: ' + moved.slice(0, 12).join(', ') + (moved.length > 12 ? ` (+${moved.length - 12} more)` : '') : ''}`);
      report[report.length - 1].visited = visited;
    }
    // SB-4: the viewport rules (O9) are unchanged and the same on workspace and normal routes
    await setStored({ v: 2, w: 320, lastFull: 320 });
    for (const [vw, want] of [[1000, '232px'], [700, '64px']]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: vw, height: 900, deviceScaleFactor: 1, mobile: false });
      for (const r of ['/inbox', '/funnel', '/wizard', '/']) {
        await load(c, BASE + r);
        await sleep(SETTLE);
        const dv = distinct(await evaluate(c, 'window.__sbVar'));
        check(`320 stored, ${vw}px window`, `viewport ${r}`, dv.length === 1 && dv[0] === want, `--sidebar-w ${dv.join(' → ')} (want ${want})`);
      }
    }
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    // SB-2: a toggle on a workspace page holds everywhere and is what is stored
    await setStored({ v: 2, w: 232, lastFull: 232 });
    await load(c, BASE + '/inbox');
    await sleep(SETTLE);
    await evaluate(c, `window.dispatchEvent(new Event('sidebar:toggle')), true`);
    await sleep(600);
    await evaluate(c, `window.__sbVar.length = 0, window.__sbPaint.length = 0, true`);
    for (const r of ['/funnel', '/tasks', '/workflows', '/wizard', '/blueprint', '/brain', '/']) {
      await sleep(300);
      await evaluate(c, CLICK(r));
    }
    await sleep(500);
    const v = distinct(await evaluate(c, 'window.__sbVar'));
    const p = distinct(await evaluate(c, 'window.__sbPaint'));
    const stored = await evaluate(c, `localStorage.getItem('glados-sidebar')`);
    const ok = (v.length === 0 || (v.length === 1 && v[0] === '64px')) && p.length === 1 && p[0] === '64px' && JSON.parse(stored || '{}').w === 64;
    check('toggle on /inbox', 'walk after toggle', ok, `--sidebar-w ${v.join(' → ') || 'unchanged'} · painted ${p.join(' → ')} · stored ${stored}`);
    // and back: the toggle on a normal page restores the labelled width on a workspace
    await evaluate(c, `window.dispatchEvent(new Event('sidebar:toggle')), true`);
    await sleep(600);
    await evaluate(c, CLICK('/wizard'));
    await sleep(400);
    const back = await evaluate(c, `document.documentElement.style.getPropertyValue('--sidebar-w')`);
    check('toggle on /', 'then /wizard', back === '232px', `--sidebar-w ${back}`);
  } finally {
    c.close();
  }
  console.log(`\nsidebar respect walk  ${BASE}  ui=${UI}  1440x900`);
  for (const r of report) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.state.padEnd(28)} ${r.what.padEnd(26)} ${r.detail}`);
  if (failures.length) {
    console.log(`\n${failures.length} failure(s)`);
    process.exit(1);
  }
  console.log('\nall pass');
  process.exit(0);
}
if (SIDEBAR_WALK) await sidebarWalk();

const rows = await httpPass();
console.log(`\n${LABEL || BASE}  ui=${UI}  warm=${WARM}`);
console.log(['route'.padEnd(44), 'st', 'cold', 'ttfb', 'html', 'rscTtfb', 'rsc', 'kb'].join('\t'));
for (const r of rows) console.log([r.route.padEnd(44), r.status, fmt(r.cold), fmt(r.ttfb), fmt(r.html), fmt(r.rscTtfb), fmt(r.rsc), r.kb].join('\t'));

let cdp = null;
let summary = null;
const pct = (xs, p) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : NaN;
};
if (CDP) {
  cdp = await cdpPass();
  console.log('\nbrowser click-through (ms): first visible change / settled');
  const keys = Object.keys(cdp.warm);
  console.log(['link'.padEnd(30), 'first', '', 'warm', ''].join('\t'));
  for (const k of keys) {
    const a = cdp.first[k] ?? {};
    const b = cdp.warm[k] ?? {};
    console.log([k.padEnd(30), fmt(a.feedback), fmt(a.done) + (a.timeout ? ' TIMEOUT' : ''), fmt(b.feedback), fmt(b.done) + (b.timeout ? ' TIMEOUT' : '') + (b.note ? ` (${b.note})` : '')].join('\t'));
  }
  // Clicks only: the full page load that starts each pass and full-load fallbacks are not clicks.
  summary = {};
  console.log('\nsummary (clicks only)      p50   p95   max   target');
  for (const pass of ['first', 'warm']) {
    const clicks = Object.entries(cdp[pass]).filter(([k, v]) => k !== '/ (full load)' && !v.note && !v.missing).map(([, v]) => v);
    const fb = clicks.map((v) => v.feedback);
    const dn = clicks.map((v) => v.done);
    summary[pass] = {
      clicks: clicks.length,
      first: { p50: pct(fb, 50), p95: pct(fb, 95), max: pct(fb, 100) },
      settled: { p50: pct(dn, 50), p95: pct(dn, 95), max: pct(dn, 100) },
    };
    const f = summary[pass].first;
    const d = summary[pass].settled;
    console.log(`${pass.padEnd(6)} first visible change  ${fmt(f.p50).padStart(5)} ${fmt(f.p95).padStart(5)} ${fmt(f.max).padStart(5)}   <= 100 every route: ${f.max <= 100 ? 'met' : 'not met'}`);
    console.log(`${pass.padEnd(6)} settled               ${fmt(d.p50).padStart(5)} ${fmt(d.p95).padStart(5)} ${fmt(d.max).padStart(5)}   p95 <= 300, max <= 500: ${d.p95 <= 300 && d.max <= 500 ? 'met' : 'not met'}`);
  }
  if (aborted.length) console.log(`\naborted non-GET /api requests: ${aborted.length} (${[...new Set(aborted)].join(', ')})`);
}
if (JSON_OUT) writeFileSync(String(JSON_OUT), JSON.stringify({ label: LABEL, base: BASE, ui: UI, at: new Date().toISOString(), rows, cdp, summary, aborted }, null, 2));
