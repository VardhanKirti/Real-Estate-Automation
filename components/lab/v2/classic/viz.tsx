'use client';
/**
 * Classic signature pieces, ported (not imported across) from v1 as 02 0 says: the Strand (beat bar), the
 * Field (breakout ratio against depth), the Tide (stacked weekly topics) and the Radar timeline lane.
 * All SVG or flex boxes; colour by data attribute so every fill is a token rule in app/globals.css.
 *
 * These stay per tree. 01 1 lists Strand, Field and Ladder under shared/, but 02 0 (which owns their
 * props and visuals) keeps them as each tree's signature pieces, and lane U1 built the GladOS ones in
 * g/Strand.tsx and g/Field.tsx. Both trees read the same view types (StrandView, FieldView).
 */
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { FieldView, StrandView, TrendsView } from '@/lib/lab/view';
import type { RadarLaneModel } from '@/lib/lab/view/radar';
import { r1, r2 } from './geom';

/** Beat bar: one segment per beat, the hook underlined, rehook ticks above. */
export function Strand({ strand, label, tall }: { strand: StrandView; label: string; tall?: boolean }) {
  return (
    <div className="lab2c-strand" data-tall={tall ? '' : undefined} role="img" aria-label={`${label}: ${strand.template}`}>
      <div className="lab2c-strand-bar">
        {strand.beats.map((b, i) => (
          <span key={i} className="lab2c-beat" data-beat={b.type} style={{ flexGrow: Math.max(0.5, b.endPct - b.startPct) }} title={`${b.label}: ${b.summary}`} data-lab-mark="">
            {tall && b.endPct - b.startPct >= 12 && <span className="lab2c-beat-label">{b.label}</span>}
          </span>
        ))}
      </div>
      {strand.hook && <span className="lab2c-strand-hook" style={{ left: `${strand.hook.startPct}%`, width: `${Math.max(1, strand.hook.endPct - strand.hook.startPct)}%` }} />}
      {strand.rehookTicks.map((t, i) => <span key={i} className="lab2c-strand-tick" style={{ left: `${t}%` }} />)}
    </div>
  );
}

/** The Field: x = breakout ratio (log), y = depth (log); owned posts ringed, Dual-High double ringed. */
export function FieldPlot({ field, dualHighIds, onOpen, label, quadrantLabels, axis }: { field: FieldView; dualHighIds: string[]; onOpen: (postId: string) => void; label: string; quadrantLabels: Record<string, string>; axis: { x: string; y: string } }) {
  const lx = (v: number) => Math.log10(Math.max(v, 1e-6));
  const [x0, x1] = [lx(field.domain.x[0]), lx(field.domain.x[1])];
  const [y0, y1] = [lx(field.domain.y[0]), lx(field.domain.y[1])];
  const X = (v: number) => Math.max(0, Math.min(100, ((lx(v) - x0) / (x1 - x0 || 1)) * 100));
  const Y = (v: number) => Math.max(0, Math.min(100, 100 - ((lx(v) - y0) / (y1 - y0 || 1)) * 100));
  const pts = useMemo(() => [...field.points].sort((a, b) => a.x - b.x), [field.points]);
  const dual = useMemo(() => new Set(dualHighIds), [dualHighIds]);
  const [focus, setFocus] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    if (!pts.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setFocus((i) => Math.max(0, Math.min(pts.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1))));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onOpen(pts[focus].postId);
    }
  };
  const mx = field.medians.breakout !== null ? r2(X(field.medians.breakout)) : 50;
  const my = field.medians.depth !== null ? r2(Y(field.medians.depth)) : 50;
  const fp = pts[focus];
  return (
    <div className="lab2c-field-wrap">
      <div
        ref={box}
        className="lab2c-fieldplot"
        role="listbox"
        tabIndex={0}
        aria-label={label}
        aria-activedescendant={fp ? `fp-${fp.postId}` : undefined}
        onKeyDown={onKey}
        data-lab="Field"
        style={{ ['--mx' as string]: `${mx}%`, ['--my' as string]: `${my}%` }}
      >
        <span className="lab2c-field-vline" />
        <span className="lab2c-field-hline" />
        <span className="lab2c-field-q" data-q="loyal" data-lab-ink="">{quadrantLabels.loyal}</span>
        <span className="lab2c-field-q" data-q="ideal" data-lab-ink="">{quadrantLabels.ideal}</span>
        <span className="lab2c-field-q" data-q="dud" data-lab-ink="">{quadrantLabels.dud}</span>
        <span className="lab2c-field-q" data-q="clickbait" data-lab-ink="">{quadrantLabels.clickbait}</span>
        {pts.map((p, i) => (
          <span
            key={p.postId}
            id={`fp-${p.postId}`}
            role="option"
            aria-selected={i === focus}
            aria-label={`${p.label}, ${p.handle}`}
            className="lab2c-fp"
            data-owned={p.owned ? '' : undefined}
            data-dual={dual.has(p.postId) ? '' : undefined}
            data-breakout={p.isBreakout ? '' : undefined}
            data-focus={i === focus ? '' : undefined}
            data-lab-shared={`fp-${p.postId}`}
            onClick={() => { setFocus(i); onOpen(p.postId); }}
            style={{ left: `${r2(X(p.x))}%`, top: `${r2(Y(p.y))}%`, ['--r' as string]: `${r1(6 + p.r * 12)}px` }}
          >
            <span className="lab2c-fp-dot" />
          </span>
        ))}
      </div>
      <span className="lab2c-field-axis" data-axis="x" data-lab-ink="">{axis.x}</span>
      <span className="lab2c-field-axis" data-axis="y" data-lab-ink="">{axis.y}</span>
    </div>
  );
}

