/**
 * The Strand, ported into the v2 GladOS tree (02 0: v1's Strand is ported, not imported across): a
 * runtime bar cut into beats, each beat its v1 beat token, the hook underlined, rehooks ticked, beat
 * labels under the bar when wide enough. The view sorts the beats and makes them tile 0 to 100.
 */
import type { CSSProperties } from 'react';

import type { StrandView } from '@/lib/lab/view/shared';
import { LAB_UI } from '@/lib/lab/view/ui-copy';

const seg = (token: string) => ({ '--lab-seg': `var(${token})` }) as CSSProperties;

export function StrandBar({ strand, labels = true, compact = false }: { strand: StrandView | null; labels?: boolean; compact?: boolean }) {
  if (!strand || strand.beats.length === 0) {
    return <span className="lab2g-strand lab2g-strand-none" data-lab-ink="">{LAB_UI.notDissected}</span>;
  }
  return (
    <span className="lab2g-strand" data-compact={compact ? '' : undefined} role="img" aria-label={`${LAB_UI.structure}: ${strand.template}`}>
      <span className="lab2g-strand-bar">
        {strand.beats.map((b, i) => (
          <span key={i} className="lab2g-strand-seg" data-beat={b.type} style={{ ...seg(b.token), left: `${b.startPct}%`, width: `${Math.max(0, b.endPct - b.startPct)}%` }} />
        ))}
        {strand.rehookTicks.map((t, i) => (
          <span key={`r${i}`} className="lab2g-strand-tick" style={{ left: `${t}%` }} />
        ))}
      </span>
      {strand.hook && <span className="lab2g-strand-hook" style={{ left: `${strand.hook.startPct}%`, width: `${strand.hook.endPct - strand.hook.startPct}%` }} aria-hidden="true" />}
      {labels && !compact && (
        <span className="lab2g-strand-labels" aria-hidden="true">
          {strand.beats.map((b, i) =>
            b.endPct - b.startPct >= 10 ? (
              <span key={i} className="lab2g-strand-label" style={{ left: `${b.startPct}%`, width: `${b.endPct - b.startPct}%` }} data-lab-ink="">
                {b.label}
              </span>
            ) : null,
          )}
        </span>
      )}
    </span>
  );
}
