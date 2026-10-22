#!/usr/bin/env node
/**
 * The name founderos-ui SPEC 4.1 (a7) and AC-8 use for the page-switch timing run. It is
 * scripts/perf-nav.mjs with the browser walk on: every sidebar link clicked twice, click to
 * first visible change and click to settled content per route, a p50/p95/max summary against
 * the spec targets, non-GET /api aborted. Every other flag passes through.
 *
 *   node scripts/nav-timing.mjs --base http://127.0.0.1:4100 [--ui classic] [--json out.json]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (!args.includes('--cdp')) args.push('--cdp');
const child = spawn(process.execPath, [path.join(here, 'perf-nav.mjs'), ...args], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
