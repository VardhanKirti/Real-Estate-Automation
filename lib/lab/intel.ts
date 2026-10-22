import { randomUUID } from 'node:crypto';
import type { LabStore } from '@/lib/lab/store';
import { isDry } from '@/lib/lab/dry';
import { assignClusters, type ClusterResult } from '@/lib/lab/clusters';
import { distillProfiles, featureRows } from '@/lib/lab/distill';
import { computeDna, familyLabelFor } from '@/lib/lab/dna';
import { computeTrendSnapshots } from '@/lib/lab/trends';
import { syncFeeds, type FeedSyncResult } from '@/lib/lab/feeds';
import { SYNC_OPEN_CAP, generateIdeas, openSyncIdeas, type Ask, type GenerateResult } from '@/lib/lab/ideas';
import { recomputePriors } from '@/lib/lab/priors';
import { writeLabBrain } from '@/lib/lab/brain';

/**
 * The intelligence half of a Lab cycle (SPEC §10 phases 4-7), run after a sync by the
 * Lab agent (lib/agents/real.ts `content-lab`), by `POST /api/lab/intel`, or by the
 * Phase 1 sync CLI once it lands:
 *
 *   clusters  embed + centroid-match new primary topics (lib/lab/clusters.ts)
 *   distill   a new Viral Profile version per family you make (Your DNA picks them)
 *   trends    daily trend snapshots with momentum and timing (84 days)
 *   feeds     HN, Reddit, Product Hunt (token only), Google Trends (Apify, gated)
 *   ideas     grounded ideas until the open queue holds 10 (LLM through the gate)
 *   priors    outcomes appended, `yours:*` priors recomputed with thresholds
 *   brain     viral profile per family + weekly digest into Optimal Engine
 *
 * Each step is isolated: one failing step is reported and the rest still run. Dry
 * (LAB_DRY=1 / Filming) makes zero paid or network calls (feeds and ideas use fixtures).
 */

export const INTEL_STEPS = ['clusters', 'distill', 'trends', 'feeds', 'ideas', 'priors', 'brain'] as const;
export type IntelStep = (typeof INTEL_STEPS)[number];

export type IntelReport = {
  dry: boolean;
  ok: boolean;
  steps: { step: IntelStep; ok: boolean; detail: string }[];
  clusters?: ClusterResult;
  profiles?: { family: string; version: number; breakouts: number; shown: number }[];
  feeds?: Pick<FeedSyncResult, 'byFeed' | 'skipped' | 'errors' | 'persisted'>;
  ideas?: Pick<GenerateResult, 'by' | 'duplicates' | 'open'> & { added: string[]; dropped: GenerateResult['dropped'] };
  summary: string;
};

/** Distil one new profile version per family you make; with no owned posts, every family with competitor rows. */
export function distillForYou(store: LabStore, now: Date) {
  const dna = computeDna(store, { now });
  const families = dna.families.map((family) => ({ family, label: familyLabelFor(family, dna.mix.find((m) => m.family === family)?.medianDurationS ?? null) }));
  const hasRows = featureRows(store, { now }).length > 0;
  if (!hasRows) return [];
  return distillProfiles(store, { now, families: families.length ? families : undefined });
}

export async function runLabIntel(store: LabStore, opts: { now?: Date; steps?: readonly IntelStep[]; ask?: Ask; brainRoot?: string; scheduled?: boolean; override?: boolean } = {}): Promise<IntelReport> {
  const now = opts.now ?? new Date();
  const want = new Set(opts.steps ?? INTEL_STEPS);
  const report: IntelReport = { dry: isDry(), ok: true, steps: [], summary: '' };
  const step = async (name: IntelStep, fn: () => Promise<string> | string) => {
    if (!want.has(name)) return;
    try {
      report.steps.push({ step: name, ok: true, detail: await fn() });
    } catch (err) {
      report.ok = false;
      report.steps.push({ step: name, ok: false, detail: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
    }
  };

  await step('clusters', () => {
    const r = assignClusters(store, { now });
    report.clusters = r;
    return `${r.assigned} topics assigned, ${r.created.length} new clusters`;
  });
  await step('distill', () => {
    const started = now.toISOString();
    const ps = distillForYou(store, now);
    report.profiles = ps.map((p) => ({ family: p.formatFamily, version: p.version, breakouts: p.breakoutsN, shown: p.features.filter((f) => f.shown).length }));
    store.runs.insert({ id: `lrun-${randomUUID().slice(0, 12)}`, kind: 'distill', apifyRunId: null, datasetId: null, actor: null, input: {}, status: 'succeeded', items: ps.length, costUsd: 0, dry: report.dry, startedAt: started, finishedAt: new Date().toISOString(), error: null });
    return ps.length ? ps.map((p) => `${p.label} v${p.version} (${p.features.filter((f) => f.shown).length} features shown, n ${p.breakoutsN} breakouts)`).join('; ') : 'nothing to distil yet';
  });
  await step('trends', () => `${computeTrendSnapshots(store, { now, days: 84 }).length} snapshot rows`);
  await step('feeds', async () => {
    const r = await syncFeeds(store, { now, scheduled: opts.scheduled, override: opts.override });
    report.feeds = { byFeed: r.byFeed, skipped: r.skipped, errors: r.errors, persisted: r.persisted };
    if (r.errors.length) throw new Error(r.errors.map((e) => `${e.feed}: ${e.error}`).join('; '));
    return `${r.items.length} items${r.persisted ? '' : ' (dry, not saved)'}`;
  });
  await step('ideas', async () => {
    if (openSyncIdeas(store) >= SYNC_OPEN_CAP) return `queue full (${SYNC_OPEN_CAP} open)`;
    const r = await generateIdeas(store, { now, ask: opts.ask, scheduled: opts.scheduled, override: opts.override });
    report.ideas = { by: r.by, duplicates: r.duplicates, open: r.open, added: r.added.map((i) => i.id), dropped: r.dropped };
    return `${r.added.length} added, ${r.dropped.length} dropped by grounding, ${r.open} open`;
  });
  await step('priors', () => `${recomputePriors(store, { now }).filter((p) => p.supersedesDefault).length} priors past threshold`);
  await step('brain', () => {
    const r = writeLabBrain(store, { now, root: opts.brainRoot });
    return `${r.written} brain docs written${r.skipped ? `, ${r.skipped} hand-edited kept` : ''}`;
  });

  report.summary = report.steps.map((s) => `${s.step}: ${s.ok ? '' : 'failed, '}${s.detail}`).join(' · ');
  return report;
}
