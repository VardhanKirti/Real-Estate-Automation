// Content Lab v2 frames gate (docs/projects/content-lab/v2/spec/02-components.md §16).
//
//   node scripts/lab-frames.mjs [--base http://localhost:4001] [--out docs/projects/content-lab/v2/frames] [--only <substr>]
//       Captures the 23 frames from /lab-frames/<state>, checks pixel contrast of every [data-lab-ink] (text)
//       and [data-lab-mark] (marks) in each one, and writes MANIFEST.json (file, url, style, width, state,
//       sha256, capturedAt, contrast). Refreshes the manifest hash line in APPROVAL.md and sets Status back
//       to pending whenever any frame changed.
//   node scripts/lab-frames.mjs --check [--pending-ok]
//       The gate. Exit 0 only when all 23 files exist, their hashes match MANIFEST.json, every frame passed
//       the contrast check, the manifest hash matches APPROVAL.md, and APPROVAL.md says `Status: approved`.
//       Everything passing but Status pending exits 3 (or 0 with --pending-ok, the lane F hand-off check).
//       Any other failure exits 1.
//
//   node scripts/lab-frames.mjs --legacy [--check]
//       LB-2 (founderos-ui pages/lab.md): the same frames route under Bennett Legacy (Monolith and Daylight),
//       LEGACY_FRAMES into docs/projects/founderos-ui/lab-frames-legacy with its own MANIFEST.json. The gate is
//       every file present, hashes matching and contrast clean; it never touches the 23-frame APPROVAL.md.
//
// Browser: Chrome at CHROME (default the macOS app path) started headless, or an existing one at CDP_PORT.
// SAFETY: every non-GET /api request is failed (cdp() in scripts/audit-routes.mjs). The frames route reads
// no store and makes no API call.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { cdp } from './audit-routes.mjs';
import { ROOT, composite, contrastRatio, decodePng, parseColor } from './g-audit/_lib.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const BASE = (opt('--base') ?? process.env.GLADOS_URL ?? 'http://localhost:4001').replace(/\/$/, '');
const LEGACY = flag('--legacy');
const OUT = path.resolve(ROOT, opt('--out', LEGACY ? 'docs/projects/founderos-ui/lab-frames-legacy' : 'docs/projects/content-lab/v2/frames'));
const ONLY = opt('--only');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** LAB_DUR.m / 2, read from lib/lab/motion.ts (never hard-coded, §16.2). */
function sheetMidMs() {
  const src = fs.readFileSync(path.join(ROOT, 'lib/lab/motion.ts'), 'utf8');
  const m = /LAB_DUR\s*=\s*\{[^}]*?\bm:\s*(\d+)/s.exec(src);
  if (!m) throw new Error('LAB_DUR.m not found in lib/lab/motion.ts');
  return Number(m[1]) / 2;
}

const STYLES = {
  'g-ember-dark': { ui: 'glados', accent: 'ember', mode: 'dark', label: 'GladOS ember dark' },
  'g-ice-light': { ui: 'glados', accent: 'ice', mode: 'light', label: 'GladOS ice light' },
  'c-console': { ui: 'classic', accent: 'ice', mode: 'dark', theme: 'console', label: 'Classic Console' },
  'l-monolith': { ui: 'legacy', accent: 'mono', mode: 'dark', label: 'Bennett Legacy Monolith' },
  'l-daylight': { ui: 'legacy', accent: 'mono', mode: 'light', label: 'Bennett Legacy Daylight' },
};
const WIN = "[data-lab='NarrativeCard'][data-kind='window']";

