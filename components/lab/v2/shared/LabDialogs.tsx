'use client';
/**
 * The Lab's small modal dialogs (01 4.3, 4.4, 12.4): a generic confirm, the CapDialog (402, "Pass the
 * cap once"), the Run dialog (preview with 09's estimate, then POST /api/lab/run) and the outside
 * score dialog (06 log_external). Every string comes from LAB_COPY or the view.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { RunDialogView } from '@/lib/lab/view/index';
import type { PlanEstimate } from '@/lib/lab/setup/estimate';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fill, fmtUsd } from '@/lib/lab/view/format';
import { isSampleUrl } from './useLabPost';

const D = LAB_COPY.dialog;

export function Dialog({ open, title, onClose, children, actions }: { open: boolean; title: string; onClose: () => void; children?: ReactNode; actions: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus], button, input, select')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="labv-dialog-layer" data-lab="Dialog">
      <div className="lab2-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className="labv-dialog lab2-glass" data-tone="solid" data-radius="sheet" role="dialog" aria-modal="true" aria-labelledby={id}>
        <h2 id={id} className="labv-dialog-title" data-lab-ink="">{title}</h2>
        <div className="labv-dialog-body">{children}</div>
        <div className="labv-dialog-actions">{actions}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onClose, cancelLabel = D.cancel }: { open: boolean; title: string; body?: string; confirmLabel: string; onConfirm: () => void; onClose: () => void; cancelLabel?: string }) {
  return (
    <Dialog open={open} title={title} onClose={onClose} actions={<>
      <button type="button" className="lab2-pill" onClick={onClose} data-autofocus="">{cancelLabel}</button>
      <button type="button" className="lab2-pill labv-pill-solid" onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
    </>}>
      {body && <p className="lab2-card-text" data-lab-ink="">{body}</p>}
    </Dialog>
  );
}

export function CapDialog({ cap, onClose }: { cap: { text: string; retry: () => void } | null; onClose: () => void }) {
  return (
    <Dialog open={!!cap} title={D.capTitle} onClose={onClose} actions={<>
      <button type="button" className="lab2-pill" onClick={onClose} data-autofocus="">{D.cancel}</button>
      <button type="button" className="lab2-pill labv-pill-solid" onClick={() => { cap?.retry(); onClose(); }}>{D.passCap}</button>
    </>}>
      <p className="lab2-card-text" data-lab-ink="">{cap?.text}</p>
    </Dialog>
  );
}

type PlanResponse = { ok: boolean; estimate?: PlanEstimate | null; runs?: { estimate?: { state?: string; usd?: { point: number; ceiling: number | null } } | null }[] };

export function RunDialog({ open, run, onClose, onRun }: { open: boolean; run: RunDialogView; onClose: () => void; onRun: (override: boolean) => void }) {
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPlan(null);
    fetch(`/api/lab/run?plan=1${isSampleUrl() ? '&sample=1' : ''}`)
      .then((r) => r.json())
      .then((d: PlanResponse) => { if (live) setPlan(d); })
      .catch(() => { if (live) setPlan({ ok: false }); });
    return () => { live = false; };
  }, [open]);
  const runs = plan?.runs ?? [];
  const point = runs.reduce((a, r) => a + (r.estimate?.usd?.point ?? 0), 0);
  const ceiling = Math.max(0, ...runs.map((r) => r.estimate?.usd?.ceiling ?? 0));
  const blocked = runs.filter((r) => r.estimate?.state === 'needs_headroom').length;
  const others = runs.length - blocked;
  const est = plan?.estimate ?? null;
  const confirm = blocked && others ? fill(LAB_COPY.plan.confirmOthers, { n: others }) : LAB_COPY.plan.confirm.replace('${usd}', fmtUsd(point));
  return (
    <Dialog open={open} title={D.runTitle} onClose={onClose} actions={<>
      <button type="button" className="lab2-pill" onClick={onClose}>{D.cancel}</button>
      <button type="button" className="lab2-pill labv-pill-solid" data-autofocus="" disabled={!plan || !!run.disabledReason} aria-disabled={!plan || !!run.disabledReason} onClick={() => { onRun(false); onClose(); }}>{plan ? confirm : D.loading}</button>
    </>}>
      <p className="lab2-card-text" data-lab-ink="">{fill(D.accounts, { a: run.accounts, t: run.tracked, d: run.depth })}</p>
      {est && <p className="lab2-card-cap" data-lab-ink="">{est.label}</p>}
      {est && <p className="lab2-card-text" data-lab-ink="">{LAB_COPY.plan.costHeadline.replace('${perDay}', fmtUsd(est.month.point / 30)).replace('${month}', fmtUsd(est.month.point)).replace('${low}', fmtUsd(est.month.low)).replace('${high}', fmtUsd(est.month.high))}</p>}
      {ceiling > 0 && <p className="lab2-card-cap" data-lab-ink="">{LAB_COPY.plan.ceiling.replace('${usd}', fmtUsd(ceiling))}</p>}
      <p className="lab2-card-cap" data-lab-ink="">{run.apifyLine}</p>
      {run.dryLine && <p className="lab2-card-cap" data-lab-ink="">{run.dryLine}</p>}
      {run.disabledReason && <p className="lab2-card-cap" data-lab-ink="">{run.disabledReason}</p>}
    </Dialog>
  );
}

export type OutsideScoreScript = { id: string; label: string };

export function OutsideScoreDialog({ open, scripts, onClose, onSubmit }: { open: boolean; scripts: OutsideScoreScript[]; onClose: () => void; onSubmit: (body: Record<string, unknown>) => void }) {
  const [scriptId, setScriptId] = useState('');
  const [tool, setTool] = useState('higgsfield');
  const [other, setOther] = useState('');
  const [score, setScore] = useState('');
  const [outOf, setOutOf] = useState('100');
  const labelOf: Record<string, string> = { higgsfield: 'Higgsfield', opusclip: 'OpusClip', other: 'Other' };
  const slug = tool === 'other' ? other.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 24) : tool;
  const valid = scriptId && slug.length >= 2 && Number.isFinite(Number(score)) && score !== '' && Number(outOf) > 0;
  return (
    <Dialog open={open} title={D.outsideTitle} onClose={onClose} actions={<>
      <button type="button" className="lab2-pill" onClick={onClose}>{D.cancel}</button>
      <button type="button" className="lab2-pill labv-pill-solid" disabled={!valid} aria-disabled={!valid} onClick={() => { onSubmit({ action: 'log_external', scriptId, tool: slug, toolLabel: tool === 'other' ? other.trim() : labelOf[tool], score: Number(score), scaleMax: Number(outOf) }); onClose(); }}>{LAB_COPY.ledger.logScore}</button>
    </>}>
      <label className="labv-field"><span>{D.script}</span>
        <select value={scriptId} onChange={(e) => setScriptId(e.target.value)} data-autofocus="">
          <option value="" />
          {scripts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      <label className="labv-field"><span>{D.tool}</span>
        <select value={tool} onChange={(e) => setTool(e.target.value)}>
          {Object.entries(labelOf).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
        </select>
      </label>
      {tool === 'other' && <label className="labv-field"><span>{D.toolOther}</span><input value={other} maxLength={24} onChange={(e) => setOther(e.target.value)} /></label>}
      <div className="labv-field-row">
        <label className="labv-field"><span>{D.score}</span><input inputMode="decimal" value={score} onChange={(e) => setScore(e.target.value)} /></label>
        <label className="labv-field"><span>{D.outOf}</span><input inputMode="decimal" value={outOf} onChange={(e) => setOutOf(e.target.value)} /></label>
      </div>
    </Dialog>
  );
}
