'use client';
/**
 * Run now under Bennett Legacy (01 4.3, 09.2.8 B, 09.4.4): the pill, the confirm dialog priced from
 * GET /api/lab/run?plan=1 (the spend gate: nothing runs until Run is pressed, the cap dialog on a 402),
 * and the progress popover polled through GET /api/lab/runs?batch=. Same calls as the Classic RunControl.
 */
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Dot } from '@/components/legacy';
import type { RunDialogView } from '@/lib/lab/view/frame';
import type { PlanEstimate } from '@/lib/lab/setup/estimate';
import type { BatchProgress, RunRowProgress } from '@/lib/lab/setup/progress';
import { fmtClock, fmtCount, fmtElapsed, fmtUsd } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { useRunProgress } from '../classic/hooks';
import { CapDialog, ConfirmDialog, Dialog } from './dialogs';
import { Btn, cx } from './parts';
import { r1 } from '../classic/geom';

type Preview = { estimate: PlanEstimate | null; runs: { platform: string; handles: string[]; limit: number; estimate: unknown }[]; dry: boolean };

const TERMINAL = new Set(['succeeded', 'failed', 'aborted', 'timed_out', 'blocked']);

function rowFill(row: RunRowProgress): number | null {
  if (!row.items.known || !row.items.expected) return null;
  if (row.state === 'succeeded') return 1;
  return Math.min((row.items.sofar ?? 0) / row.items.expected, 0.99);
}

export function batchHeadline(b: BatchProgress): string {
  const usd = fmtUsd(b.overall.usd);
  const items = fmtCount(b.overall.items);
  if (b.state === 'done') return b.overall.estimateUsd !== null ? fill(C.progress.done, { items, usd, estimate: fmtUsd(b.overall.estimateUsd) }) : fill(C.progress.doneNoEstimate, { items, usd });
  if (b.state === 'stopped') return fill(C.progress.stopped, { usd, items });
  const elapsed = Math.max(0, (Date.now() - Date.parse(b.startedAt)) / 1000);
  return fill(C.progress.header, { elapsed: fmtElapsed(elapsed) });
}

function ProgressRow({ row, onStop }: { row: RunRowProgress; onStop?: () => void }) {
  const terminal = TERMINAL.has(row.state);
  const failed = row.state === 'failed' || row.state === 'timed_out' || row.state === 'blocked';
  const f = rowFill(row);
  const sofar = row.items.sofar ?? 0;
  const counts = f !== null ? fill(C.progress.determinate, { sofar: fmtCount(sofar), expected: fmtCount(row.items.expected!) }) : fill(C.progress.indeterminate, { sofar: fmtCount(sofar) });
  const cost = row.usd.sofar === null ? C.progress.costPending : row.usd.estimate !== null ? fill(C.progress.costOf, { sofar: fmtUsd(row.usd.sofar), estimate: fmtUsd(row.usd.estimate) }) : fmtUsd(row.usd.sofar);
  const typical = row.typicalS !== null ? fill(C.progress.typical, { dur: fmtElapsed(row.typicalS) }) : null;
  return (
    <div data-l="LabProgressRow" className="l-lab-prow" data-state={row.state} data-failed={failed ? '' : undefined}>
      <div className="l-lab-prow-line">
        <span className="l-lab-prow-label">{row.label}</span>
        <span className="l-lab-prow-state">{`${C.progress.state[row.state] ?? row.state}, ${fmtElapsed(row.elapsedS)}`}</span>
        {row.canStop && onStop && !terminal && <Btn onClick={onStop} aria-label={`${C.progress.stop} ${row.label}`}>{C.progress.stop}</Btn>}
      </div>
      <div className="l-lab-prow-track" data-indeterminate={f === null && !terminal ? '' : undefined}>
        <span className="l-lab-prow-fill" style={{ width: f === null ? (terminal ? '100%' : undefined) : `${r1(f * 100)}%` }} />
      </div>
      <div className="l-lab-prow-sub">
        <span>{counts}</span>
        <span>{[cost, typical].filter(Boolean).join(' · ')}</span>
        {failed && <a href="?setup=spend" className="l-link">{C.progress.rowLog}</a>}
      </div>
    </div>
  );
}

