/**
 * Price books and tier (09.2.2). The pure half (types, RECORDED_PRICES, currentEntry, priceOf,
 * the pricingInfos parser) lives in pricing-book.ts so the browser can use it; this file adds the
 * store and network half: loadPriceBook, refreshPriceBooks, resolveTier.
 *
 * Storage: lab_priors `pricing:<actorId>` (an ActorPriceBook, source 'live') and `apify:plan`
 * (`{ tier, planId, maxConcurrentActorRuns, checkedAt }`, written by the apify.auth health check).
 * Fetches only from the `health` job (every 6 h) or Check again, never on render, never in dry.
 */
import { ApifyTierSchema, type ApifyTier } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { APIFY_BASE, actorPath, type FetchLike } from '@/lib/lab/apify-client';
import { isDry } from '@/lib/lab/dry';
import { LAB_ACTORS } from '@/lib/lab/setup/estimate';
import { RECORDED_PRICES, parseActorBook, type ActorPriceBook } from '@/lib/lab/setup/pricing-book';

export type { ApifyTier } from '@/lib/schemas';
export type { ActorPriceBook, PriceEvent, PriceSource } from '@/lib/lab/setup/pricing-book';
export { RECORDED_PRICES, RECORDED_PRICES_DATE, TIER_PLAN_LABEL, currentEntry, parseActorBook, parseEvents, priceOf } from '@/lib/lab/setup/pricing-book';

/** A cached book younger than this is 'live' and is not refetched. */
export const PRICE_BOOK_TTL_MS = 24 * 3_600_000;

const pricingKey = (actorId: string) => `pricing:${actorId}`;

/** An actor the Lab has no recorded book for: no events, priced at 0, marked recorded. */
function emptyBook(actorId: string): ActorPriceBook {
  return { actorId, model: 'FREE', entryStartedAt: '2026-10-11T00:00:00.000Z', events: [], minMaxTotalChargeUsd: null, defaultMemoryMb: 1024, next: null, source: 'recorded', fetchedAt: null };
}

/** lab_priors 'pricing:<actorId>' if present, else RECORDED_PRICES[actorId]; never fetches. */
export function loadPriceBook(store: LabStore, actorId: string, now: Date): ActorPriceBook {
  const cached = store.priors.get(pricingKey(actorId))?.value as ActorPriceBook | null | undefined;
  if (cached && Array.isArray(cached.events) && cached.events.length > 0) {
    const age = cached.fetchedAt ? now.getTime() - Date.parse(cached.fetchedAt) : Infinity;
    return { ...cached, source: age <= PRICE_BOOK_TTL_MS ? 'live' : 'cached' };
  }
  return RECORDED_PRICES[actorId] ?? emptyBook(actorId);
}

/** Every actor whose book the Lab keeps: the 09.2.3 rule table. */
export const priceBookActors = (): string[] => Object.keys(LAB_ACTORS);

/**
 * Fetch every actor in LAB_ACTORS whose cache is older than 24 h. Free; no token sent
 * (GET /v2/acts/{id} answers for public actors without one). Never in dry.
 */
export async function refreshPriceBooks(store: LabStore, now: Date, fetchBook: FetchLike): Promise<{ refreshed: string[]; failed: string[] }> {
  const refreshed: string[] = [];
  const failed: string[] = [];
  if (isDry()) return { refreshed, failed };
  for (const actorId of priceBookActors()) {
    const cached = store.priors.get(pricingKey(actorId))?.value as ActorPriceBook | null | undefined;
    if (cached?.fetchedAt && now.getTime() - Date.parse(cached.fetchedAt) < PRICE_BOOK_TTL_MS) continue;
    try {
      const res = await fetchBook(`${APIFY_BASE}/acts/${actorPath(actorId)}`, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!res.ok) {
        failed.push(actorId);
        continue;
      }
      const parsed = parseActorBook(actorId, await res.json(), now);
      if (!parsed || parsed.events.length === 0) {
        failed.push(actorId);
        continue;
      }
      store.priors.set({ key: pricingKey(actorId), value: parsed, n: 0, supersedesDefault: false, updatedAt: now.toISOString() });
      refreshed.push(actorId);
    } catch {
      failed.push(actorId);
    }
  }
  return { refreshed, failed };
}

export type ApifyPlan = { tier: ApifyTier; planId: string; maxConcurrentActorRuns: number | null; checkedAt: string };

/** Tier for prices: lab_priors 'apify:plan' (from GET /v2/users/me) when present, else 'FREE' with source 'assumed'. */
export function resolveTier(store: LabStore): { tier: ApifyTier; planId: string | null; source: 'account' | 'assumed'; checkedAt: string | null } {
  const plan = store.priors.get('apify:plan')?.value as Partial<ApifyPlan> | null | undefined;
  const tier = ApifyTierSchema.safeParse(plan?.tier);
  if (plan && tier.success) return { tier: tier.data, planId: plan.planId ?? null, source: 'account', checkedAt: plan.checkedAt ?? null };
  return { tier: 'FREE', planId: null, source: 'assumed', checkedAt: null };
}

/** Write `apify:plan` from a GET /v2/users/me body (the apify.auth health check, 08.4.1). */
export function recordApifyPlan(store: LabStore, body: unknown, now: Date): ApifyPlan | null {
  const d = ((body as { data?: unknown } | null)?.data ?? body) as { plan?: Record<string, unknown> } | null;
  const tier = ApifyTierSchema.safeParse(d?.plan?.tier);
  if (!tier.success) return null;
  const plan: ApifyPlan = {
    tier: tier.data,
    planId: typeof d?.plan?.id === 'string' ? d.plan.id : '',
    maxConcurrentActorRuns: typeof d?.plan?.maxConcurrentActorRuns === 'number' ? d.plan.maxConcurrentActorRuns : null,
    checkedAt: now.toISOString(),
  };
  store.priors.set({ key: 'apify:plan', value: plan, n: 0, supersedesDefault: false, updatedAt: plan.checkedAt });
  return plan;
}

/** Every book the Lab keeps, loaded (no fetch): what SetupView ships to the browser (09.2.7). */
export function loadAllBooks(store: LabStore, now: Date): Record<string, ActorPriceBook> {
  return Object.fromEntries(priceBookActors().map((id) => [id, loadPriceBook(store, id, now)]));
}
