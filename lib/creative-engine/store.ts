import type { CreditsSnapshot, EngineSettings, Workflow } from '@/lib/creative-engine/schemas';
import { NODE_TYPES, WorkflowSchema } from '@/lib/creative-engine/schemas';
import fs from 'node:fs';
import { z } from 'zod';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CampaignSchema,
  CreditEntrySchema,
  HealthSchema,
  PresetSchema,
  RunSchema,
  type Campaign,
  type Concept,
  type CreditEntry,
  type Health,
  type Preset,
  type Run, CreditsSnapshotSchema, EngineSettingsSchema } from '@/lib/creative-engine/schemas';
import { dataDir, filmingMode } from '@/lib/paths';
import { envDry } from '@/lib/creative-engine/dry';
import { engineEnv } from '@/lib/creative-engine/env';
import { DIR_NAME, LEGACY_DIR_NAME, LEGACY_PUBLIC_PREFIX, PUBLIC_PREFIX, resolveRenamedDir, rewriteLegacyAssetPaths, type DirResolution } from '@/lib/creative-engine/migrate';

/**
 * Creative Engine store — plain JSON under data/creative-engine/
 * (CREATIVE_ENGINE_STORE_DIR, or the legacy AD_ENGINE_STORE_DIR, overrides
 * for tests), one file per campaign plus flat files for runs, the
 * credit ledger, presets, health and the Arcads catalog cache. Same rules
 * as lib/foreplay/store.ts and lib/wizard/store.ts: parse on read, a
 * missing or malformed file is "empty" never a crash, mkdir + pretty JSON
 * on write, caps so nothing grows unbounded.
 */

/**
 * The pre-rename data/ad-engine/ and public/content-media/ad-engine/ move to
 * their creative-engine names on first use (S02 FR-13, FR-14; rules in
 * lib/creative-engine/migrate.ts). Resolved once per data dir, since Filming
 * switches between data/ and demo-data/ per call. An override env skips the
 * migration. CREATIVE_ENGINE_MIGRATE=0 reads the old dirs in place instead
 * of renaming them (vitest sets it, so a test run never moves real data).
 */
function migrationEnabled(): boolean {
  return engineEnv('MIGRATE') !== '0';
}

const storeMemo = new Map<string, string>();
let assetMemo: { base: string; res: DirResolution } | null = null;

function resolveAssetRoot(): DirResolution {
  const base = path.join(process.cwd(), 'public', 'content-media');
  if (assetMemo?.base === base) return assetMemo.res;
  const res = resolveRenamedDir(path.join(base, DIR_NAME), path.join(base, LEGACY_DIR_NAME), { migrate: migrationEnabled() });
  assetMemo = { base, res };
  return res;
}

export function storeDir(): string {
  const override = engineEnv('STORE_DIR');
  if (override) return override;
  const root = dataDir();
  const hit = storeMemo.get(root);
  if (hit) return hit;
  let dir = path.join(root, DIR_NAME);
  try {
    const res = resolveRenamedDir(dir, path.join(root, LEGACY_DIR_NAME), { migrate: migrationEnabled() });
    dir = res.dir;
    // Stored asset paths follow the asset dir: once it carries the new name,
    // this store's /content-media/ad-engine/ paths are rewritten (backed up).
    if (!res.legacy && migrationEnabled() && !engineEnv('ASSET_DIR') && !resolveAssetRoot().legacy) rewriteLegacyAssetPaths(dir);
  } catch (err) {
    console.warn(`[creative-engine] store migration skipped (${String(err)})`);
  }
  storeMemo.set(root, dir);
  return dir;
}

/** Forget the resolved dirs (tests that build a store layout and then read it). */
export function resetStoreDirMemo(): void {
  storeMemo.clear();
  assetMemo = null;
}

const CAMPAIGN_CAP = 200;
const RUN_CAP = 1000;
const LEDGER_CAP = 5000;
const PRESET_CAP = 100;

function fileFor(name: string): string {
  return path.join(storeDir(), name);
}

