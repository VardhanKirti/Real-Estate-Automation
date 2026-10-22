#!/usr/bin/env node
// Content Lab v2 motion audit (docs/projects/content-lab/v2/spec/03-motion.md 03.17, browser half; lane U1).
//
// Usage:
//   GLADOS_URL=http://127.0.0.1:4322 node scripts/lab-motion-audit.mjs [outDir]
// Env:
//   GLADOS_URL   the instance (required). Pages are opened with ?sample=1.
//   APPEARANCE   glados-appearance cookie (default glados.ember.dark)
//   CHROME       Chrome binary started headless here (default macOS Google Chrome); CDP_PORT to attach instead
// Every non-GET /api request is failed at the network layer (scripts/audit-routes.mjs cdp()), so nothing is
// written or spent. Exit 1 when any check fails; the JSON report is outDir/report.json.
//
// Checks: AC-03-20 intro plays once per session and never on reload or client navigation; AC-03-21 reduced
// motion leaves no running animation on any page or open sheet; AC-03-22 narrative drift pauses out of view
// and under a sheet; AC-03-24 intro and sheet keyframes animate opacity and transform only (border-radius on
// the ghost); AC-03-25 running-animation ceilings; AC-03-26/27 the sheet flies from the first Your posts tile
// in 260 ms and Escape returns focus to it; AC-03-28 a deep-linked sheet fades in 240 ms with no ghost;
// AC-03-29 the Aurora node survives a tab change, the underline flies 280 ms, the page rises 240 ms;
// AC-03-32 the Window pulse plays once for a new event; AC-03-33 layout shift in the first second under 0.01;
// AC-03-34 the scrubber runs at most one animation under rapid keys; AC-03-35 tile rows snap on x and register
// no scroll listener. Not automated here (need a live or dry POST, or a frozen page): AC-03-23, AC-03-30, AC-03-31.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cdp } from './audit-routes.mjs';

const BASE = (process.env.GLADOS_URL ?? '').replace(/\/$/, '');
if (!BASE) { console.error('Set GLADOS_URL, e.g. GLADOS_URL=http://127.0.0.1:4322'); process.exit(2); }
const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'lab-motion-audit');
const APPEARANCE = process.env.APPEARANCE ?? 'glados.ember.dark';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGES = ['/lab', '/lab/radar', '/lab/breakouts', '/lab/playbook', '/lab/studio', '/lab/ledger', '/lab/creatorverse'];
const url = (p, extra = '') => `${BASE}${p}?sample=1${extra}`;

async function startBrowser() {
  if (process.env.CDP_PORT) return { stop: () => {} };
  const bin = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-motion-'));
  const child = spawn(bin, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--hide-scrollbars', '--no-first-run', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await sleep(100);
  if (!fs.existsSync(portFile)) { child.kill(); console.error('Chrome did not start'); process.exit(2); }
  process.env.CDP_PORT = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
  return { stop: () => { child.kill(); setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 500); } };
}

