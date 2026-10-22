import fs from 'node:fs';
import { openDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import { assertSeedTarget, dataDir, dataPath, filmingMode } from '@/lib/paths';
import { seedDemoDatabase } from './seed-v1';
import { clearSiteTables, seedFromSite, writeSiteFiles } from './company';
import { writeDemoBrain } from './brain';
import company from './company.json';

/**
 * The demo company FounderOS opens on.
 *
 * A fresh clone runs in demo mode (lib/paths.ts) until Settings switches it to
 * real data, and demo mode reads demo-data/, never data/. The first time the
 * demo store is needed it is built here, in one pass:
 *
 *   1. the structural rows (lib/seed.ts),
 *   2. the FounderOS v1 demo seed (./seed-v1.ts): tools, people, phases, the
 *      email list and the rest of what v1 shipped with,
 *   3. the demo company (./company.json, the same company founderos.sh shows)
 *      over everything it models: agents, tasks, runs, crons, skills,
 *      workflows, funnel, social, DMs, trading, brand deals, AdPilot, Drift
 *      and the Wizard's projects,
 *   4. the Optimal Engine markdown store and its stub CLI (./brain.ts).
 *
 * Every date is moved to "now" as it is written, and the store is rebuilt when
 * it is a week old, so the charts never age out of their 30-day windows.
 * Nothing here ever touches data/.
 */

const MARKER = '.demo-seeded-at';
const MAX_AGE_MS = 7 * 86_400_000;

type Company = { exportedAt: string } & Record<string, unknown>;

/** Move every ISO date in the exported company forward by whole days, so the
 *  company reads as of now rather than as of the day it was exported. */
export function shiftCompanyDates<T>(value: T, days: number): T {
  if (days === 0) return value;
  const by = days * 86_400_000;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v)) return new Date(Date.parse(v) + by).toISOString();
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(Date.parse(`${v}T12:00:00Z`) + by).toISOString().slice(0, 10);
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

function seededAt(): number | null {
  try {
    return Number(fs.readFileSync(dataPath(MARKER), 'utf8').trim()) || null;
  } catch {
    return null;
  }
}

/** True when demo mode is on and its store is missing or a week old. */
export function demoStoreStale(now = Date.now()): boolean {
  if (!filmingMode()) return false;
  const at = seededAt();
  return at == null || !fs.existsSync(dataPath('glados.db')) || now - at > MAX_AGE_MS;
}

/** Build the demo store from scratch. Refuses to run outside demo mode. */
export function buildDemoStore(now = Date.now()): { pages: number } {
  if (!filmingMode()) throw new Error('The demo store is built in demo mode only (demo-data/).');
  assertSeedTarget();
  const raw = company as unknown as Company;
  const site = shiftCompanyDates(raw, Math.round((now - Date.parse(raw.exportedAt)) / 86_400_000));

  fs.rmSync(dataDir(), { recursive: true, force: true });
  fs.mkdirSync(dataDir(), { recursive: true });
  const dbPath = dataPath('glados.db');
  let db = openDb(dbPath);
  seedDatabase(db);
  seedDemoDatabase(db);
  db.close();
  clearSiteTables(dbPath);
  db = openDb(dbPath);
  seedFromSite(db, site);
  // Paid deals are won and the declined one is lost: the outcome overlay Brand Deals reads.
  (site.business as { BRAND_DEALS: { status: string; amountAgreedUsd: number | null; dealValueUsd: number | null }[] }).BRAND_DEALS.forEach((d, i) => {
    const updatedAt = new Date(now).toISOString();
    if (d.status === 'Paid') db.brandDeals.upsert({ dealId: `r-${1040 + i}`, outcome: 'won', amountUsd: d.amountAgreedUsd ?? d.dealValueUsd, updatedAt });
    if (d.status === 'Declined') db.brandDeals.upsert({ dealId: `r-${1040 + i}`, outcome: 'lost', amountUsd: d.dealValueUsd, updatedAt });
  });
  db.close();
  writeSiteFiles(site);
  const pages = writeDemoBrain();
  fs.writeFileSync(dataPath(MARKER), `${now}\n`);
  return { pages };
}

/** Build the demo store if demo mode needs one. Cheap when it is fresh. */
export function ensureDemoStore(): void {
  if (demoStoreStale()) buildDemoStore();
}