function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(fileFor(name), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(name: string, value: unknown): void {
  const file = fileFor(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_');
}

/* ───────────────────────────── campaigns ───────────────────────────── */

function campaignFile(id: string): string {
  return path.join('campaigns', `${safeId(id)}.json`);
}

export function readCampaigns(): Campaign[] {
  const dir = fileFor('campaigns');
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out: Campaign[] = [];
  for (const name of names) {
    const parsed = CampaignSchema.safeParse(readJson(path.join('campaigns', name), null));
    if (parsed.success) out.push(parsed.data);
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function readCampaign(id: string): Campaign | null {
  const parsed = CampaignSchema.safeParse(readJson(campaignFile(id), null));
  return parsed.success ? parsed.data : null;
}

export function writeCampaign(c: Campaign): Campaign {
  writeJson(campaignFile(c.id), c);
  // cap: drop the oldest beyond the cap (their assets are pruned with them)
  const all = readCampaigns();
  for (const old of all.slice(CAMPAIGN_CAP)) deleteCampaign(old.id);
  return c;
}

export function createCampaign(concept: Concept): Campaign {
  const now = new Date().toISOString();
  const c: Campaign = CampaignSchema.parse({
    id: `ae-${randomUUID().slice(0, 8)}`,
    name: concept.text.replace(/\s+/g, ' ').trim().slice(0, 60),
    // S03 FR-1: provenance is set once, at birth. Filming wins (the demo world
    // is its own store); a CREATIVE_ENGINE_DRY session marks its campaigns dry.
    origin: filmingMode() ? 'filming' : envDry() ? 'dry' : 'live',
    concept,
    createdAt: now,
    updatedAt: now,
  });
  return writeCampaign(c);
}

/** Read-modify-write on one campaign. Returns null when it does not exist. */
export function mutateCampaign(id: string, fn: (c: Campaign) => Campaign): Campaign | null {
  const cur = readCampaign(id);
  if (!cur) return null;
  const next = CampaignSchema.parse({ ...fn(cur), updatedAt: new Date().toISOString() });
  writeJson(campaignFile(id), next);
  return next;
}

/**
 * Hard delete (S03 FR-6, Q-ENG-4): the campaign JSON, its rehosted asset
 * folder and every workflow that belongs to it. Runs and ledger entries stay:
 * they are credit history.
 */
export function deleteCampaign(id: string): void {
  if (id) for (const w of readWorkflows(id)) deleteWorkflow(w.id);
  try {
    fs.rmSync(fileFor(campaignFile(id)), { force: true });
  } catch {
    /* already gone */
  }
  try {
    fs.rmSync(path.join(assetRoot(), safeId(id)), { recursive: true, force: true });
  } catch {
    /* no assets */
  }
}

/* ─────────────────────────────── runs ──────────────────────────────── */

export function readRuns(): Run[] {
  const raw = readJson<unknown[]>('runs.json', []);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const p = RunSchema.safeParse(r);
    return p.success ? [p.data] : [];
  });
}

export function writeRuns(runs: Run[]): void {
  writeJson('runs.json', runs.slice(0, RUN_CAP));
}

export function appendRun(run: Run): Run {
  writeRuns([run, ...readRuns()]);
  return run;
}

export function mutateRun(id: string, fn: (r: Run) => Run): Run | null {
  const runs = readRuns();
  const i = runs.findIndex((r) => r.id === id);
  if (i < 0) return null;
  runs[i] = RunSchema.parse(fn(runs[i]));
  writeRuns(runs);
  return runs[i];
}

/* ─────────────────────────────── ledger ────────────────────────────── */

export function readLedger(): CreditEntry[] {
  const raw = readJson<unknown[]>('ledger.json', []);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const p = CreditEntrySchema.safeParse(r);
    return p.success ? [p.data] : [];
  });
}

export function appendLedger(entry: CreditEntry): void {
  writeJson('ledger.json', [entry, ...readLedger()].slice(0, LEDGER_CAP));
}

