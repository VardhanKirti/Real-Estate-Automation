// Shared helpers for scripts/l-audit.mjs (Bennett Legacy audit, docs/projects/founderos-ui/SPEC.md §2.5).
// Pure functions only, so tests import them (tests/legacy-style.test.ts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** L_READY and L_NO_SLAB from lib/l-ready.ts (plain string-array literals). */
export function readLReady(root = ROOT) {
  const src = fs.readFileSync(path.join(root, 'lib/l-ready.ts'), 'utf8');
  const list = (name) => {
    const m = src.match(new RegExp(`export\\s+const\\s+${name}\\b[^=]*=\\s*\\[([\\s\\S]*?)\\]`));
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  };
  return { source: 'lib/l-ready.ts', routes: list('L_READY'), noSlab: list('L_NO_SLAB') };
}

/** Is `route` (query ignored) a full-height workspace that renders without the slab? */
export function isWorkspace(route, noSlab) {
  const p = route.split(/[?#]/)[0] || '/';
  return noSlab.some((r) => p === r || p.startsWith(`${r}/`));
}

/** WCAG minimum for a text sample: 3:1 for large text (24px, or 18.66px bold), else 4.5:1. */
export function minContrast({ size, weight }) {
  return size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
}

/** Class tokens that belong to the GladOS kit (`g-*`) or the Legacy kit (`l-*`). */
export const isGClass = (c) => /^g-[a-z0-9]/.test(c);
export const isLClass = (c) => /^l-[a-z0-9]/.test(c);
