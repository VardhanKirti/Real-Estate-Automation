'use client';
/**
 * Run now (01 4.3, 03.8, 09.2.8 B, 09.4.4): the pill, its confirm dialog with the priced plan, and the
 * live progress popover. The dialog prices the plan with `GET /api/lab/run?plan=1` (which also ticks
 * the checklist's "plan previewed"); confirm posts `/api/lab/run` and hands the batch id to the poller
 * in the /lab layout. Dry runs finish inside the POST: no ring, the pill says "Dry run done".
 */
import { useEffect, useRef, useState } from 'react';
import { GDialog, useToast } from '@/components/g';
import { ActionPill, Glass, RoundButton } from '@/components/lab/v2/shared';
import { batchLines, pillLabel } from '@/components/lab/v2/shared/progressView';
import { useLabRun } from '@/components/lab/v2/shared/useLabRun';
import { usePresence } from '@/components/lab/v2/shared/motion/usePresence';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fmtCount, fmtUsd } from '@/lib/lab/view/format';
import type { LabFrameView } from '@/lib/lab/view/frame';
import type { PlanEstimate } from '@/lib/lab/setup/estimate';
import type { RunRowProgress } from '@/lib/lab/setup/progress';
import { ProgressRow, StageList } from './progress/ProgressRow';
import { LAB_UI, fill } from '@/lib/lab/view/ui-copy';

type PlanPreview = { estimate: PlanEstimate | null; runs: { platform?: string; kind?: string; targets?: number; limit?: number }[] };

function sumUsd(e: PlanEstimate, live: (r: PlanEstimate['perRun'][number]) => boolean) {
  const runs = e.perRun.filter(live);
  return {
    low: runs.reduce((a, r) => a + r.usd.low, 0),
    point: runs.reduce((a, r) => a + r.usd.point, 0),
    high: runs.reduce((a, r) => a + r.usd.high, 0),
    ceiling: runs.reduce((a, r) => Math.max(a, r.usd.ceiling ?? 0), 0),
    headroom: e.perRun.filter((r) => r.state === 'needs_headroom').length,
    n: runs.length,
  };
}