function StageList({ stages }: { stages: BatchProgress['stages'] }) {
  return (
    <ul data-l="LabStageList" className="l-lab-stages">
      {stages.map((s) => (
        <li key={s.stage} className="l-lab-stage" data-state={s.state}>
          <Dot state={s.state === 'done' ? 'ok' : s.state === 'failed' ? 'err' : s.state === 'running' ? 'warn' : 'off'} pulse={s.state === 'running'} />
          <span className="l-lab-stage-label">{C.progress.stage[s.stage] ?? s.stage}</span>
          <span className="l-lab-stage-state">{`${C.progress.stageState[s.state] ?? s.state}${s.total !== null ? ` ${fmtCount(s.done)}` : ''}`}</span>
          {s.note && <span className="l-lab-stage-note">{s.note}</span>}
        </li>
      ))}
    </ul>
  );
}

/** The progress panel: the popover under Run now and the Pipeline card's running body. */
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
    ? fill(C.progress.stopConfirm, { label: ask.row?.label ?? C.progress.title, n: fmtCount(ask.row ? ask.row.items.sofar ?? 0 : batch.overall.items), usd: fmtUsd(ask.row ? ask.row.usd.sofar ?? 0 : batch.overall.usd) })
    : '';
  return (
    <div data-l="LabRunPanel" className="l-lab-runpanel" data-form={form} data-state={batch.state}>
      <header className="l-lab-runpanel-head">
        <span className="min-w-0">
          <span className="l-lab-runpanel-title">{batchHeadline(batch)}</span>
          {(batch.state === 'running' || batch.state === 'stages') && <span className="l-lab-runpanel-sub">{overall}</span>}
          {batch.origin === 'schedule' && <span className="l-lab-runpanel-sub">{fill(C.progress.bySchedule, { time: fmtClock(batch.startedAt) })}</span>}
        </span>
        {canStopAll && batch.state === 'running' && <Btn onClick={() => setAsk({ row: null })}>{C.progress.stopAll}</Btn>}
      </header>
      {stages ? (
        <>
          <p className="l-lab-runpanel-line">{fill(C.progress.stagesLine, { n: batch.overall.finished, items: fmtCount(batch.overall.items), usd: fmtUsd(batch.overall.usd) })}</p>
          <StageList stages={batch.stages} />
        </>
      ) : (
        <>
          <div className="l-lab-runpanel-rows">
            {batch.rows.map((r) => <ProgressRow key={r.runId} row={r} onStop={!readOnly ? () => setAsk({ row: r }) : undefined} />)}
          </div>
          <span className="l-micro">{C.progress.then}</span>
          <StageList stages={batch.stages} />
        </>
      )}
      <Link href="?setup=spend" scroll={false} className="l-link">{C.progress.runLog}</Link>
      <ConfirmDialog open={!!ask} title={C.progress.stop} body={confirmText} confirmLabel={C.progress.stop} onConfirm={() => void stop(ask?.row ?? null)} onClose={() => setAsk(null)} />
    </div>
  );
}

