'use client';
/**
 * The Field, ported into the v2 GladOS tree (02 0): every post with a baseline on log axes (x = ratio to
 * its creator's normal, y = depth), quadrant lines at the niche medians, your posts as rings, Dual-High
 * posts as a double ring. One tab stop: Left and Right move through the points by x, Enter opens the post.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { openSheetHref } from '@/components/lab/v2/shared/useSheetRoute';

import { fmtPct, fmtRatio } from '@/lib/lab/view/format';
import type { FieldView } from '@/lib/lab/view/shared';
import { LAB_UI } from '@/lib/lab/view/ui-copy';

const M = { l: 48, r: 16, t: 20, b: 40 };
const X_TICKS = [0.1, 0.3, 1, 3, 10, 30];
const Y_TICKS = [0.01, 0.03, 0.1, 0.3];

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setW(Math.round(el.getBoundingClientRect().width));
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const log = (v: number) => Math.log10(Math.max(1e-6, v));

export function Field({ field, dualHighIds, height = 360 }: { field: FieldView; dualHighIds: string[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [focus, setFocus] = useState(0);
  const dual = useMemo(() => new Set(dualHighIds), [dualHighIds]);
  const pts = useMemo(() => [...field.points].sort((a, b) => a.x - b.x), [field.points]);
  const W = Math.max(280, width);
  const H = height;
  const [x0, x1] = [log(field.domain.x[0]), log(field.domain.x[1])];
  const [y0, y1] = [log(field.domain.y[0]), log(field.domain.y[1])];
  const sx = (v: number) => Math.round((M.l + ((log(v) - x0) / Math.max(1e-6, x1 - x0)) * (W - M.l - M.r)) * 10) / 10;
  const sy = (v: number) => Math.round((H - M.b - ((log(v) - y0) / Math.max(1e-6, y1 - y0)) * (H - M.t - M.b)) * 10) / 10;
  const open = (id: string) => openSheetHref(`?post=${id}`, { title: LAB_UI.kindPost, originId: `fp-${id}` });
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!pts.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setFocus((f) => Math.min(pts.length - 1, Math.max(0, f + (e.key === 'ArrowRight' ? 1 : -1))));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      open(pts[focus].postId);
    }
  };
  const cur = pts[focus];
  return (
    // The svg waits for the measured width; the box keeps its height meanwhile, so nothing below jumps (AC-01-6).
    <div ref={ref} className="lab2g-field" style={{ minHeight: H }}>
      {width > 0 && (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="application"
          tabIndex={0}
          aria-label={cur ? `${LAB_UI.theField}: ${cur.handle}, ${fmtRatio(cur.x)}, ${LAB_UI.fieldHint}` : LAB_UI.theField}
          onKeyDown={onKey}
          className="lab2g-field-svg"
        >
          {X_TICKS.filter((t) => t >= field.domain.x[0] && t <= field.domain.x[1]).map((t) => (
            <g key={`x${t}`}>
              <line x1={sx(t)} x2={sx(t)} y1={M.t} y2={H - M.b} className="lab2g-grid" />
              <text x={sx(t)} y={H - M.b + 18} className="lab2g-axislabel" textAnchor="middle">{fmtRatio(t)}</text>
            </g>
          ))}
          {Y_TICKS.filter((t) => t >= field.domain.y[0] && t <= field.domain.y[1]).map((t) => (
            <g key={`y${t}`}>
              <line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} className="lab2g-grid" />
              <text x={M.l - 8} y={sy(t) + 4} className="lab2g-axislabel" textAnchor="end">{fmtPct(t)}</text>
            </g>
          ))}
          {field.medians.breakout !== null && <line x1={sx(field.medians.breakout)} x2={sx(field.medians.breakout)} y1={M.t} y2={H - M.b} className="lab2g-median" />}
          {field.medians.depth !== null && <line x1={M.l} x2={W - M.r} y1={sy(field.medians.depth)} y2={sy(field.medians.depth)} className="lab2g-median" />}
          <text x={W - M.r} y={M.t + 12} textAnchor="end" className="lab2g-quadlabel">{LAB_UI.qIdeal}</text>
          <text x={M.l + 6} y={M.t + 12} className="lab2g-quadlabel">{LAB_UI.qLoyal}</text>
          <text x={M.l + 6} y={H - M.b - 8} className="lab2g-quadlabel">{LAB_UI.qDud}</text>
          <text x={W - M.r} y={H - M.b - 8} textAnchor="end" className="lab2g-quadlabel">{LAB_UI.qClickbait}</text>
          <text x={(W + M.l) / 2} y={H - 6} textAnchor="middle" className="lab2g-axislabel">{LAB_UI.xAxis}</text>
          {pts.map((p, i) => {
            const cx = sx(p.x);
            const cy = sy(p.y);
            const r = Math.max(2.5, Math.min(9, p.r));
            return (
              <g key={p.postId} data-lab-shared={`fp-${p.postId}`} className="lab2g-pt" data-owned={p.owned ? '' : undefined} data-breakout={p.isBreakout ? '' : undefined} onClick={() => open(p.postId)}>
                <circle cx={cx} cy={cy} r={r} className="lab2g-pt-dot" />
                {dual.has(p.postId) && <circle cx={cx} cy={cy} r={r + 4} className="lab2g-pt-ring" />}
                {i === focus && <circle cx={cx} cy={cy} r={r + 7} className="lab2g-pt-focus" />}
                <title>{`${p.handle}: ${fmtRatio(p.x)}, ${fmtPct(p.y)}`}</title>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
