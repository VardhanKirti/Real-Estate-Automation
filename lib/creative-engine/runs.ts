import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { RUN_TIMEOUT_MS, type Run, type RunKind, type RunStatus } from '@/lib/creative-engine/schemas';
import { appendRun, assetRoot, mutateRun, readCampaign, readRuns } from '@/lib/creative-engine/store';

/**
 * Runs — every operation that takes longer than a click. Status is DERIVED
 * on every read (`resolveRun`), never stored as truth, following
 * lib/content-schema.ts: a run reads `delivered` only when the thing it
 * promised actually exists, `stale` when it has been running past its
 * kind's timeout, and the client can never mark anything done.
 */

export type ResolvedRun = Run & { status: RunStatus; elapsedMs: number; timeoutMs: number };

export function startRun(input: {
  campaignId: string | null;
  kind: RunKind;
  title: string;
  outputRef?: string | null;
  dry?: boolean;
}): Run {
  return appendRun({
    id: `run-${randomUUID().slice(0, 8)}`,
    campaignId: input.campaignId,
    kind: input.kind,
    title: input.title,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    abandoned: false,
    outputRef: input.outputRef ?? null,
    arcads: null,
    foreplay: null,
    dry: input.dry ?? false,
  });
}

export function finishRun(id: string, patch: Partial<Pick<Run, 'outputRef' | 'foreplay' | 'arcads'>> = {}): Run | null {
  return mutateRun(id, (r) => ({ ...r, ...patch, finishedAt: new Date().toISOString(), error: null }));
}

export function failRun(id: string, error: string): Run | null {
  return mutateRun(id, (r) => ({ ...r, finishedAt: new Date().toISOString(), error: error.slice(0, 500) }));
}

export function abandonRun(id: string): Run | null {
  return mutateRun(id, (r) => ({ ...r, abandoned: true, finishedAt: r.finishedAt ?? new Date().toISOString() }));
}

/**
 * Does the promised output exist? `outputRef` grammar:
 *   campaign:<id>#research | #angles | #script:<sid> | #brief:<bid>
 *   asset:<campaignId>/<file>           (a rehosted file on disk)
 */
export function outputExists(ref: string | null): boolean {
  if (!ref) return false;
  if (ref.startsWith('asset:')) {
    const rel = ref.slice('asset:'.length);
    if (rel.includes('..')) return false;
    return fs.existsSync(path.join(assetRoot(), rel));
  }
  const m = ref.match(/^campaign:([^#]+)#(.+)$/);
  if (!m) return false;
  const c = readCampaign(m[1]);
  if (!c) return false;
  const what = m[2];
  if (what === 'research') return c.research !== null && c.research.pool.length > 0;
  if (what === 'angles') return c.angles.length > 0;
  if (what.startsWith('script:')) {
    const s = c.scripts.find((x) => x.id === what.slice(7));
    return !!s && s.versions.length > 0;
  }
  if (what.startsWith('brief:')) return c.briefs.some((b) => b.id === what.slice(6));
  return false;
}

export function resolveRun(run: Run, now = Date.now()): ResolvedRun {
  const started = new Date(run.startedAt).getTime();
  const elapsedMs = Math.max(0, (run.finishedAt ? new Date(run.finishedAt).getTime() : now) - started);
  const timeoutMs = RUN_TIMEOUT_MS[run.kind];
  let status: RunStatus;
  if (run.abandoned) status = 'abandoned';
  else if (run.error) status = 'failed';
  else if (outputExists(run.outputRef)) status = 'delivered';
  else if (run.finishedAt) status = run.outputRef ? 'failed' : 'delivered'; // finished with nothing to check = done
  else if (elapsedMs > timeoutMs) status = 'stale';
  else status = 'running';
  // a finished run whose promised output vanished reads failed, never delivered
  if (status === 'failed' && run.finishedAt && !run.error && run.outputRef) {
    return { ...run, status, elapsedMs, timeoutMs, error: 'output missing' };
  }
  return { ...run, status, elapsedMs, timeoutMs };
}

export function listRuns(campaignId?: string | null): ResolvedRun[] {
  const now = Date.now();
  return readRuns()
    .filter((r) => !campaignId || r.campaignId === campaignId)
    .map((r) => resolveRun(r, now));
}
