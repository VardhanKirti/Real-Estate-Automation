'use client';
/**
 * The run progress panel (09.4.4), Classic tree: the popover under Run now and the Pipeline card's running
 * body. Draws 09's BatchProgress; Stop posts 09.4.5's abort after the confirm.
 */
import { useState } from 'react';
import Link from 'next/link';
import type { BatchProgress, RunRowProgress } from '@/lib/lab/setup/progress';
import { fmtClock, fmtCount, fmtElapsed, fmtUsd } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { Btn, ConfirmDialog } from '../dialogs';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { ProgressRow } from './ProgressRow';
import { StageList } from './StageList';

export function batchHeadline(b: BatchProgress): string {
  const usd = fmtUsd(b.overall.usd);
  const items = fmtCount(b.overall.items);
  if (b.state === 'done') return b.overall.estimateUsd !== null ? fill(C.progress.done, { items, usd, estimate: fmtUsd(b.overall.estimateUsd) }) : fill(C.progress.doneNoEstimate, { items, usd });
  if (b.state === 'stopped') return fill(C.progress.stopped, { usd, items });
  const elapsed = Math.max(0, (Date.now() - Date.parse(b.startedAt)) / 1000);
  return fill(C.progress.header, { elapsed: fmtElapsed(elapsed) });
}

export function RunPanel({ batch, form = 'popover', readOnly }: { batch: BatchProgress; form?: 'popover' | 'card'; readOnly?: string | null }) {
  const { post } = useLabPost();
  const [ask, setAsk] = useState<{ row: RunRowProgress | null } | null>(null);
  const overall = batch.overall.estimateUsd !== null
    ? fill(C.progress.overall, { finished: batch.overall.finished, total: batch.overall.total, items: fmtCount(batch.overall.items), usd: fmtUsd(batch.overall.usd), estimate: fmtUsd(batch.overall.estimateUsd) })
    : fill(C.progress.overallNoEstimate, { finished: batch.overall.finished, total: batch.overall.total, items: fmtCount(batch.overall.items), usd: fmtUsd(batch.overall.usd) });
  const stages = batch.state === 'stages' || form === 'card';
  const canStopAll = !readOnly && !batch.dry && batch.rows.some((r) => r.canStop);
  const stop = async (row: RunRowProgress | null) => {
    setAsk(null);
    await post('/api/lab/runs', row ? { action: 'abort', runId: row.runId } : { action: 'abort', batchId: batch.batchId }, { key: 'abort' });
  };
  const confirmText = ask
    ? fill(C.progress.stopConfirm, {
        label: ask.row?.label ?? C.progress.title,
        n: fmtCount(ask.row ? ask.row.items.sofar ?? 0 : batch.overall.items),
        usd: fmtUsd(ask.row ? ask.row.usd.sofar ?? 0 : batch.overall.usd),
      })
    : '';
  return (
    <div className="lab2c-runpanel" data-form={form} data-state={batch.state}>
      <header className="lab2c-runpanel-head">
        <span className="lab2c-runpanel-titles">
          <span className="lab2c-runpanel-title" data-lab-ink="">{batchHeadline(batch)}</span>
          {batch.state === 'running' || batch.state === 'stages' ? <span className="lab2c-runpanel-sub" data-lab-ink="">{overall}</span> : null}
          {batch.origin === 'schedule' && <span className="lab2c-runpanel-sub" data-lab-ink="">{fill(C.progress.bySchedule, { time: fmtClock(batch.startedAt) })}</span>}
        </span>
        {canStopAll && (batch.state === 'running') && <Btn onClick={() => setAsk({ row: null })}>{C.progress.stopAll}</Btn>}
      </header>
      {stages ? (
        <>
          <p className="lab2c-runpanel-line" data-lab-ink="">
            {fill(C.progress.stagesLine, { n: batch.overall.finished, items: fmtCount(batch.overall.items), usd: fmtUsd(batch.overall.usd) })}
          </p>
          <StageList stages={batch.stages} />
        </>
      ) : (
        <>
          <div className="lab2c-runpanel-rows">
            {batch.rows.map((r) => (
              <ProgressRow key={r.runId} row={r} onStop={!readOnly ? () => setAsk({ row: r }) : undefined} />
            ))}
          </div>
          <div className="lab2c-runpanel-then">
            <span className="lab2c-runpanel-sub" data-lab-ink="">{C.progress.then}</span>
            <StageList stages={batch.stages} />
          </div>
        </>
      )}
      <Link href="?setup=spend" className="lab2-textlink" scroll={false}>{C.progress.runLog}</Link>
      <ConfirmDialog open={!!ask} title={C.progress.stop} body={confirmText} confirmLabel={C.progress.stop} onConfirm={() => void stop(ask?.row ?? null)} onClose={() => setAsk(null)} />
    </div>
  );
}
