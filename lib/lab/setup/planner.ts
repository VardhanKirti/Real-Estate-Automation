/**
 * The server half of the plan panel (09.2.7): what SetupView ships to the browser as
 * `planner: PlanInputs` (price books, tier, calibration, caps, spend this month, the current
 * selection, gate rates), built from the store with no network call (AC-08-9, AC-09-30).
 */
import { LAB_JOB_IDS, LAB_SPEND_LINES, LAB_SPEND_PROVIDERS, LabPlatformSchema, type JobConfig, type LabJobId, type LabPlatform, type LabSpendLine, type LabSpendProvider } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { readEnvLocal } from '@/lib/creds';
import { capFor, lineCapFor, lineSpend, monthStart } from '@/lib/lab/spend';
import { SCRAPE_DEPTH } from '@/lib/lab/apify-client';
import { labTz } from '@/lib/lab/setup/tz';
import { jobConfig } from '@/lib/lab/setup/schedule';
import { RECORDED_PRICES } from '@/lib/lab/setup/pricing-book';
import { loadAllBooks, resolveTier } from '@/lib/lab/setup/pricing';
import { calibrationFor, type ActorCalibration } from '@/lib/lab/setup/calibration';
import { LAB_ACTORS, type PlanInputs, type PlanSelection } from '@/lib/lab/setup/estimate';
import { gateRates } from '@/lib/lab/setup/gates';

const DAY = 86_400_000;
type Env = Record<string, string | undefined>;

/** The tracked and owned set as it stands, with each platform's observed posts a week when known. */
export function currentSelection(store: LabStore, now: Date, env: Env = { ...process.env, ...readEnvLocal() }): PlanSelection {
  const T = now.getTime();
  const month = monthStart(now);
  const tracked = new Map<LabPlatform, { count: number; posts: number; active: number }>();
  const owned = new Map<LabPlatform, number>();
  const added = new Map<LabPlatform, number>();
  for (const s of store.sources.all()) {
    if (s.status !== 'active' || (s.kind !== 'tracked' && s.kind !== 'owned')) continue;
    const p = LabPlatformSchema.safeParse(s.platform);
    if (!p.success) continue;
    if (s.kind === 'owned') owned.set(p.data, (owned.get(p.data) ?? 0) + 1);
    else {
      const recent = store.posts.bySource(s.id).filter((x) => x.postedAt && T - Date.parse(x.postedAt) <= 28 * DAY && Date.parse(x.postedAt) <= T).length;
      const cur = tracked.get(p.data) ?? { count: 0, posts: 0, active: 0 };
      tracked.set(p.data, { count: cur.count + 1, posts: cur.posts + recent, active: cur.active + (recent > 0 ? 1 : 0) });
    }
    if (s.addedAt >= month) added.set(p.data, (added.get(p.data) ?? 0) + 1);
  }
  const schedule = Object.fromEntries(LAB_JOB_IDS.map((id) => [id, jobConfig(store, id)])) as Record<LabJobId, JobConfig>;
  return {
    tracked: [...tracked].map(([platform, t]) => ({ platform, count: t.count, ...(t.active >= 5 ? { postsPerWeek: Math.round((t.posts / t.active / 4) * 10) / 10 } : {}) })),
    owned: [...owned].map(([platform, count]) => ({ platform, count })),
    depth: { first: SCRAPE_DEPTH.first, cycle: SCRAPE_DEPTH.cycle },
    addOns: { tiktokDownloads: env.LAB_TIKTOK_DOWNLOADS?.trim() === '1', comments: env.LAB_COMMENTS?.trim() === '1' },
    schedule,
    newThisMonth: [...added].map(([platform, count]) => ({ platform, count })),
  };
}

/**
 * PlanInputs for the browser. `recorded` (dry, Filming, sample) prices from RECORDED_PRICES and
 * assumes nothing about the account.
 */
export function planInputs(store: LabStore, now: Date, opts: { recorded?: boolean; env?: Env } = {}): PlanInputs {
  const env = opts.env ?? { ...process.env, ...readEnvLocal() };
  const books = opts.recorded ? { ...RECORDED_PRICES } : loadAllBooks(store, now);
  const calibration: Record<string, ActorCalibration> = {};
  for (const id of Object.keys(LAB_ACTORS)) calibration[id] = calibrationFor(store, id, now);
  return {
    books,
    tier: opts.recorded ? { tier: 'FREE', planId: null, source: 'assumed', checkedAt: null } : resolveTier(store),
    calibration,
    lineCaps: Object.fromEntries(LAB_SPEND_LINES.map((l) => [l, lineCapFor(l, env)])) as Record<LabSpendLine, number | null>,
    providerCaps: Object.fromEntries(LAB_SPEND_PROVIDERS.map((p) => [p, capFor(p, env)])) as Record<LabSpendProvider, number | null>,
    spentThisMonth: Object.fromEntries(LAB_SPEND_LINES.map((l) => [l, lineSpend(store, l, now)])) as Record<LabSpendLine, number>,
    current: currentSelection(store, now, env),
    rates: gateRates(store, now),
    now: now.toISOString(),
    tz: labTz(env),
  };
}
