/**
 * The run() bodies of section 08's `ledger` and `ledger.early` jobs (06 7.4, 08.5.1 rows 16 and
 * 24). `runLedgerCycle` also serves POST /api/lab/ledger/run and `npm run lab-sync -- ledger`.
 * Each step is isolated: one failing step records its error on its own run row and the rest run.
 */
import type { LabRun } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { resolveCred } from '@/lib/creds';
import { refreshInstagramToken } from '@/lib/lab/setup/oauth-instagram';
import { gradeDueForecasts } from '@/lib/lab/setup/forecasts';
import { gradeDue, ledgerRun } from '@/lib/lab/ledger/outcome';
import { fitAndCache } from '@/lib/lab/ledger/forecast';
import { runBacktest, HARNESS_VERSION } from '@/lib/lab/ledger/backtest';
import { computeEvals } from '@/lib/lab/ledger/evals';
import { planWeek, plannerGate, settlePlannedPosts } from '@/lib/lab/ledger/planner';
import { retentionDue } from '@/lib/lab/ledger/retention/due';

export { earlyForecastDue } from '@/lib/lab/ledger/forecast';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

/** Where the harness keeps its last run summary (origins, abstentions) for the Ledger view. */
export const HARNESS_PRIOR = 'ledger:harness';

/**
 * 06 7.4: (1) 08's refreshInstagramToken, then retentionDue; (2) gradeDue (+ pairwise) and 09's
 * gradeDueForecasts; (3) fit and cache sh / mv; (4) runBacktest; (5) computeEvals; (6) planWeek
 * when the gate is open. One lab_runs row per step kind (oauth_refresh, retention, grade, backtest).
 */
export async function runLedgerCycle(store: LabStore, opts: { now: Date; dry: boolean }): Promise<{ runs: LabRun[] }> {
  const { now, dry } = opts;
  const runs: LabRun[] = [];

  // 1. token refresh (section 08 owns it; no network in dry)
  {
    const started = new Date();
    if (dry) runs.push(ledgerRun(store, { kind: 'oauth_refresh', started, items: 0, dry, input: { skipped: 'dry' } }));
    else if (!resolveCred('LAB_IG_ACCESS_TOKEN', [])) runs.push(ledgerRun(store, { kind: 'oauth_refresh', started, items: 0, dry, input: { skipped: 'instagram not connected' } }));
    else {
      try {
        const r = await refreshInstagramToken(store, { now, dry });
        runs.push(ledgerRun(store, { kind: 'oauth_refresh', started, items: r.refreshed ? 1 : 0, dry, input: { refreshed: r.refreshed, reason: r.reason } }));
      } catch (err) {
        runs.push(ledgerRun(store, { kind: 'oauth_refresh', started, items: 0, dry, error: message(err) }));
      }
    }
  }
  try {
    runs.push(...(await retentionDue(store, now, { dry })).runs);
  } catch (err) {
    runs.push(ledgerRun(store, { kind: 'retention', started: new Date(), items: 0, dry, error: message(err) }));
  }

  // 2. grade (writes its own `grade` row), planner slots at 72 h, and 09's forecasts in the same step
  {
    const started = new Date();
    try {
      const g = gradeDue(store, now, { dry, writeRun: false });
      const planned = settlePlannedPosts(store, now);
      const forecasts = gradeDueForecasts(store, now);
      runs.push(ledgerRun(store, { kind: 'grade', started, items: g.graded + g.pairwise, dry, input: { graded: g.graded, ungradable: g.ungradable, pairwise: g.pairwise, linked: g.linked, experiments: g.experiments, planned, forecasts } }));
    } catch (err) {
      runs.push(ledgerRun(store, { kind: 'grade', started, items: 0, dry, error: message(err) }));
    }
  }

  // 3 to 6. fits, backtest, evals, planner: one `backtest` row
  {
    const started = new Date();
    try {
      const fits = fitAndCache(store, now);
      const bt = runBacktest(store, { now, dry });
      const ev = computeEvals(store, { now, dry, abstained: bt.abstained, origins: bt.origins });
      const gate = plannerGate(store);
      const plan = gate.open ? planWeek(store, now, { dry }) : null;
      store.priors.set({ key: HARNESS_PRIOR, value: { ranAt: now.toISOString(), version: HARNESS_VERSION, origins: bt.origins, rows: bt.rows, abstained: bt.abstained }, n: bt.origins, supersedesDefault: false, updatedAt: now.toISOString() });
      runs.push(ledgerRun(store, { kind: 'backtest', started, items: Object.values(bt.rows).reduce((s, n) => s + n, 0), dry, input: { fits: fits.fitted, origins: bt.origins, graded: bt.graded, evals: ev.written, plan: plan ? plan.slots : null, plannerGate: gate.n } }));
    } catch (err) {
      runs.push(ledgerRun(store, { kind: 'backtest', started, items: 0, dry, error: message(err) }));
    }
  }
  return { runs };
}
