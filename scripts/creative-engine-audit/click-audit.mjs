// Creative Engine click audit (SPEC S04 AC04.4, G8 ACG8.1): every interactive element on the page, and with
// --deep every control inside each sheet and drawer it opens, is clicked with every non-GET /api request
// aborted (nothing is written, nothing is charged). An element passes when the click changed something
// (DOM, URL, a dialog, focus, a request, audio, clipboard or a download) or when it is disabled with a reason
// in its title. Anything that only looks clickable (pointer cursor, no control) is reported too.
//
// Usage:
//   GLADOS_URL=http://127.0.0.1:4000 [ENGINE_ROUTE=/adpilot ENGINE_SCOPE='[data-adpilot]'] node scripts/creative-engine-audit/click-audit.mjs <outDir> \
//     [--themes console,red,light,frost,grey-frost] [--widths 1440,1280,1024,820] [--modes sample,live] [--deep] [--shots]
// Playwright is not a dependency of this repo (no new dependencies, SPEC §3.5.4): the script loads it from
// node_modules when present, else from PLAYWRIGHT_DIR (any folder whose node_modules has playwright).
// PW_CHROMIUM may point at a Chromium binary when Playwright's own download is not installed.
// Exit code 1 when any element is inert, disabled without a reason, or covered by another element.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
let pw;
try {
  pw = req('playwright');
} catch {
  if (!process.env.PLAYWRIGHT_DIR) {
    console.error('playwright not found: set PLAYWRIGHT_DIR to a folder with node_modules/playwright');
    process.exit(2);
  }
  pw = req(req.resolve('playwright', { paths: [process.env.PLAYWRIGHT_DIR] }));
}
const { chromium } = pw;

