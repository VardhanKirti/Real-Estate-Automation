import type { LabPlatform } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import type { ApifyClient } from '@/lib/lab/apify-client';
import type { SttClient } from '@/lib/connectors/openai-stt';
import { recomputeMeasures } from '@/lib/lab/compute';
import { assignVerdicts } from '@/lib/lab/measure/case-control';
import { planScrape, startPlan, type StartedRun, type SyncDeps, type SyncPlan } from '@/lib/lab/sync';
import { transcribeCycle, type TranscribeResult } from '@/lib/lab/transcribe';
import { dissectCycle, type DissectResult, type DissectRunner } from '@/lib/lab/dissect';
import { discoveryTerms, planSearch, rescoreSuggestions, startSearches } from '@/lib/lab/discover';

/**
 * One place that strings the ingest stages together, shared by "Run now"
 * (POST /api/lab/run) and the launchd CLI (scripts/lab-sync.ts):
 *
 *   scrape (+ profiles) → [live: advance-on-read later] → transcribe → dissect →
 *   recomputeMeasures → rescore suggestions
 *
 * In dry mode the scrape ingests fixtures at once, so a dry Run now does the whole
 * cycle in one request. Live, the scrape is only started here; the items land on a later
 * read (GET /api/lab/runs) or the CLI's wait loop, and analysis runs in the CLI (a page
 * request never waits on the claude CLI or a media download).
 */

export type AnalyseDeps = { store: LabStore; dry: boolean; stt: SttClient | null; now?: Date; override?: boolean; scheduled?: boolean; runner?: DissectRunner; transcribeLimit?: number; dissectLimit?: number };
export type AnalyseResult = { transcribe: TranscribeResult; dissect: DissectResult; measures: { posts: number; measured: number; breakouts: number }; suggestionsScored: number };

export async function analyse(deps: AnalyseDeps): Promise<AnalyseResult> {
  const now = deps.now ?? new Date();
  // measures, then the case-control verdicts: transcription and dissection eligibility read lab_controls (04 5.2)
  recomputeMeasures(deps.store, now);
  assignVerdicts(deps.store, now);
  const transcribe = await transcribeCycle({ store: deps.store, stt: deps.stt, dry: deps.dry, now, override: deps.override, scheduled: deps.scheduled, limit: deps.transcribeLimit });
  const dissect = await dissectCycle({ store: deps.store, now, override: deps.override, scheduled: deps.scheduled, runner: deps.runner, limit: deps.dissectLimit });
  // v2 baselines never read the dissection (04 3.2); the recompute picks up anything ingested meanwhile
  const measures = recomputeMeasures(deps.store, now);
  const suggestionsScored = rescoreSuggestions(deps.store);
  return { transcribe, dissect, measures, suggestionsScored };
}

export type ScrapeDeps = { store: LabStore; client: ApifyClient | null; now?: Date; override?: boolean; scheduled?: boolean; platforms?: readonly LabPlatform[]; force?: boolean; batchId?: string | null; estimateFor?: SyncDeps['estimateFor'] };

/** Plan and start the scrape. TikTok video downloads (an extra paid event) only with LAB_TIKTOK_DOWNLOADS=1. */
export async function scrape(deps: ScrapeDeps): Promise<{ plan: SyncPlan; runs: StartedRun[] }> {
  const now = deps.now ?? new Date();
  const plan = planScrape(deps.store, now, { platforms: deps.platforms, force: deps.force, override: deps.override, downloadVideos: process.env.LAB_TIKTOK_DOWNLOADS === '1' });
  const runs = await startPlan({ store: deps.store, client: deps.client, now, override: deps.override, scheduled: deps.scheduled, batchId: deps.batchId, estimateFor: deps.estimateFor }, plan);
  return { plan, runs };
}

export const DISCOVERY_EVERY_DAYS = 7;

/** A search is due when none ran (or was started) in the last week. */
export function discoveryDue(store: LabStore, now: Date): boolean {
  return store.runs.since(new Date(now.getTime() - DISCOVERY_EVERY_DAYS * 86_400_000).toISOString(), 'search').filter((r) => r.status !== 'blocked' && r.status !== 'failed').length === 0;
}

export async function discover(deps: { store: LabStore; client: ApifyClient | null; now?: Date; override?: boolean; scheduled?: boolean }) {
  const terms = discoveryTerms(deps.store);
  const groups = planSearch(deps.store, terms);
  const runs = groups.length ? await startSearches(deps, groups) : [];
  return { terms, groups, runs };
}
