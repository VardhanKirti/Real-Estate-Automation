import { z } from 'zod';
import { LabPlatformSchema } from '@/lib/schemas';
import { resolveLab } from '@/lib/lab/context';
import { body, json, readOnlyRefusal } from '@/lib/lab/api';
import { CapError, spendMeter } from '@/lib/lab/spend';
import { liveApifyClient } from '@/lib/lab/apify-live';
import { resolveApifyToken } from '@/lib/connectors/apify';
import { describePlan, planScrape } from '@/lib/lab/sync';
import { analyse, discover, scrape } from '@/lib/lab/pipeline';
import { discoveryTerms, planSearch } from '@/lib/lab/discover';
import { runRow } from '@/lib/lab/view';
import { estimateSyncPlan, planGroupKey } from '@/lib/lab/setup/run-estimate';
import { markPlanPreviewed } from '@/lib/lab/setup/checklist';
import { newBatchId } from '@/lib/lab/setup/progress';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RunSchema = z.object({
  /** Limit to these platforms; default every platform with an active source that is due. */
  platforms: z.array(LabPlatformSchema).optional(),
  /** Pass the monthly cap once (the SpendGate's second confirm). */
  override: z.boolean().optional(),
  /** Answer what would run (actors, handles, item ceilings, this month's spend) without starting anything. */
  preview: z.boolean().optional(),
  /** Run discovery search (SPEC §4.8) instead of the scrape. */
  discover: z.boolean().optional(),
});

/**
 * GET /api/lab/run?plan=1 (09.7): the plan the Run confirm names, priced from the price books
 * (`estimate: PlanEstimate`, and `runs[].estimate` per actor run), without starting anything.
 * With `plan=1` it also records the checklist evidence `checklist:plan_previewed` (08.4.2 step 5;
 * never in sample). No network call.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = resolveLab({ sample: url.searchParams.get('sample') === '1' });
  const store = ctx.store;
  const now = new Date();
  const dry = Boolean(ctx.flags.dry);
  const plan = planScrape(store, now, { force: true });
  const priced = estimateSyncPlan(store, plan, now, { recorded: dry || ctx.readOnly });
  if (url.searchParams.get('plan') === '1' && !ctx.readOnly) markPlanPreviewed(store, now);
  const groups = [...plan.scrapes, ...plan.profiles];
  const runs = describePlan(plan).map((r, i) => ({ ...r, estimate: priced.perGroup.get(planGroupKey(groups[i])) ?? null }));
  return json({ ok: true, dry, sample: ctx.readOnly, configured: Boolean(ctx.flags.configured), plan: runs, runs, estimate: priced.estimate, spend: spendMeter(store, now) });
}

/**
 * POST /api/lab/run — "Run now". Everything goes through the one spend gate
 * (lib/lab/spend.ts gatedCall, via lib/lab/sync.ts and lib/lab/discover.ts):
 *
 * - dry (LAB_DRY=1 or Filming): fixture actor items are ingested at once, then the
 *   fixture transcription and dissection run, so the whole cycle lands in this request;
 *   every run is 0-cost and dry, and no client is built.
 * - live: Apify accepts each run and it stays `running`; GET /api/lab/runs advances it
 *   (advance-on-read) and ingests the items. Analysis (transcribe, dissect) runs in the
 *   launchd CLI, never inside a page request.
 * - past the monthly cap: 402 `{ capAsk, spent, cap }`; the SpendGate re-POSTs with
 *   `override: true` to pass it once.
 * - `preview: true`: the plan the confirm names, nothing started.
 */
export async function POST(request: Request) {
  const parsed = RunSchema.safeParse((await body(request)) ?? {});
  if (!parsed.success) return json({ ok: false, error: 'platforms must be a list of instagram, tiktok, youtube, linkedin, twitter' }, 400);
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  const refusal = readOnlyRefusal(ctx);
  if (refusal) return refusal;
  if (!ctx.flags.configured && !ctx.flags.dry) return json({ ok: false, error: 'Apify is not configured', setupHref: ctx.flags.setupHref }, 409);

  const store = ctx.store;
  const now = new Date();
  const dry = Boolean(ctx.flags.dry);
  const { platforms, override, preview } = parsed.data;

  if (parsed.data.discover) {
    const terms = discoveryTerms(store);
    if (terms.length === 0) return json({ ok: false, error: 'Nothing to search for yet: scrape and dissect your own posts first' }, 409);
    if (preview) return json({ ok: true, dry, plan: planSearch(store, terms).map((g) => ({ kind: 'search', platform: g.platform, actor: g.actorId, terms: g.terms, limit: g.limit, maxItems: g.limit * g.terms.length })), spend: spendMeter(store, now) });
    try {
      const out = await discover({ store, client: dry ? null : liveClient(), now, override });
      return json({ ok: true, dry, terms: out.terms, runs: out.runs.map((r) => runRow(r.run)), pending: out.runs.filter((r) => r.run.status === 'running').length });
    } catch (err) {
      return failure(err);
    }
  }

  const plan = planScrape(store, now, { platforms, force: true });
  if (plan.scrapes.length === 0 && plan.profiles.length === 0) return json({ ok: false, error: 'Add your accounts first' }, 409);
  if (preview) return json({ ok: true, dry, plan: describePlan(plan), spend: spendMeter(store, now) });

  try {
    // 09.4.2: every run this press starts carries one batch id; 09.2.6: each carries its estimate to the gate
    const batchId = newBatchId();
    const priced = estimateSyncPlan(store, plan, now, { recorded: dry });
    const out = await scrape({ store, client: dry ? null : liveClient(), now, override, platforms, force: true, batchId, estimateFor: priced.estimateFor });
    const analysis = dry ? await analyse({ store, dry: true, stt: null, now, override }) : null;
    return json({
      ok: true,
      dry,
      batchId,
      estimate: priced.estimate,
      runs: out.runs.map((r) => runRow(r.run)),
      pending: out.runs.filter((r) => r.run.status === 'running').length,
      ingested: out.runs.reduce((a, r) => a + (r.ingest?.posts ?? 0), 0),
      analysis: analysis ? { transcribed: analysis.transcribe.done, dissected: analysis.dissect.done, measured: analysis.measures.measured, breakouts: analysis.measures.breakouts } : null,
    });
  } catch (err) {
    return failure(err);
  }
}

function liveClient() {
  const token = resolveApifyToken();
  if (!token) throw new Error('Apify is not configured');
  return liveApifyClient(token);
}

function failure(err: unknown) {
  if (err instanceof CapError) return json({ ok: false, capAsk: err.message, provider: err.provider, spent: err.spent, cap: err.cap, reason: err.reason, scope: err.scope, line: err.line }, 402);
  return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
}
