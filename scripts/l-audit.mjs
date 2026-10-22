#!/usr/bin/env node
// Bennett Legacy audit (docs/projects/founderos-ui/SPEC.md §2.5, AC-6; pages/README.md B4, B6).
// Modelled on scripts/g-audit.mjs: drives headless Chrome over DevTools, sets the appearance cookie, loads
// each route at each width, and checks the rendered DOM.
//
// USAGE
//   node scripts/l-audit.mjs [--routes /,/funnel] [--skins monolith,daylight] [--widths 1440,1024,390]
//                            [--out <dir>] [--no-glados] [--full]
//
//   Legacy pass, for every skin × width × route (cookie legacy.mono.<dark|light>):
//     appearance   html carries data-ui=legacy and data-theme=monolith|daylight
//     contrast     every visible text node's computed colour against its composited background:
//                  4.5:1, or 3:1 for large text (24px, or 18.66px bold). --l-text-3 is for non-essential
//                  text only (O8): mark such text [data-l-decor] (or aria-hidden) and it is skipped.
//                  Text on a gradient or image is not measurable this way; it is counted, not failed.
//     g-classes    0 elements with a GladOS kit class (g-*) or a data-g attribute in the Legacy DOM
//     overflow     no horizontal scroll (document scrollWidth <= viewport width)
//     slab         one page slab ([data-l-frame]) on every route that is not a full-height workspace
//                  (lib/l-ready.ts L_NO_SLAB)
//     font         body computes to JetBrains Mono
//   GladOS pass (skip with --no-glados), every route at the first width, glados · ice · dark:
//     l-classes    0 elements with a Legacy kit class (l-*) or a data-l attribute in the GladOS DOM
//
//   Shots: <out>/<skin>/<width>/<route>.png (viewport, or the full page with --full); report: <out>/report.json.
//   Exit 1 on any failure.
//
// COMMON OPTIONS
//   GLADOS_URL   server (default http://localhost:4001); WAIT ms after load (default 1500)
//   CDP_PORT     attach to a Chrome already started with --remote-debugging-port; without it the script
//                launches headless Chrome itself (CHROME = binary path, default Google Chrome)
//
// SAFETY: every non-GET /api request is failed (cdp() in scripts/audit-routes.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cdp } from './audit-routes.mjs';
import { composite, contrastRatio, parseColor, routeSlug } from './g-audit/_lib.mjs';
import { ROOT, isWorkspace, minContrast, readLReady } from './l-audit/_lib.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const list = (n, d) => { const v = opt(n); return v ? v.split(',').filter(Boolean) : d; };

const BASE = (process.env.GLADOS_URL ?? 'http://localhost:4001').replace(/\/$/, '');
const WAIT = Number(process.env.WAIT ?? 1500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REG = readLReady();
const DEFAULT_ROUTES = ['/dev/l-kit', '/', '/funnel', '/brand-deals', '/finances', '/social', '/tasks', '/agents', '/skills', '/roadmap', '/analytics', '/integrations', '/setup'];
const ROUTES = list('--routes', DEFAULT_ROUTES);
const SKINS = list('--skins', ['monolith', 'daylight']);
const WIDTHS = list('--widths', ['1440', '1024', '390']).map(Number);
const OUT = path.resolve(opt('--out', path.join(ROOT, 'docs/projects/founderos-ui/shots/l-audit')));
const FULL = flag('--full');
const MODE_OF = { monolith: 'dark', daylight: 'light' };

async function startBrowser() {
  if (process.env.CDP_PORT) return { stop: () => {} };
  const bin = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!fs.existsSync(bin)) throw new Error(`No Chrome at ${bin}. Set CHROME=<binary> or start one and set CDP_PORT.`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l-audit-'));
  const child = spawn(bin, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--hide-scrollbars', '--force-color-profile=srgb',
    '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' });
  const portFile = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await sleep(100);
  if (!fs.existsSync(portFile)) { child.kill(); throw new Error('Chrome did not start (no DevToolsActivePort).'); }
  process.env.CDP_PORT = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
  return { stop: () => { child.kill(); setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 500); } };
}

let S;
let initScriptId = null;
const FREEZE_CSS = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';

async function setViewport(width) {
  await S.send('Emulation.setDeviceMetricsOverride', { width, height: width <= 480 ? 844 : 900, deviceScaleFactor: 1, mobile: false });
}