/** The exact 23-file list of §16.3. */
export const FRAMES = [
  { file: 'today--g-ember-dark--1440.png', style: 'g-ember-dark', width: 1440, state: 'default', capture: 'full' },
  { file: 'today--g-ember-dark--390.png', style: 'g-ember-dark', width: 390, state: 'default', capture: 'full' },
  { file: 'today--g-ice-light--1440.png', style: 'g-ice-light', width: 1440, state: 'default', capture: 'full' },
  { file: 'today--g-ice-light--390.png', style: 'g-ice-light', width: 390, state: 'default', capture: 'full' },
  { file: 'today--c-console--1440.png', style: 'c-console', width: 1440, state: 'default', capture: 'full' },
  { file: 'today--c-console--390.png', style: 'c-console', width: 390, state: 'default', capture: 'full' },
  ...['g-ember-dark', 'g-ice-light', 'c-console'].flatMap((style) =>
    ['open', 'closing', 'none'].map((s) => ({ file: `window--${style}--${s}.png`, style, width: 1440, state: `window-${s}`, capture: 'crop', selector: WIN })),
  ),
  { file: 'sheet-post--g-ember-dark--1440--mid.png', style: 'g-ember-dark', width: 1440, state: 'default', capture: 'viewport', sheet: 'mid' },
  { file: 'sheet-post--g-ember-dark--1440--open.png', style: 'g-ember-dark', width: 1440, state: 'default', capture: 'viewport', sheet: 'open' },
  { file: 'sheet-post--g-ember-dark--390--open.png', style: 'g-ember-dark', width: 390, state: 'default', capture: 'viewport', sheet: 'open' },
  { file: 'today--g-ember-dark--1440--not-configured.png', style: 'g-ember-dark', width: 1440, state: 'not-configured', capture: 'full' },
  { file: 'today--g-ember-dark--1440--reduced-transparency.png', style: 'g-ember-dark', width: 1440, state: 'default', capture: 'viewport', reducedTransparency: true },
  { file: 'components--g-ember-dark--1440.png', style: 'g-ember-dark', width: 1440, state: 'components', capture: 'full' },
  { file: 'components--g-ice-light--1440.png', style: 'g-ice-light', width: 1440, state: 'components', capture: 'full' },
  { file: 'components--c-console--1440.png', style: 'c-console', width: 1440, state: 'components', capture: 'full' },
];

/** LB-2: the frames under Bennett Legacy, both skins. */
export const LEGACY_FRAMES = [
  ...['l-monolith', 'l-daylight'].flatMap((style) => [
    { file: `today--${style}--1440.png`, style, width: 1440, state: 'default', capture: 'full' },
    { file: `today--${style}--390.png`, style, width: 390, state: 'default', capture: 'full' },
    ...['open', 'closing', 'none'].map((s) => ({ file: `window--${style}--${s}.png`, style, width: 1440, state: `window-${s}`, capture: 'crop', selector: WIN })),
    { file: `sheet-post--${style}--1440--open.png`, style, width: 1440, state: 'default', capture: 'viewport', sheet: 'open' },
    { file: `components--${style}--1440.png`, style, width: 1440, state: 'components', capture: 'full' },
  ]),
  { file: 'sheet-post--l-monolith--390--open.png', style: 'l-monolith', width: 390, state: 'default', capture: 'viewport', sheet: 'open' },
  { file: 'today--l-monolith--1440--not-configured.png', style: 'l-monolith', width: 1440, state: 'not-configured', capture: 'full' },
];
const LIST = LEGACY ? LEGACY_FRAMES : FRAMES;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const APPROVAL = path.join(OUT, 'APPROVAL.md');
const MANIFEST = path.join(OUT, 'MANIFEST.json');

