/**
 * Stale-while-revalidate memo for slow live checks on the render path (connector health,
 * `engine doctor`). Perf only: a page never waits on a check it already ran recently.
 *
 *   fresh (age < freshMs)      the last real result, no call
 *   stale (age < maxStaleMs)   the last real result now, one refresh starts in the background
 *   older / never run          the caller waits for a real call (same as no cache)
 *
 * Every value it hands out is a real result of the wrapped call, at most `maxStaleMs` old and
 * normally no older than `freshMs` plus one refresh; it never invents a state. Concurrent
 * callers share one in-flight call. A rejected call is not cached. `invalidateSwr(prefix)`
 * drops entries when the operator changes something the check depends on (keys, settings),
 * so the next render checks again for real.
 *
 * Held on globalThis so `next dev` module reloads share one cache per server process.
 */
import { createHash } from 'node:crypto';

/** Shared keys, so writers can invalidate what readers cache. Every connector status key starts
 *  with CONNECTORS_SWR_PREFIX, so one invalidation covers the board and the single-status reads. */
export const CONNECTORS_SWR_PREFIX = 'connectors:';
export const CONNECTORS_SWR_KEY = 'connectors:all';
export const BRAIN_SWR_PREFIX = 'brain:';

const MIN = 60_000;
/**
 * Freshness windows per source (founderos-ui SPEC 4.1 a3). `freshMs`: served with no call.
 * `maxStaleMs`: served at once while one refresh runs behind it. Older than that, the caller waits.
 */
export const TTL = {
  /** connector health checks (the board and single statuses) */
  connector: { freshMs: MIN, maxStaleMs: 10 * MIN },
  /** CRM pipelines: Attio deals and contacts, GHL opportunities */
  crm: { freshMs: MIN, maxStaleMs: 10 * MIN },
  /** Zernio accounts, history and posts; Beehiiv subscribers and posts */
  social: { freshMs: MIN, maxStaleMs: 10 * MIN },
  /** the comms feed: IMAP, Slack */
  comms: { freshMs: 30_000, maxStaleMs: 5 * MIN },
  /** money: Stripe, FanBasis, Wise */
  money: { freshMs: 5 * MIN, maxStaleMs: 30 * MIN },
  /** engine doctor and stats */
  brain: { freshMs: 5 * MIN, maxStaleMs: 30 * MIN },
  /** Phantom wallet balance on /trading (pages/trading.md §2: 60 s) */
  wallet: { freshMs: MIN, maxStaleMs: 10 * MIN },
  /** MIOSA computers and credits */
  compute: { freshMs: 30_000, maxStaleMs: 5 * MIN },
  /** Skyescraper: leads, projects/units — /funnel and the real-estate dashboard */
  skyescraper: { freshMs: 30_000, maxStaleMs: 5 * MIN },
} as const;

/** The default window for a live third-party read on the render path: 60s fresh, 10 min stale-while-revalidate. */
export const LIVE_READ = TTL.crm;

/** A short one-way tag for a credential, so a cache key never holds the secret itself. */
export function keyTag(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 12);
}

type Entry = { at: number; value?: unknown; has: boolean; pending?: Promise<unknown> };

const g = globalThis as typeof globalThis & { __gladosSwr?: Map<string, Entry> };
const store: Map<string, Entry> = (g.__gladosSwr ??= new Map());
/** Bumped by invalidateSwr: a call that started before an invalidation never lands in the cache. */
let generation = 0;

/** Off under vitest, so every test sees a real call unless it opts in with `force`. */
const disabled = () => process.env.VITEST === 'true' || process.env.GLADOS_SWR === '0';

export async function swr<T>(key: string, opts: { freshMs: number; maxStaleMs: number; force?: boolean }, load: () => Promise<T>): Promise<T> {
  if (disabled() && !opts.force) return load();
  const now = Date.now();
  const e = store.get(key);
  const refresh = (): Promise<T> => {
    const cur = store.get(key);
    if (cur?.pending) return cur.pending as Promise<T>;
    const gen = generation;
    const p = load().then(
      (value) => {
        if (gen === generation) store.set(key, { at: Date.now(), value, has: true });
        return value;
      },
      (err) => {
        const prev = store.get(key);
        if (prev && gen === generation) store.set(key, { ...prev, pending: undefined });
        throw err;
      },
    );
    store.set(key, { ...(cur ?? { at: 0, has: false }), pending: p });
    return p;
  };
  if (e?.has) {
    const age = now - e.at;
    if (age < opts.freshMs) return e.value as T;
    if (age < opts.maxStaleMs) {
      refresh().catch(() => {});
      return e.value as T;
    }
  }
  return refresh();
}

/**
 * The last real value stored under `key`, whatever its age, or undefined. For a source that used to
 * fall back to its last good answer when a call fails (Zernio, Beehiiv): the value is still a real
 * result, only older. Never invents one.
 */
export function lastSwr<T>(key: string): T | undefined {
  const e = store.get(key);
  return e?.has ? (e.value as T) : undefined;
}

/** Drop every entry whose key starts with `prefix` (all of them with no argument). */
export function invalidateSwr(prefix = ''): void {
  generation++;
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
