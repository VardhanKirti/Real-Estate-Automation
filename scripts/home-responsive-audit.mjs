// Home responsive audit (SPEC S10 §10): the home page at every width, theme, Wizard dock width and
// sidebar width, with a full-page screenshot and an overlap / clip / out-of-card scan per case.
// Start Chrome first:  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/glados-audit about:blank &
// Then:  BASE=http://127.0.0.1:4300 node scripts/home-responsive-audit.mjs [themes|all] [widths|all] [docks|all] [sidebars] [outdir]
//   themes   comma list of lib/theme.ts ids (default all)
//   widths   comma list of viewport widths (default 1920,1600,1440,1280,1152,1024,900,768,390)
//   docks    comma list of 0 (closed) / dock widths (default 0,380,760; 380 only at >= 1280, 760 only at >= 1600)
//   sidebars comma list of stored sidebar widths (default 232; 64,184,232,320 for the S09 sweep)
// Findings: text boxes from different elements that intersect, text outside its card, horizontal page
// scroll while the home container is >= 320px, chart text under 10px, a finance header wider than its
// card, a card under the Wizard launcher at the bottom of the page, and a home ground that stops short
// of the document bottom. Exits 1 on any finding. Non-GET /api requests are blocked (cdp()).
import fs from 'node:fs';
import { THEME_IDS, cdp } from './audit-routes.mjs';

const [, , themesArg = 'all', widthsArg = 'all', docksArg = 'all', sidebarsArg = '232', outArg] = process.argv;
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300';
const OUT = outArg ?? 'docs/projects/ui-polish/shots/home-responsive/after';
const WAIT = Number(process.env.WAIT ?? 3500);
fs.mkdirSync(OUT, { recursive: true });
const themes = themesArg === 'all' ? THEME_IDS : themesArg.split(',');
const widths = widthsArg === 'all' ? [1920, 1600, 1440, 1280, 1152, 1024, 900, 768, 390] : widthsArg.split(',').map(Number);
const docks = docksArg === 'all' ? [0, 380, 760] : docksArg.split(',').map(Number);
const sidebars = sidebarsArg.split(',').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCAN = `(async () => {
  const home = document.querySelector('.h6-home');
  if (!home) return { error: 'no .h6-home on the page' };
  const findings = [];
  const vw = innerWidth;
  const homeW = Math.round(home.getBoundingClientRect().width);
  if (homeW >= 320 && document.documentElement.scrollWidth > vw + 1) findings.push('horizontal scroll: ' + document.documentElement.scrollWidth + ' > ' + vw);
  const label = (n) => (n.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 32);
  // visible rect of a text node: its box clipped by every overflow-clipping ancestor up to the home root
  const visible = (node) => {
    const rg = document.createRange(); rg.selectNodeContents(node);
    let r = rg.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    let box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    for (let el = node.parentElement; el && el !== home; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return null;
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || el.tagName.toLowerCase() === 'svg') {
        const e = el.getBoundingClientRect();
        box = { l: Math.max(box.l, e.left), t: Math.max(box.t, e.top), r: Math.min(box.r, e.right), b: Math.min(box.b, e.bottom) };
        if (box.r - box.l < 1 || box.b - box.t < 1) return null;
      }
    }
    return box;
  };
  const walker = document.createTreeWalker(home, NodeFilter.SHOW_TEXT);
  const texts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest('[aria-hidden="true"]:not(svg), .sr-only, title, style, script')) continue;
    const box = visible(n);
    if (box) texts.push({ n, el, box, card: el.closest('.h6-card, .h6-strip') });
  }
  for (let i = 0; i < texts.length; i++) {
    const a = texts[i];
    const c = a.card ? a.card.getBoundingClientRect() : home.getBoundingClientRect();
    if (a.box.l < c.left - 1 || a.box.r > c.right + 1 || a.box.t < c.top - 1 || a.box.b > c.bottom + 1) findings.push('outside card: "' + label(a.n) + '"');
    for (let j = i + 1; j < texts.length; j++) {
      const b = texts[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ox = Math.min(a.box.r, b.box.r) - Math.max(a.box.l, b.box.l);
      const oy = Math.min(a.box.b, b.box.b) - Math.max(a.box.t, b.box.t);
      if (ox > 2 && oy > 2) findings.push('overlap: "' + label(a.n) + '" x "' + label(b.n) + '" (' + Math.round(ox) + 'x' + Math.round(oy) + ')');
    }
  }
  for (const t of home.querySelectorAll('[data-h6-chart] svg text')) {
    const h = t.getBoundingClientRect().height;
    if (h > 0 && h < 10) findings.push('chart text ' + h.toFixed(1) + 'px: "' + label(t) + '"');
  }
  for (const h of home.querySelectorAll('[data-pc-header]')) if (h.scrollWidth > h.clientWidth + 1) findings.push('finance header ' + h.scrollWidth + ' > ' + h.clientWidth);
  for (const card of home.querySelectorAll('.h6-card, .h6-strip')) if (card.scrollWidth > card.clientWidth + 1) findings.push('card content wider than card: "' + label(card).slice(0, 20) + '" ' + card.scrollWidth + ' > ' + card.clientWidth);
  // bottom of the page: launcher clearance and a continuous ground
  scrollTo(0, document.documentElement.scrollHeight);
  await new Promise((r) => setTimeout(r, 250));
  const launcher = document.querySelector('.wiz-launch');
  if (launcher) {
    const l = launcher.getBoundingClientRect();
    for (const card of home.querySelectorAll('.h6-card, .h6-strip')) {
      const r = card.getBoundingClientRect();
      if (r.right > l.left && r.left < l.right && r.bottom > l.top - 8 && r.top < l.bottom) findings.push('launcher covers "' + label(card).slice(0, 20) + '"');
    }
  }
  const homeBottom = home.getBoundingClientRect().bottom + scrollY;
  if (homeBottom < document.documentElement.scrollHeight - 1) findings.push('ground stops at ' + Math.round(homeBottom) + ' of ' + document.documentElement.scrollHeight);
  const grid = home.querySelector('.h6-grid');
  scrollTo(0, 0);
  return { homeW, vw, docW: document.documentElement.scrollWidth, tier: grid ? getComputedStyle(grid).gridTemplateAreas : null, cols: grid ? getComputedStyle(grid).gridTemplateColumns : null, sidebar: getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w').trim(), findings };
})()`;

