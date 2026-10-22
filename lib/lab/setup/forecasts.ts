/**
 * The Lab's own forecasts (09.3.6): run_cost, month_cost and gate_eta rows in lab_forecasts,
 * frozen and graded. Not predictors: they never enter LAB_PREDICTOR_IDS, the hide rule or the
 * backtest (06 section 3). Lane L calls gradeDueForecasts from the `ledger` job and carries
 * forecastRecord on LedgerView; run_cost rows are graded at settle (lib/lab/spend.ts).
 */
import type { LabForecast, LabForecastKind } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { isDry } from '@/lib/lab/dry';
import { estimatePlan } from '@/lib/lab/setup/estimate';
import { gateCounts, predictGates, type GateEta } from '@/lib/lab/setup/gates';
import { quantile } from '@/lib/lab/setup/calibration';
import { freezeForecast as freezeRow } from '@/lib/lab/setup/forecast-rows';
import { planInputs } from '@/lib/lab/setup/planner';
import { labTz } from '@/lib/lab/setup/tz';
import { localClock } from '@/lib/lab/setup/schedule';

/** 06 LedgerView.forecastRecord, built here; 01 12.3a renders it verbatim. */
export type ForecastRecord = { runCost: string; month: string; gates: string; n: { runCost: number; month: number; gates: number } };

export function freezeForecast(store: LabStore, f: { kind: LabForecastKind; subject: string; inputs: Record<string, unknown>; predicted: number; lo: number | null; hi: number | null; expectedItems?: number | null; now: Date; dry: boolean }): LabForecast {
  return freezeRow(store, f);
}

const DAY = 86_400_000;
const daysBetween = (a: string, b: Date) => (b.getTime() - Date.parse(a)) / DAY;
const monthOf = (d: Date) => d.toISOString().slice(0, 7);

/** The current prediction of every gate for the set as it stands (no network). */
export function currentGates(store: LabStore, now: Date): GateEta[] {
  const inputs = planInputs(store, now);
  return predictGates(inputs.rates, inputs.current, gateCounts(store, now), now, gateAdjust(store));
}

/**
 * Freeze the scheduled forecasts (called from the `health` job): one month_cost row per priced
 * spend line in the first tick of each month, and one gate_eta row per (gate, platform) each
 * Monday at the first tick after 06:00 local. Never twice for the same subject and period.
 */
export function freezeScheduledForecasts(store: LabStore, now: Date, opts: { dry?: boolean } = {}): { month: number; gates: number } {
  const dry = opts.dry ?? isDry();
  let month = 0;
  let gates = 0;
  const ym = monthOf(now);
  const inputs = planInputs(store, now);
  const plan = estimatePlan(inputs, inputs.current);
  for (const line of plan.perLine) {
    const subject = `${line.line}:${ym}`;
    if (line.usd.point <= 0 || store.forecasts.bySubject(subject).some((f) => f.kind === 'month_cost')) continue;
    freezeRow(store, { kind: 'month_cost', subject, inputs: { selection: inputs.current, tier: inputs.tier.tier, priceSource: plan.label }, predicted: line.usd.point, lo: line.usd.low, hi: line.usd.high, now, dry });
    month++;
  }
  const tz = labTz();
  const c = localClock(now, tz);
  if (c.weekday === 1 && c.hh >= 6) {
    const weekStart = new Date(now.getTime() - ((c.hh * 60 + c.mm) * 60 + c.ss) * 1000).toISOString();
    for (const g of predictGates(inputs.rates, inputs.current, gateCounts(store, now), now, gateAdjust(store))) {
      if (g.state !== 'predicted' || !g.days) continue;
      const subject = `${g.gate}:${g.platform}`;
      if (store.forecasts.bySubject(subject).some((f) => f.kind === 'gate_eta' && f.frozenAt >= weekStart)) continue;
      freezeRow(store, { kind: 'gate_eta', subject, inputs: { rates: inputs.rates, selection: inputs.current }, predicted: g.days.med, lo: g.days.lo, hi: g.days.hi, now, dry });
      gates++;
    }
  }
  return { month, gates };
}

/**
 * Grade what is due (09.3.6): month_cost rows once their month has ended, against the line's
 * settled spend; gate_eta rows the first time the gate is met (a `late` row is re-graded then),
 * and `late` once `hi` days pass unmet.
 */
