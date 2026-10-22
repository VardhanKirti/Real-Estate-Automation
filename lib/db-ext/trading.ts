/**
 * Trading repository (FounderOS UI merge, pages/trading.md §2). Ported from
 * the 2026-10-06 parts bin (lib/db-ext/trading.ts), schemas moved to
 * lib/schemas.ts and the tables to lib/db.ts FO_DDL.
 *
 * GladOS cannot call the Robinhood Trading MCP (it is agent-facing OAuth), so
 * the Markets agent pushes rows in through POST /api/trading/snapshot and
 * /trading reads them back. Nothing is seeded, and there are no default
 * limits: no row means "No limits saved" (SPEC O4).
 */
import type Database from 'better-sqlite3';
import {
  TradeActivitySchema,
  TradeAnalysisSchema,
  TradingAccountSnapshotSchema,
  TradingLimitsRowSchema,
  TradingLimitsSchema,
  TradingOrderSchema,
  TradingPositionSchema,
  type TradeActivity,
  type TradeAnalysis,
  type TradingAccountSnapshot,
  type TradingLimits,
  type TradingLimitsRow,
  type TradingOrder,
  type TradingPosition,
} from '@/lib/schemas';

const SNAPSHOT_COLS = `account_id AS accountId, account_label AS accountLabel, captured_at AS capturedAt,
  account_value_usd AS accountValueUsd, buying_power_usd AS buyingPowerUsd,
  cash_usd AS cashUsd, day_pnl_usd AS dayPnlUsd, total_pnl_usd AS totalPnlUsd, source`;

