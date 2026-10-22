import { describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { LAB_DDL } from '@/lib/db';
import { labStore } from '@/lib/lab/store';
import { forecastRecord, freezeForecast, gateAdjust, gradeDueForecasts } from '@/lib/lab/setup/forecasts';
import type { GateEta } from '@/lib/lab/setup/gates';

const fresh = () => {
  const db = new Database(':memory:');
  db.exec(LAB_DDL);
  return labStore(db);
};
const MONDAY = new Date('2026-10-12T07:00:00.000Z');
const DAY = 86_400_000;
const eta = (state: GateEta['state']): GateEta[] => [{ gate: 'baseline_24h', platform: 'instagram', state, metAt: null, days: null, rate: null, rateRange: null, interval: null, blockedReason: null, sources: [] }];

describe('AC-09-13: gate_eta rows are frozen, graded once when met, late past hi', () => {
  test('met before hi: graded once with the days from freeze', () => {
    const store = fresh();
    const f = freezeForecast(store, { kind: 'gate_eta', subject: 'baseline_24h:instagram', inputs: {}, predicted: 12, lo: 7, hi: 20, now: MONDAY, dry: false });
    expect(gradeDueForecasts(store, new Date(MONDAY.getTime() + 5 * DAY), { gates: eta('predicted') })).toEqual({ graded: 0, late: 0 });
    expect(gradeDueForecasts(store, new Date(MONDAY.getTime() + 11 * DAY), { gates: eta('met') })).toEqual({ graded: 1, late: 0 });
    expect(store.forecasts.get(f.id)).toMatchObject({ status: 'graded', actual: 11 });
    // graded once: a later call changes nothing
    expect(gradeDueForecasts(store, new Date(MONDAY.getTime() + 12 * DAY), { gates: eta('met') })).toEqual({ graded: 0, late: 0 });
  });
  test('unmet past hi: late, then re-graded once when met', () => {
    const store = fresh();
    const f = freezeForecast(store, { kind: 'gate_eta', subject: 'baseline_24h:instagram', inputs: {}, predicted: 12, lo: 7, hi: 20, now: MONDAY, dry: false });
    expect(gradeDueForecasts(store, new Date(MONDAY.getTime() + 21 * DAY), { gates: eta('predicted') })).toEqual({ graded: 0, late: 1 });
    expect(store.forecasts.get(f.id)).toMatchObject({ status: 'late', actual: null });
    expect(gradeDueForecasts(store, new Date(MONDAY.getTime() + 25 * DAY), { gates: eta('met') })).toEqual({ graded: 1, late: 0 });
    expect(store.forecasts.get(f.id)).toMatchObject({ status: 'graded', actual: 25 });
  });
  test('month_cost rows grade on the first of the next month against settled spend', () => {
    const store = fresh();
    const f = freezeForecast(store, { kind: 'month_cost', subject: 'apify.sync:2026-10', inputs: {}, predicted: 30, lo: 25, hi: 31, now: new Date('2026-10-01T06:00:00Z'), dry: false });
    store.spend.add({ runId: 'r1', provider: 'apify', line: 'apify.sync', units: 1, estUsd: null, actualUsd: 12.5, dry: false, at: '2026-10-05T00:00:00Z' });
    store.spend.add({ runId: 'r2', provider: 'apify', line: 'apify.sync', units: 1, estUsd: null, actualUsd: 9, dry: true, at: '2026-10-06T00:00:00Z' });
    store.spend.add({ runId: 'r3', provider: 'apify', line: 'apify.snapshots', units: 1, estUsd: null, actualUsd: 4, dry: false, at: '2026-10-06T00:00:00Z' });
    expect(gradeDueForecasts(store, new Date('2026-10-30T00:00:00Z'), { gates: [] }).graded).toBe(0);
    expect(gradeDueForecasts(store, new Date('2026-11-01T01:00:00Z'), { gates: [] }).graded).toBe(1);
    expect(store.forecasts.get(f.id)).toMatchObject({ status: 'graded', actual: 12.5 });
  });
  test('the card prints not enough yet under 5 graded rows, the record from 5', () => {
    const store = fresh();
    expect(forecastRecord(store)).toEqual({
      runCost: 'Run cost estimates: not enough yet (n 0).',
      month: 'Monthly estimates: not enough yet (n 0).',
      gates: 'Readiness dates: not enough yet (n 0).',
      n: { runCost: 0, month: 0, gates: 0 },
    });
    for (let k = 0; k < 5; k++) {
      const f = freezeForecast(store, { kind: 'run_cost', subject: `run-${k}`, inputs: {}, predicted: 1, lo: 0.8, hi: 1.2, now: MONDAY, dry: false });
      store.forecasts.grade(f.id, { actual: k === 4 ? 2 : 1.1, status: 'graded', gradedAt: MONDAY.toISOString() });
    }
    expect(forecastRecord(store).runCost).toBe('Run cost estimates: typically off by 9% on 5 runs, 4 of 5 inside the range.');
    expect(gateAdjust(store)).toBeNull();
  });
});

describe('AC-09-14: lab_forecasts rows are immutable after grading', () => {
  test('a graded row refuses any update; a void row too; a late row re-grades once', () => {
    const store = fresh();
    const g = freezeForecast(store, { kind: 'run_cost', subject: 'r', inputs: {}, predicted: 1, lo: null, hi: null, now: MONDAY, dry: false });
    store.forecasts.grade(g.id, { actual: 1, status: 'graded', gradedAt: MONDAY.toISOString() });
    expect(() => store.forecasts.grade(g.id, { actual: 2, status: 'graded', gradedAt: MONDAY.toISOString() })).toThrow();
    const v = freezeForecast(store, { kind: 'gate_eta', subject: 'x:all', inputs: {}, predicted: 1, lo: 0, hi: 2, now: MONDAY, dry: false });
    store.forecasts.grade(v.id, { actual: null, status: 'void', gradedAt: MONDAY.toISOString() });
    expect(() => store.forecasts.grade(v.id, { actual: 3, status: 'graded', gradedAt: MONDAY.toISOString() })).toThrow();
    const l = freezeForecast(store, { kind: 'gate_eta', subject: 'y:all', inputs: {}, predicted: 1, lo: 0, hi: 2, now: MONDAY, dry: false });
    store.forecasts.grade(l.id, { actual: null, status: 'late', gradedAt: MONDAY.toISOString() });
    expect(() => store.forecasts.grade(l.id, { actual: null, status: 'void', gradedAt: MONDAY.toISOString() })).toThrow();
    store.forecasts.grade(l.id, { actual: 4, status: 'graded', gradedAt: MONDAY.toISOString() });
    expect(() => store.forecasts.grade(l.id, { actual: 5, status: 'graded', gradedAt: MONDAY.toISOString() })).toThrow();
    expect(store.forecasts.get(l.id)!.actual).toBe(4);
  });
});