const args = process.argv.slice(2);
const OUT = args.find((a) => !a.startsWith('--')) ?? 'creative-engine-audit-out';
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def; };
const flag = (name) => args.includes(`--${name}`);
const BASE = process.env.GLADOS_URL ?? 'http://127.0.0.1:4000';
const ROUTE = process.env.ENGINE_ROUTE ?? '/creative-engine';
// The same audit runs on AdPilot: ENGINE_ROUTE=/adpilot ENGINE_SCOPE='[data-adpilot]' --modes live (no sample mode there).
const SCOPE = process.env.ENGINE_SCOPE ?? '[data-creative-engine]';
const THEMES = opt('themes', 'console,red,light,frost,grey-frost').split(',');
const WIDTHS = opt('widths', '1440,1280,1024,820').split(',').map(Number);
const MODES = opt('modes', 'sample,live').split(',');
const DEEP = flag('deep');
const SHOTS = flag('shots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

// In the page: record effects that leave no DOM trace (audio preview, clipboard copy, a download link).
const HOOKS = `(() => {
  window.__aeFx = [];
  const fx = (k) => window.__aeFx.push(k);
  try { const play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { fx('play'); return play.call(this).catch(() => {}); }; } catch {}
  try { if (navigator.clipboard) { navigator.clipboard.writeText = async () => { fx('clipboard'); }; } } catch {}
  try { const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { fx('download'); return; } return click.call(this); }; } catch {}
  try { window.open = () => { fx('open'); return null; }; } catch {}
})();`;

// Tag every interactive element inside `scope` (a selector) and return their facts.
const TAG = (scope, prefix) => `(() => {
  const root = document.querySelector(${JSON.stringify(scope)});
  if (!root) return [];
  const sel = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=radio], [role=menuitem], [role=checkbox], [role=slider], [tabindex]:not([tabindex="-1"])';
  const out = [];
  const seen = new Map();
  [...root.querySelectorAll(sel)].forEach((e) => {
    if (e.closest('[data-audit-skip]')) return;
    // A stable id from what the element is, so a re-render that reorders the DOM does not shift the ids.
    const what = [e.tagName, e.getAttribute('role') || '', e.getAttribute('aria-label') || '', (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40), e.getAttribute('href') || ''].join('|');
    const n = (seen.get(what) ?? 0) + 1;
    seen.set(what, n);
    let h = 0;
    for (const c of what) h = (h * 31 + c.charCodeAt(0)) | 0;
    const id = ${JSON.stringify(prefix)} + (h >>> 0).toString(36) + '-' + n;
    e.setAttribute('data-audit', id);
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    out.push({ id, tag: e.tagName.toLowerCase(), role: e.getAttribute('role') || '', type: e.getAttribute('type') || '',
      text: (e.innerText || e.value || '').replace(/\\s+/g, ' ').trim().slice(0, 50), label: e.getAttribute('aria-label') || '', title: e.getAttribute('title') || '',
      disabled: !!e.disabled || e.getAttribute('aria-disabled') === 'true', visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
      href: e.getAttribute('href') || '', selected: e.getAttribute('aria-selected') === 'true' || e.getAttribute('aria-checked') === 'true', pressed: e.getAttribute('aria-pressed') === 'true' || e.getAttribute('data-on') === 'true' });
  });
  return out;
})()`;

// Things with a pointer cursor that are not controls and not inside one: they look clickable and are not.
const LOOKALIKES = (scope) => `(() => {
  const root = document.querySelector(${JSON.stringify(scope)});
  if (!root) return [];
  const ctl = 'button, a[href], input, select, textarea, label, [role=button], [role=tab], [role=menuitem], [role=checkbox], [role=slider], [tabindex]';
  return [...root.querySelectorAll('*')].filter((e) => {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (getComputedStyle(e).cursor !== 'pointer') return false;
    if (e.closest(ctl)) return false;
    return !e.querySelector(ctl);
  }).map((e) => ({ cls: String(e.className).slice(0, 60), text: (e.innerText || '').trim().slice(0, 40) }));
})()`;

const ARM = `(() => {
  window.__aeMut = 0;
  window.__aeObs?.disconnect();
  window.__aeObs = new MutationObserver((list) => { for (const m of list) { if (m.target.closest && m.target.closest('[data-audit-noise]')) continue; window.__aeMut += 1; } });
  window.__aeObs.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: undefined });
  return { url: location.href, dialogs: document.querySelectorAll('[role=dialog]').length, fx: window.__aeFx.length, focus: document.activeElement?.getAttribute('data-audit') || document.activeElement?.tagName || '' };
})()`;
const READ = `(() => ({ url: location.href, dialogs: document.querySelectorAll('[role=dialog]').length, fx: window.__aeFx.length, mut: window.__aeMut, focus: document.activeElement?.getAttribute('data-audit') || document.activeElement?.tagName || '' }))()`;

const report = { base: BASE, at: new Date().toISOString(), runs: [] };
let failures = 0;

for (const mode of MODES) {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const url = `${BASE}${ROUTE}${mode === 'sample' ? '?sample=1' : ''}`;
      const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
      await ctx.addInitScript((t) => { try { localStorage.setItem('glados-theme', t); } catch {} }, theme);
      // APPEARANCE='legacy.mono.dark' audits another style through the appearance cookie (founderos-ui pages/creative-engine.md CE-1).
      if (process.env.APPEARANCE) await ctx.addCookies([{ name: 'glados-appearance', value: process.env.APPEARANCE, url: BASE }]);
      // AUDIT_LOCAL='{"adpilot-library-open":"1"}' seeds per-viewer state (e.g. AdPilot's library open on a tab) before load.
      if (process.env.AUDIT_LOCAL) await ctx.addInitScript((kv) => { try { for (const [k, v] of Object.entries(JSON.parse(kv))) localStorage.setItem(k, v); } catch {} }, process.env.AUDIT_LOCAL);
      await ctx.addInitScript(HOOKS);
      let page = null;
      ctx.on('page', (p) => { if (page && p !== page) void p.close(); });
      let requests = 0;
      const blocked = [];
      await ctx.route('**/api/**', (route) => {
        const r = route.request();
        if (r.method() !== 'GET') { blocked.push(`${r.method()} ${new URL(r.url()).pathname}`); requests += 1; return route.abort(); }
        requests += 1;
        return route.continue();
      });
      page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
      const load = async () => {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 }).catch(() => {});
        await page.waitForSelector(SCOPE, { timeout: 30_000 });
        await sleep(700);
      };
      const closeLayers = async () => {
        for (let i = 0; i < 4; i += 1) {
          const open = await page.evaluate(() => document.querySelectorAll('[role=dialog], [role=menu], .ae-pop, .ae-octane, [data-campaign-switcher]').length);
          if (!open) break;
          await page.keyboard.press('Escape');
          await sleep(150);
        }
      };
      await load();
      if (SHOTS) await page.screenshot({ path: path.join(OUT, `${mode}-${theme}-${width}.png`), fullPage: true });
      const run = { mode, theme, width, results: [], lookalikes: [], errors, blocked };

      /** Click every element tagged in `scope`; `reopen` puts the scope back when a click took it away. */
      const audit = async (scope, prefix, reopen) => {
        const tagged = await page.evaluate(TAG(scope, prefix));
        run.lookalikes.push(...(await page.evaluate(LOOKALIKES(scope))).map((l) => ({ scope, ...l })));
        for (const el of tagged) {
          if (!el.visible) continue;
          if (el.disabled) {
            const ok = !!el.title;
            run.results.push({ scope, ...el, verdict: ok ? 'disabled-with-reason' : 'DISABLED-NO-REASON' });
            if (!ok) failures += 1;
            continue;
          }
          // A link with a real destination works by definition; not following it keeps the run on this page.
          if (el.tag === 'a' && el.href && el.href !== '#') {
            run.results.push({ scope, ...el, verdict: 'link' });
            continue;
          }
          // Clicking the tab or radio option that is already selected is meant to do nothing.
          if ((el.role === 'tab' || el.role === 'radio') && el.selected) {
            run.results.push({ scope, ...el, verdict: 'selected-tab' });
            continue;
          }
          if (el.tag === 'input' || el.tag === 'textarea' || el.tag === 'select') {
            run.results.push({ scope, ...el, verdict: 'field' });
            continue;
          }
          if (!(await page.$(`[data-audit="${el.id}"]`))) { await reopen(); await page.evaluate(TAG(scope, prefix)); }
          if (!(await page.$(`[data-audit="${el.id}"]`))) { await load(); await reopen(); await page.evaluate(TAG(scope, prefix)); }
          if (!(await page.$(`[data-audit="${el.id}"]`))) { run.results.push({ scope, ...el, verdict: 'gone', note: 'not on the page after a reload (its text is state, e.g. a ticking time)' }); continue; }
          await sleep(120);
          const before = await page.evaluate(ARM);
          const reqBefore = requests;
          let verdict = 'effect';
          let note = '';
          try {
            // Centre it first: the shell's sticky topbar covers whatever sits at the very top of the viewport.
            // Then hit-test its centre ourselves: Playwright would scroll elsewhere and blame whatever is on top there.
            const hit = await page.$eval(`[data-audit="${el.id}"]`, (e) => {
              e.scrollIntoView({ block: 'center' });
              const r = e.getBoundingClientRect();
              // A visually hidden control (.sr-only: the globe's keyboard list of its pins) is reached by keyboard, not the pointer.
              if ((r.width <= 1 && r.height <= 1) || e.closest('.sr-only')) return { sr: true };
              const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              if (!top || e === top || e.contains(top)) return null;
              return { cls: String(top.closest('[class]')?.className ?? top.tagName).slice(0, 80), thumb: !!top.closest('.ae-tl-thumb, .ae-tl-tip') };
            });
            if (el.role === 'slider') {
              // A keyboard slider (the GladOS run strip, kit GTimelineStrip): its contract is Arrow keys, not a click.
              await page.focus(`[data-audit="${el.id}"]`);
              await page.keyboard.press('ArrowLeft');
            } else if (hit?.sr) {
              await page.focus(`[data-audit="${el.id}"]`);
              await page.keyboard.press('Enter');
            } else if (hit) {
              verdict = hit.thumb ? 'under-thumb' : 'COVERED';
              note = `covered by .${hit.cls}`;
              throw Object.assign(new Error(note), { audit: true });
            } else {
              await page.click(`[data-audit="${el.id}"]`, { timeout: 2500 });
            }
          } catch (e) {
            if (e.audit) { /* verdict set by the hit test */ } else {
            const msg = String(e.message);
            const hit = msg.split('\n').reverse().find((l) => /intercepts pointer events|not visible|not stable|outside of the viewport/.test(l)) ?? msg.split('\n')[0];
            // The run scrubber's own thumb sits over the dot it selects (S07 F12); those dots are reached by drag and arrow keys.
            verdict = /intercepts pointer events/.test(msg) ? (/ae-tl-thumb|ae-tl-tip/.test(hit) ? 'under-thumb' : 'COVERED') : 'CLICK-FAILED';
            note = hit.trim().slice(0, 200);
            }
          }
          await sleep(350);
          const after = await page.evaluate(READ).catch(() => ({ url: 'navigated', dialogs: 0, fx: 0, mut: 1, focus: '' }));
          if (verdict === 'effect') {
            const what = [];
            if (after.url !== before.url) what.push('url');
            if (after.dialogs !== before.dialogs) what.push('dialog');
            if (after.fx !== before.fx) what.push('fx');
            if (after.mut > 0) what.push(`dom:${after.mut}`);
            if (requests !== reqBefore) what.push('request');
            if (after.focus !== before.focus && after.focus !== el.id) what.push('focus');
            // A choice that is already on (aria-pressed) is meant to stay as it is when clicked again.
            // A slider over an empty range has nothing to step to; that is its honest empty state, not a dead control.
            const emptySlider = el.role === 'slider' && what.length === 0 && /^Nothing/.test(await page.$eval(`[data-audit="${el.id}"]`, (e) => e.getAttribute('aria-valuetext') || '').catch(() => ''));
            if (what.length === 0) verdict = el.pressed ? 'already-on' : emptySlider ? 'empty-slider' : 'INERT';
            note = what.join(' ');
          }
          if (/^[A-Z]/.test(verdict)) failures += 1;
          run.results.push({ scope, ...el, verdict, note });
          // Put the page back for the next element.
          if (!page.url().startsWith(url.split('?')[0]) || new URL(page.url()).pathname !== ROUTE) { await load(); await reopen(); await page.evaluate(TAG(scope, prefix)); continue; }
          await reopen(true);
        }
      };

      // Level 1: the page itself (everything outside dialogs).
      const pageScope = SCOPE;
      await audit(pageScope, 'p', async (soft) => {
        await closeLayers();
        const engineTab = await page.$('#ae-tab-engine[aria-selected="false"]');
        if (engineTab) { await engineTab.click(); await sleep(200); }
        if (!soft) await page.evaluate(TAG(pageScope, 'p'));
      });

      // Level 2: every sheet and drawer the nav pills open (.ae-pill in Classic and Legacy, .g-pill in the GladOS tree).
      if (DEEP) {
        const openers = await page.evaluate(() => [...document.querySelectorAll('[data-creative-engine] .ae-dash-pills :is(.ae-pill, .g-pill)')].map((b, i) => ({ i, text: (b.innerText || '').split('\n')[0].trim() })));
        const extra = ['Connect Arcads', 'Settings'];
        for (const o of [...openers.map((x) => x.text), ...extra]) {
          const openIt = async () => {
            await closeLayers();
            if (o === 'Connect Arcads' || o === 'Settings') {
              // Connect Arcads lives behind Credits & health in every state.
              await page.click('.ae-dash-pills :is(.ae-pill, .g-pill):has-text("Credits & health")', { timeout: 2500 }).catch(() => {});
              await sleep(400);
              await page.click('[role=dialog] button:has-text("Settings"), [role=dialog] button:has-text("Connect")', { timeout: 2500 }).catch(() => {});
            } else {
              await page.click(`.ae-dash-pills :is(.ae-pill, .g-pill):has-text(${JSON.stringify(o)})`, { timeout: 2500 }).catch(() => {});
            }
            await sleep(600);
          };
          if (o === 'Settings') continue;
          if (o === 'Motion console') continue; // the console has its own audit (scripts/motion-console-audit.mjs)
          await openIt();
          const has = await page.$('[role=dialog], .ae-pop, [data-campaign-switcher]');
          if (!has) { run.results.push({ scope: o, verdict: 'NO-DIALOG', text: o }); failures += 1; continue; }
          await page.evaluate(() => { const d = [...document.querySelectorAll('[role=dialog], .ae-pop, [data-campaign-switcher]')].at(-1); d?.setAttribute('data-audit-scope', '1'); });
          await audit('[data-audit-scope="1"]', `d${o.replace(/\W+/g, '').slice(0, 6)}-`, async () => {
            // Close any nested layer first; reopen the sheet if the click closed it.
            for (let i = 0; i < 3; i += 1) {
              const n = await page.evaluate(() => document.querySelectorAll('[role=dialog], .ae-pop, [data-campaign-switcher]').length + (document.querySelector('.ae-octane') ? 1 : 0));
              if (n <= 1) break;
              await page.keyboard.press('Escape');
              await sleep(200);
            }
            if (!(await page.$('[data-audit-scope="1"]'))) {
              await openIt();
              await page.evaluate(() => { const d = [...document.querySelectorAll('[role=dialog], .ae-pop, [data-campaign-switcher]')].at(-1); d?.setAttribute('data-audit-scope', '1'); });
            }
          });
          await closeLayers();
          // Each opener starts from a fresh page: a control inside one layer (the kit campaign switcher's New concept or
          // a campaign row) can move the URL or leave a layer Escape does not close, and the next pill would miss.
          await load();
        }
      }

      const bad = run.results.filter((r) => /^[A-Z]/.test(r.verdict));
      console.log(`${mode} ${theme} ${width}: ${run.results.length} elements, ${bad.length} failing, ${run.lookalikes.length} look-alikes, ${errors.length} page errors`);
      for (const b of bad) console.log(`  ${b.verdict} [${b.scope}] ${b.tag ?? ''} "${b.text || b.label || b.title}" ${b.note ?? ''}`);
      for (const l of run.lookalikes) console.log(`  LOOKALIKE [${l.scope}] .${l.cls} "${l.text}"`);
      failures += run.lookalikes.length;
      report.runs.push(run);
      await ctx.close();
    }
  }
}
fs.writeFileSync(path.join(OUT, 'click-audit.json'), JSON.stringify(report, null, 2));
await browser.close();
console.log(failures ? `FAIL: ${failures} problems (see ${OUT}/click-audit.json)` : `PASS: zero inert elements (${OUT}/click-audit.json)`);
process.exit(failures ? 1 : 0);
