/**
 * Robinhood connector (pages/trading.md §2), ported from the 2026-10-06 parts
 * bin and FounderOS (`connectors/robinhood/robinhood.go`).
 *
 * There is no key: the Robinhood Trading MCP is agent-facing OAuth, not
 * callable by this webapp. The Markets agent pushes account snapshots to
 * POST /api/trading/snapshot, and this connector reports whether that feed is
 * live, from the newest capture alone:
 *
 *   no snapshot ever      not_configured
 *   newest under 24 h     connected
 *   newest 24 h or older  error, naming the age ("Feed 2 days old")
 *
 * It never calls Robinhood, so there is no order endpoint anywhere in lib/
 * (pages/trading.md T-6).
 */
import type { ConnectorStatus } from '@/lib/connectors/types';
import type { TradingAccountSnapshot } from '@/lib/schemas';

export const ROBINHOOD_STALE_MS = 24 * 3600_000;

/** "just now", "12 min", "3 hours", "2 days". */
export function feedAge(iso: string, now: Date = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} hour${hrs === 1 ? '' : 's'}`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function robinhoodStatus(accounts: TradingAccountSnapshot[], now: Date = new Date()): ConnectorStatus {
  const base = { id: 'robinhood', name: 'Robinhood', kind: 'payments' } as const;
  if (accounts.length === 0) {
    return {
      ...base,
      state: 'not_configured',
      detail: 'No account data pushed yet. Have the Markets agent POST /api/trading/snapshot with TRADING_PUSH_TOKEN; its first push fills /trading.',
    };
  }
  const freshest = accounts.reduce((a, b) => (a.capturedAt >= b.capturedAt ? a : b));
  const ageMs = now.getTime() - new Date(freshest.capturedAt).getTime();
  const scope = accounts.length === 1 ? accounts[0].accountLabel : `${accounts.length} accounts`;
  const sum = (pick: (s: TradingAccountSnapshot) => number) => Math.round(accounts.reduce((t, a) => t + pick(a), 0) * 100) / 100;
  const meta = { accountValueUsd: sum((a) => a.accountValueUsd), buyingPowerUsd: sum((a) => a.buyingPowerUsd), capturedAt: freshest.capturedAt };
  if (!(ageMs < ROBINHOOD_STALE_MS)) {
    return { ...base, state: 'error', detail: `Feed ${feedAge(freshest.capturedAt, now)} old · ${scope}. The Markets agent has stopped pushing.`, meta };
  }
  return { ...base, state: 'connected', detail: `${scope} · updated ${feedAge(freshest.capturedAt, now)}${ageMs >= 60_000 ? ' ago' : ''}`, meta };
}

/** The connections-board check: reads the store, never the network. */
export async function robinhoodConnectorStatus(): Promise<ConnectorStatus> {
  const { getDb } = await import('@/lib/data');
  return robinhoodStatus(getDb().trading.latestSnapshots());
}