// ── check ────────────────────────────────────────────────────────────────────────────────────
function check() {
  const problems = [];
  if (!fs.existsSync(MANIFEST)) problems.push('MANIFEST.json is missing');
  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : [];
  const byFile = new Map(manifest.map((m) => [m.file, m]));
  for (const f of LIST) {
    const p = path.join(OUT, f.file);
    const m = byFile.get(f.file);
    if (!fs.existsSync(p)) { problems.push(`${f.file}: file missing`); continue; }
    if (!m) { problems.push(`${f.file}: not in MANIFEST.json`); continue; }
    if (sha256(fs.readFileSync(p)) !== m.sha256) problems.push(`${f.file}: hash differs from MANIFEST.json (recapture)`);
    if (!m.contrast || m.contrast.fails.length) problems.push(`${f.file}: contrast ${m.contrast ? `${m.contrast.fails.length} failing target(s)` : 'not checked'}`);
  }
  if (manifest.length !== LIST.length) problems.push(`MANIFEST.json lists ${manifest.length} frames, expected ${LIST.length}`);
  if (LEGACY) {
    if (problems.length) { console.error(`lab-frames --legacy --check: FAIL\n${problems.map((p) => `  - ${p}`).join('\n')}`); process.exit(1); }
    console.log(`lab-frames --legacy --check: ok, ${LIST.length} frames, hashes match, contrast clean`);
    process.exit(0);
  }
  let status = 'missing';
  if (!fs.existsSync(APPROVAL)) problems.push('APPROVAL.md is missing');
  else {
    const a = fs.readFileSync(APPROVAL, 'utf8');
    status = (/^Status:\s*(\w+)/m.exec(a) || [])[1] ?? 'missing';
    const want = fs.existsSync(MANIFEST) ? sha256(fs.readFileSync(MANIFEST)) : '';
    const have = (/sha256 of the manifest:\s*([0-9a-f]{64})/.exec(a) || [])[1];
    if (have !== want) problems.push('APPROVAL.md manifest hash does not match MANIFEST.json');
  }
  if (problems.length) {
    console.error(`lab-frames --check: FAIL\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  if (status === 'approved') { console.log(`lab-frames --check: ok, ${FRAMES.length} frames, contrast clean, Status approved`); process.exit(0); }
  console.log(`lab-frames --check: ${FRAMES.length} frames present, hashes match, contrast clean. Status: ${status} (waiting on Brody).`);
  process.exit(flag('--pending-ok') ? 0 : 3);
}
const MAIN = !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (MAIN && flag('--check')) check();

// ── browser ──────────────────────────────────────────────────────────────────────────────────
async function startBrowser() {
  if (process.env.CDP_PORT) return { stop: () => {} };
  const bin = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!fs.existsSync(bin)) { console.error(`No Chrome at ${bin}. Set CHROME=<binary> or CDP_PORT.`); process.exit(2); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-frames-'));
  const child = spawn(bin, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--hide-scrollbars', '--force-color-profile=srgb',
    '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' });
  const portFile = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await sleep(100);
  if (!fs.existsSync(portFile)) { child.kill(); console.error('Chrome did not start'); process.exit(2); }
  process.env.CDP_PORT = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
  return { stop: () => { child.kill(); setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 500); } };
}

let S;
let initId = null;

async function appearance(style, { reduceMotion, reduceTransparency }) {
  const st = STYLES[style];
  await S.send('Network.setCookie', { name: 'glados-appearance', value: `${st.ui}.${st.accent}.${st.mode}`, url: BASE, path: '/', sameSite: 'Lax' });
  if (initId) await S.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initId }).catch(() => {});
  const store = { 'glados-ui': st.ui, 'glados-mode': st.mode, ...(st.ui === 'legacy' ? { 'glados-legacy-skin': st.accent } : { 'glados-accent': st.accent }), ...(st.theme ? { 'glados-theme': st.theme } : {}) };
  ({ identifier: initId } = await S.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try{var s=${JSON.stringify(store)};for(var k in s)localStorage.setItem(k,s[k]);sessionStorage.setItem('lab.intro.aurora','1');sessionStorage.setItem('lab.intro.today','1');}catch(e){}`,
  }));
  const features = [{ name: 'prefers-color-scheme', value: st.mode }];
  features.push({ name: 'prefers-reduced-motion', value: reduceMotion ? 'reduce' : 'no-preference' });
  features.push({ name: 'prefers-reduced-transparency', value: reduceTransparency ? 'reduce' : 'no-preference' });
  await S.send('Emulation.setEmulatedMedia', { features });
}

async function viewport(width) {
  await S.send('Emulation.setDeviceMetricsOverride', { width, height: width <= 480 ? 844 : 900, deviceScaleFactor: 2, mobile: width <= 480 });
}

async function go(url) {
  await S.ev('window.__labFramesStale = 1').catch(() => {});
  await S.send('Page.navigate', { url });
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    await sleep(150);
    if (await S.ev("!window.__labFramesStale && document.readyState === 'complete' && !!document.querySelector('[data-lab-root]')").catch(() => false)) break;
  }
  await S.ev('document.fonts ? document.fonts.ready.then(() => 1) : 1').catch(() => {});
  await sleep(600);
}

async function capture({ clip, full }) {
  const params = { format: 'png', captureBeyondViewport: !!(full || clip) };
  if (full) {
    const m = await S.send('Page.getLayoutMetrics');
    const c = m.cssContentSize || m.contentSize;
    params.clip = { x: 0, y: 0, width: Math.ceil(c.width), height: Math.ceil(c.height), scale: 1 };
  } else if (clip) params.clip = { ...clip, scale: 1 };
  const { data } = await S.send('Page.captureScreenshot', params);
  return Buffer.from(data, 'base64');
}

