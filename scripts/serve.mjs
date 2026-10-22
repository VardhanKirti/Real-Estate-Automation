#!/usr/bin/env node
/**
 * Boot wrapper for `npm run dev`, `npm start` and `npm run preview`.
 *
 * Decides the bind address from whether an operator password exists:
 *   - no password  → 127.0.0.1 only. Any other GLADOS_HOST is refused, so a
 *                    fresh install can never be reached from the network open.
 *   - password set → GLADOS_HOST if given (a Tailscale IP, a LAN address,
 *                    0.0.0.0), else still 127.0.0.1.
 *
 * The password itself is set from the UI (Setup → Security) and lands in
 * .env.local as GLADOS_PASSWORD_HASH + GLADOS_SESSION_SECRET. Setting it does
 * not need a restart; changing the bind address does.
 *
 *   node scripts/serve.mjs dev       next dev (on-demand compile; for coding)
 *   node scripts/serve.mjs start     next start on an existing build (.next or NEXT_DIST_DIR)
 *   node scripts/serve.mjs preview   build into .next-preview, then next start on it
 *
 * `preview` is the review server (founderos-ui SPEC 4.1 a1, O5): every route is compiled
 * ahead of time and <Link> prefetch works, so page switches are timed as a user sees them,
 * not as `next dev` compiles them. It builds into its own dist dir (NEXT_DIST_DIR, default
 * .next-preview), so a `next dev` on the same checkout keeps its `.next` untouched. Pass
 * `--no-build` to restart on the last preview build without rebuilding. A build failure
 * exits non-zero and never starts a stale server. Code changes need a new `preview` run.
 */
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const MODES = ['dev', 'start', 'preview'];
const mode = MODES.includes(process.argv[2]) ? process.argv[2] : 'dev';
const skipBuild = process.argv.includes('--no-build');

function parseEnv(content) {
  const out = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const stripped = line.startsWith('export ') ? line.slice(7) : line;
    const eq = stripped.indexOf('=');
    if (eq <= 0) continue;
    const key = stripped.slice(0, eq).trim();
    let value = stripped.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function isLoopback(host) {
  const h = host.trim().toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

let envLocal = {};
try {
  envLocal = parseEnv(readFileSync(process.env.GLADOS_ENV_LOCAL ?? path.join(process.cwd(), '.env.local'), 'utf8'));
} catch {
  envLocal = {};
}
const get = (k) => (process.env[k] ?? envLocal[k] ?? '').trim();
// The product name this deployment shows (lib/brand.ts): FounderOS unless GLADOS_BRAND=glados.
const brandName = get('GLADOS_BRAND').toLowerCase() === 'glados' ? 'GladOS' : 'FounderOS';

const host = get('GLADOS_HOST') || '127.0.0.1';
const port = get('PORT') || '4100';
const hasPassword = Boolean(get('GLADOS_PASSWORD_HASH') && get('GLADOS_SESSION_SECRET'));

if (!isLoopback(host) && !hasPassword) {
  console.error(
    [
      `${brandName} refuses to listen on ${host}: no operator password is set.`,
      'Start it without GLADOS_HOST, open http://localhost:' + port + '/setup and set a password',
      `under Security, then set GLADOS_HOST=${host} and start again.`,
    ].join('\n'),
  );
  process.exit(1);
}

console.log(
  hasPassword
    ? `${brandName} · password set · listening on ${host}:${port}`
    : `${brandName} · no password yet · this machine only · http://localhost:${port}/setup to set one`,
);

// Creative Engine rename (S02 FR-14): move public/content-media/ad-engine to
// public/content-media/creative-engine BEFORE Next starts. `next start` lists
// public/ once at boot, so a rename done later by the app (lib/creative-engine/
// migrate.ts, which still covers `next dev` and the data stores) would 404
// every rehosted video until the next restart. Same rules as the app: only
// when the new dir is missing, one same-filesystem rename, never a copy or a
// delete, a failure only warns. Skipped when an asset dir override is set or
// CREATIVE_ENGINE_MIGRATE=0.
function migrateEngineAssets() {
  const env = (n) => process.env[`CREATIVE_ENGINE_${n}`] ?? process.env[`AD_ENGINE_${n}`];
  if (env('ASSET_DIR') || env('MIGRATE') === '0') return;
  const base = path.join(process.cwd(), 'public', 'content-media');
  const old = path.join(base, 'ad-engine');
  const next = path.join(base, 'creative-engine');
  try {
    if (existsSync(next) || !existsSync(old)) return;
    renameSync(old, next);
    console.log(`[creative-engine] moved ${old} to ${next}`);
  } catch (err) {
    console.warn(`[creative-engine] could not move ${old} (${err?.code ?? err}); the old dir stays in use`);
  }
}
migrateEngineAssets();

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
// next.config.mjs reads NEXT_DIST_DIR; preview pins its own dir so it never shares `.next` with dev.
const distDir = mode === 'preview' ? process.env.NEXT_DIST_DIR || '.next-preview' : process.env.NEXT_DIST_DIR;
const childEnv = { ...process.env, GLADOS_HOST: host, PORT: port, ...(distDir ? { NEXT_DIST_DIR: distDir } : {}) };

let current = null;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (current ? current.kill(sig) : process.exit(1)));

function run(args) {
  return new Promise((resolve) => {
    current = spawn(process.execPath, [nextBin, ...args], { stdio: 'inherit', env: childEnv });
    current.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

if (mode === 'preview') {
  const built = existsSync(path.join(process.cwd(), distDir, 'BUILD_ID'));
  if (skipBuild && !built) {
    console.error(`--no-build: no build in ${distDir} yet. Run without --no-build once.`);
    process.exit(1);
  }
  if (!skipBuild) {
    console.log(`${brandName} · preview · building into ${distDir}`);
    const code = await run(['build']);
    if (code !== 0) {
      console.error(`${brandName} · preview · build failed (exit ${code}); not starting.`);
      process.exit(code);
    }
  }
  console.log(`${brandName} · preview · serving the build in ${distDir}`);
}
process.exit(await run([mode === 'dev' ? 'dev' : 'start', '-p', port, '-H', host]));
