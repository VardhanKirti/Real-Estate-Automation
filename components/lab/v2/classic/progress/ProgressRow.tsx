'use client';
/**
 * Run progress row, Classic tree (02 8.2, 09.4.4). Draws 09's RunRowProgress; every string is 09.8's.
 * Determinate only with items.known and an expected count: fill = min(sofar / expected, 0.99) until the
 * row is terminal, 1 at succeeded. Otherwise the indeterminate arc and "{sofar} so far", never a percent.
 */
import { ProgressRing, RoundButton } from '@/components/lab/v2/shared';
import type { RunRowProgress } from '@/lib/lab/setup/progress';
import { fmtCount, fmtElapsed, fmtUsd } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { useKitMark } from '@/components/lab/v2/shared/kitMark';

const TERMINAL = new Set(['succeeded', 'failed', 'aborted', 'timed_out', 'blocked']);

export function rowFillOf(row: RunRowProgress): number | null {
  if (!row.items.known || !row.items.expected) return null;
  if (row.state === 'succeeded') return 1;
  return Math.min((row.items.sofar ?? 0) / row.items.expected, 0.99);
}

export function ProgressRow({ row, onStop, compact }: { row: RunRowProgress; onStop?: () => void; compact?: boolean }) {
  const km = useKitMark();
  const terminal = TERMINAL.has(row.state);
  const failed = row.state === 'failed' || row.state === 'timed_out' || row.state === 'blocked';
  const f = rowFillOf(row);
  const sofar = row.items.sofar ?? 0;
  const counts = f !== null ? fill(C.progress.determinate, { sofar: fmtCount(sofar), expected: fmtCount(row.items.expected!) }) : fill(C.progress.indeterminate, { sofar: fmtCount(sofar) });
  const cost = row.usd.sofar === null
    ? C.progress.costPending
    : row.usd.estimate !== null
      ? fill(C.progress.costOf, { sofar: fmtUsd(row.usd.sofar), estimate: fmtUsd(row.usd.estimate) })
      : fmtUsd(row.usd.sofar);
  const typical = row.typicalS !== null ? fill(C.progress.typical, { dur: fmtElapsed(row.typicalS) }) : null;
  const state = `${C.progress.state[row.state] ?? row.state}, ${fmtElapsed(row.elapsedS)}`;
  const msg = row.statusMessage ? (row.statusMessage.length > 80 ? `${row.statusMessage.slice(0, 79)}...` : row.statusMessage) : null;
  return (
    <div className="lab2-prow lab2c-prow" data-lab="ProgressRow" {...km('LabProgressRow')} data-failed={failed ? '' : undefined} data-compact={compact ? '' : undefined} data-state={row.state}>
      <div className="lab2-prow-line">
        <span className="lab2-prow-label" data-lab-ink="">{row.label}</span>
        <span className="lab2-prow-meta" data-lab-ink="">{row.targets > 0 ? fmtCount(row.targets) : ''}</span>
        <span className="lab2-prow-state" data-lab-ink="">{compact ? `${counts}, ${state}` : state}</span>
        {row.canStop && onStop && !terminal && <RoundButton label={`${C.progress.stop} ${row.label}`} icon="close" onClick={onStop} />}
      </div>
      {!compact && (
        <>
          <div className="lab2-prow-bar">
            {f === null ? (
              terminal ? <span className="lab2-prow-track"><span className="lab2-prow-fill" data-lab-mark="" style={{ transform: 'scaleX(1)' }} /></span> : <ProgressRing progress={null} size={14} />
            ) : (
              <span className="lab2-prow-track" data-frozen={failed ? '' : undefined}>
                <span className="lab2-prow-fill" data-lab-mark="" style={{ transform: `scaleX(${f})` }} />
              </span>
            )}
            <span className="lab2-prow-counts" data-lab-ink="">{counts}</span>
          </div>
          <div className="lab2-prow-sub" data-lab-ink="">
            {[cost, typical].filter(Boolean).join(' · ')}
            {msg && <q className="lab2-prow-msg">{msg}</q>}
            {failed && <a href="?setup=spend" className="lab2-prow-log">{C.progress.rowLog}</a>}
          </div>
        </>
      )}
    </div>
  );
}
