#!/usr/bin/env node
/**
 * Warms every page AND every API route this dev server actually serves, in
 * one pass, with plain HTTP requests (no browser needed — works on any OS,
 * unlike scripts/nav-timing.mjs's CDP walk which needs a local Chrome).
 *
 * Why this exists: `next dev` compiles a route (page or API) on its first
 * real request, not at boot. lib/warm.ts's instrumentation hook pre-fills
 * the DATA caches (lib/swr.ts) at boot, but that's a different cost from
 * compiling the route's own module — calling a cached function in-process
 * doesn't make Next compile the HTTP route around it. A route is only
 * actually fast once BOTH have happened once.
 *
 * STANDING PRACTICE: run this once after every dev-server restart, before
 * telling anyone the app is ready to use:
 *
 *   node scripts/warm-local.mjs --base http://127.0.0.1:4100
 *
 * Add a new entry to EXTRA_ROUTES below whenever a new API route is added
 * that a page fetches client-side (same rule as lib/warm.ts: every new live
 * read needs to be named somewhere it will actually get hit before a real
 * user hits it first).
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, '..', 'app');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const base = arg('base', 'http://127.0.0.1:4100');

/** Every top-level static page.tsx route (skips dynamic [x] segments and groups). */
function topLevelPages() {
  const routes = ['/'];
  for (const entry of readdirSync(appDir)) {
    const full = path.join(appDir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry.startsWith('_') || entry.startsWith('(') || entry.startsWith('[') || entry === 'api') continue;
    try {
      statSync(path.join(full, 'page.tsx'));
      routes.push(`/${entry}`);
    } catch {
      /* no page.tsx at this level (a layout-only or api-only folder) — skip */
    }
  }
  return routes;
}

/** API routes nothing else here would discover (client-fetched, not navigated to).
 *  Add a line per new one — this is the one place a new live route must be named. */
const EXTRA_ROUTES = ['/api/real-estate/leads', '/api/real-estate/properties', '/api/real-estate/brokers'];

async function hit(route) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(30000) });
    return { route, status: res.status, ms: Date.now() - t0 };
  } catch (err) {
    return { route, status: 'ERR', ms: Date.now() - t0, error: err instanceof Error ? err.message : String(err) };
  }
}

const routes = [...topLevelPages(), ...EXTRA_ROUTES];
console.log(`Warming ${routes.length} routes against ${base} ...`);
const results = [];
for (const route of routes) {
  results.push(await hit(route));
}
for (const r of results) {
  console.log(`${String(r.status).padEnd(5)} ${String(r.ms).padStart(6)}ms  ${r.route}${r.error ? `  (${r.error})` : ''}`);
}
const slow = results.filter((r) => typeof r.ms === 'number' && r.ms > 2000);
console.log(`\nDone. ${slow.length ? `${slow.length} route(s) took >2s on this first hit (expected — that's the compile cost being paid once, now).` : 'Everything was already warm.'}`);
