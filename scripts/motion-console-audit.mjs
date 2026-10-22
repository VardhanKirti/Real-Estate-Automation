// Motion console click audit (SPEC S05a §10, AC5a.1 to AC5a.5, AC5a.9, AC5a.10; ACG3.2).
//
// Enumerates every clickable control in the Motion console outside the workflow builder (.ae-o-graph),
// in its base state and in each layer it opens (tabs, menus, stage sheets, the cost preview), and for each one:
// reloads a fresh page, acts on it (click, next select option, ArrowRight on a range, typing into a field),
// and asserts something visibly changed. EVERY non-GET /api request is aborted at the network layer, so
// nothing is spent or written. Paid buttons (Confirm, Pass the cap once, Run the probe, Abandon) are never pressed.
//
// It also runs: the fake-affordance scan (AC5a.4), the overflow typing checks (AC5a.1), Escape on the gate
// and the probe dialog (AC5a.3), the spend chip widths (AC5a.5), draft persistence (AC5a.9), Copy (AC5a.10)
// and an unknown ?asset= id (ACG3.2).
//
// Usage:
//   GLADOS_URL=http://127.0.0.1:4000 node scripts/motion-console-audit.mjs [outDir]
// Env:
//   GLADOS_URL  the instance to audit (required; never a hard-coded host)
//   MODES       live,sample (default both): live is ?engine=console, sample is ?sample=1&engine=console
//   THEME       console | red | light | frost | grey-frost (default console)
//   APPEARANCE  glados-appearance cookie, e.g. legacy.mono.dark (founderos-ui pages/creative-engine.md CE-2)
//   CHROME      Chrome or chrome-headless-shell binary (default: macOS Google Chrome), started headless here
//   CDP_URL     use an already running Chrome (e.g. http://127.0.0.1:9333) instead of starting one
// Exit code 1 when any check fails. The JSON report lands in outDir/report-<mode>.json.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const BASE = (process.env.GLADOS_URL ?? '').replace(/\/$/, '');
if (!BASE) { console.error('Set GLADOS_URL, e.g. GLADOS_URL=http://127.0.0.1:4000'); process.exit(2); }
const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'motion-console-audit');
fs.mkdirSync(OUT, { recursive: true });
const MODES = (process.env.MODES ?? 'live,sample').split(',').map((s) => s.trim()).filter(Boolean);
const THEME = process.env.THEME ?? 'console';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Chrome over CDP ── */

async function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const { port } = s.address(); s.close(() => res(port)); }); });
}
let chrome = null;
async function cdpBase() {
  if (process.env.CDP_URL) return process.env.CDP_URL.replace(/\/$/, '');
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-audit-profile-'));
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) { try { await (await fetch(`${base}/json/version`)).json(); return base; } catch { await sleep(100); } }
  throw new Error(`Chrome did not start (${CHROME})`);
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); }
  static async open(wsUrl) {
    const ws = new WebSocket(wsUrl);
    const c = new Cdp(ws);
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && c.pending.has(d.id)) { const p = c.pending.get(d.id); c.pending.delete(d.id); if (d.error) p.rej(new Error(JSON.stringify(d.error))); else p.res(d.result); return; }
      for (const fn of c.handlers.get(d.method) ?? []) fn(d.params);
    };
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    return c;
  }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  on(method, fn) { this.handlers.set(method, [...(this.handlers.get(method) ?? []), fn]); }
}

