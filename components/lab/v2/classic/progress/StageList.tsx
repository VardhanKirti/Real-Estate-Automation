'use client';
/** After-run stages, Classic tree (02 8.2, 09.4.4): Save posts, Transcribe, Dissect, Measure. */
import { IconAlert, IconCheck, ProgressRing } from '@/components/lab/v2/shared';
import type { BatchProgress } from '@/lib/lab/setup/progress';
import { fmtCount } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C } from '@/lib/lab/view/classic-copy';
import { useKitMark } from '@/components/lab/v2/shared/kitMark';

export function StageList({ stages }: { stages: BatchProgress['stages'] }) {
  const km = useKitMark();
  return (
    <ul className="lab2-stages" data-lab="StageList" {...km('LabStageList')}>
      {stages.map((s) => (
        <li key={s.stage} className="lab2-stage" data-state={s.state}>
          <span className="lab2-stage-mark" data-lab-mark="">
            {s.state === 'running' ? <ProgressRing progress={null} size={14} /> : s.state === 'done' ? <IconCheck size={14} /> : s.state === 'failed' ? <IconAlert size={14} /> : <span className="lab2-stage-dot" />}
          </span>
          <span className="lab2-stage-label" data-lab-ink="">{C.progress.stage[s.stage] ?? s.stage}</span>
          <span className="lab2-stage-state" data-lab-ink="">
            {C.progress.stageState[s.state] ?? s.state}
            {s.total !== null ? ` ${fmtCount(s.done)}` : ''}
          </span>
          {s.note && <span className="lab2-stage-note" data-lab-ink="">{s.note}</span>}
        </li>
      ))}
    </ul>
  );
}
