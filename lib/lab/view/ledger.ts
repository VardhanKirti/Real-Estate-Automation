/**
 * Ledger (`/lab/ledger`) page model (01 12.2), its builder and testStatusLabel(). LedgerView and its
 * row types are section 06's (lib/lab/ledger/view.ts), embedded unchanged as `ledger`.
 */
import type { LabStore } from '@/lib/lab/store';
import type { LabContext } from '@/lib/lab/context';
import type { LabParams } from '@/lib/lab/view/shared';
import { ledgerView } from '@/lib/lab/ledger/view';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fill } from '@/lib/lab/view/format';
import { READY, section, state, withSample } from '@/lib/lab/view/section';
import type { SectionState } from '@/lib/lab/view/shared';
import type { LabFrameView } from '@/lib/lab/view/frame';
import type { SheetPayload } from '@/lib/lab/view/index';
import type { LedgerView, PredictionRow, TestRow } from '@/lib/lab/ledger/view';

export type LedgerPageView = {
  frame: LabFrameView;
  sheet: SheetPayload | null;
  /** section 06 ledgerView(store, { now, dry, filming, sample }), unchanged; null when layers.ledger is not live */
  ledger: LedgerView | null;
  /** ?predictor=, a section 06 predictor id */
  predictor: string | null;
  /** from ledger.predictors (PredictorCard id, label, n); 'All' first */
  predictorOptions: { id: string; label: string; n: number }[];
  /** 12.3 */
  calibration: { state: SectionState; sentence: string; meta: string };
  /** 12.3a; 06 LedgerView.forecastRecord, built by 09 forecastRecord(store) */
  forecasts: { state: SectionState; record: LedgerView['forecastRecord'] | null };
  /** ledger.predictions filtered to `predictor` */
  predictions: { state: SectionState; rows: PredictionRow[] };
  tests: { state: SectionState; rows: TestRowModel[] };
  /** rows render ledger.planner (06 PlannerView) and 06's reason copy */
  planner: { state: SectionState };
};

/** Section 06 TestRow plus the one display label this section derives from status and result. */
export type TestRowModel = {
  row: TestRow;
  /** "?test=<id>" */
  href: string;
  /** trial_reels "Trial Reels hook test" | yt_test_compare "YouTube Test & Compare" | self_experiment "Self-experiment" | planned_post "Planner post" */
  kindLabel: string;
  /** testStatusLabel (12.2 table) */
  statusLabel: string;
  /** 'ok' only for result 'winner'; every other state is neutral */
  tone: 'neutral' | 'ok';
};

/* ── builder (01 12) ──────────────────────────────────────────────────── */

/** 01 12.2 table. */
export function testStatusLabel(row: Pick<TestRow, 'status' | 'result' | 'resultLabel'>): string {
  const L = LAB_COPY.ledger.status;
  if (row.status === 'done') {
    if (row.result === 'winner') return row.resultLabel;
    if (row.result === 'performed_same') return L.performed_same;
    return L.inconclusive;
  }
  return L[row.status] ?? row.status;
}

export function testRowModel(row: TestRow, sample: boolean): TestRowModel {
  return {
    row,
    href: withSample(`?test=${encodeURIComponent(row.id)}`, sample),
    kindLabel: LAB_COPY.ledger.kind[row.kind] ?? row.kind,
    statusLabel: testStatusLabel(row),
    tone: row.status === 'done' && row.result === 'winner' ? 'ok' : 'neutral',
  };
}

/** 01 12.3 meta for the calibration card. */
export function calibrationMeta(ledger: LedgerView): string {
  const n = ledger.hero.n;
  if (n === 0) return 'n 0';
  if (n < 5) return fill(LAB_COPY.ledger.gradedNotEnough, { n });
  const card = ledger.predictors.find((p) => p.id === 'brody') ?? ledger.predictors.find((p) => !p.isBaseline) ?? ledger.predictors[0];
  return fill(LAB_COPY.ledger.metaLine, { pairwise: card?.pairwise?.display ?? LAB_COPY.notEnough, coverage: card?.coverage?.display ?? LAB_COPY.notEnough });
}

export function buildLedger(store: LabStore, params: LabParams, flags: LabContext['flags'], now: Date, inp: { frame: LabFrameView; sheet: SheetPayload | null }): LedgerPageView {
  const sample = Boolean(flags.sample);
  const L = LAB_COPY.ledger;
  const nb = state('not_built', LAB_COPY.layer.ledger);
  const view: LedgerPageView = {
    frame: inp.frame,
    sheet: inp.sheet,
    ledger: null,
    predictor: params.predictor,
    predictorOptions: [{ id: 'all', label: L.predictorAll, n: 0 }],
    calibration: { state: nb, sentence: LAB_COPY.layer.ledger, meta: '' },
    forecasts: { state: nb, record: null },
    predictions: { state: nb, rows: [] },
    tests: { state: nb, rows: [] },
    planner: { state: state('not_built', LAB_COPY.layer.planner) },
  };
  if (inp.frame.mode.state === 'not_configured' || inp.frame.layers.ledger !== 'live') return view;
  const P = 'ledger';
  section(P, 'ledger', () => {
    const ledger = ledgerView(store, { now, dry: Boolean(flags.dry), filming: Boolean(flags.filming), sample });
    view.ledger = ledger;
    const known = ledger.predictors.some((p) => p.id === params.predictor);
    view.predictor = known ? params.predictor : null;
    view.predictorOptions = [{ id: 'all', label: L.predictorAll, n: ledger.predictions.length }, ...ledger.predictors.map((p) => ({ id: p.id, label: p.label, n: p.n }))];
    view.calibration = { state: ledger.hero.n === 0 ? state('empty') : ledger.hero.enough ? READY : state('thin'), sentence: ledger.hero.sentence, meta: calibrationMeta(ledger) };
    view.forecasts = { state: READY, record: ledger.forecastRecord };
    const rows = view.predictor ? ledger.predictions.filter((r) => r.predictor === view.predictor) : ledger.predictions;
    view.predictions = { state: rows.length ? READY : state('empty', L.noPredictions, { label: L.freezeFirst, href: withSample('/lab/studio', sample) }), rows };
    view.tests = { state: ledger.tests.length ? READY : state('empty', L.noTests, { label: LAB_COPY.frame.logTest, href: withSample('?test=new', sample) }), rows: ledger.tests.map((t) => testRowModel(t, sample)) };
    view.planner = { state: ledger.planner ? READY : state('empty', fill(L.plannerGate, { need: ledger.plannerGate.need, n: ledger.plannerGate.n })) };
  }, (s) => {
    view.calibration = { ...view.calibration, state: s, sentence: s.message ?? '' };
  });
  return view;
}
