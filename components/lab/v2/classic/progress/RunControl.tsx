'use client';
/**
 * Run now (01 4.3, 09.2.8 B, 09.4.4), Classic tree: the pill, the confirm dialog priced from
 * GET /api/lab/run?plan=1, the cap pass, and the progress popover polled through GET /api/lab/runs?batch=.
 */
import { useEffect, useRef, useState } from 'react';
import { ActionPill, Glass } from '@/components/lab/v2/shared';
import type { RunDialogView } from '@/lib/lab/view/frame';
import type { PlanEstimate } from '@/lib/lab/setup/estimate';
import { fmtUsd } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { Btn, CapDialog, Dialog } from '../dialogs';
import { useRunProgress } from '../hooks';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { RunPanel } from './RunPanel';
import { usePresence } from '@/components/lab/v2/shared/motion/usePresence';

type Preview = { estimate: PlanEstimate | null; runs: { platform: string; handles: string[]; limit: number; estimate: unknown }[]; dry: boolean };

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
  // Empty states elsewhere on the page ("Radar has not run yet", "No posts yet") offer Run now through this event.
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
      const data = (await res.json()) as Preview;
      setPreview(data);
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
  const popIn = usePresence(pop && !!batch);
  const est = preview?.estimate ?? null;
  const fraction = batch && batch.overall.total ? batch.overall.finished / batch.overall.total : null;
  const confirmLabel = est ? fill(C.plan.confirm, { usd: fmtUsd(est.perRun.reduce((s, r) => s + r.usd.point, 0)) }) : C.dialog.runConfirm;
  const headroomRuns = est?.perRun.filter((r) => r.state === 'needs_headroom') ?? [];
  const ceiling = est ? Math.max(0, ...est.perRun.map((r) => r.usd.ceiling ?? 0)) : 0;

  return (
    <span ref={wrap} className="lab2c-run" data-active={active ? '' : undefined}>
      <ActionPill
        label={active ? C.running : doneText ?? label}
        icon="play"
        busy={active}
        progress={fraction}
        disabled={!!run.disabledReason && !active}
        disabledReason={run.disabledReason ?? undefined}
        sharedId="run-now"
        onClick={() => (active ? setPop((p) => !p) : void openDialog())}
      />
      {dryLabel && <span className="lab2-chip lab2c-dry" data-lab-ink="">{dryLabel}</span>}
      {popIn.mounted && batch && (
        <Glass as="div" tone="solid" radius="chip" priority={1} className="lab2c-pop" role="dialog" aria-label={C.progress.title} data-lab-closing={popIn.closing ? '' : undefined}>
          <RunPanel batch={batch} readOnly={readOnly} />
        </Glass>
      )}
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title={C.dialog.runTitle}
        footer={
          <>
            <Btn onClick={() => setDialog(false)}>{C.dialog.cancel}</Btn>
            <Btn primary data-autofocus="" disabled={!!run.disabledReason} title={run.disabledReason ?? undefined} busy={busy === 'run'} onClick={() => void start()}>
              {headroomRuns.length && est ? fill(C.plan.confirmOther, { n: est.perRun.length - headroomRuns.length }) : confirmLabel}
            </Btn>
          </>
        }
      >
        <div className="lab2c-runconfirm">
          <p className="lab2c-dialog-text" data-lab-ink="">{fill(C.dialog.runAccounts, { a: run.accounts, t: run.tracked, d: run.depth })}</p>
          {est && (
            <div className="lab2c-runconfirm-est">
              <span className="lab2c-num" data-size="m" data-lab-ink="">{fmtUsd(est.perRun.reduce((s, r) => s + r.usd.point, 0))}</span>
              <span className="lab2c-muted" data-lab-ink="">
                {`${fmtUsd(est.perRun.reduce((s, r) => s + r.usd.low, 0))} to ${fmtUsd(est.perRun.reduce((s, r) => s + r.usd.high, 0))}`}
              </span>
              {ceiling > 0 && <span className="lab2c-muted" data-lab-ink="">{fill(C.plan.ceiling, { usd: fmtUsd(ceiling) })}</span>}
              <span className="lab2c-muted" data-lab-ink="">{est.label}</span>
            </div>
          )}
          {headroomRuns.map((r) => (
            <p key={r.actorId} className="lab2c-dialog-text" data-tone="warn" data-lab-ink="">{fill(C.plan.needsHeadroom, { usd: fmtUsd(r.usd.ceiling ?? 0) })}</p>
          ))}
          <p className="lab2c-dialog-text" data-lab-ink="">{run.apifyLine}</p>
          {run.dryLine && <p className="lab2c-dialog-text" data-lab-ink="">{run.dryLine}</p>}
          {run.disabledReason && <p className="lab2c-dialog-text" data-lab-ink="">{run.disabledReason}</p>}
        </div>
      </Dialog>
      <CapDialog ask={cap} onClose={() => setCap(null)} onPass={() => void start(true)} />
    </span>
  );
}