export function gradeDueForecasts(store: LabStore, now: Date, opts: { gates?: GateEta[] } = {}): { graded: number; late: number } {
  let graded = 0;
  let late = 0;
  const at = now.toISOString();
  const thisMonth = monthOf(now);
  for (const f of store.forecasts.open('month_cost').filter((x) => x.status === 'open')) {
    const [line, ym] = f.subject.split(':');
    if (!ym || ym >= thisMonth) continue;
    const actual = store.spend
      .all()
      .filter((s) => !s.dry && s.line === line && s.at.slice(0, 7) === ym)
      .reduce((a, s) => a + (s.actualUsd ?? s.estUsd ?? s.reservedUsd ?? 0), 0);
    store.forecasts.grade(f.id, { actual: Math.round(actual * 10_000) / 10_000, status: 'graded', gradedAt: at });
    graded++;
  }
  const gateRows = [...new Map([...store.forecasts.open('gate_eta'), ...store.forecasts.all('gate_eta').filter((f) => f.status === 'late')].map((f) => [f.id, f])).values()];
  if (gateRows.length) {
    const gates = opts.gates ?? currentGates(store, now);
    const met = new Set(gates.filter((g) => g.state === 'met').map((g) => `${g.gate}:${g.platform}`));
    for (const f of gateRows) {
      if (met.has(f.subject)) {
        store.forecasts.grade(f.id, { actual: Math.round(daysBetween(f.frozenAt, now) * 10) / 10, status: 'graded', gradedAt: at });
        graded++;
      } else if (f.status === 'open' && f.hi !== null && daysBetween(f.frozenAt, now) > f.hi) {
        store.forecasts.grade(f.id, { actual: null, status: 'late', gradedAt: at });
        late++;
      }
    }
  }
  return { graded, late };
}

/** Self-correction (09.3.6): with 5+ graded gate rows, the shrunk median of actual / predicted days. */
export function gateAdjust(store: LabStore): number | null {
  const rows = store.forecasts.all('gate_eta').filter((f) => f.status === 'graded' && f.actual !== null && f.predicted > 0 && !f.dry);
  if (rows.length < 5) return null;
  const ratio = quantile(rows.map((f) => f.actual! / f.predicted), 0.5)!;
  const n = rows.length;
  return Math.round((1 + (n / (n + 5)) * (ratio - 1)) * 100) / 100;
}

/** The "The Lab's own forecasts" card (09.3.6, copy 09.8). Under n 5 each line says `not enough yet`. */
export function forecastRecord(store: LabStore): ForecastRecord {
  const graded = (kind: LabForecastKind) => store.forecasts.all(kind).filter((f) => f.status === 'graded' && f.actual !== null && !f.dry);
  const inside = (f: LabForecast) => (f.lo === null || f.actual! >= f.lo - 1e-9) && (f.hi === null || f.actual! <= f.hi + 1e-9);
  const runs = graded('run_cost');
  const months = graded('month_cost');
  const gates = graded('gate_eta');
  const pct = (rows: LabForecast[]) => Math.round((quantile(rows.filter((f) => f.actual! > 0).map((f) => Math.abs(f.actual! - f.predicted) / f.actual!), 0.5) ?? 0) * 100);
  const runCost = runs.length < 5 ? `Run cost estimates: not enough yet (n ${runs.length}).` : `Run cost estimates: typically off by ${pct(runs)}% on ${runs.length} runs, ${runs.filter(inside).length} of ${runs.length} inside the range.`;
  const month = months.length < 5 ? `Monthly estimates: not enough yet (n ${months.length}).` : `Monthly estimates: off by ${pct(months)}% over ${months.length} line-months.`;
  const d = Math.round(quantile(gates.map((f) => Math.abs(f.actual! - f.predicted)), 0.5) ?? 0);
  const gatesLine = gates.length < 5 ? `Readiness dates: not enough yet (n ${gates.length}).` : `Readiness dates: typically ${d} days early or late on ${gates.length} gates, ${gates.filter(inside).length} of ${gates.length} inside the window.`;
  return { runCost, month, gates: gatesLine, n: { runCost: runs.length, month: months.length, gates: gates.length } };
}