async function setAppearance(ui, mid, mode) {
  await S.send('Network.setCookie', { name: 'glados-appearance', value: `${ui}.${mid}.${mode}`, url: BASE, path: '/', sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 86400 });
  if (initScriptId) await S.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initScriptId }).catch(() => {});
  const store = { 'glados-ui': ui, 'glados-mode': mode, ...(ui === 'legacy' ? { 'glados-legacy-skin': mid } : { 'glados-accent': mid }) };
  ({ identifier: initScriptId } = await S.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try{var s=${JSON.stringify(store)};for(var k in s)localStorage.setItem(k,s[k]);}catch(e){}`,
  }));
  await S.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
}

async function go(url) {
  await S.ev('window.__lAuditStale = 1').catch(() => {});
  const nav = await S.send('Page.navigate', { url });
  if (nav.errorText) return { status: 0, error: nav.errorText };
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    await sleep(200);
    if (await S.ev("!window.__lAuditStale && document.readyState === 'complete'").catch(() => false)) break;
  }
  await S.ev('document.fonts ? document.fonts.ready.then(() => 1) : 1').catch(() => {});
  await S.ev(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(FREEZE_CSS)}; document.head.appendChild(s); return 1; })()`);
  await sleep(WAIT);
  const status = await S.ev("(performance.getEntriesByType('navigation')[0] || {}).responseStatus || 0").catch(() => 0);
  return { status };
}

async function shot(file) {
  let params = { format: 'png' };
  if (FULL) {
    const h = await S.ev('Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)');
    const w = await S.ev('document.documentElement.clientWidth');
    params = { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 16000), scale: 1 } };
  }
  const r = await S.send('Page.captureScreenshot', params);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
}

// ── in-page scan (serialised; no closures) ───────────────────────────────────────────────────
function scanLegacy() {
  const sel = (el) => {
    const parts = [];
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 4; n = n.parentElement, i++) {
      const c = typeof n.className === 'string' ? n.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.') : '';
      parts.unshift(n.tagName.toLowerCase() + (n.getAttribute('data-l') ? `[data-l=${n.getAttribute('data-l')}]` : '') + (c ? '.' + c : ''));
    }
    return parts.join(' > ');
  };
  const de = document.documentElement;
  const out = { attrs: { ui: de.getAttribute('data-ui'), theme: de.getAttribute('data-theme') }, overflow: { scrollWidth: de.scrollWidth, innerWidth: window.innerWidth } };
  out.gClasses = [];
  for (const el of document.querySelectorAll('[class], [data-g]')) {
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/) : [...(el.classList || [])];
    const bad = cls.filter((c) => /^g-[a-z0-9]/.test(c));
    if (bad.length || el.hasAttribute('data-g')) out.gClasses.push({ el: sel(el), classes: bad.join(' '), dataG: el.getAttribute('data-g') });
  }
  out.slab = document.querySelectorAll('[data-l-frame]').length;
  out.font = getComputedStyle(document.body).fontFamily;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
      if (n.hasAttribute('aria-hidden') && n.getAttribute('aria-hidden') !== 'false') return false;
      if (n.hasAttribute('data-l-decor')) return false;
    }
    return true;
  };
  const parse = (s) => { const m = s && s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x))); return [p[0], p[1], p[2], p[3] ?? 1]; };
  out.text = []; out.unmeasured = 0;
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.textContent.trim()) continue;
    const el = t.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (el.closest('script, style, noscript, option, svg, [disabled], [aria-disabled="true"]')) continue;
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    let alpha = 1;
    const layers = [];
    let unknown = false;
    for (let n = el; n; n = n.parentElement) {
      const ns = getComputedStyle(n);
      alpha *= parseFloat(ns.opacity) || 1;
      if (ns.backgroundImage && ns.backgroundImage !== 'none' && !/^url\(/.test(ns.backgroundImage)) { unknown = true; break; }
      const bg = parse(ns.backgroundColor);
      if (bg && bg[3] > 0) { layers.push(bg); if (bg[3] >= 0.98) break; }
    }
    if (unknown) { out.unmeasured++; continue; }
    out.text.push({ el: sel(el), text: t.textContent.trim().slice(0, 40), color: cs.color, alpha, layers, size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10) || 400 });
  }
  return out;
}

function scanGlados() {
  const bad = [];
  for (const el of document.querySelectorAll('[class], [data-l]')) {
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/) : [...(el.classList || [])];
    const l = cls.filter((c) => /^l-[a-z0-9]/.test(c));
    if (l.length || el.hasAttribute('data-l')) bad.push({ el: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''), classes: l.join(' '), dataL: el.getAttribute('data-l') });
  }
  return { ui: document.documentElement.getAttribute('data-ui'), bad };
}

