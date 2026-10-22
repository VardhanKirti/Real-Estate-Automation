import Database from 'better-sqlite3';
import { LAB_DDL } from '@/lib/db';
import { getDb } from '@/lib/data';
import { filmingMode } from '@/lib/paths';
import { setupHrefFor } from '@/lib/integrations-catalog';
import { apifyConfigured } from '@/lib/connectors/apify';
import { labStore, type LabStore } from '@/lib/lab/store';
import { FIXTURE_NAME, ensureFilmingFixtures, resolveScenario, seedLabFixtures } from '@/lib/lab/fixtures';
import type { LabFixtureScenario } from '@/lib/schemas';
import { dryLabel, dryReason, isDry } from '@/lib/lab/dry';
import type { BuildOpts } from '@/lib/lab/view/legacy';
import type { LabQuadrant } from '@/lib/schemas';
import { labAgentName } from '@/lib/agents/content-lab';
import { SHEET_PRECEDENCE, type LabParams } from '@/lib/lab/view/shared';

/**
 * Which Content Lab world a request reads, and the mode flags the view needs. One place,
 * shared by the page and every /api/lab route:
 *
 * - `?sample=1` on an install with no real lab data: an in-memory database holding the
 *   fixture world (cached per anchor hour), flagged `sample` so the UI shows the badge.
 *   Never written to disk; a real install's data is never touched. When real data
 *   exists, `?sample=1` is ignored (real wins, as on /creative-engine).
 * - Filming mode: the demo-data database, seeded with the fixture world when its lab
 *   tables are empty and refreshed when that world is stale (ensureFilmingFixtures).
 * - Otherwise: the real database (`getDb().lab`).
 */

let sampleCache = new Map<string, { hour: number; store: LabStore }>();

/** The in-memory fixture world for `?sample=1` (08.7.2: `&scenario=<name>` picks a transform of `full`). */
export function sampleStore(now: Date = new Date(), scenario: LabFixtureScenario = 'full'): LabStore {
  const hour = Math.floor(now.getTime() / 3_600_000);
  const hit = sampleCache.get(scenario);
  if (hit?.hour === hour) return hit.store;
  if (sampleCache.size > 8) sampleCache = new Map();
  const db = new Database(':memory:');
  db.exec(LAB_DDL);
  const store = labStore(db);
  seedLabFixtures(store, now, scenario);
  sampleCache.set(scenario, { hour, store });
  return store;
}

export type LabContext = { store: LabStore; flags: Omit<BuildOpts, 'tab' | 'now' | 'since' | 'filters' | 'profileFamily' | 'post' | 'idea' | 'script'>; readOnly: boolean };

export function resolveLab(opts: { sample?: boolean; now?: Date; scenario?: string | null } = {}): LabContext {
  const now = opts.now ?? new Date();
  const filming = filmingMode();
  const real = getDb().lab;
  if (filming) ensureFilmingFixtures(real, now, resolveScenario(process.env.LAB_FIXTURE_SCENARIO));
  const useSample = Boolean(opts.sample) && !filming && real.isEmpty();
  const reason = dryReason();
  return {
    store: useSample ? sampleStore(now, resolveScenario(opts.scenario)) : real,
    readOnly: useSample,
    flags: {
      configured: apifyConfigured(),
      sample: useSample,
      filming,
      dry: isDry(),
      dryReason: reason,
      dryLabel: dryLabel(reason),
      setupHref: setupHrefFor('apify'),
      // the sample badge is for ?sample=1 only; Filming says "Filming · no charges" through dryLabel instead
      fixtureName: useSample ? FIXTURE_NAME : null,
      agentName: labAgentName(getDb().agents.all()),
    },
  };
}

/** Parse the shared query/search params into BuildOpts extras. */
export function viewParams(get: (k: string) => string | null | undefined) {
  const n = (v: string | null | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : null);
  const q = get('quadrant');
  return {
    sample: get('sample') === '1',
    post: get('post') ?? null,
    idea: get('idea') ?? null,
    script: get('script') ?? null,
    profileFamily: get('family') ?? null,
    filters: {
      format: get('format') ?? null,
      platform: get('platform') ?? null,
      quadrant: (q === 'ideal' || q === 'loyal' || q === 'clickbait' || q === 'dud' ? q : null) as LabQuadrant | null,
      windowDays: n(get('window')),
    },
  };
}

/* ── Content Lab v2 (01 2.1): every URL param, validated ──────────────── */

const PLATFORM_IDS = ['instagram', 'tiktok', 'youtube', 'linkedin', 'twitter'] as const;
const pick = <T extends string>(v: string | null | undefined, allowed: readonly T[]): T | null => (v && (allowed as readonly string[]).includes(v) ? (v as T) : null);

/**
 * 01 5.2 LabParams from a query getter. Unknown values become null (filters) or the default
 * (period, window, hp, seg). Several sheet params: the first in SHEET_PRECEDENCE wins (D4).
 */
export function labParams(get: (k: string) => string | null | undefined): LabParams {
  let sheet: LabParams['sheet'] = null;
  for (const kind of SHEET_PRECEDENCE) {
    const raw = get(kind);
    if (raw === null || raw === undefined) continue;
    if (kind === 'setup') {
      sheet = { kind, id: raw };
      break;
    }
    const v = kind === 'ask' ? raw.trim().slice(0, 300) : raw.trim();
    if (v.length) {
      sheet = { kind, id: v };
      break;
    }
  }
  const off = Number(get('offset') ?? 0);
  const ver = Number(get('ver'));
  const win = Number(get('window'));
  return {
    sample: get('sample') === '1',
    sheet,
    st: get('st')?.trim() || null,
    ver: Number.isInteger(ver) && ver > 0 ? ver : null,
    period: get('period') === 'm' ? 'm' : 'w',
    offset: Number.isFinite(off) ? Math.max(-12, Math.min(0, Math.round(off))) : 0,
    hp: pick(get('hp'), ['all', ...PLATFORM_IDS] as const) ?? 'all',
    seg: get('seg') === 'ask' ? 'ask' : 'brief',
    platform: pick(get('platform'), PLATFORM_IDS),
    format: get('format')?.trim() || null,
    quadrant: pick(get('quadrant'), ['ideal', 'loyal', 'clickbait', 'dud'] as const),
    window: win === 7 || win === 90 ? win : 30,
    dual: get('dual') === '1',
    mine: get('mine') === '1',
    creator: get('creator')?.trim().slice(0, 200) || null,
    eventClass: pick(get('class'), ['spike', 'adopted', 'unknown'] as const),
    windowState: pick(get('state'), ['open', 'closing', 'closed'] as const),
    predictor: get('predictor')?.trim() || null,
    newIdea: get('new') === '1',
    focus: get('focus') === 'add' ? 'add' : null,
  };
}

/** labParams from a Next searchParams record (server pages). */
export function labParamsFrom(sp: Record<string, string | string[] | undefined>): LabParams {
  return labParams((k) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  });
}