/** The last real charge we recorded for this model (+ duration when video). */
export function lastCharge(model: string, durationSec: number | null): CreditEntry | null {
  return (
    readLedger().find(
      (e) => !e.dry && e.model === model && (durationSec === null || e.durationSec === null || e.durationSec === durationSec),
    ) ?? null
  );
}

/* ─────────────────────────────── presets ───────────────────────────── */

export function readPresets(): Preset[] {
  const raw = readJson<unknown[]>('presets.json', []);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const p = PresetSchema.safeParse(r);
    return p.success ? [p.data] : [];
  });
}

export function writePresets(presets: Preset[]): void {
  writeJson('presets.json', presets.slice(0, PRESET_CAP));
}

/* ─────────────────────────────── health ────────────────────────────── */

export function readHealth(): Health {
  const p = HealthSchema.safeParse(readJson('health.json', {}));
  return p.success ? p.data : {};
}

export function writeHealth(h: Health): void {
  writeJson('health.json', h);
}

/* ─────────────────────────── settings + credits ────────────────────── */

export function readSettings(): EngineSettings {
  const p = EngineSettingsSchema.safeParse(readJson('settings.json', {}));
  return p.success ? p.data : EngineSettingsSchema.parse({});
}

export function writeSettings(patch: Partial<EngineSettings>): EngineSettings {
  const next = EngineSettingsSchema.parse({ ...readSettings(), ...patch });
  writeJson('settings.json', next);
  return next;
}

/** The last GET /v1/credits we saw, or null when never read. */
export function readCreditsSnapshot(): CreditsSnapshot | null {
  const p = CreditsSnapshotSchema.safeParse(readJson('credits.json', null));
  return p.success ? p.data : null;
}

export function writeCreditsSnapshot(c: CreditsSnapshot): void {
  writeJson('credits.json', c);
}

/* ─────────────────────────── arcads catalog cache ──────────────────── */

export type CatalogCache<T> = { fetchedAt: string; value: T };

export function readCache<T>(name: string, ttlMs: number): T | null {
  const c = readJson<CatalogCache<T> | null>(`cache-${name}.json`, null);
  if (!c || typeof c !== 'object' || !('fetchedAt' in c)) return null;
  if (Date.now() - new Date(c.fetchedAt).getTime() > ttlMs) return null;
  return c.value;
}

export function writeCache<T>(name: string, value: T): void {
  writeJson(`cache-${name}.json`, { fetchedAt: new Date().toISOString(), value });
}

/* ─────────────────────────────── assets ────────────────────────────── */

/** Where rehosted files land. Served by Next from /content-media/creative-engine/… */
export function assetRoot(): string {
  return engineEnv('ASSET_DIR') ?? resolveAssetRoot().dir;
}

/** The public URL prefix matching assetRoot(): the old one only while the old dir is still in use. */
function assetPublicPrefix(): string {
  if (engineEnv('ASSET_DIR')) return PUBLIC_PREFIX;
  return resolveAssetRoot().legacy ? LEGACY_PUBLIC_PREFIX : PUBLIC_PREFIX;
}

export function assetPathFor(campaignId: string, assetId: string, ext: string): { abs: string; publicPath: string } {
  const rel = path.join(safeId(campaignId), `${safeId(assetId)}${ext}`);
  return { abs: path.join(assetRoot(), rel), publicPath: `${assetPublicPrefix()}${rel.split(path.sep).join('/')}` };
}

/* ─────────────────────────────── workflows ─────────────────────────────── */

const WORKFLOW_CAP = 300;

function workflowFile(id: string): string {
  return path.join('workflows', `${safeId(id)}.json`);
}

/**
 * A node whose type was removed from NODE_TYPES would fail the parse and the
 * whole workflow would vanish from the list (S05b edge case 11). Instead it
 * loads as a "Missing node type" placeholder that keeps its id, title,
 * position and old type; its links are dropped (its ports no longer exist),
 * and validateGraph asks to remove or replace it before Run.
 */