/** Composite the background layers (top first) onto the page ground, then the text colour onto that. */
function ratioOf(sample, ground) {
  let bg = ground;
  for (const l of [...sample.layers].reverse()) bg = composite(l, bg);
  const fg = parseColor(sample.color);
  if (!fg) return null;
  return contrastRatio(composite([fg[0], fg[1], fg[2], (fg[3] ?? 1) * sample.alpha], bg), bg);
}

async function main() {
  const browser = await startBrowser();
  S = await cdp();
  await S.send('Network.enable');
  const report = { base: BASE, routes: ROUTES, skins: SKINS, widths: WIDTHS, legacy: [], glados: [], failures: 0 };
  try {
    for (const skin of SKINS) {
      const mode = MODE_OF[skin];
      await setAppearance('legacy', 'mono', mode);
      for (const width of WIDTHS) {
        await setViewport(width);
        for (const route of ROUTES) {
          const { status, error } = await go(`${BASE}${route}`);
          const file = path.join(OUT, skin, String(width), `${routeSlug(route)}.png`);
          await shot(file);
          const r = await S.ev(`(${scanLegacy.toString()})()`);
          const ground = parseColor(await S.ev('getComputedStyle(document.body).backgroundColor')) ?? [0, 0, 0, 1];
          const fails = [];
          if (status >= 400 || error) fails.push({ check: 'status', status, error });
          if (r.attrs.ui !== 'legacy' || r.attrs.theme !== skin) fails.push({ check: 'appearance', got: r.attrs });
          if (r.overflow.scrollWidth > r.overflow.innerWidth + 1) fails.push({ check: 'overflow', ...r.overflow });
          if (r.gClasses.length) fails.push({ check: 'g-classes', count: r.gClasses.length, first: r.gClasses.slice(0, 5) });
          if (!isWorkspace(route, REG.noSlab) && r.slab !== 1) fails.push({ check: 'slab', count: r.slab });
          if (!/JetBrains|__l_font|l-font/i.test(r.font) && !/Mono/i.test(r.font)) fails.push({ check: 'font', font: r.font });
          const low = [];
          for (const t of r.text) {
            const ratio = ratioOf(t, ground);
            if (ratio == null) continue;
            const min = minContrast(t);
            if (ratio + 1e-6 < min) low.push({ el: t.el, text: t.text, ratio: Math.round(ratio * 100) / 100, min });
          }
          if (low.length) fails.push({ check: 'contrast', count: low.length, first: low.slice(0, 8) });
          report.legacy.push({ skin, width, route, file: path.relative(ROOT, file), texts: r.text.length, unmeasured: r.unmeasured, fails });
          report.failures += fails.length;
          console.log(`${fails.length ? 'FAIL' : 'ok  '} ${skin.padEnd(8)} ${String(width).padEnd(4)} ${route.padEnd(16)} text ${r.text.length} (unmeasured ${r.unmeasured})${fails.length ? '  ' + fails.map((f) => `${f.check}${f.count != null ? `×${f.count}` : ''}`).join(', ') : ''}`);
          for (const f of fails) if (f.first) for (const x of f.first.slice(0, 4)) console.log(`       ${f.check}: ${JSON.stringify(x).slice(0, 220)}`);
        }
      }
    }
    if (!flag('--no-glados')) {
      await setAppearance('glados', 'ice', 'dark');
      await setViewport(WIDTHS[0]);
      // every route, own-tree (L_READY) routes included: their GladOS tree must carry no Legacy class either (AC-6)
      for (const route of ROUTES) {
        await go(`${BASE}${route}`);
        const g = await S.ev(`(${scanGlados.toString()})()`);
        const fails = [];
        if (g.ui !== 'glados') fails.push({ check: 'appearance', got: g.ui });
        if (g.bad.length) fails.push({ check: 'l-classes', count: g.bad.length, first: g.bad.slice(0, 5) });
        report.glados.push({ route, fails });
        report.failures += fails.length;
        console.log(`${fails.length ? 'FAIL' : 'ok  '} glados   ${String(WIDTHS[0]).padEnd(4)} ${route.padEnd(16)} ${fails.map((f) => `${f.check}${f.count != null ? `×${f.count}` : ''}`).join(', ')}`);
      }
    }
  } finally {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    S?.close();
    browser.stop();
  }
  console.log(`\n${report.failures ? `${report.failures} failure(s)` : 'clean'} · report ${path.relative(process.cwd(), path.join(OUT, 'report.json'))}`);
  process.exit(report.failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
