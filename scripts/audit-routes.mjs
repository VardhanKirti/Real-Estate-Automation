// Shared lists for the theme audit scripts (theme-audit, theme-hover-check, ground-check).
// Themes are read from lib/theme.ts so a new colourway joins every audit by default.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** THEMES from lib/theme.ts, in registry order. */
export const THEME_IDS = (() => {
  const src = fs.readFileSync(path.join(root, 'lib/theme.ts'), 'utf8');
  const m = src.match(/export const THEMES = \[([^\]]+)\]/);
  return m ? [...m[1].matchAll(/'([\w-]+)'/g)].map((x) => x[1]) : ['console'];
})();

/** Themes whose signal is not green: token greens must be 0 there too (S06 FR-b9). */
export const ZERO_GREEN_THEMES = ['red', 'frost', 'grey-frost'];

/** The 33 audited routes. Dynamic routes and /design/* specimens are out (pinned surfaces). */
export const AUDIT_ROUTES = [
  '/', '/wizard', '/inbox', '/funnel', '/brand-deals', '/workflows', '/social', '/social/beehiiv', '/adpilot',
  '/creative-engine', '/creative-engine?engine=console', '/finances', '/trading', '/agents', '/chats', '/tasks', '/skills', '/blueprint',
  '/database', '/compute', '/usage', '/brain', '/knowledge', '/drift', '/org', '/analytics', '/lab', '/roadmap',
  '/integrations', '/integrations/whatsapp', '/setup', '/login',
  '/clients', '/lead-magnets',
];

/** Routes from the ROUTES env (space separated) or the default list. */
export function routesFromEnv(arg) {
  if (arg && arg !== 'all') return arg.split(',');
  const env = (process.env.ROUTES ?? '').split(' ').filter(Boolean);
  return env.length ? env : AUDIT_ROUTES;
}

/** Same-origin Chrome DevTools session on CDP_PORT (default 9333): { send, ev, close }. */
export async function cdp() {
  const port = process.env.CDP_PORT ?? '9333';
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); } };
  await new Promise((r) => (ws.onopen = r));
  const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  await send('Page.enable');
  await send('Runtime.enable');
  // Audits never spend: every non-GET /api request is failed (SPEC §3.1.7).
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = d.params;
    if (request.method === 'GET' || request.method === 'HEAD') send('Fetch.continueRequest', { requestId }).catch(() => {});
    else send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
  });
  return { send, ev, close: () => ws.close() };
}