// In-page: collect contrast targets (document coordinates) and hide their ink, or restore it.
function labTargets(hide) {
  const STYLE_ID = 'lab-frames-hide';
  if (!hide) { document.getElementById(STYLE_ID)?.remove(); return []; }
  const exempt = (el) => !!el.closest("[aria-disabled='true'], [data-dim], [data-lab-skip-contrast], .lab2-sheet-ghost, [inert]") || clipped(el);
  const clipped = (el) => { const sc = el.closest('.lab2-row-scroll, .lab2-tabs'); if (!sc) return false; const a = el.getBoundingClientRect(), b = sc.getBoundingClientRect(); return a.left < b.left - 1 || a.right > b.right + 1; };
  const visible = (r) => r.width >= 2 && r.height >= 2;
  const out = [];
  const sx = window.scrollX, sy = window.scrollY;
  for (const el of document.querySelectorAll('[data-lab-ink]')) {
    if (exempt(el)) continue;
    const text = (el.textContent || el.getAttribute('placeholder') || '').trim();
    if (!text && el.tagName !== 'INPUT') continue;
    const r = el.getBoundingClientRect();
    if (!visible(r)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400;
    out.push({ kind: 'text', text: (text || el.getAttribute('placeholder') || '').slice(0, 40), color: cs.color, need: size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5, rect: { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height } });
  }
  for (const el of document.querySelectorAll('[data-lab-mark]')) {
    if (exempt(el)) continue;
    const r = el.getBoundingClientRect();
    if (!visible(r)) continue;
    const lit = el.querySelector("[data-emphasis='current'] [data-on='1']") || el.querySelector("[data-on='1']") || (el.getAttribute('data-on') === '1' ? el : null);
    const stroke = el.matches('.lab2-viz-line, .lab2-viz-fill') ? el : el.querySelector('.lab2-viz-line, .lab2-viz-fill, .lab2-ring-fill');
    let color;
    if (lit) { const c = getComputedStyle(lit); color = c.fill; const op = parseFloat(lit.getAttribute('fill-opacity') ?? '1'); if (op < 1) color = `${color}|${op}`; }
    else if (el.classList.contains('lab2-prow-fill')) color = getComputedStyle(el).backgroundColor;
    else if (stroke) color = getComputedStyle(stroke).stroke;
    else color = getComputedStyle(el).color;
    if (el.matches("[data-lab='DotMatrix']") && !lit) continue; // all dots off: decorative (§15.1)
    out.push({ kind: 'mark', text: el.getAttribute('data-lab') || el.getAttribute('aria-label') || el.className?.baseVal || el.className || 'mark', color, need: 3, rect: { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height } });
  }
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = "[data-lab-ink], [data-lab-ink] *, [data-lab-ink]::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; } svg[data-lab-mark], [data-lab-mark] svg, svg:has([data-lab-mark]), [data-lab-mark] .lab2-prow-fill { visibility: hidden !important; } .lab2-prow-fill[data-lab-mark], .lab2-prow-track { background: transparent !important; }";
  document.head.appendChild(s);
  return out;
}

function parseInk(c) {
  const [col, op] = String(c).split('|');
  const rgba = parseColor(col);
  if (!rgba) return null;
  if (op) rgba[3] = (rgba[3] ?? 1) * Number(op);
  return rgba;
}

async function contrastFor(frame, clipDoc) {
  const targets = await S.ev(`(${labTargets.toString()})(true)`);
  await sleep(120);
  const fullImg = decodePng(await capture(clipDoc ? { clip: clipDoc } : frame.capture === 'full' ? { full: true } : {}));
  await S.ev(`(${labTargets.toString()})(false)`);
  const scrollY = frame.capture === 'viewport' ? await S.ev('window.scrollY') : 0;
  const ox = clipDoc?.x ?? 0, oy = (clipDoc?.y ?? 0) + (frame.capture === 'viewport' ? scrollY : 0);
  const dpr = 2;
  const fails = [];
  let checked = 0;
  for (const t of targets) {
    const ink = parseInk(t.color);
    if (!ink) continue;
    const rx = t.rect.x - ox, ry = t.rect.y - oy;
    if (rx + t.rect.w < 0 || ry + t.rect.h < 0 || rx * dpr >= fullImg.width || ry * dpr >= fullImg.height) continue;
    let worst = Infinity;
    for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 6; gx++) {
      const x = Math.round((rx + 1 + ((t.rect.w - 2) * (gx + 0.5)) / 6) * dpr);
      const y = Math.round((ry + 1 + ((t.rect.h - 2) * (gy + 0.5)) / 3) * dpr);
      if (x < 0 || y < 0 || x >= fullImg.width || y >= fullImg.height) continue;
      const o = (y * fullImg.width + x) * 4;
      const bg = [fullImg.data[o], fullImg.data[o + 1], fullImg.data[o + 2]];
      worst = Math.min(worst, contrastRatio(composite(ink, bg), bg));
    }
    if (worst === Infinity) continue;
    checked++;
    if (worst < t.need) fails.push({ kind: t.kind, text: t.text, ratio: +worst.toFixed(2), need: t.need });
  }
  return { checked, fails };
}

