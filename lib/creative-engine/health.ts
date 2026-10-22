import { createArcadsClient, explainArcadsError, type ArcadsClient } from '@/lib/arcads/client';
import { isDry } from '@/lib/creative-engine/dry';
import { readHealth, writeCreditsSnapshot, writeHealth, readCreditsSnapshot } from '@/lib/creative-engine/store';
import type { CreditsSnapshot, Health } from '@/lib/creative-engine/schemas';

/**
 * Health — the free checks only: auth (GET /v1/products), catalog
 * (GET /v1/voices) and the balance (GET /v1/credits). A per-model
 * generation probe costs credits, so it is a manual button that records
 * into the same file; nothing here ever charges on its own.
 */
export async function probeFree(clientOverride?: ArcadsClient | null): Promise<{ health: Health; credits: CreditsSnapshot | null }> {
  const h = readHealth();
  const at = new Date().toISOString();
  if (isDry()) {
    h.auth = { lastProbeAt: at, ok: true, error: null };
    h.catalog = { lastProbeAt: at, ok: true, error: null };
    h.credits = { lastProbeAt: at, ok: true, error: null };
    writeHealth(h);
    const snap: CreditsSnapshot = { at, creditsIncluded: 1000, creditsRemaining: 961.97, additionalCreditsUsed: 0, periodStart: null, periodEnd: null, plan: 'dry run' };
    writeCreditsSnapshot(snap);
    return { health: h, credits: snap };
  }
  const client = clientOverride === undefined ? createArcadsClient() : clientOverride;
  if (!client) {
    h.auth = { lastProbeAt: at, ok: false, error: 'ARCADS_BASIC_AUTH not set' };
    writeHealth(h);
    return { health: h, credits: readCreditsSnapshot() };
  }
  const run = async (key: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      h[key] = { lastProbeAt: at, ok: true, error: null };
    } catch (err) {
      h[key] = { lastProbeAt: at, ok: false, error: explainArcadsError(err).message };
    }
  };
  await run('auth', () => client.products());
  await run('catalog', () => client.voices());
  let credits: CreditsSnapshot | null = readCreditsSnapshot();
  await run('credits', async () => {
    const b = await client.credits();
    const plan = typeof b.plan === 'string' ? b.plan : b.plan && typeof b.plan === 'object' ? ((b.plan as { name?: string }).name ?? null) : null;
    credits = { at, creditsIncluded: b.creditsIncluded ?? null, creditsRemaining: b.creditsRemaining ?? null, additionalCreditsUsed: b.additionalCreditsUsed ?? null, periodStart: b.currentPeriodStart ?? null, periodEnd: b.currentPeriodEnd ?? null, plan };
    writeCreditsSnapshot(credits);
  });
  writeHealth(h);
  return { health: h, credits };
}

/** Record a per-model probe verdict (the generation itself is a run; the poll calls this). */
export function recordModelProbe(model: string, ok: boolean, error: string | null): Health {
  const h = readHealth();
  h[model] = { lastProbeAt: new Date().toISOString(), ok, error };
  writeHealth(h);
  return h;
}
