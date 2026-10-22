/**
 * BatchProgress (09.4.2) to the draw-only props of ProgressRow and StageList (02 8.2). Numbers become
 * text only through 01's formatters; strings are 09.8's (LAB_COPY.progress) or LAB_UI. Fills come from
 * 09's own `rowFill` (min(sofar / expected, 0.99) until terminal, 1 at succeeded). No percentage is
 * ever produced for an indeterminate row.
 */
import type { BatchProgress, RunRowProgress } from '@/lib/lab/setup/progress';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fmtClock, fmtCount, fmtUsd } from '@/lib/lab/view/format';
import type { ProgressRowView, StageView } from './Progress';

/** 09.4.2 rowFill, mirrored here because lib/lab/setup/progress.ts is server only (it opens the store). */
export function rowFill(row: RunRowProgress): number | null {
  if (!row.items.known || !row.items.expected) return null;
  if (row.state === 'succeeded') return 1;
  const f = (row.items.sofar ?? 0) / row.items.expected;
  return TERMINAL.has(row.state) ? Math.min(1, f) : Math.min(0.99, f);
}
import { LAB_UI, fill, fmtElapsed } from '@/lib/lab/view/ui-copy';

const TERMINAL = new Set<RunRowProgress['state']>(['succeeded', 'failed', 'aborted', 'timed_out', 'blocked']);

function stateText(r: RunRowProgress): string {
  const elapsed = fmtElapsed(r.elapsedS);
  switch (r.state) {
    case 'queued': return LAB_UI.rowQueued;
    case 'running': return fill(LAB_UI.rowRunning, { elapsed });
    case 'finishing': return LAB_UI.rowFinishing;
    case 'succeeded': return fill(LAB_UI.rowDone, { elapsed });
    case 'failed': return r.statusMessage ? fill(LAB_UI.rowFailed, { error: r.statusMessage }) : LAB_UI.rowFailedPlain;
    case 'aborted': return LAB_UI.rowStopped;
    case 'timed_out': return LAB_UI.rowTimedOut;
    case 'blocked': return LAB_UI.rowBlocked;
  }
}

export function progressRowView(r: RunRowProgress): ProgressRowView {
  const f = rowFill(r);
  const sofar = r.items.sofar ?? 0;
  const counts = f !== null && r.items.expected
    ? fill(LAB_COPY.progress.rowDeterminate, { sofar: fmtCount(sofar), expected: fmtCount(r.items.expected) })
    : fill(LAB_COPY.progress.rowIndeterminate, { sofar: fmtCount(sofar) });
  const cost = r.usd.sofar === null
    ? LAB_COPY.progress.rowCostPending
    : r.usd.estimate !== null
      ? fill(LAB_UI.rowCost, { usd: fmtUsd(r.usd.sofar), estimate: fmtUsd(r.usd.estimate) })
      : fill(LAB_UI.rowCostOnly, { usd: fmtUsd(r.usd.sofar) });
  return {
    label: r.label,
    targetsText: r.targets === 1 ? LAB_UI.rowTarget : fill(LAB_UI.rowTargets, { n: fmtCount(r.targets) }),
    stateText: stateText(r),
    fill: f,
    countsText: counts,
    costText: cost,
    elapsedText: null,
    typicalText: r.typicalS !== null && !TERMINAL.has(r.state) ? fill(LAB_UI.rowTypicalNoN, { dur: fmtElapsed(r.typicalS) }) : null,
    statusMessage: r.state === 'failed' ? null : r.statusMessage,
    failed: r.state === 'failed',
    frozen: r.state === 'aborted',
    canStop: r.canStop,
    runLogHref: r.state === 'failed' ? '?setup=spend' : null,
  };
}

const STAGE_LABEL: Record<BatchProgress['stages'][number]['stage'], string> = {
  ingest: LAB_UI.stageIngest,
  transcribe: LAB_UI.stageTranscribe,
  dissect: LAB_UI.stageDissect,
  measure: LAB_UI.stageMeasure,
};
const STAGE_STATE: Record<StageView['state'], string> = {
  waiting: LAB_UI.stageWaiting,
  running: LAB_UI.stageRunning,
  done: LAB_UI.stageDone,
  skipped: LAB_UI.stageSkipped,
  failed: LAB_UI.stageFailed,
};

export function stageViews(stages: BatchProgress['stages']): StageView[] {
  return stages.map((s) => ({
    id: s.stage,
    label: STAGE_LABEL[s.stage],
    state: s.state,
    stateText: STAGE_STATE[s.state],
    countText: s.state === 'waiting' ? null : s.total !== null && s.stage !== 'measure' ? `${fmtCount(s.done)} of ${fmtCount(s.total)}` : s.stage === 'ingest' ? fmtCount(s.done) : null,
    note: s.note || null,
  }));
}

/** Header and overall lines of the progress panel (09.4.4, 09.8). */
export function batchLines(b: BatchProgress, nowMs: number = Date.now()): { header: string; overall: string; origin: string | null; collapsed: string; end: string | null } {
  const elapsedS = Math.max(0, (nowMs - Date.parse(b.startedAt)) / 1000);
  const est = b.overall.estimateUsd;
  const overall = fill(LAB_COPY.progress.overall, {
    finished: fmtCount(b.overall.finished),
    total: fmtCount(b.overall.total),
    items: fmtCount(b.overall.items),
    usd: fmtUsd(b.overall.usd).slice(1),
    estimate: est === null ? '' : fmtUsd(est).slice(1),
  });
  const end =
    b.state === 'done'
      ? fill(LAB_COPY.progress.done, { items: fmtCount(b.overall.items), usd: fmtUsd(b.overall.usd).slice(1), estimate: est === null ? '' : fmtUsd(est).slice(1) })
      : b.state === 'stopped'
        ? fill(LAB_COPY.progress.stopped, { usd: fmtUsd(b.overall.usd).slice(1), items: fmtCount(b.overall.items) })
        : null;
  return {
    header: fill(LAB_COPY.progress.header, { elapsed: fmtElapsed(elapsedS) }),
    overall: est === null ? overall.replace(/ of about \$$/, '') : overall,
    origin: b.origin === 'schedule' ? fill(LAB_COPY.progress.startedBySchedule, { 'HH:mm': fmtClock(b.startedAt) }) : null,
    collapsed: fill(LAB_UI.runsDone, { n: fmtCount(b.overall.finished), items: fmtCount(b.overall.items), usd: fmtUsd(b.overall.usd) }),
    end,
  };
}

/** The Run now pill label while a batch runs (03.8): "Running, 2 of 5" (several runs) or "Running, 2m". */
export function pillLabel(b: BatchProgress, nowMs: number = Date.now()): { label: string; progress: number | null } {
  if (b.overall.total > 1) {
    return { label: fill(LAB_UI.runningOf, { finished: fmtCount(b.overall.finished), total: fmtCount(b.overall.total) }), progress: b.overall.finished / b.overall.total };
  }
  const elapsedS = Math.max(0, (nowMs - Date.parse(b.startedAt)) / 1000);
  // Elapsed in whole minutes, refreshed each 15 s by the caller (03.8 indeterminate label).
  return { label: fill(LAB_UI.runningFor, { elapsed: `${Math.floor(elapsedS / 60)}m` }), progress: null };
}
