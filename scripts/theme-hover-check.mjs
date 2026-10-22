// Hover and live-switch check over CDP (same Chrome as theme-audit.mjs, port 9333 or CDP_PORT).
// For each theme: hover a sidebar link, a .hoverable card and the primary button, screenshot each and
// record the computed glow; then open /setup, click every theme card and confirm <html data-theme>
// and aria-pressed follow. Frost and Grey Frost must show the shared blue-white glow (S06 AC06.11).
// Usage: S=… BASE=http://127.0.0.1:4302 node scripts/theme-hover-check.mjs [themes,comma|all] [outdir]
import fs from 'node:fs';
import { THEME_IDS, cdp } from './audit-routes.mjs';
const [,, themesArg = 'all', outArg] = process.argv;
const BASE = process.env.BASE ?? 'http://127.0.0.1:4302';
const OUT = outArg ?? `${process.env.S}/audit/hover`; fs.mkdirSync(OUT, { recursive: true });
const themes = themesArg === 'all' ? THEME_IDS : themesArg.split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { send, ev, close } = await cdp();
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64')); };
const rectOf = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
const hover = async (sel) => { const r = await rectOf(sel); if (!r) return null; await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + r.width / 2, y: r.y + r.height / 2 }); await sleep(450); return r; };
const FROST_GLOW = /rgba\(120, 180, 255/;
// [label, route, selector]: .hoverable cards live on Setup (the theme picker), not on Home
const TARGETS = [
  ['nav', '/', '.os-sidebar a[href="/inbox"], .os-sidebar a[href="/funnel"]'],
  ['button', '/', 'main .c-btn-primary, main a.c-btn, main button.c-btn, main button'],
  ['card', '/setup', 'main .hoverable'],
];
const report = {};
let failed = false;
for (const theme of themes) {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('glados-theme',${JSON.stringify(theme)})}catch(e){}` });
  const t = {};
  let at = '';
  for (const [label, route, sel] of TARGETS) {
    if (route !== at) { await send('Page.navigate', { url: BASE + route }); await sleep(4000); at = route; }
    const r = await hover(sel);
    if (!r) { t[label] = 'missing'; continue; }
    const pad = 24; await shot(`${theme}--hover-${label}`, { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: Math.min(1440, r.width + pad * 2), height: Math.min(900, r.height + pad * 2) });
    t[label] = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});const c=getComputedStyle(e);return {color:c.color,bg:c.backgroundColor,shadow:c.boxShadow,textShadow:c.textShadow,border:c.borderColor}})()`);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 890 });
  if (theme === 'frost' || theme === 'grey-frost') {
    t.glow = { nav: FROST_GLOW.test(t.nav?.shadow ?? ''), card: FROST_GLOW.test(t.card?.shadow ?? '') };
    if (!t.glow.nav || !t.glow.card) failed = true;
  }
  // live switch on the picker (already on /setup): click each card and read data-theme and aria-pressed back
  t.switch = await ev(`(async()=>{const out={};for(const c of document.querySelectorAll('button[data-theme-id]')){c.click();await new Promise(r=>setTimeout(r,150));out[c.dataset.themeId]={applied:document.documentElement.getAttribute('data-theme'),pressed:c.getAttribute('aria-pressed')}}return out})()`);
  for (const [id, v] of Object.entries(t.switch ?? {})) if (v.applied !== id || v.pressed !== 'true') failed = true;
  if (Object.keys(t.switch ?? {}).length !== THEME_IDS.length) failed = true;
  report[theme] = t;
}
fs.writeFileSync(`${OUT}/hover-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(failed ? 'FAIL' : 'PASS');
if (failed) process.exitCode = 1;
close();
