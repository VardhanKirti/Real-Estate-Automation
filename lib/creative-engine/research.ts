import { z } from 'zod';
import { createForeplayClient } from '@/lib/foreplay/client';
import { mineConcept, naiveProbes } from '@/lib/foreplay/mine';
import { toWallAd } from '@/lib/foreplay/wall';
import { claudeJson } from '@/lib/creative-engine/claude';
import { isDry } from '@/lib/creative-engine/dry';
import { DRY_POOL } from '@/lib/creative-engine/fixtures';
import { DEPTH_BUDGET, type Campaign, type Depth, type PoolAd, type Research } from '@/lib/creative-engine/schemas';

/**
 * Research — the AI decides what to search, Foreplay answers, longevity
 * ranks. Extends app/api/adscout/mine's `expandProbes`: the model also
 * picks minDays, format and says WHY each probe (shown to the operator),
 * then the top winners get a duplicates count (the scaling signal). Every
 * credit is capped by the depth chosen before the run.
 */

const PlanSchema = z.object({
  probes: z.array(z.object({ query: z.string().min(2).max(80), why: z.string().max(160).default('') })).min(2).max(8),
  minDays: z.number().int().min(7).max(120).default(21),
  format: z.enum(['video', 'image', 'any']).default('any'),
});

export type Plan = z.infer<typeof PlanSchema> & { expandedBy: Research['expandedBy'] };

export async function planResearch(campaign: Campaign, depth: Depth): Promise<Plan> {
  const budget = DEPTH_BUDGET[depth];
  if (isDry()) {
    return { probes: naiveProbes(campaign.concept.text).map((q) => ({ query: q, why: 'dry run: keyword expansion' })), minDays: 21, format: 'any', expandedBy: 'dry' };
  }
  const c = campaign.concept;
  const prompt = [
    'You plan an ad-library search for a creator/operator who wants proven ad angles.',
    `Concept: "${c.text}"`,
    c.product ? `Product: ${c.product}` : '',
    c.audience ? `Audience: ${c.audience}` : '',
    c.goal !== 'unset' ? `Goal: ${c.goal}` : '',
    `Reply with STRICT JSON only: {"probes":[{"query":"2-5 words as they would appear in real ad copy","why":"one short clause"}] (${Math.min(4, budget.probes)}-${budget.probes} items, mix exact phrases and keyword pairs),"minDays":21|30|60,"format":"video"|"image"|"any"}. No markdown.`,
  ]
    .filter(Boolean)
    .join('\n');
  const res = await claudeJson(prompt, PlanSchema, { timeoutMs: 60_000 });
  if (res.ok) return { ...res.data, probes: res.data.probes.slice(0, budget.probes), expandedBy: 'claude' };
  return { probes: naiveProbes(c.text).map((q) => ({ query: q, why: 'keyword fallback (Claude unavailable)' })), minDays: 21, format: 'any', expandedBy: 'fallback' };
}

export async function runResearch(campaign: Campaign, depth: Depth): Promise<Research> {
  const budget = DEPTH_BUDGET[depth];
  const plan = await planResearch(campaign, depth);
  const ranAt = new Date().toISOString();

  if (isDry()) {
    return { depth, expandedBy: 'dry', minDays: plan.minDays, format: plan.format, probes: plan.probes.map((p) => ({ ...p, results: 2 })), pool: DRY_POOL, pooled: DRY_POOL.length, apiCalls: 0, ranAt };
  }

  const client = createForeplayClient();
  if (!client) throw new Error('Foreplay not configured — set FOREPLAY_API_KEY in .env.local');
  const start = client.callCount;

  const mined = await mineConcept(client, campaign.concept.text, plan.probes.map((p) => p.query), {
    minDays: plan.minDays,
    format: plan.format === 'any' ? undefined : plan.format,
    maxWinners: 30,
  });
  const pool: PoolAd[] = mined.winners.map((w) => ({ ...toWallAd(w.ad), probes: w.probes, duplicates: null }));

  // duplicates: the scaling signal, capped by depth and never past the ceiling
  let dupChecks = 0;
  for (const ad of pool) {
    if (dupChecks >= budget.duplicates || client.callCount - start >= budget.maxCalls - 1) break;
    try {
      const dups = await client.adDuplicates(ad.id);
      ad.duplicates = dups.length;
    } catch {
      ad.duplicates = null;
    }
    dupChecks += 1;
  }

  const probes = plan.probes.map((p) => ({ ...p, results: mined.probes.find((m) => m.query === p.query)?.results ?? 0 }));
  return { depth, expandedBy: plan.expandedBy, minDays: plan.minDays, format: plan.format, probes, pool, pooled: mined.pooled, apiCalls: client.callCount - start, ranAt };
}