const { send, ev, close } = await cdp();
const report = [];
let failed = 0;
for (const theme of themes) {
  for (const w of widths) {
    for (const dock of docks) {
      if (dock === 380 && w < 1280) continue;
      if (dock === 760 && w < 1600) continue;
      for (const sb of sidebars) {
        const name = `${theme}-${w}${dock ? `-dock${dock}` : ''}${sidebars.length > 1 || sb !== 232 ? `-sb${sb}` : ''}`;
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
        const prefs = JSON.stringify({ v: 2, w: sb, lastFull: sb >= 184 ? sb : 232 });
        const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', {
          source: `try{localStorage.setItem('glados-theme',${JSON.stringify(theme)});localStorage.setItem('glados-sidebar',${JSON.stringify(prefs)});${dock ? `localStorage.setItem('glados-conductor-w','${dock}');` : ''}}catch(e){}`,
        });
        try {
          await send('Page.navigate', { url: `${BASE}/` });
          await sleep(WAIT);
          if (dock) {
            await ev(`window.dispatchEvent(new Event('conductor:open'))`);
            await sleep(900);
          }
          const scan = await ev(SCAN);
          const metrics = await send('Page.getLayoutMetrics');
          const height = Math.ceil(metrics.cssContentSize?.height ?? metrics.contentSize.height);
          const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height, scale: 1 } });
          fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(shot.data, 'base64'));
          const n = scan.error ? 1 : scan.findings.length;
          failed += n ? 1 : 0;
          report.push({ name, ...scan });
          console.log(`${name}: home ${scan.homeW}px ${scan.tier ?? ''} | ${scan.error ?? `${n} finding${n === 1 ? '' : 's'}`}`);
          for (const f of scan.findings ?? []) console.log(`   ${f}`);
        } catch (e) {
          failed += 1;
          report.push({ name, error: e.message });
          console.log(`${name}: ERROR ${e.message.slice(0, 100)}`);
        }
        await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
      }
    }
  }
}
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
close();
console.log(failed ? `${failed} case(s) with findings` : 'all clear');
process.exit(failed ? 1 : 0);
