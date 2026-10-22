'use client';

import { insetRect, treemapLayout } from '@/lib/chart-geometry';
import { colorVar, slotColor, useWidth, VizStateBody, type VizColor, type VizStateProps } from './viz-shared';

export type TreemapKind = { id: string; label: string; color?: VizColor };
export type TreemapBlock = {
  id: string;
  label: string;
  /** area */
  value: number;
  /** the block's kind (its fill) */
  kind: string;
  /** printed under the label: "4.2 MB" */
  sub?: string;
  /** per-kind share of a mixed block (folders): drawn as a thin mix bar */
  mix?: Readonly<Record<string, number>>;
  /** the "N smaller items" block */
  rest?: boolean;
};

export type GTreemapProps = VizStateProps & {
  blocks: readonly TreemapBlock[];
  kinds: readonly TreemapKind[];
  /** kinds not in focus drop to 30% */
  dimKinds?: readonly string[] | null;
  /** a block click (drill into a folder, open a file); blocks are buttons only when set */
  onOpen?: (id: string) => void;
  /** px, default 360 */
  height?: number;
  label: string;
  className?: string;
};

const GAP = 4;

/**
 * GTreemap (GP3, S05 F05.22): squarified blocks with 4px gaps and radius 14,
 * filled with the kind's `--g-cat-*` at 55% (dark) / 70% (light), labelled
 * in `--g-ink`. A mixed block shows its kind mix as a thin bar. `dimKinds`
 * lowers other kinds to 30%. Layout: lib/chart-geometry `treemapLayout`.
 */
export function GTreemap({ blocks, kinds, dimKinds = null, onOpen, height = 360, label, className = '', ...stateProps }: GTreemapProps) {
  const [ref, W] = useWidth<HTMLDivElement>(720);
  const total = blocks.reduce((s, b) => s + (Number.isFinite(b.value) && b.value > 0 ? b.value : 0), 0);
  const body = VizStateBody({ ...stateProps, state: stateProps.state ?? (total === 0 ? 'empty' : 'ready'), height });
  if (body) return <div data-g="GTreemap" className={`g-treemap ${className}`}>{body}</div>;
  const kindColor = new Map(kinds.map((k, i) => [k.id, colorVar(k.color ?? slotColor(i))]));
  const kindLabel = new Map(kinds.map((k) => [k.id, k.label]));
  const rects = treemapLayout(blocks.map((b) => b.value), { x: 0, y: 0, w: W, h: height });
  return (
    <div ref={ref} data-g="GTreemap" className={`g-treemap ${className}`} style={{ height }} role={onOpen ? 'group' : 'img'} aria-label={label}>
      {blocks.map((b, i) => {
        const q = rects[i];
        if (!q) return null;
        const r = insetRect(q, GAP);
        const fill = b.rest ? 'var(--g-well)' : kindColor.get(b.kind) ?? 'var(--g-track-soft)';
        const dim = dimKinds !== null && dimKinds.length > 0 && !b.rest && !dimKinds.includes(b.kind) && !(b.mix && dimKinds.some((k) => (b.mix?.[k] ?? 0) > 0));
        const small = r.w < 64 || r.h < 40;
        const mixTotal = b.mix ? Object.values(b.mix).reduce((s, v) => s + Math.max(0, v), 0) : 0;
        const title = `${b.label}${b.sub ? ` · ${b.sub}` : ''}${b.rest ? '' : ` · ${kindLabel.get(b.kind) ?? b.kind}`}`;
        const style = { left: r.x, top: r.y, width: r.w, height: r.h, ['--gk-tree-fill' as string]: fill };
        const inner = (
          <>
            {!small && <span className="g-tree-label">{b.label}</span>}
            {!small && b.sub && <span className="g-tree-sub">{b.sub}</span>}
            {!small && mixTotal > 0 && (
              <span className="g-tree-mix" aria-hidden="true">
                {Object.entries(b.mix!).filter(([, v]) => v > 0).map(([k, v]) => <i key={k} style={{ flexGrow: v, background: kindColor.get(k) ?? 'var(--g-track-soft)' }} />)}
              </span>
            )}
          </>
        );
        return onOpen ? (
          <button key={b.id} type="button" className="g-tree-block" data-rest={b.rest || undefined} data-dim={dim || undefined} style={style} title={title} aria-label={title} onClick={() => onOpen(b.id)}>{inner}</button>
        ) : (
          <div key={b.id} className="g-tree-block" data-rest={b.rest || undefined} data-dim={dim || undefined} style={style} title={title}>{inner}</div>
        );
      })}
    </div>
  );
}