export function tolerateUnknownNodes(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const w = raw as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(w.nodes)) return raw;
  const known = new Set<string>(NODE_TYPES);
  const gone = new Set<string>();
  const nodes = w.nodes.map((n) => {
    const node = n as { id?: unknown; type?: unknown; settings?: unknown };
    if (!node || typeof node !== 'object' || typeof node.type !== 'string' || known.has(node.type)) return n;
    if (typeof node.id === 'string') gone.add(node.id);
    return { ...node, type: 'missing', settings: { originalType: node.type }, runId: null, outputAssetId: null, outputText: null, error: null, resolvedAt: null };
  });
  if (!gone.size) return raw;
  const edges = Array.isArray(w.edges) ? w.edges.filter((e) => { const x = e as { from?: unknown; to?: unknown }; return !gone.has(String(x?.from)) && !gone.has(String(x?.to)); }) : w.edges;
  return { ...w, nodes, edges };
}

export function readWorkflows(campaignId?: string | null): Workflow[] {
  const dir = path.join(storeDir(), 'workflows');
  let names: string[] = [];
  // sidecars (`<id>.versions.json`, `<id>.reset.json`) live next to the workflow files and are not workflows
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json') && !n.endsWith('.versions.json') && !n.endsWith('.reset.json')); } catch { return []; }
  return names
    .flatMap((n) => { const p = WorkflowSchema.safeParse(tolerateUnknownNodes(readJson(path.join('workflows', n), null))); return p.success ? [p.data] : []; })
    .filter((w) => !campaignId || w.campaignId === campaignId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, WORKFLOW_CAP);
}

export function readWorkflow(id: string): Workflow | null {
  const p = WorkflowSchema.safeParse(tolerateUnknownNodes(readJson(workflowFile(id), null)));
  return p.success ? p.data : null;
}

export function writeWorkflow(w: Workflow, opts: { stampLayout?: boolean } = {}): Workflow {
  const now = new Date().toISOString();
  const next = WorkflowSchema.parse({ ...w, updatedAt: now, ...(opts.stampLayout ? { layoutAt: now } : {}) });
  writeJson(workflowFile(next.id), next);
  return next;
}

export function createWorkflow(input: { campaignId: string; name: string; nodes?: Workflow['nodes']; edges?: Workflow['edges'] }): Workflow {
  const now = new Date().toISOString();
  return writeWorkflow({ id: `wf-${randomUUID().slice(0, 8)}`, campaignId: input.campaignId, name: input.name, nodes: input.nodes ?? [], edges: input.edges ?? [], runStartedAt: null, createdAt: now, updatedAt: now }, { stampLayout: true });
}

/** Thrown by mutateWorkflow when the stored copy moved on since the caller read it. Carries the current copy. */
export class WorkflowConflictError extends Error {
  constructor(public current: Workflow) {
    super('This workflow changed since it was loaded');
  }
}

/** The stamp a client's `baseUpdatedAt` is compared with: the last design change (engine writes don't move it). */
export function designStamp(w: Workflow): string {
  return w.layoutAt ?? w.updatedAt;
}

/**
 * Read, transform, write. With `expectUpdatedAt`, refuse (WorkflowConflictError)
 * when the stored design is newer. `stampLayout` marks this write as a design
 * change (autosave, rename, restore).
 */
export function mutateWorkflow(id: string, fn: (w: Workflow) => Workflow, opts: { expectUpdatedAt?: string; stampLayout?: boolean } = {}): Workflow | null {
  const w = readWorkflow(id);
  if (!w) return null;
  if (opts.expectUpdatedAt !== undefined && opts.expectUpdatedAt !== designStamp(w) && opts.expectUpdatedAt !== w.updatedAt) throw new WorkflowConflictError(w);
  return writeWorkflow(fn(w), { stampLayout: opts.stampLayout });
}

export function deleteWorkflow(id: string): void {
  for (const f of [workflowFile(id), versionsFile(id), resetFile(id)]) {
    try { fs.unlinkSync(fileFor(f)); } catch { /* already gone */ }
  }
}