let S;
const results = [];
const check = (id, ok, detail) => { results.push({ id, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${detail ?? ''}`); };

async function go(u, { waitMs = 2200 } = {}) {
  await S.ev('window.__labAuditStale = 1').catch(() => {});
  await S.send('Page.navigate', { url: u });
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    await sleep(100);
    if (await S.ev("!window.__labAuditStale && document.readyState === 'complete'").catch(() => false)) break;
  }
  await sleep(waitMs);
}

const running = `document.getAnimations().filter((a) => a.playState === 'running' && (a.effect?.getTiming?.().duration ?? 0) > 0)`;
const countRunning = () => S.ev(`${running}.length`);

async function media(features) { await S.send('Emulation.setEmulatedMedia', { features }); }

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  await S.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await S.send('Network.enable');
  await S.send('Network.setCookie', { name: 'glados-appearance', value: APPEARANCE, url: BASE, path: '/' });
  await media([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

  // ── AC-03-20, 24, 25, 33: the intro ──
  await go(url('/lab'), { waitMs: 300 });
  await S.ev('try { sessionStorage.clear(); localStorage.removeItem("lab.window.seen"); } catch (e) {} 1');
  await S.send('Page.navigate', { url: url('/lab') });
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 2500) {
    const s = await S.ev(`(() => ({ t: performance.now(), attr: document.documentElement.getAttribute('data-lab-intro'), n: ${running}.length,
      props: [...new Set(${running}.flatMap((a) => (a.effect?.getKeyframes?.() ?? []).flatMap((k) => Object.keys(k))))],
      cls: (window.__labCls ??= (() => { let v = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) v += e.value; window.__labClsV = v; }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {} return 1; })(), window.__labClsV ?? 0) }))()`).catch(() => null);
    if (s) samples.push(s);
    await sleep(40);
  }
  const played = samples.filter((s) => s.attr === 'play');
  const firstPlay = played[0]?.t ?? null;
  const lastPlay = played.at(-1)?.t ?? null;
  check('AC-03-20 intro plays on a fresh session', played.length > 0 && samples.some((s) => s.attr === 'play' && s.n > 0), `samples ${samples.length}, with play ${played.length}`);
  check('AC-03-20 intro attribute gone by 800 ms', firstPlay !== null && lastPlay - firstPlay <= 900, firstPlay === null ? 'never seen' : `${Math.round(lastPlay - firstPlay)} ms`);
  const allowed = new Set(['opacity', 'transform', 'offset', 'easing', 'composite', 'computedOffset']);
  const badProps = [...new Set(samples.flatMap((s) => s.props))].filter((p) => !allowed.has(p));
  check('AC-03-24 intro keyframes animate opacity and transform only', badProps.length === 0, badProps.join(', '));
  check('AC-03-25 at most 80 running animations during the intro', Math.max(0, ...samples.map((s) => s.n)) <= 80, `max ${Math.max(0, ...samples.map((s) => s.n))}`);
  const cls = await S.ev('window.__labClsV ?? 0');
  check('AC-03-33 layout shift in the first second under 0.01', cls < 0.01, `CLS ${Number(cls).toFixed(4)}`);

  await sleep(1200);
  const restToday = [];
  for (let i = 0; i < 10; i++) { restToday.push(await countRunning()); await sleep(50); }
  check('AC-03-25 at most 3 running animations at rest on Today', Math.max(...restToday) <= 3, `max ${Math.max(...restToday)}`);

  // reload: no intro
  await S.send('Page.reload', {});
  let reloadSeen = false;
  for (let i = 0; i < 40; i++) { if ((await S.ev("document.documentElement.getAttribute('data-lab-intro')").catch(() => null)) === 'play') reloadSeen = true; await sleep(40); }
  check('AC-03-20 no intro on reload', !reloadSeen);
  await sleep(1500);

  // ── AC-03-29: client navigation keeps the Aurora; underline 280 ms; page rise 240 ms ──
  await S.ev("(() => { const a = document.querySelector('.lab2-aurora'); if (a) a.__labTag = 'u1'; window.__labAnims = []; const seen = new Set(); const tick = () => { for (const an of document.getAnimations()) { if (seen.has(an)) continue; seen.add(an); const t = an.effect?.target; window.__labAnims.push({ cls: t && t.className && String(t.className.baseVal ?? t.className), name: an.animationName ?? null, dur: an.effect?.getTiming?.().duration }); } if (window.__labAnims.length < 400) requestAnimationFrame(tick); }; requestAnimationFrame(tick); return 1; })()");
  await S.ev("(() => { const t = [...document.querySelectorAll('.lab2-tabs a')].find((a) => /Radar/.test(a.textContent || '')); t.click(); return 1; })()");
  let introOnNav = false;
  for (let i = 0; i < 40; i++) { if ((await S.ev("document.documentElement.getAttribute('data-lab-intro')").catch(() => null)) === 'play') introOnNav = true; await sleep(50); }
  await sleep(800);
  const nav = await S.ev("({ path: location.pathname, tagged: document.querySelector('.lab2-aurora')?.__labTag === 'u1', anims: window.__labAnims || [] })");
  check('AC-03-29 the Aurora node survives the page change', nav.path === '/lab/radar' && nav.tagged, `path ${nav.path}, tagged ${nav.tagged}`);
  check('AC-03-20 no intro on client navigation', !introOnNav);
  const ink = nav.anims.find((a) => /lab2[gc]-tab-ink/.test(a.cls || '')); // GladOS and Classic trees
  check('AC-03-29 tab underline flies in 280 ms', ink && Math.round(ink.dur) === 280, ink ? `${ink.dur} ms` : 'no underline animation');
  const rise = nav.anims.find((a) => /lab2-page/.test(a.cls || '') && (a.name === 'lab2-rise' || a.name === null));
  check('AC-03-29 page rises in 240 ms', rise && Math.round(rise.dur) === 240, rise ? `${rise.dur} ms` : 'no rise animation');

  // ── AC-03-25 at rest on the other five pages ──
  for (const p of PAGES.slice(1)) {
    await go(url(p), { waitMs: 2500 });
    const r = [];
    for (let i = 0; i < 8; i++) { r.push(await countRunning()); await sleep(50); }
    // the Running pill's ring is a live-run indicator (03.8), not rest motion
    const ring = await S.ev("document.querySelectorAll('.lab2-ring-spin').length");
    check(`AC-03-25 at most 1 running animation at rest on ${p}`, Math.max(...r) - ring <= 1, `max ${Math.max(...r)} (ring ${ring})`);
  }

  // ── AC-03-26, 27: the shared-element open and Escape close ──
  await go(url('/lab'), { waitMs: 2500 });
  await S.ev("(() => { const t = document.querySelector(\"section[data-lab='TileRow'] a[data-lab='Tile']\"); t.scrollIntoView({ block: 'center' }); return 1; })()");
  await sleep(400);
  const open = await S.ev(`(async () => {
    const tile = document.querySelector("section[data-lab='TileRow'] a[data-lab='Tile']");
    const tr = tile.getBoundingClientRect();
    let first = null, dur = null, props = [];
    const mo = new MutationObserver(() => {
      const g = document.querySelector('.lab2-sheet-ghost');
      if (g && !first) {
        const r = g.getBoundingClientRect();
        first = { x: r.x, y: r.y, w: r.width, h: r.height };
        const an = g.getAnimations()[0];
        if (an) { dur = an.effect.getTiming().duration; props = an.effect.getKeyframes().flatMap((k) => Object.keys(k)); }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    tile.click();
    await new Promise((r) => setTimeout(r, 400));
    mo.disconnect();
    return { tile: { x: tr.x, y: tr.y, w: tr.width, h: tr.height }, first, dur, props: [...new Set(props)], ghostLeft: !!document.querySelector('.lab2-sheet-ghost') };
  })()`);
  const near = (a, b) => a && b && Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2 && Math.abs(a.w - b.w) <= 2 && Math.abs(a.h - b.h) <= 2;
  check('AC-03-26 the ghost starts on the tile', near(open.first, open.tile), JSON.stringify({ tile: open.tile, first: open.first }));
  check('AC-03-26 the open runs 260 ms and the ghost is gone after', open.dur === 260 && !open.ghostLeft, `dur ${open.dur}, ghost left ${open.ghostLeft}`);
  const okProps = open.props.every((p) => allowed.has(p) || p === 'borderRadius');
  check('AC-03-24 sheet keyframes: opacity, transform, border-radius on the ghost', okProps, open.props.join(', '));
  await sleep(300);
  // AC-03-22 drift pauses under a sheet
  const driftUnder = await S.ev("document.getAnimations().filter((a) => a.animationName === 'lab2-drift').map((a) => a.playState)");
  check('AC-03-22 drift paused while a sheet is open', driftUnder.length === 0 || driftUnder.every((s) => s === 'paused'), driftUnder.join(','));
  await S.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await S.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(600);
  const back = await S.ev("(() => { const t = document.querySelector(\"section[data-lab='TileRow'] a[data-lab='Tile']\"); const a = document.activeElement; return { ok: a === t || t.contains(a), open: !!document.querySelector('.lab2-sheet-layer[data-open]'), active: a ? a.tagName + '.' + String(a.className).slice(0, 40) : null, url: location.search }; })()");
  check('AC-03-27 Escape closes and focus returns to the tile', back.ok && !back.open, JSON.stringify(back));

  // ── AC-03-22 drift pauses out of view ──
  await S.ev('window.scrollTo(0, document.documentElement.scrollHeight)');
  await sleep(700);
  const driftOut = await S.ev("document.getAnimations().filter((a) => a.animationName === 'lab2-drift').map((a) => a.playState)");
  await S.ev('window.scrollTo(0, 0)');
  await sleep(700);
  const driftIn = await S.ev("document.getAnimations().filter((a) => a.animationName === 'lab2-drift').map((a) => a.playState)");
  check('AC-03-22 drift paused out of view, running in view', driftOut.every((s) => s === 'paused') && (driftIn.length === 0 || driftIn.some((s) => s === 'running')), `out [${driftOut}] in [${driftIn}]`);

  // ── AC-03-34 scrubber under rapid keys ──
  const scrub = await S.ev(`(async () => {
    const s = document.querySelector("[data-lab='PeriodScrubber'] [role='slider']");
    if (!s) return { missing: true };
    s.focus();
    const before = Number(s.getAttribute('aria-valuenow'));
    let maxAnims = 0;
    for (let i = 0; i < 3; i++) { s.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); maxAnims = Math.max(maxAnims, document.querySelector("[data-lab='PeriodScrubber']").getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length); await new Promise((r) => setTimeout(r, 25)); }
    await new Promise((r) => setTimeout(r, 400));
    return { before, after: Number(s.getAttribute('aria-valuenow')), maxAnims };
  })()`);
  check('AC-03-34 three quick steps move three, one animation at most', !scrub.missing && Math.abs(scrub.after - scrub.before) === 3 && scrub.maxAnims <= 1, JSON.stringify(scrub));

  // ── AC-03-35 tile rows snap on x, no scroll listener ──
  const snap = await S.ev("[...document.querySelectorAll('.lab2-row-scroll')].map((r) => getComputedStyle(r).scrollSnapType)");
  check('AC-03-35 tile rows have x scroll snap', snap.length > 0 && snap.every((v) => /x/.test(v)), snap.join(' | '));
  const rowObj = await S.send('Runtime.evaluate', { expression: "document.querySelector('.lab2-row-scroll')" });
  let scrollListeners = -1;
  if (rowObj.result.objectId) {
    const ls = await S.send('DOMDebugger.getEventListeners', { objectId: rowObj.result.objectId });
    scrollListeners = ls.listeners.filter((l) => l.type === 'scroll').length;
  }
  check('AC-03-35 no scroll listener on the row', scrollListeners === 0, `scroll listeners ${scrollListeners}`);

  // ── AC-03-32 the Window pulse ──
  await S.ev("try { localStorage.setItem('lab.window.seen', 'another-event'); sessionStorage.setItem('lab.intro.aurora', '1'); sessionStorage.setItem('lab.intro.today', '1'); } catch (e) {} 1");
  await S.send('Page.navigate', { url: url('/lab') });
  let pulses = 0, pulseSeen = false;
  for (let i = 0; i < 60; i++) {
    const n = await S.ev("document.getAnimations().filter((a) => a.effect?.target?.classList?.contains('lab2-narr-pulse')).length").catch(() => 0);
    if (n > 0) pulseSeen = true;
    pulses = Math.max(pulses, n);
    await sleep(50);
  }
  await sleep(1200);
  const spanGone = await S.ev("!document.querySelector('.lab2-narr-pulse')");
  const hasWindow = await S.ev("!!document.querySelector(\"[data-lab='NarrativeCard'][data-kind='window'] a, [data-lab='NarrativeCard'][data-kind='window'] .lab2-narr-action\")");
  check('AC-03-32 one pulse for a new event, span removed after', !hasWindow || (pulseSeen && pulses === 1 && spanGone), `window ${hasWindow}, max ${pulses}, gone ${spanGone}`);
  await S.send('Page.reload', {});
  let again = 0;
  for (let i = 0; i < 40; i++) { again = Math.max(again, await S.ev("document.querySelectorAll('.lab2-narr-pulse').length").catch(() => 0)); await sleep(50); }
  check('AC-03-32 no pulse on reload', again === 0, `pulse spans ${again}`);

  // ── AC-03-28 a deep-linked sheet fades, no ghost ──
  const post = await S.ev("(() => { const t = document.querySelector(\"section[data-lab='TileRow'] a[data-lab='Tile'][href*='post=']\"); return t ? new URL(t.href).searchParams.get('post') : null; })()");
  if (post) {
    await S.send('Page.navigate', { url: url('/lab', `&post=${encodeURIComponent(post)}`) });
    let ghost = false; let fade = null;
    for (let i = 0; i < 80; i++) {
      const s = await S.ev("(() => { const g = !!document.querySelector('.lab2-sheet-ghost'); const sh = document.querySelector('.lab2-sheet'); const an = sh ? sh.getAnimations()[0] : null; return { g, an: an ? { dur: an.effect.getTiming().duration, kf: an.effect.getKeyframes().map((k) => ({ o: k.opacity, t: k.transform })) } : null }; })()").catch(() => null);
      if (s?.g) ghost = true;
      if (s?.an && !fade) fade = s.an;
      await sleep(25);
    }
    check('AC-03-28 a deep link never makes a ghost', !ghost);
    check('AC-03-28 the deep-link entrance is one 240 ms fade and rise', fade && fade.dur === 240 && !(fade.kf ?? []).some((k) => /scale/.test(k.t ?? '')), JSON.stringify(fade));
  } else check('AC-03-28 a deep-linked sheet', false, 'no Your posts tile with a post id');

  // ── AC-03-21 reduced motion: nothing runs ──
  await media([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await S.ev('try { sessionStorage.clear(); } catch (e) {} 1');
  for (const p of [...PAGES, '/lab?post']) {
    const u = p === '/lab?post' ? url('/lab', post ? `&post=${encodeURIComponent(post)}` : '') : url(p);
    await S.send('Page.navigate', { url: u });
    let max = 0;
    const t1 = Date.now();
    while (Date.now() - t1 < 2000) { max = Math.max(max, await countRunning().catch(() => 0)); await sleep(50); }
    check(`AC-03-21 reduced motion: no running animation on ${p}`, max === 0, `max ${max}`);
  }
  await media([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

  const fails = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ url: BASE, at: new Date().toISOString(), appearance: APPEARANCE, results, notAutomated: ['AC-03-23', 'AC-03-30', 'AC-03-31'] }, null, 1));
  console.log(`${results.length - fails.length}/${results.length} checks pass · report ${path.join(OUT, 'report.json')}`);
  return fails.length ? 1 : 0;
}

const browser = await startBrowser();
let code = 1;
try {
  S = await cdp();
  code = await main();
} catch (e) {
  console.error(e);
} finally {
  S?.close();
  browser.stop();
}
process.exit(code);
