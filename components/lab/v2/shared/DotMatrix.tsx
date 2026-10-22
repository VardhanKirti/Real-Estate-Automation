/**
 * Dot-matrix "last vs this" chart (02 section 6). Columns are bottom-aligned; lit counts come from
 * dotFill in lib/chart-geometry.ts. Groups are real periods only: a group with no data is not drawn.
 */
import { dotFill } from '@/lib/chart-geometry';
import { DOT, DOT_EMPHASIS } from './tokens';
import { useKitMark } from '@/components/lab/v2/shared/kitMark';

export type DotGroup = {
  id: string;
  label: string;
  values: (number | null)[];
  emphasis: 'context' | 'prev' | 'current';
};

export type DotMatrixProps = {
  groups: DotGroup[];
  rows?: number;
  max?: number;
  dot?: number;
  pitch?: number;
  groupGap?: number;
  label: string;
  /** Draw every dot unlit (thin state). */
  unlit?: boolean;
  className?: string;
};

export type DotLayout = { width: number; height: number; groups: { id: string; x: number; w: number }[] };

/** Visible groups (any non-null value) in order. */
export function visibleGroups(groups: DotGroup[]): DotGroup[] {
  return groups.filter((g) => g.values.some((v) => v !== null && Number.isFinite(v)));
}

/** Geometry shared with HeroMetric so labels and the delta pill sit on their group. */
export function dotLayout(groups: DotGroup[], rows: number = DOT.rows, pitch: number = DOT.pitch, groupGap: number = DOT.groupGap): DotLayout {
  let x = 0;
  const out: DotLayout['groups'] = [];
  visibleGroups(groups).forEach((g, i) => {
    if (i > 0) x += groupGap;
    const w = g.values.length * pitch;
    out.push({ id: g.id, x, w });
    x += w;
  });
  return { width: Math.max(0, x), height: rows * pitch + 2, groups: out };
}

/** Lit dots per column for one group against a shared max (0 and null light nothing). */
export function litCounts(values: (number | null)[], rows: number, max: number): number[] {
  return dotFill(values.map((v) => (v === null || !Number.isFinite(v) ? 0 : v)), rows, max);
}

export function DotMatrix({ groups, rows = DOT.rows, max, dot = DOT.size, pitch = DOT.pitch, groupGap = DOT.groupGap, label, unlit, className }: DotMatrixProps) {
  const km = useKitMark();
  const vis = visibleGroups(groups);
  const layout = dotLayout(vis, rows, pitch, groupGap);
  const all = vis.flatMap((g) => g.values).filter((v): v is number => v !== null && Number.isFinite(v));
  const m = max !== undefined && max > 0 ? max : Math.max(0, ...all);
  const r = dot / 2;
  let col = 0;
  return (
    <svg
      role="img"
      aria-label={label}
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className={['lab2-dm', className].filter(Boolean).join(' ')}
      data-lab="DotMatrix"
      {...km('LabDotMatrix')}
      data-lab-mark=""
    >
      {vis.map((g, gi) => {
        const gx = layout.groups[gi].x;
        const lit = unlit ? g.values.map(() => 0) : litCounts(g.values, rows, m);
        const op = DOT_EMPHASIS[g.emphasis];
        return (
          <g key={g.id} data-group={g.id} data-emphasis={g.emphasis}>
            {lit.map((n, ci) => {
              const cx = gx + ci * pitch + pitch / 2;
              const i = col++;
              return (
                <g key={ci} className="lab2-dm-col" style={{ ['--i' as string]: Math.min(i, 23) }} data-lit={n}>
                  {Array.from({ length: rows }, (_, ri) => {
                    const on = ri < n; // ri counts from the bottom
                    const cy = layout.height - 1 - (ri * pitch + pitch / 2);
                    return (
                      <circle
                        key={ri}
                        className="lab2-dm-dot"
                        cx={cx}
                        cy={cy}
                        r={r}
                        data-on={on ? '1' : '0'}
                        fillOpacity={on ? op : undefined}
                      />
                    );
                  })}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
