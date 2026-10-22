/**
 * lab_forecasts row writes (09.3.6, 09.6) with no other Lab dependency, so the spend gate can
 * freeze a run's cost estimate at reserve time and grade it at settle without an import cycle.
 * Rows are immutable once graded or void; a `late` row may be re-graded once (lab_forecasts_lock).
 */
import { randomBytes } from 'node:crypto';
import type { LabForecast, LabForecastKind } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';

export const newForecastId = (): string => `lfc-${randomBytes(8).toString('hex')}`;

export type FreezeInput = {
  kind: LabForecastKind;
  subject: string;
  inputs: Record<string, unknown>;
  predicted: number;
  lo: number | null;
  hi: number | null;
  expectedItems?: number | null;
  now: Date;
  dry: boolean;
};

/** Freeze one forecast. Never updates an existing row. */
export function freezeForecast(store: LabStore, f: FreezeInput): LabForecast {
  const row: LabForecast = {
    id: newForecastId(),
    kind: f.kind,
    subject: f.subject,
    frozenAt: f.now.toISOString(),
    inputs: f.inputs,
    predicted: f.predicted,
    lo: f.lo,
    hi: f.hi,
    expectedItems: f.expectedItems === undefined || f.expectedItems === null ? null : Math.round(f.expectedItems),
    actual: null,
    actualItems: null,
    status: 'open',
    gradedAt: null,
    dry: f.dry,
  };
  store.forecasts.insert(row);
  return row;
}

/** The open (or late) run_cost forecast frozen for a lab_runs id, if any. */
export function runCostForecast(store: LabStore, runId: string): LabForecast | null {
  return store.forecasts.bySubject(runId).find((f) => f.kind === 'run_cost' && (f.status === 'open' || f.status === 'late')) ?? null;
}
