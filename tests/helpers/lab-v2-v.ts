/**
 * Lane V test helpers: in-memory stores (fixture world, blank, crafted), flags for each mode, and
 * one call that builds a page or sheet the way the routes do.
 */
import Database from 'better-sqlite3';
import { LAB_DDL } from '@/lib/db';
import { labStore, type LabStore } from '@/lib/lab/store';
import { seedLabFixtures, FIXTURE_IDS } from '@/lib/lab/fixtures';
import { buildPageView, buildSheet } from '@/lib/lab/view/build';
import { labParams } from '@/lib/lab/context';
import type { LabContext } from '@/lib/lab/context';
import type { LabPage, SheetKind } from '@/lib/lab/view/shared';

export const NOW = new Date('2026-10-11T15:00:00.000Z');
export const ENV = { GLADOS_TZ: 'UTC' };
export { FIXTURE_IDS };

type Flags = LabContext['flags'];
const base: Flags = { configured: true, sample: false, filming: false, dry: false, dryReason: null, dryLabel: null, setupHref: '/lab?setup=keys', fixtureName: null, agentName: 'Content Lab' } as Flags;
export const FLAGS = {
  real: base,
  sample: { ...base, configured: false, sample: true, fixtureName: 'Content Lab sample: a fictional AI-space niche' } as Flags,
  filming: { ...base, configured: false, filming: true, dry: true, dryReason: 'filming', dryLabel: 'Filming · no charges' } as Flags,
  notConfigured: { ...base, configured: false } as Flags,
};

export function blankStore(): LabStore {
  const db = new Database(':memory:');
  db.exec(LAB_DDL);
  return labStore(db);
}

let fixture: LabStore | null = null;
/** The fixture world (shared, read-only by convention). */
export function fixtureStore(): LabStore {
  if (!fixture) {
    fixture = blankStore();
    seedLabFixtures(fixture, NOW);
  }
  return fixture;
}

export function params(q: Record<string, string> = {}) {
  return labParams((k) => q[k] ?? null);
}

export function page<P extends LabPage>(p: P, store: LabStore, flags: Flags, q: Record<string, string> = {}, now = NOW) {
  return buildPageView(p, store, params(q), flags, now, { env: ENV, prefillPost: q.post ?? null, from: q.from ? Number(q.from) : 0 });
}

export function sheet(kind: SheetKind, id: string, store: LabStore, flags: Flags, q: Record<string, string> = {}, now = NOW) {
  return buildSheet(kind, id, store, params({ ...q, [kind]: id }), flags, now, { env: ENV, prefillPost: q.post ?? null });
}

/** Every key and string in a JSON-able value, for copy and naming scans. */
export function walk(v: unknown, onKey: (k: string, path: string) => void, onString: (s: string, path: string) => void, path = '$'): void {
  if (typeof v === 'string') return onString(v, path);
  if (Array.isArray(v)) return v.forEach((x, i) => walk(x, onKey, onString, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      onKey(k, `${path}.${k}`);
      walk(x, onKey, onString, `${path}.${k}`);
    }
  }
}