async function openSheet(mid) {
  if (mid) {
    const ms = sheetMidMs();
    await S.ev(`(() => { const mo = new MutationObserver(() => { if (document.querySelector('.lab2-sheet-ghost')) { document.getAnimations().forEach((a) => { a.pause(); a.currentTime = ${ms}; }); mo.disconnect(); window.__labMid = 1; } }); mo.observe(document.body, { childList: true, subtree: true }); return 1; })()`);
  }
  await S.ev(`(() => { const t = document.querySelector("[data-lab='Tile']"); t.scrollIntoView({ block: 'center' }); return 1; })()`);
  await sleep(300);
  await S.ev(`(() => { document.querySelector("[data-lab='Tile']").click(); return 1; })()`);
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    await sleep(50);
    const ready = await S.ev(mid ? '!!window.__labMid' : "!!document.querySelector('.lab2-sheet') && !document.querySelector('.lab2-sheet-ghost')");
    if (ready) break;
  }
  await sleep(mid ? 150 : 700);
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await startBrowser();
  S = await cdp();
  await S.send('Network.enable');
  const prev = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : [];
  const byFile = new Map(prev.map((m) => [m.file, m]));
  let failed = 0;
  try {
    for (const f of LIST) {
      if (ONLY && !f.file.includes(ONLY)) continue;
      const url = `${BASE}/lab-frames/${f.state}`;
      await appearance(f.style, { reduceMotion: f.sheet !== 'mid', reduceTransparency: !!f.reducedTransparency });
      await viewport(f.width);
      await go(url);
      if (f.sheet) await openSheet(f.sheet === 'mid');
      let clipDoc = null;
      if (f.capture === 'crop') {
        clipDoc = await S.ev(`(() => { const el = document.querySelector(${JSON.stringify(f.selector)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + scrollX - 24, y: r.top + scrollY - 24, width: r.width + 48, height: r.height + 48 }; })()`);
        await sleep(200);
      }
      const png = await capture(clipDoc ? { clip: clipDoc } : { full: f.capture === 'full' });
      fs.writeFileSync(path.join(OUT, f.file), png);
      const contrast = f.sheet === 'mid' ? { checked: 0, fails: [], note: 'mid-flight frame: contrast is checked on the open frame' } : await contrastFor(f, clipDoc);
      if (contrast.fails.length) failed++;
      byFile.set(f.file, {
        file: f.file, url, style: STYLES[f.style].label, width: f.width, state: f.sheet ? `${f.state}, post sheet ${f.sheet}` : f.reducedTransparency ? `${f.state}, reduced transparency` : f.state,
        sha256: sha256(png), capturedAt: new Date().toISOString(), contrast,
      });
      const worst = contrast.fails.slice(0, 4).map((x) => `"${x.text}" ${x.ratio}<${x.need}`).join('; ');
      console.log(`${contrast.fails.length ? 'FAIL' : 'ok  '} ${f.file} (${contrast.checked} targets)${worst ? `  ${worst}` : ''}`);
    }
  } finally {
    S.close();
    browser.stop();
  }
  const manifest = LIST.map((f) => byFile.get(f.file)).filter(Boolean);
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  const changed = !fs.existsSync(MANIFEST) || fs.readFileSync(MANIFEST, 'utf8') !== body;
  fs.writeFileSync(MANIFEST, body);
  if (!LEGACY) writeApproval(sha256(Buffer.from(body)), changed);
  console.log(`${manifest.length} of ${LIST.length} frames in MANIFEST.json; ${failed} with contrast failures`);
  process.exit(failed ? 1 : 0);
}

/** Keeps APPROVAL.md's manifest hash current; a recapture that changed anything resets Status to pending (§16.4). */
function writeApproval(hash, changed) {
  if (!fs.existsSync(APPROVAL)) return;
  let a = fs.readFileSync(APPROVAL, 'utf8');
  const before = (/sha256 of the manifest:\s*([0-9a-f]{64}|<hash>)/.exec(a) || [])[1];
  a = a.replace(/(sha256 of the manifest:\s*)([0-9a-f]{64}|<hash>)/, `$1${hash}`);
  if (changed && before !== hash) a = a.replace(/^Status:\s*\w+/m, 'Status: pending');
  fs.writeFileSync(APPROVAL, a);
}

if (MAIN && !flag('--check')) run().catch((e) => { console.error(e); process.exit(1); });