export function tradingRepo(db: InstanceType<typeof Database>) {
  const trading = {
    /** One account snapshot plus its positions, written together. */
    recordSnapshot(s: TradingAccountSnapshot, positions: TradingPosition[]): void {
      const snap = TradingAccountSnapshotSchema.parse(s);
      const rows = positions.map((p) => TradingPositionSchema.parse(p));
      db.transaction(() => {
        db.prepare(
          `INSERT OR REPLACE INTO trading_snapshots
             (account_id, account_label, captured_at, account_value_usd, buying_power_usd, cash_usd,
              day_pnl_usd, total_pnl_usd, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          snap.accountId, snap.accountLabel, snap.capturedAt, snap.accountValueUsd,
          snap.buyingPowerUsd, snap.cashUsd, snap.dayPnlUsd, snap.totalPnlUsd, snap.source,
        );
        const ins = db.prepare(
          `INSERT OR REPLACE INTO trading_positions
             (account_id, captured_at, symbol, quantity, avg_cost_usd, market_value_usd, unrealized_pnl_usd)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const p of rows) ins.run(p.accountId, p.capturedAt, p.symbol, p.quantity, p.avgCostUsd, p.marketValueUsd, p.unrealizedPnlUsd);
      })();
    },

    /** The newest snapshot of every account, richest first. */
    latestSnapshots(): TradingAccountSnapshot[] {
      return db
        .prepare(
          `SELECT ${SNAPSHOT_COLS}
             FROM trading_snapshots
            WHERE (account_id, captured_at) IN
                  (SELECT account_id, MAX(captured_at) FROM trading_snapshots GROUP BY account_id)
            ORDER BY account_value_usd DESC`,
        )
        .all()
        .map((r) => TradingAccountSnapshotSchema.parse(r));
    },

    /** One account's snapshots oldest-first (the chart series), last `limit`. */
    history(accountId: string, limit = 500): TradingAccountSnapshot[] {
      return db
        .prepare(
          `SELECT * FROM (
             SELECT ${SNAPSHOT_COLS} FROM trading_snapshots WHERE account_id = ?
             ORDER BY captured_at DESC LIMIT ?
           ) ORDER BY capturedAt ASC`,
        )
        .all(accountId, limit)
        .map((r) => TradingAccountSnapshotSchema.parse(r));
    },

    /** Positions from each account's latest snapshot, largest first. */
    positions(accountId?: string): TradingPosition[] {
      return db
        .prepare(
          `SELECT p.account_id AS accountId, p.captured_at AS capturedAt, p.symbol, p.quantity,
                  p.avg_cost_usd AS avgCostUsd, p.market_value_usd AS marketValueUsd,
                  p.unrealized_pnl_usd AS unrealizedPnlUsd
             FROM trading_positions p
            WHERE (p.account_id, p.captured_at) IN
                  (SELECT account_id, MAX(captured_at) FROM trading_snapshots GROUP BY account_id)
              AND (? IS NULL OR p.account_id = ?)
            ORDER BY p.market_value_usd DESC`,
        )
        .all(accountId ?? null, accountId ?? null)
        .map((r) => TradingPositionSchema.parse(r));
    },

    /** Replace one account's live orders wholesale, so filled and cancelled
     *  orders drop off. An empty array means nothing is working. */
    replaceOpenOrders(accountId: string, orders: TradingOrder[]): void {
      const rows = orders.map((o) => TradingOrderSchema.parse({ ...o, accountId }));
      db.transaction(() => {
        db.prepare('DELETE FROM trading_orders WHERE account_id = ?').run(accountId);
        const ins = db.prepare(
          `INSERT OR REPLACE INTO trading_orders
             (id, account_id, symbol, side, type, state, quantity, filled_quantity,
              dollar_amount_usd, limit_price_usd, placed_agent, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const o of rows) {
          ins.run(o.id, accountId, o.symbol, o.side, o.type, o.state, o.quantity,
            o.filledQuantity, o.dollarAmountUsd, o.limitPriceUsd, o.placedAgent, o.createdAt);
        }
      })();
    },

    openOrders(accountId?: string): TradingOrder[] {
      return db
        .prepare(
          `SELECT id, account_id AS accountId, symbol, side, type, state, quantity,
                  filled_quantity AS filledQuantity, dollar_amount_usd AS dollarAmountUsd,
                  limit_price_usd AS limitPriceUsd, placed_agent AS placedAgent, created_at AS createdAt
             FROM trading_orders WHERE (? IS NULL OR account_id = ?)
            ORDER BY created_at DESC`,
        )
        .all(accountId ?? null, accountId ?? null)
        .map((r) => TradingOrderSchema.parse(r));
    },

    /** One run's reasoning. Idempotent on id so a retried push cannot duplicate. */
    recordAnalysis(a: TradeAnalysis): void {
      const row = TradeAnalysisSchema.parse(a);
      db.prepare(
        `INSERT OR REPLACE INTO trading_analysis (id, at, account_id, agent, examined, signals, notes, rows_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(row.id, row.at, row.accountId, row.agent, row.examined, row.signals, row.notes, JSON.stringify(row.rows));
    },

    analyses(accountId?: string, limit = 30): TradeAnalysis[] {
      return (
        db
          .prepare(
            `SELECT id, at, account_id AS accountId, agent, examined, signals, notes, rows_json AS rowsJson
               FROM trading_analysis WHERE (? IS NULL OR account_id = ?)
              ORDER BY at DESC LIMIT ?`,
          )
          .all(accountId ?? null, accountId ?? null, limit) as ({ rowsJson: string } & Record<string, unknown>)[]
      ).map(({ rowsJson, ...rest }) => TradeAnalysisSchema.parse({ ...rest, rows: JSON.parse(rowsJson || '[]') }));
    },

    latestAnalysis(accountId?: string): TradeAnalysis | null {
      return trading.analyses(accountId, 1)[0] ?? null;
    },

    /** One trade or decision. Idempotent on id. */
    recordActivity(a: TradeActivity): void {
      const row = TradeActivitySchema.parse(a);
      db.prepare(
        `INSERT OR REPLACE INTO trading_activity
           (id, at, account_id, agent, action, symbol, quantity, price_usd, rationale, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(row.id, row.at, row.accountId, row.agent, row.action, row.symbol, row.quantity, row.priceUsd, row.rationale, row.status);
    },

    activity(limit = 50, accountId?: string): TradeActivity[] {
      return db
        .prepare(
          `SELECT id, at, account_id AS accountId, agent, action, symbol, quantity,
                  price_usd AS priceUsd, rationale, status
             FROM trading_activity WHERE (? IS NULL OR account_id = ?)
            ORDER BY at DESC LIMIT ?`,
        )
        .all(accountId ?? null, accountId ?? null, limit)
        .map((r) => TradeActivitySchema.parse(r));
    },

    /** The stored limits, or null when none were ever saved. */
    limits(): TradingLimitsRow | null {
      const row = db
        .prepare(
          `SELECT max_deployed_capital_usd AS maxDeployedCapitalUsd,
                  max_notional_per_trade_usd AS maxNotionalPerTradeUsd,
                  max_position_pct_of_sleeve AS maxPositionPctOfSleeve,
                  max_risk_pct_per_trade AS maxRiskPctPerTrade,
                  max_concurrent_positions AS maxConcurrentPositions,
                  max_trades_per_day AS maxTradesPerDay,
                  min_sleeve_value_usd AS minSleeveValueUsd,
                  autopilot, updated_at AS updatedAt
             FROM trading_limits WHERE id = 1`,
        )
        .get() as (Record<string, number> & { autopilot: number; updatedAt: string }) | undefined;
      return row ? TradingLimitsRowSchema.parse({ ...row, autopilot: row.autopilot === 1 }) : null;
    },

    saveLimits(l: TradingLimits, now = new Date().toISOString()): void {
      const v = TradingLimitsSchema.parse(l);
      db.prepare(
        `INSERT INTO trading_limits
           (id, max_deployed_capital_usd, max_notional_per_trade_usd, max_position_pct_of_sleeve,
            max_risk_pct_per_trade, max_concurrent_positions, max_trades_per_day, min_sleeve_value_usd,
            autopilot, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           max_deployed_capital_usd   = excluded.max_deployed_capital_usd,
           max_notional_per_trade_usd = excluded.max_notional_per_trade_usd,
           max_position_pct_of_sleeve = excluded.max_position_pct_of_sleeve,
           max_risk_pct_per_trade     = excluded.max_risk_pct_per_trade,
           max_concurrent_positions   = excluded.max_concurrent_positions,
           max_trades_per_day         = excluded.max_trades_per_day,
           min_sleeve_value_usd       = excluded.min_sleeve_value_usd,
           autopilot                  = excluded.autopilot,
           updated_at                 = excluded.updated_at`,
      ).run(
        v.maxDeployedCapitalUsd, v.maxNotionalPerTradeUsd, v.maxPositionPctOfSleeve, v.maxRiskPctPerTrade,
        v.maxConcurrentPositions, v.maxTradesPerDay, v.minSleeveValueUsd, v.autopilot ? 1 : 0, now,
      );
    },

    /** True when nothing was ever pushed or saved: the page's blank state. */
    isEmpty(): boolean {
      const n = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
      return n('trading_snapshots') + n('trading_activity') + n('trading_analysis') + n('trading_orders') + n('trading_limits') === 0;
    },
  };
  return trading;
}