/** The confirm (09.2.8 B). */
export function RunDialog({ run, open, onClose, dry }: { run: LabFrameView['run']; open: boolean; onClose: () => void; dry: boolean }) {
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [capAsk, setCapAsk] = useState<string | null>(null);
  const { post, busy } = useLabPost();
  const live = useLabRun();
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setFailed(false);
    setCapAsk(null);
    let alive = true;
    const sample = new URL(window.location.href).searchParams.get('sample') === '1' ? '&sample=1' : '';
    fetch(`/api/lab/run?plan=1${sample}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: PlanPreview) => alive && setPreview({ estimate: d.estimate ?? null, runs: d.runs ?? [] }))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [open]);

  const est = preview?.estimate ? sumUsd(preview.estimate, (r) => r.state !== 'needs_headroom' && r.state !== 'off') : null;
  const label = capAsk
    ? LAB_UI.runPassCap
    : dry
      ? LAB_UI.runDry
      : est && est.headroom > 0
        ? fill(LAB_UI.runOthers, { n: fmtCount(est.n) })
        : est
          ? fill(LAB_COPY.plan.confirm, { usd: fmtUsd(est.point).slice(1) })
          : LAB_UI.runTitle;

  const confirm = async () => {
    const r = await post('/api/lab/run', { override: Boolean(capAsk) }, { key: 'run', capRetry: false, inline: [402] });
    if (r.status === 402) {
      setCapAsk(typeof r.data.capAsk === 'string' ? r.data.capAsk : LAB_UI.capTitle);
      return;
    }
    if (!r.ok) return;
    onClose();
    if (r.data.dry) {
      live.dryDone();
      toast({ text: LAB_UI.runDryRecorded, tone: 'ok' });
    } else if (typeof r.data.batchId === 'string') {
      live.start(r.data.batchId);
    }
  };

  return (
    <GDialog
      open={open}
      onClose={onClose}
      title={LAB_UI.runTitle}
      confirmLabel={label}
      cancelLabel={LAB_UI.runCancel}
      onConfirm={confirm}
      busy={busy === 'run'}
      confirmDisabledReason={run.disabledReason ?? undefined}
    >
      <div className="lab2g-dialog" data-lab-run-dialog="">
        <p className="lab2g-dialog-lead">{fill(LAB_UI.runPlanOf, { n: fmtCount(preview?.runs.length ?? 0), platforms: [...new Set((preview?.runs ?? []).map((r) => r.platform).filter(Boolean))].join(', '), creators: fmtCount(run.accounts + run.tracked), depth: fmtCount(run.depth) })}</p>
        {!preview && !failed && <p className="lab2g-dialog-muted">{LAB_UI.runPreviewLoading}</p>}
        {failed && <p className="lab2g-dialog-muted">{LAB_UI.runPreviewFailed}</p>}
        {est && !dry && (
          <div className="lab2g-dialog-price">
            <span className="lab2g-dialog-big">{fmtUsd(est.point)}</span>
            <span className="lab2g-dialog-muted">{`${fmtUsd(est.low)} to ${fmtUsd(est.high)}`}</span>
          </div>
        )}
        {est && !dry && est.ceiling > 0 && <p className="lab2g-dialog-muted">{fill(LAB_COPY.plan.ceiling, { usd: fmtUsd(est.ceiling).slice(1) })}</p>}
        {preview?.estimate?.perRun
          .filter((r) => r.state === 'needs_headroom')
          .map((r) => (
            <p key={r.actorId} className="lab2g-dialog-warn">{`${r.actorId}: ${fill(LAB_COPY.plan.needsHeadroom, { usd: fmtUsd(r.usd.ceiling ?? r.usd.high).slice(1) })}`}</p>
          ))}
        <p className="lab2g-dialog-line">{run.apifyLine}</p>
        {run.dryLine && <p className="lab2g-dialog-muted">{run.dryLine}</p>}
        {capAsk && <p className="lab2g-dialog-warn" role="alert">{capAsk}</p>}
      </div>
    </GDialog>
  );
}

/** The live panel (09.4.4): header, overall line, one row per run with Stop, then the follow-on stages. */
export function RunProgressPanel({ onClose, compact }: { onClose?: () => void; compact?: boolean }) {
  const { batch, batchId } = useLabRun();
  const { post } = useLabPost();
  const [confirm, setConfirm] = useState<{ label: string; n: number; usd: number; target: { runId: string } | { batchId: string } } | null>(null);
  const [stopping, setStopping] = useState<Set<string>>(new Set());
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);
  if (!batch) {
    return <p className="lab2g-progress-empty">{batchId ? LAB_UI.loading : LAB_UI.runNow}</p>;
  }
  const lines = batchLines(batch);
  const stoppable = batch.rows.filter((r) => r.canStop);
  const askStop = (target: { runId: string } | { batchId: string }, rows: RunRowProgress[], label: string) =>
    setConfirm({ label, target, n: rows.reduce((a, r) => a + (r.items.sofar ?? 0), 0), usd: rows.reduce((a, r) => a + (r.usd.sofar ?? 0), 0) });
  const doStop = async () => {
    if (!confirm) return;
    const ids = 'runId' in confirm.target ? [confirm.target.runId] : stoppable.map((r) => r.runId);
    setStopping((s) => new Set([...s, ...ids]));
    setConfirm(null);
    await post('/api/lab/runs', { action: 'abort', ...confirm.target }, { key: 'abort', refresh: false });
  };
  const collapsed = compact || batch.state === 'stages';
  return (
    <div className="lab2g-progress" data-lab="RunProgress" data-g="LabRunProgress" aria-live="polite">
      <div className="lab2g-progress-head">
        <span className="lab2g-progress-title" data-lab-ink="">{lines.end ?? lines.header}</span>
        {stoppable.length > 0 && !lines.end && (
          <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={() => askStop({ batchId: batch.batchId }, stoppable, LAB_UI.stopAll)}>
            <span data-lab-ink="">{LAB_UI.stopAll}</span>
          </button>
        )}
        {onClose && <RoundButton label={LAB_UI.close} icon="close" onClick={onClose} />}
      </div>
      <p className="lab2g-progress-overall" data-lab-ink="">{collapsed ? lines.collapsed : lines.overall}</p>
      {lines.origin && <p className="lab2g-progress-origin" data-lab-ink="">{lines.origin}</p>}
      <div className="lab2g-progress-rows">
        {batch.rows.map((r) => (
          <ProgressRow
            key={r.runId}
            row={r}
            compact={collapsed}
            stopping={stopping.has(r.runId) && !['aborted', 'succeeded', 'failed'].includes(r.state)}
            onStop={r.canStop ? () => askStop({ runId: r.runId }, [r], r.label) : undefined}
          />
        ))}
      </div>
      <div className="lab2g-progress-stages">
        <span className="lab2g-progress-then" data-lab-ink="">{LAB_UI.thenStages}</span>
        <StageList stages={batch.stages} />
      </div>
      <a data-g="LabLink" href="?setup=spend" className="lab2-textlink" data-lab-shared="run-log">{LAB_UI.runLog}</a>
      <GDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.label ?? LAB_UI.stop}
        confirmLabel={LAB_UI.stop}
        cancelLabel={LAB_UI.runCancel}
        onConfirm={doStop}
        tone="danger"
      >
        {confirm && <p>{fill(LAB_COPY.progress.stopConfirm, { label: confirm.label, n: fmtCount(confirm.n), usd: fmtUsd(confirm.usd).slice(1) })}</p>}
      </GDialog>
    </div>
  );
}

/** The Run now pill: idle opens the dialog; while a batch runs it shows the ring and opens the panel. */
export function RunNowPill({ frame }: { frame: LabFrameView }) {
  const live = useLabRun();
  const [dialog, setDialog] = useState(false);
  const [panel, setPanel] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live.batch) return;
    const id = window.setInterval(() => tick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, [live.batch]);
  useEffect(() => {
    if (!panel) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node) && !(e.target as Element | null)?.closest?.('.g-layer')) setPanel(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanel(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [panel]);
  useEffect(() => {
    if (!live.batchId) setPanel(false);
  }, [live.batchId]);

  const running = !!live.batchId || frame.run.active;
  const pop = usePresence(panel && running);
  const pill = live.batch ? pillLabel(live.batch) : null;
  const f = live.flash;
  const label = f
    ? f.kind === 'done'
      ? fill(LAB_UI.doneItems, { items: fmtCount(f.items) })
      : f.kind === 'dry'
        ? LAB_UI.dryDone
        : f.kind === 'failed'
          ? LAB_UI.runFailed
          : fill(LAB_COPY.progress.stopped, { usd: fmtUsd(f.usd).slice(1), items: fmtCount(f.items) })
    : running
      ? pill?.label ?? LAB_UI.running
      : LAB_UI.runNow;

  return (
    <span ref={wrap} className="lab2g-run" data-lab-run={running ? 'running' : f ? f.kind : 'idle'}>
      <ActionPill
        label={label}
        icon="play"
        busy={running && !f}
        progress={pill?.progress ?? null}
        progressValue={live.batch && live.batch.overall.total > 1 ? { now: live.batch.overall.finished, max: live.batch.overall.total } : null}
        href={f?.kind === 'failed' ? '?setup=spend' : undefined}
        onClick={() => {
          if (f) live.clearFlash();
          if (running) setPanel((p) => !p);
          else setDialog(true);
        }}
        disabled={!running && !f && !!frame.run.disabledReason}
        disabledReason={frame.run.disabledReason ?? undefined}
        sharedId="run-now"
      />
      {pop.mounted && (
        <Glass tone="strong" radius="chip" priority={1} className="lab2g-run-pop" role="dialog" aria-label={LAB_UI.progressTitle} data-lab-closing={pop.closing ? '' : undefined}>
          <RunProgressPanel onClose={() => setPanel(false)} />
        </Glass>
      )}
      <RunDialog run={frame.run} open={dialog} onClose={() => setDialog(false)} dry={frame.mode.dry} />
    </span>
  );
}