const cdpRoot = await cdpBase();
const target = await (await fetch(`${cdpRoot}/json/new?about:blank`, { method: 'PUT' })).json();
const cdp = await Cdp.open(target.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
// the safety rail: every non-GET request to /api is failed before it leaves the browser
const blocked = [];
let blockedSince = 0;
await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
cdp.on('Fetch.requestPaused', ({ requestId, request }) => {
  if (request.method !== 'GET') { blocked.push(`${request.method} ${new URL(request.url).pathname}`); void cdp.send('Fetch.failRequest', { requestId, errorReason: 'Aborted' }); }
  else void cdp.send('Fetch.continueRequest', { requestId });
});
if (process.env.APPEARANCE) await cdp.send('Network.setCookie', { name: 'glados-appearance', value: process.env.APPEARANCE, url: BASE, path: '/' });
// theme, and a clean draft on every load unless a check asks to keep it
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('glados-theme',${JSON.stringify(THEME)});if(!sessionStorage.getItem('mc-audit-keep')){for(const k of Object.keys(localStorage))if(k.startsWith('ae-console-draft:'))localStorage.removeItem(k)}}catch(e){}` });

const ev = async (expr) => {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const key = async (k, code = k, vk = 0) => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
};
const ESC = () => key('Escape', 'Escape', 27);
const shot = async (name) => { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, 'base64')); };
async function waitFor(expr, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(150); } return false; }
async function load(url) {
  await cdp.send('Page.navigate', { url });
  if (!(await waitFor(`!!document.querySelector('.ae-octane .ae-o-top')`, 60000))) throw new Error(`console did not open at ${url}`);
  await sleep(900);
}

/* ── in-page helpers ── */

// Controls: everything focusable in the console, outside the builder, visible.
const INVENTORY = `(() => {
  const els = [...document.querySelectorAll('.ae-octane button, .ae-octane select, .ae-octane input, .ae-octane textarea')]
    .filter((e) => !e.closest('.ae-o-graph') && !e.closest('.ui-toast') && e.getClientRects().length > 0);
  window.__mc = els;
  return els.map((e, i) => ({
    i, tag: e.tagName.toLowerCase(), type: e.getAttribute('type') || '', role: e.getAttribute('role') || '',
    label: (e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || e.getAttribute('placeholder') || e.className || '').toString().trim().replace(/\\s+/g, ' ').slice(0, 60),
    title: e.getAttribute('title') || '', cls: (e.className || '').toString().slice(0, 50),
    disabled: !!e.disabled, ariaDisabled: e.getAttribute('aria-disabled') === 'true', selected: e.getAttribute('aria-selected') === 'true',
    options: e.tagName === 'SELECT' ? [...e.options].filter((o) => !o.disabled).length : 0,
    where: e.closest('.ae-o-gate') ? 'gate' : e.closest('.ae-o-pop') ? 'menu' : e.closest('.ae-o-sheet') ? 'sheet' : 'console',
  }));
})()`;
// A signature of what a person can see: the console DOM minus clocks, plus every field value, plus what is open.
const SIG = `(() => {
  const o = document.querySelector('.ae-octane');
  const sheet = document.querySelector('[data-creative-engine] .ae-sheet, .ae-sheet')?.textContent?.slice(0, 60) ?? '';
  if (!o || !o.querySelector('.ae-o-top')) return 'console-closed|' + sheet;
  const c = o.cloneNode(true);
  c.querySelectorAll('.ae-o-graph, .ae-o-readout, .ae-o-ringslot, .ae-o-stage-note').forEach((n) => n.remove());
  const vals = [...o.querySelectorAll('input, select, textarea')].filter((e) => !e.closest('.ae-o-graph')).map((e) => e.type === 'checkbox' ? e.checked : e.value).join('\\u0001');
  const s = c.innerHTML + '|' + vals + '|' + (document.activeElement === document.body ? '' : '') + '|' + sheet;
  let h = 0; for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return s.length + ':' + h;
})()`;
const clickLabel = (label) => ev(`(() => {
  const want = ${JSON.stringify(label.toLowerCase())};
  const els = [...document.querySelectorAll('.ae-octane button')].filter((b) => !b.closest('.ae-o-graph'));
  const e = els.find((b) => (b.getAttribute('aria-label') || '').toLowerCase() === want) || els.find((b) => (b.getAttribute('title') || '').toLowerCase().startsWith(want)) || els.find((b) => b.innerText.trim().toLowerCase() === want);
  if (!e || e.disabled) return false; e.click(); return true;
})()`);
const alive = () => ev(`!!document.querySelector('.ae-octane .ae-o-top') && !document.getElementById('ae-console-error-title')`);

/* ── checks ── */

const NEVER = /^(confirm|pass the cap once|run the probe|abandon$|replace$)/i; // spends or writes: never pressed, even with the network rail

async function act(el) {
  if (el.tag === 'select') {
    return ev(`(() => { const e = window.__mc[${el.i}]; const o = [...e.options].filter((x) => !x.disabled && x.value !== e.value && x.value !== '__loading'); if (!o.length) return 'single option';
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(e, o[0].value); e.dispatchEvent(new Event('change', { bubbles: true })); return 'select ' + o[0].value; })()`);
  }
  if (el.tag === 'input' && el.type === 'range') {
    // step toward the end that has room: a range already at its max cannot move right
    const atMax = await ev(`(() => { const e = window.__mc[${el.i}]; e.focus(); return Number(e.value) >= Number(e.max); })()`);
    if (atMax) { await key('ArrowLeft', 'ArrowLeft', 37); return 'range ArrowLeft'; }
    await key('ArrowRight', 'ArrowRight', 39); return 'range ArrowRight';
  }
  if (el.tag === 'input' || el.tag === 'textarea') {
    const text = el.type === 'number' ? '1' : /path|frame/i.test(el.label) ? '/tmp/mc-audit-missing.jpg' : 'close-up test 6s';
    await ev(`(() => { const e = window.__mc[${el.i}]; e.focus(); e.select && e.select(); })()`);
    await cdp.send('Input.insertText', { text });
    if (el.type === 'number') await key('Enter', 'Enter', 13);
    return 'typed';
  }
  await ev(`window.__mc[${el.i}].click()`);
  return 'click';
}

function allowedNoChange(el) {
  if (el.role === 'tab' && el.selected) return 'already-active tab';
  if (el.ariaDisabled) return 'inert (aria-disabled) with title';
  if (el.tag === 'select' && el.options < 2) return 'single option';
  return null;
}

const SCENES = [
  { name: 'base', setup: [] },
  { name: 'tab-presets', setup: [{ label: 'Presets', tab: true }] },
  { name: 'tab-refs', setup: [{ label: 'Refs', tab: true }] },
  { name: 'console-menu', setup: [{ label: 'Console menu' }] },
  { name: 'shot-menu', setup: [{ label: 'Shot column menu' }] },
  { name: 'output-menu', setup: [{ label: 'Output column menu' }] },
  { name: 'sheet-dialogue', setup: [{ label: 'Dialogue' }] },
  { name: 'sheet-describe', setup: [{ label: 'Describe it' }] },
  { name: 'sheet-prompt', setup: [{ label: 'Composed prompt' }] },
  { name: 'cost-preview', setup: [{ label: 'Cost preview' }] },
  { name: 'value-edit', setup: [{ label: 'Imperfection: 3. Edit' }] },
];

async function setupScene(url, scene) {
  await load(url);
  for (const s of scene.setup) {
    const ok = s.tab
      ? await ev(`(() => { const t = [...document.querySelectorAll('.ae-octane [role=tab]')].find((x) => x.innerText.trim() === ${JSON.stringify(s.label)}); if (!t) return false; t.click(); return true; })()`)
      : await clickLabel(s.label);
    if (!ok) return false;
    await sleep(350);
  }
  return true;
}

async function auditMode(mode) {
  const url = `${BASE}/creative-engine?${mode === 'sample' ? 'sample=1&' : ''}engine=console`;
  const failures = [];
  const results = [];
  const seen = new Set();

  // AC5a.4: anything styled like a control is a control, or says it is display-only and why
  await load(url);
  await shot(`${mode}-00-base`);
  const fakes = await ev(`(() => [...document.querySelectorAll('.ae-octane .ae-o-pill, .ae-octane .ae-o-caret, .ae-octane .ae-o-value, .ae-octane .ae-o-hud > *, .ae-octane .ae-o-readout > *')]
    .filter((e) => !e.closest('.ae-o-graph') && e.getClientRects().length > 0)
    .filter((e) => !['BUTTON', 'SELECT', 'INPUT'].includes(e.tagName) && !e.querySelector('select, button, input') && !(e.hasAttribute('data-display-only') && e.getAttribute('title')))
    .map((e) => e.tagName.toLowerCase() + '.' + e.className + ' "' + (e.textContent || '').trim().slice(0, 30) + '"'))()`);
  for (const f of fakes) failures.push(`fake affordance: ${f}`);

  for (const scene of SCENES) {
    if (!(await setupScene(url, scene))) { results.push({ scene: scene.name, skipped: 'setup control not available' }); continue; }
    await shot(`${mode}-10-${scene.name}`);
    const inv = await ev(INVENTORY);
    for (const el of inv) {
      const id = `${el.where}|${el.tag}|${el.label}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const rec = { scene: scene.name, ...el };
      if (el.disabled) {
        rec.result = el.title ? 'disabled (reason in title)' : 'DISABLED WITHOUT REASON';
        if (!el.title && el.where !== 'menu') failures.push(`disabled without a reason: ${el.label}`);
        results.push(rec); continue;
      }
      if (NEVER.test(el.label) || NEVER.test(el.label.split(' ')[0])) { rec.result = 'not pressed (spends or writes)'; results.push(rec); continue; }
      await setupScene(url, scene);
      const now = await ev(INVENTORY);
      const match = now.find((x) => `${x.where}|${x.tag}|${x.label}` === id);
      if (!match) { rec.result = 'gone after reload'; results.push(rec); continue; }
      blockedSince = blocked.length;
      const before = await ev(SIG);
      try { rec.action = await act(match); } catch (e) { rec.action = 'ERR ' + String(e.message).slice(0, 80); }
      await sleep(el.tag === 'textarea' || /path|frame/i.test(el.label) ? 1100 : 450);
      const after = await ev(SIG);
      rec.blocked = blocked.slice(blockedSince);
      rec.changed = before !== after;
      if (!(await alive()) && after !== 'console-closed|' && !after.startsWith('console-closed')) failures.push(`console crashed after: ${el.label}`);
      const allow = allowedNoChange(match);
      rec.result = rec.changed ? 'changed' : allow ? `no change (allowed: ${allow})` : 'NO VISIBLE CHANGE';
      if (!rec.changed && !allow) failures.push(`no visible change: [${scene.name}] ${el.tag} "${el.label}"`);
      results.push(rec);
    }
  }

  // AC5a.1: long input never throws, and every field stays at its limit
  const overflow = [];
  for (const [sel, open, n, limit] of [['input[aria-label="Overlay text"]', null, 200, 80], ['textarea[aria-label="Dialogue"]', 'Dialogue', 2000, 600], ['input[aria-label="Describe the shot"]', 'Describe it', 1000, 300]]) {
    const label = sel;
    await load(url);
    if (open) { await clickLabel(open); await sleep(300); }
    const found = await ev(`(() => { const e = document.querySelector(${JSON.stringify('.ae-octane ' + sel)}); if (!e) return false; e.focus(); return true; })()`);
    if (!found) { overflow.push({ label, skipped: true }); continue; }
    await cdp.send('Input.insertText', { text: 'x'.repeat(n) });
    if (sel.includes('Describe')) await key('Enter', 'Enter', 13);
    await sleep(400);
    const len = await ev(`document.querySelector(${JSON.stringify('.ae-octane ' + sel)})?.value.length ?? -1`);
    const ok = (await alive()) && len <= limit;
    overflow.push({ label, typed: n, length: len, limit, ok });
    if (!ok) failures.push(`overflow: ${label} typed ${n}, length ${len}, limit ${limit}, alive ${await alive()}`);
  }

  // AC5a.2 / AC5a.3: the cost preview always opens, has no Confirm while blocked, and Escape closes only it
  await load(url);
  await clickLabel('Cost preview'); await sleep(350);
  const gate = await ev(`(() => { const g = document.querySelector('.ae-o-gate [role=dialog]'); if (!g) return null; const b = [...g.querySelectorAll('button')].map((x) => x.innerText.trim()); const reason = document.querySelector('#ae-o-block-caption')?.innerText ?? null; return { buttons: b, block: g.querySelector('.ae-o-gate-block')?.innerText ?? null, caption: reason }; })()`);
  if (!gate) failures.push('cost preview did not open');
  else if (gate.block && gate.buttons.some((b) => /^Confirm/.test(b))) failures.push('cost preview shows Confirm while blocked');
  await ESC(); await sleep(300);
  const escGate = { gateClosed: !(await ev(`!!document.querySelector('.ae-o-gate')`)), consoleOpen: await alive() };
  await ESC(); await sleep(400);
  escGate.consoleClosedOnSecond = !(await ev(`!!document.querySelector('.ae-octane .ae-o-top')`));
  if (!escGate.gateClosed || !escGate.consoleOpen || !escGate.consoleClosedOnSecond) failures.push(`Escape order on the gate: ${JSON.stringify(escGate)}`);
  let escProbe = 'probe disabled here';
  await load(url);
  if (await clickLabel(`Probe ${await ev(`document.querySelector('.ae-octane [aria-label=Model]')?.value ?? ''`)}`)) {
    await sleep(350);
    const opened = await ev(`!!document.querySelector('.ae-o-gate [role=dialog]')`);
    await ESC(); await sleep(300);
    escProbe = { opened, closed: !(await ev(`!!document.querySelector('.ae-o-gate')`)), consoleOpen: await alive() };
    if (!escProbe.opened || !escProbe.closed || !escProbe.consoleOpen) failures.push(`Escape on the probe dialog: ${JSON.stringify(escProbe)}`);
  }

  // AC5a.5: spend chips sum to the track; no pink at zero
  const chips = await ev(`(() => { const t = [...document.querySelectorAll('.ae-octane .ae-o-readout .ae-o-chips')].pop(); if (!t) return null;
    const w = (s) => t.querySelector(s)?.getBoundingClientRect().width ?? 0; return { track: t.getBoundingClientRect().width, used: w('[data-chip=used]'), left: w('[data-chip=left]'), text: t.parentElement.innerText }; })()`);
  if (chips) {
    const m = /session ([\d,.]+) \/ ([\d,.]+)/.exec(chips.text);
    if (m) {
      const spent = Number(m[1].replace(/,/g, '')), cap = Number(m[2].replace(/,/g, ''));
      const both = chips.used > 0 && chips.left > 0 ? 6 : 0;
      const want = Math.min(1, spent / cap) * (chips.track - both);
      chips.want = want;
      if (spent === 0 && chips.used > 0) failures.push('pink spend chip shown at zero spend');
      if (Math.abs(chips.used - want) > 1) failures.push(`spend chip ${chips.used.toFixed(1)}px, want ${want.toFixed(1)}px`);
    }
  }

  // AC5a.9: a control survives close and reopen (live only; the sample never stores drafts)
  let persisted = 'sample: drafts off';
  if (mode !== 'sample') {
    await load(url);
    const pick = await ev(`(() => { const e = document.querySelector('.ae-octane select[aria-label=Framing]'); const o = [...e.options].find((x) => x.value !== e.value); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(e, o.value); e.dispatchEvent(new Event('change', { bubbles: true })); return o.value; })()`);
    await sleep(300);
    await ev(`sessionStorage.setItem('mc-audit-keep', '1')`);
    await load(url);
    const got = await ev(`document.querySelector('.ae-octane select[aria-label=Framing]')?.value`);
    await ev(`sessionStorage.removeItem('mc-audit-keep')`);
    persisted = { set: pick, afterReload: got };
    if (got !== pick) failures.push(`draft not restored: Framing ${pick} became ${got}`);
  }

  // AC5a.10: Copy works (clipboard API on a secure origin, the textarea fallback on plain http)
  await load(url);
  await cdp.send('Browser.grantPermissions', { origin: new URL(BASE).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
  // a real pointer click, so the copy runs with user activation like a person's click
  const at = await ev(`(() => { const r = document.querySelector('.ae-octane [aria-label="Copy the prompt"]')?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
  if (at) for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await sleep(400);
  const copy = await ev(`[...document.querySelectorAll('.ae-octane .ui-toast')].map((t) => t.innerText).join(' | ')`);
  if (!/Prompt copied/.test(copy)) failures.push(`copy: ${copy || 'no toast'}`);

  // ACG3.2: an unknown asset id opens the console normally
  await load(`${url}&asset=does-not-exist`);
  const g3 = await alive();
  if (!g3) failures.push('?asset=<unknown> did not open the console');

  const report = { url, theme: THEME, at: new Date().toISOString(), blocked, fakes, overflow, gate, escGate, escProbe, chips, persisted, copy, g3UnknownAsset: g3, results, failures };
  fs.writeFileSync(path.join(OUT, `report-${mode}.json`), JSON.stringify(report, null, 1));
  const tested = results.filter((r) => r.changed !== undefined);
  console.log(`[${mode}] controls ${results.length}; acted ${tested.length}; changed ${tested.filter((r) => r.changed).length}; allowed no-change ${tested.filter((r) => !r.changed && r.result.startsWith('no change')).length}; blocked non-GET ${blocked.length}; failures ${failures.length}`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  return failures.length;
}

let failed = 0;
try {
  for (const m of MODES) failed += await auditMode(m);
} finally {
  cdp.ws.close();
  if (chrome) chrome.kill();
}
console.log(`report: ${OUT}`);
process.exit(failed ? 1 : 0);