export function RunControl({ run, label, readOnly, dryLabel }: { run: RunDialogView; label: string; readOnly: string | null; dryLabel: string | null }) {
  const { post, busy } = useLabPost();
  const [dialog, setDialog] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [cap, setCap] = useState<Record<string, unknown> | null>(null);
  const [batchId, setBatchId] = useState<string | null>(run.activeBatch);
  const [pop, setPop] = useState(false);
  const [doneText, setDoneText] = useState<string | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const batch = useRunProgress(batchId, { onDone: () => setTimeout(() => { setPop(false); setBatchId(null); }, 3000) });

  useEffect(() => setBatchId(run.activeBatch), [run.activeBatch]);
  // Empty states elsewhere on the page offer Run now through this event.
  useEffect(() => {
    const on = () => { if (!run.disabledReason) void openDialog(); };
    window.addEventListener('lab:run', on);
    return () => window.removeEventListener('lab:run', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.disabledReason]);
  useEffect(() => {
    if (!pop) return;
    const on = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setPop(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setPop(false); };
    document.addEventListener('mousedown', on);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', on); document.removeEventListener('keydown', key); };
  }, [pop]);

  const openDialog = async () => {
    setDialog(true);
    setPreview(null);
    try {
      const sample = new URL(window.location.href).searchParams.get('sample') === '1';
      const res = await fetch(`/api/lab/run?plan=1${sample ? '&sample=1' : ''}`);
      setPreview((await res.json()) as Preview);
    } catch { /* the dialog still offers the run */ }
  };

  const start = async (override = false) => {
    setCap(null);
    const r = await post('/api/lab/run', override ? { override: true } : {}, { key: 'run', onCap: (_retry, d) => setCap(d) });
    if (r.ok) {
      setDialog(false);
      const id = typeof r.data.batchId === 'string' ? r.data.batchId : null;
      if (r.data.dry || !id) setDoneText(C.progress.dryDone);
      else { setBatchId(id); setPop(true); }
    }
  };

  const active = !!batchId && (!batch || batch.state === 'running' || batch.state === 'stages');
  const est = preview?.estimate ?? null;
  const fraction = batch && batch.overall.total ? batch.overall.finished / batch.overall.total : null;
  const point = est ? est.perRun.reduce((s, r) => s + r.usd.point, 0) : 0;
  const confirmLabel = est ? fill(C.plan.confirm, { usd: fmtUsd(point) }) : C.dialog.runConfirm;
  const headroomRuns = est?.perRun.filter((r) => r.state === 'needs_headroom') ?? [];
  const ceiling = est ? Math.max(0, ...est.perRun.map((r) => r.usd.ceiling ?? 0)) : 0;
  const disabled = !!run.disabledReason && !active;

  return (
    <span ref={wrap} data-l="LabRun" className="l-lab-run" data-active={active ? '' : undefined}>
      <button
        type="button"
        data-l="Pressable"
        data-lens="c"
        data-lab-shared="run-now"
        className={cx('l-pressable l-pill l-lab-runpill', active ? 'is-dark' : 'is-primary')}
        aria-disabled={disabled ? 'true' : undefined}
        aria-busy={active ? 'true' : undefined}
        title={disabled ? run.disabledReason ?? undefined : undefined}
        onClick={() => { if (disabled) return; if (active) setPop((p) => !p); else void openDialog(); }}
      >
        <span aria-hidden className="l-lab-runpill-mark" data-on={active ? '' : undefined} />
        {active ? C.running : doneText ?? label}
        {active && fraction !== null && <span className="l-lab-runpill-frac" style={{ width: `${r1(fraction * 100)}%` }} aria-hidden />}
      </button>
      {dryLabel && <span className="l-chip l-lab-dry" data-l="Chip">{dryLabel}</span>}
      {pop && batch && (
        <div data-l="LabPopover" className="l-lab-pop" role="dialog" aria-label={C.progress.title}>
          <RunPanel batch={batch} readOnly={readOnly} />
        </div>
      )}
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title={C.dialog.runTitle}
        footer={
          <>
            <Btn onClick={() => setDialog(false)}>{C.dialog.cancel}</Btn>
            <Btn primary disabled={!!run.disabledReason} title={run.disabledReason ?? undefined} busy={busy === 'run'} onClick={() => void start()}>
              {headroomRuns.length && est ? fill(C.plan.confirmOther, { n: est.perRun.length - headroomRuns.length }) : confirmLabel}
            </Btn>
          </>
        }
      >
        <div data-l="LabRunConfirm" className="l-lab-runconfirm">
          <p className="l-body-text">{fill(C.dialog.runAccounts, { a: run.accounts, t: run.tracked, d: run.depth })}</p>
          {est && (
            <div className="l-lab-runconfirm-est">
              <span className="l-bigstat is-small">{fmtUsd(point)}</span>
              <span className="l-muted">{`${fmtUsd(est.perRun.reduce((s, r) => s + r.usd.low, 0))} to ${fmtUsd(est.perRun.reduce((s, r) => s + r.usd.high, 0))}`}</span>
              {ceiling > 0 && <span className="l-muted">{fill(C.plan.ceiling, { usd: fmtUsd(ceiling) })}</span>}
              <span className="l-muted">{est.label}</span>
            </div>
          )}
          {headroomRuns.map((r) => <p key={r.actorId} className="l-body-text l-lab-warn">{fill(C.plan.needsHeadroom, { usd: fmtUsd(r.usd.ceiling ?? 0) })}</p>)}
          <p className="l-body-text">{run.apifyLine}</p>
          {run.dryLine && <p className="l-body-text">{run.dryLine}</p>}
          {run.disabledReason && <p className="l-body-text">{run.disabledReason}</p>}
        </div>
      </Dialog>
      <CapDialog ask={cap} onClose={() => setCap(null)} onPass={() => void start(true)} />
    </span>
  );
}
