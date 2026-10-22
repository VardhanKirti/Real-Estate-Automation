'use client';
/**
 * ProgressRow and StageList, first cut (02 section 8.2, data and strings from 09). These only draw: every
 * string arrives formatted (09.8 copy through 01's LAB_COPY), and the determinate fill arrives computed
 * (min(sofar / expected, 0.99) until terminal, 1 at succeeded, 09.4.4).
 *
 * The GladOS tree adapts 09's RunRowProgress and BatchProgress['stages'] to these props in
 * components/lab/v2/g/progress/ProgressRow.tsx (lane U1, done).
 * The Classic tree draws RunRowProgress directly in components/lab/v2/classic/progress/ (lane U2, done).
 */
import { ProgressRing, RoundButton } from './ActionPill';
import { IconAlert, IconCheck } from './icons';
import { useKitMark } from '@/components/lab/v2/shared/kitMark';

export type ProgressRowView = {
  label: string;
  targetsText: string;
  stateText: string;
  /** 0..1 when the row is determinate, null for the indeterminate arc. */
  fill: number | null;
  countsText: string;
  costText?: string | null;
  elapsedText?: string | null;
  typicalText?: string | null;
  statusMessage?: string | null;
  failed?: boolean;
  frozen?: boolean;
  canStop?: boolean;
  runLogHref?: string | null;
};

export function ProgressRow({ row, onStop, compact }: { row: ProgressRowView; onStop?: () => void; compact?: boolean }) {
  const km = useKitMark();
  const msg = row.statusMessage ? (row.statusMessage.length > 80 ? `${row.statusMessage.slice(0, 79)}…` : row.statusMessage) : null;
  return (
    <div className="lab2-prow" data-lab="ProgressRow" {...km('LabProgressRow')} data-failed={row.failed ? '' : undefined} data-compact={compact ? '' : undefined}>
      <div className="lab2-prow-line">
        <span className="lab2-prow-label" data-lab-ink="">{row.label}</span>
        <span className="lab2-prow-meta" data-lab-ink="">{row.targetsText}</span>
        <span className="lab2-prow-state" data-lab-ink="">{row.stateText}</span>
        {row.canStop && onStop && <RoundButton label={`Stop ${row.label}`} icon="close" onClick={onStop} />}
      </div>
      {!compact && (
        <>
          <div className="lab2-prow-bar">
            {row.fill === null ? (
              <ProgressRing progress={null} size={14} />
            ) : (
              <span className="lab2-prow-track" data-frozen={row.frozen ? '' : undefined}>
                <span className="lab2-prow-fill" data-lab-mark="" style={{ transform: `scaleX(${Math.min(1, Math.max(0, row.fill))})` }} />
              </span>
            )}
            <span className="lab2-prow-counts" data-lab-ink="">{row.countsText}</span>
          </div>
          <div className="lab2-prow-sub" data-lab-ink="">
            {[row.costText, row.elapsedText, row.typicalText].filter(Boolean).join(' · ')}
            {msg && <q className="lab2-prow-msg">{msg}</q>}
            {row.failed && row.runLogHref && <a href={row.runLogHref} className="lab2-prow-log">Run log</a>}
          </div>
        </>
      )}
    </div>
  );
}

export type StageView = { id: string; label: string; state: 'waiting' | 'running' | 'done' | 'skipped' | 'failed'; stateText: string; countText?: string | null; note?: string | null };

export function StageList({ stages }: { stages: StageView[] }) {
  const km = useKitMark();
  return (
    <ul className="lab2-stages" data-lab="StageList" {...km('LabStageList')}>
      {stages.map((s) => (
        <li key={s.id} className="lab2-stage" data-state={s.state}>
          <span className="lab2-stage-mark" data-lab-mark="">
            {s.state === 'running' ? <ProgressRing progress={null} size={14} /> : s.state === 'done' ? <IconCheck size={14} /> : s.state === 'failed' ? <IconAlert size={14} /> : <span className="lab2-stage-dot" />}
          </span>
          <span className="lab2-stage-label" data-lab-ink="">{s.label}</span>
          <span className="lab2-stage-state" data-lab-ink="">{s.stateText}{s.countText ? `, ${s.countText}` : ''}</span>
          {s.note && <span className="lab2-stage-note" data-lab-ink="">{s.note}</span>}
        </li>
      ))}
    </ul>
  );
}