/** Stacked weekly topic area (v1 tide maths, unchanged): one path per series, by its categorical slot. */
export function Tide({ trends, height = 180, label }: { trends: Pick<TrendsView, 'weeks' | 'series'>; height?: number; label: string }) {
  const W = 600;
  const H = height;
  const n = trends.weeks.length;
  if (n < 2 || !trends.series.length) return null;
  const totals = trends.weeks.map((_, i) => trends.series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const xs = trends.weeks.map((_, i) => (i / (n - 1)) * W);
  const acc = new Array(n).fill(0);
  const paths = trends.series.map((s) => {
    const lo = [...acc];
    s.values.forEach((v, i) => { acc[i] += v ?? 0; });
    const hi = [...acc];
    const y = (v: number) => H - (v / max) * (H - 4);
    const top = xs.map((x, i) => `${i ? 'L' : 'M'}${r1(x)},${r1(y(hi[i]))}`).join('');
    const bot = xs.map((x, i) => `L${r1(x)},${r1(y(lo[i]))}`).reverse().join('');
    return { id: s.clusterId, cat: s.cat, d: `${top}${bot}Z`, label: s.label };
  });
  return (
    <svg className="lab2c-tide" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {paths.map((p) => <path key={p.id} d={p.d} className="lab2c-tide-area" data-cat={((p.cat - 1) % 11) + 1} data-lab-mark="" />)}
    </svg>
  );
}

/** One Radar timeline lane: source pings as dots and the coverage ribbon, over [from, to]. */
export function LaneTrack({ lane, from, to, scaleMax }: { lane: RadarLaneModel['lane']; from: string; to: string; scaleMax?: number }) {
  const a = Date.parse(from);
  const b = Date.parse(to);
  const x = (iso: string) => Math.max(0, Math.min(100, ((Date.parse(iso) - a) / (b - a || 1)) * 100));
  if (!lane) return <span className="lab2c-lane-track" />;
  const rib = lane.ribbon;
  const maxC = Math.max(1, scaleMax ?? 0, ...rib.map((r) => r.creators));
  return (
    <span className="lab2c-lane-track" aria-hidden="true">
      {rib.length > 1 && (
        <svg className="lab2c-lane-ribbon" viewBox="0 0 100 20" preserveAspectRatio="none">
          <path
            d={`M${r2(x(rib[0].at))},20 ${rib.map((r) => `L${r2(x(r.at))},${r2(20 - (r.creators / maxC) * 16)}`).join(' ')} L${r2(x(rib[rib.length - 1].at))},20Z`}
            className="lab2c-lane-ribbon-fill"
            data-state={rib[rib.length - 1].state}
          />
        </svg>
      )}
      {lane.pings.map((p, i) => (
        <span key={i} className="lab2c-ping" data-family={p.family} style={{ left: `${r2(x(p.at))}%` }} data-lab-mark="" />
      ))}
    </span>
  );
}
