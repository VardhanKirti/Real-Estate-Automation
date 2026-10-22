/**
 * The first-live-run checklist items that belong to data and measurement (04 2.1). Section 08 owns
 * the checklist file, the sheet and the order it renders; this module supplies each item's tick,
 * detected from the store only (nothing is ticked by hand except the operator's console figure for
 * `bill_matches`). Pure over the store and `now`; no network.
 */
import type { LabPlatform } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { allPostActorsVerified } from '@/lib/lab/measure/actors';
import { snapshotHitRate } from '@/lib/lab/measure/scheduler';
import type { ActorPriceBook } from '@/lib/lab/setup/pricing';

export type MeasureChecklistId =
  | 'key_apify' | 'verify_actors' | 'first_owned' | 'cost_settles' | 'bill_matches' | 'first_tracked' | 'stt_price'
  | 'dissect_real' | 'feeds_live' | 'snap_installed' | 'snap_hit_rate' | 'measures_live' | 'tiktok_download_price';

export const MEASURE_CHECKLIST: { id: MeasureChecklistId; step: string; ceilingUsd: number | null; closes: string | null }[] = [
  { id: 'key_apify', step: 'Paste the Apify token and press Test key', ceilingUsd: 0, closes: null },
  { id: 'verify_actors', step: 'Run the actor check', ceilingUsd: 0.4, closes: 'LC-2, LC-3, LC-4, LC-5' },
  { id: 'first_owned', step: 'First read of your own accounts (50 posts each)', ceilingUsd: 0.75, closes: 'LC-5' },
  { id: 'cost_settles', step: 'Actual cost recorded', ceilingUsd: 0, closes: 'LC-1' },
  { id: 'bill_matches', step: "The ledger matches Apify's bill", ceilingUsd: 0, closes: 'LC-1, LC-5' },
  { id: 'first_tracked', step: 'First read of tracked creators', ceilingUsd: 6, closes: 'LC-5' },
  { id: 'stt_price', step: 'Whisper price checked and one of your shorts transcribed', ceilingUsd: 0.01, closes: 'LC-6' },
  { id: 'dissect_real', step: 'The claude CLI dissects 3 real transcripts', ceilingUsd: 0, closes: 'LC-7' },
  { id: 'feeds_live', step: 'Hacker News and Reddit answered', ceilingUsd: 0, closes: 'LC-8' },
  { id: 'snap_installed', step: 'Snapshot scheduler installed', ceilingUsd: 0, closes: null },
  { id: 'snap_hit_rate', step: 'First day of fixed-age reads', ceilingUsd: null, closes: null },
  { id: 'measures_live', step: 'Measures from real data', ceilingUsd: 0, closes: null },
  { id: 'tiktok_download_price', step: 'TikTok video download event priced', ceilingUsd: 0, closes: 'LC-9' },
];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Each 04 item's tick from the store. */
export function measureChecklist(store: LabStore, now: Date): Record<MeasureChecklistId, boolean> {
  const owned = store.sources.all('owned').filter((s) => s.status === 'active');
  const tracked = store.sources.all('tracked').filter((s) => s.status === 'active');
  const ownedPlatforms = [...new Set(owned.map((s) => s.platform))].filter((p): p is LabPlatform => ['instagram', 'tiktok', 'youtube', 'linkedin', 'twitter'].includes(p));
  const runs = store.runs.recent(2000);
  const liveScrapes = runs.filter((r) => r.kind === 'scrape' && r.status === 'succeeded' && !r.dry);
  const scrapedSources = new Set(liveScrapes.flatMap((r) => ((r.input as { sourceIds?: unknown } | null)?.sourceIds as string[] | undefined) ?? []));
  const posts = store.posts.all();
  const live = store.spend.all().filter((s) => !s.dry);
  const bill = store.priors.get('bill_check')?.value as { ledger?: number; console?: number } | null | undefined;
  const sttPrice = store.priors.get('stt_price');
  const dayAgo = now.getTime() - DAY;
  const feedOk = (actor: string) => runs.some((r) => r.kind === 'search' && r.actor === actor && r.status === 'succeeded' && !r.dry && Date.parse(r.startedAt) >= dayAgo);
  const ownedAt24 = posts.filter((p) => p.isOwned && p.postedAt && now.getTime() - Date.parse(p.postedAt) >= 24 * HOUR).length;
  const hit = snapshotHitRate(store, now);
  const trackedIds = new Set(posts.filter((p) => !p.isOwned).map((p) => p.id));
  // LC-9: only a book fetched from Apify counts; the recorded listing figures (RECORDED_PRICES) are not a check
  const book = (store.priors.get('pricing:clockworks/tiktok-scraper')?.value as ActorPriceBook | null | undefined) ?? null;
  const healthApify = store.priors.get('health:apify')?.value as { state?: string } | null | undefined;

  const firstTracked = tracked.length > 0 && tracked.every((s) => scrapedSources.has(s.id));
  return {
    key_apify: store.priors.get('apify:plan') !== null || healthApify?.state === 'ok',
    verify_actors: ownedPlatforms.length > 0 && allPostActorsVerified(store, ownedPlatforms),
    first_owned: ownedPlatforms.length > 0 && ownedPlatforms.every((p) => liveScrapes.some((r) => (r.input as { platform?: string } | null)?.platform === p)) && posts.some((p) => p.isOwned),
    cost_settles: live.length > 0 && live.every((s) => Date.parse(s.at) > now.getTime() - HOUR || s.actualUsd !== null),
    bill_matches: typeof bill?.ledger === 'number' && typeof bill?.console === 'number' && Math.abs(bill.ledger - bill.console) <= Math.max(0.1, 0.05 * bill.console),
    first_tracked: firstTracked,
    stt_price: sttPrice !== null && store.transcripts.all().some((t) => t.provider === 'whisper-1' && t.status === 'done'),
    dissect_real: store.dissections.all().filter((d) => d.modelId !== 'dry-fixture').length >= 3,
    feeds_live: feedOk('feed:hn') && feedOk('feed:reddit'),
    snap_installed: store.priors.get('schedule') !== null,
    snap_hit_rate: ownedAt24 >= 3 && hit.rate !== null && hit.rate >= 0.8,
    measures_live: firstTracked && store.measures.all().some((m) => trackedIds.has(m.postId) && ((m.ages['24']?.n ?? 0) >= 5 || (m.ages['168']?.n ?? 0) >= 5)),
    tiktok_download_price: Boolean(book?.events?.some((e) => e.name === 'video-download')),
  };
}