/* Versions (S05b FR-63): snapshots of the design (layout, titles, settings,
   edges, name) in a sidecar, written on Run and on Save version. Autosave
   never makes one. Capped at 30; the oldest go first unless a run used them. */

export const WorkflowVersionSchema = z.object({
  n: z.number().int(),
  at: z.string(),
  note: z.string().max(120).default(''),
  /** 'run' when Run made it, 'save' for Save version, 'restore' for the copy taken before a restore */
  reason: z.enum(['run', 'save', 'restore']).default('save'),
  name: z.string(),
  nodes: z.array(z.object({ id: z.string(), type: z.string(), title: z.string(), x: z.number(), y: z.number(), settings: z.record(z.string(), z.unknown()) })),
  edges: z.array(z.object({ id: z.string(), from: z.string(), fromPort: z.string(), to: z.string(), toPort: z.string() })),
});
export type WorkflowVersion = z.infer<typeof WorkflowVersionSchema>;
export const WORKFLOW_VERSION_CAP = 30;

function versionsFile(id: string): string {
  return path.join('workflows', `${safeId(id)}.versions.json`);
}
function resetFile(id: string): string {
  return path.join('workflows', `${safeId(id)}.reset.json`);
}

export function readWorkflowVersions(id: string): WorkflowVersion[] {
  const raw = readJson<unknown[]>(versionsFile(id), []);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => { const p = WorkflowVersionSchema.safeParse(r); return p.success ? [p.data] : []; }).sort((a, b) => b.n - a.n);
}

/** Keep the newest `keep`; a version a run made is pruned only after every other one. */
export function pruneWorkflowVersions(list: WorkflowVersion[], keep = WORKFLOW_VERSION_CAP): WorkflowVersion[] {
  const sorted = [...list].sort((a, b) => b.n - a.n);
  if (sorted.length <= keep) return sorted;
  const drop = new Set<number>();
  for (const v of [...sorted].reverse()) { if (sorted.length - drop.size <= keep) break; if (v.reason !== 'run') drop.add(v.n); }
  for (const v of [...sorted].reverse()) { if (sorted.length - drop.size <= keep) break; drop.add(v.n); }
  return sorted.filter((v) => !drop.has(v.n));
}

export function writeWorkflowVersion(w: Workflow, input: { note?: string; reason?: WorkflowVersion['reason'] } = {}): WorkflowVersion {
  const list = readWorkflowVersions(w.id);
  const v: WorkflowVersion = {
    n: (list[0]?.n ?? 0) + 1, at: new Date().toISOString(), note: (input.note ?? '').slice(0, 120), reason: input.reason ?? 'save', name: w.name,
    nodes: w.nodes.map(({ id, type, title, x, y, settings }) => ({ id, type, title, x, y, settings })),
    edges: w.edges.map(({ id, from, fromPort, to, toPort }) => ({ id, from, fromPort, to, toPort })),
  };
  writeJson(versionsFile(w.id), pruneWorkflowVersions([v, ...list]));
  return v;
}

/** The runtime fields Reset cleared, kept for one Undo (S05b FR-62). */
export const ResetSnapshotSchema = z.object({
  at: z.string(),
  runStartedAt: z.string().nullable(),
  runScope: z.array(z.string()).nullable().default(null),
  nodes: z.array(z.object({ id: z.string(), runId: z.string().nullable(), outputAssetId: z.string().nullable(), outputText: z.string().nullable(), error: z.string().nullable(), resolvedAt: z.string().nullable() })),
});
export type ResetSnapshot = z.infer<typeof ResetSnapshotSchema>;

export function writeResetSnapshot(id: string, s: ResetSnapshot): void {
  writeJson(resetFile(id), s);
}
export function readResetSnapshot(id: string): ResetSnapshot | null {
  const p = ResetSnapshotSchema.safeParse(readJson(resetFile(id), null));
  return p.success ? p.data : null;
}
export function clearResetSnapshot(id: string): void {
  try { fs.unlinkSync(fileFor(resetFile(id))); } catch { /* none */ }
}
