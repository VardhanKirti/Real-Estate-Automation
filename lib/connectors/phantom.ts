/**
 * Phantom wallet (Solana): read-only balance for /trading. Ported from the
 * 2026-10-06 parts bin and FounderOS (`connectors/phantom`).
 *
 * No credential of any kind: a Solana address is public and the balance comes
 * from a public RPC (`getBalance`, free), so this holds an ADDRESS, never a
 * key, and has no signing path. PHANTOM_WALLET_ADDRESS and the optional
 * SOLANA_RPC_URL resolve through lib/creds.ts. Readings sit in the SWR cache
 * (60 s fresh, pages/trading.md §2), so a polling page cannot hammer the RPC.
 */
import { resolveCred } from '@/lib/creds';
import type { ConnectorStatus } from '@/lib/connectors/types';
import { TTL, invalidateSwr, lastSwr, swr } from '@/lib/swr';

export const DEFAULT_SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd';
const LAMPORTS_PER_SOL = 1_000_000_000;
/** Fresh window for a reading (pages/trading.md §2); TTL.wallet in lib/swr.ts. */
export const PHANTOM_CACHE_MS = TTL.wallet.freshMs;

export type PhantomBalance = {
  address: string;
  sol: number;
  usdPerSol: number | null;
  usdValue: number | null;
  fetchedAt: string;
};

/** A reading attempt: the balance, or why there is none. */
export type PhantomReading = { balance: PhantomBalance | null; error: string | null };

export function solFromLamports(lamports: number): number {
  return Math.round((lamports / LAMPORTS_PER_SOL) * 1e6) / 1e6;
}

export function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Base58, 32-44 chars: the shape of a Solana public key. */
export function looksLikeSolanaAddress(a: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
}

export function phantomAddress(): string | null {
  const a = resolveCred('PHANTOM_WALLET_ADDRESS', [])?.trim();
  return a ? a : null;
}

export function solanaRpcUrl(): string {
  return resolveCred('SOLANA_RPC_URL', [])?.trim() || DEFAULT_SOLANA_RPC;
}

type Fetch = typeof fetch;

/** SWR key per address (lib/swr.ts). */
export const phantomKey = (address: string) => `phantom:balance:${address}`;
/**
 * A render that finds only an expired reading waits this long for the refresh, then shows the last real
 * reading (with its fetchedAt) while the refresh finishes behind it (founderos-ui SPEC 4.1 a3).
 */
export const PHANTOM_BUDGET_MS = 1500;

/** Test hook. */
export function resetPhantomCache(): void {
  invalidateSwr('phantom:');
}

async function json(fetchFn: Fetch, url: string, init?: RequestInit): Promise<unknown> {
  const r = await fetchFn(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/**
 * Balance in SOL plus its USD value. The price is a separate best-effort call:
 * a price outage nulls usdValue instead of hiding the balance. No address
 * means no network call at all.
 *
 * Behind the SWR cache (TTL.wallet: 60 s fresh, then served stale while one
 * refresh runs; lib/warm.ts reads it at boot), so /trading never waits on the
 * RPC (up to 8 s) after the first read. Always on, tests included: it is also
 * the guard that keeps a polling page off the public RPC. An unreachable RPC
 * is a real reading too ("Wallet not reachable") and is cached like one.
 */
export async function readPhantom(address: string | null = phantomAddress(), opts: { fetchFn?: Fetch; now?: number } = {}): Promise<PhantomReading> {
  if (!address) return { balance: null, error: null };
  const key = phantomKey(address);
  const last = lastSwr<PhantomReading>(key);
  const live = swr(key, { ...TTL.wallet, force: true }, () => readPhantomLive(address, opts.fetchFn ?? fetch, opts.now));
  if (!last) return live;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<PhantomReading>((resolve) => {
    timer = setTimeout(() => resolve(last), PHANTOM_BUDGET_MS);
    timer.unref?.();
  });
  return Promise.race([live, budget]).finally(() => clearTimeout(timer));
}

async function readPhantomLive(address: string, fetchFn: Fetch, nowOpt?: number): Promise<PhantomReading> {
  const now = nowOpt ?? Date.now();
  try {
    const res = (await json(fetchFn, solanaRpcUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }),
    })) as { result?: { value?: unknown }; error?: { message?: unknown } };
    const lamports = res?.result?.value;
    if (typeof lamports !== 'number') throw new Error(typeof res?.error?.message === 'string' ? res.error.message : 'RPC returned no balance');
    let usdPerSol: number | null = null;
    try {
      const price = (await json(fetchFn, PRICE_URL)) as { solana?: { usd?: unknown } };
      usdPerSol = typeof price?.solana?.usd === 'number' ? price.solana.usd : null;
    } catch {
      usdPerSol = null;
    }
    const sol = solFromLamports(lamports);
    return {
      balance: {
        address,
        sol,
        usdPerSol,
        usdValue: usdPerSol === null ? null : Math.round(sol * usdPerSol * 100) / 100,
        fetchedAt: new Date(now).toISOString(),
      },
      error: null,
    };
  } catch (err) {
    return { balance: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Honest status: no address is a different thing from a dead RPC. */
export function phantomStatus(reading: PhantomReading, address: string | null = phantomAddress()): ConnectorStatus {
  const base = { id: 'phantom', name: 'Phantom', kind: 'payments' } as const;
  if (!address) {
    return {
      ...base,
      state: 'not_configured',
      detail: 'Set PHANTOM_WALLET_ADDRESS. It is a public Solana address, not a key; nothing can be signed.',
    };
  }
  if (!looksLikeSolanaAddress(address)) {
    return { ...base, state: 'error', detail: 'PHANTOM_WALLET_ADDRESS is not a Solana address (base58, 32 to 44 characters).' };
  }
  if (!reading.balance) {
    return { ...base, state: 'error', detail: `Wallet not reachable: ${reading.error ?? 'Solana RPC did not answer'}` };
  }
  const b = reading.balance;
  return {
    ...base,
    state: 'connected',
    detail: `${shortAddress(b.address)} · ${b.sol} SOL${b.usdValue === null ? ' (price unavailable)' : ''}`,
    meta: { sol: b.sol, ...(b.usdValue === null ? {} : { usdValue: b.usdValue }) },
  };
}

/** The connections-board check: one (cached) balance read, then the status. */
export async function phantomConnectorStatus(): Promise<ConnectorStatus> {
  const address = phantomAddress();
  if (address && !looksLikeSolanaAddress(address)) return phantomStatus({ balance: null, error: null }, address);
  return phantomStatus(await readPhantom(address), address);
}
