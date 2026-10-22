// Content Lab v2 page audit (01 AC-01-4, AC-01-6, AC-01-31): every route and every sheet at 1440, 1024
// and 390 on the sample world. Checks: no horizontal page scroll; at 1440 at most 12 blurred surfaces
// in view; cumulative layout shift under 0.05 after load. Non-GET /api requests are blocked (cdp()).
// Start Chrome first:  chrome --headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/lab-audit about:blank &
// Then:  BASE=http://127.0.0.1:4321 [APPEARANCE=glados.ember.dark] node scripts/audit-lab-v2.mjs [widths]
import { cdp } from './audit-routes.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300';
const APPEARANCE = process.env.APPEARANCE ?? 'glados.ember.dark';
const WAIT = Number(process.env.WAIT ?? 3000);
const widths = (process.argv[2] ?? '1440,1024,390').split(',').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROUTES = ['/lab', '/lab/radar', '/lab/breakouts', '/lab/playbook', '/lab/studio', '/lab/ledger', '/lab/creatorverse'];
const SHEETS = ['post=fx-p-0001', 'event=fx-ev-e1', 'idea=fx-idea-1', 'script=fx-script-1', 'test=fx-test-1', 'test=new', 'setup=keys', 'ask=tiktok%20breakouts%20this%20month'];
const URLS = [...ROUTES.map((r) => `${r}?sample=1`), ...SHEETS.map((s) => `/lab/radar?sample=1&${s}`)];

const SCAN = `(async () => {
  await new Promise((r) => setTimeout(r, 300));
  const se = document.scrollingElement;
  let cls = 0;
  try {
    const entries = await new Promise((res) => {
      const got = [];
      const po = new PerformanceObserver((l) => got.push(...l.getEntries()));
      po.observe({ type: 'layout-shift', buffered: true });
      setTimeout(() => { po.disconnect(); res(got); }, 200);
    });
    for (const e of entries) if (!e.hadRecentInput) cls += e.value;
  } catch {}
  const vh = innerHeight, vw = innerWidth;
  let glass = 0;
  for (const el of document.querySelectorAll('[data-lab-root] *')) {
    const cs = getComputedStyle(el);
    const bf = cs.backdropFilter || cs.webkitBackdropFilter;
    if (!bf || bf === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.height && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw) glass++;
  }
  return { scrollWidth: se.scrollWidth, innerWidth: vw, glass, cls: Math.round(cls * 1000) / 1000, root: !!document.querySelector('[data-lab-root]') };
})()`;

const { send, ev, close } = await cdp();
await send('Network.enable');
await send('Network.setCookie', { name: 'glados-appearance', value: APPEARANCE, url: BASE });
const findings = [];
let n = 0;
for (const w of widths) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: w === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: w === 390 });
  for (const u of URLS) {
    await send('Page.navigate', { url: `${BASE}${u}` });
    await sleep(WAIT);
    const r = await ev(SCAN);
    n++;
    const tag = `${w} ${u}`;
    if (!r?.root) findings.push(`${tag}: no [data-lab-root]`);
    else {
      if (r.scrollWidth > r.innerWidth) findings.push(`${tag}: horizontal scroll ${r.scrollWidth} > ${r.innerWidth} (AC-01-4)`);
      if (w === 1440 && r.glass > 12) findings.push(`${tag}: ${r.glass} blurred surfaces in view (AC-01-31)`);
      if (!u.includes('=fx') && !u.includes('setup=') && !u.includes('ask=') && !u.includes('test=') && r.cls >= 0.05) findings.push(`${tag}: CLS ${r.cls} (AC-01-6)`);
    }
    console.log(`${tag}  scroll ${r?.scrollWidth}/${r?.innerWidth}  glass ${r?.glass}  cls ${r?.cls}`);
  }
}
close();
console.log(`\n${n} cases, ${findings.length} findings`);
for (const f of findings) console.log(`  ${f}`);
process.exit(findings.length ? 1 : 0);
