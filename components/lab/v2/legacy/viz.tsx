'use client';
/**
 * Content Lab signature pieces in Bennett Legacy (pages/lab.md: "Strand and Field lines --l-text"): the
 * Strand (beat bar), the Field (breakout ratio against depth) and the Radar scatter, all in Monolith ink
 * with square markers, plus the angle map of a launch. Beat hues stay: they are data (LO.5), drawn flat
 * under a hairline. Geometry is rounded (classic/geom) so server and client markup match.
 */
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { FieldView, StrandView } from '@/lib/lab/view';
import type { RadarLaneModel } from '@/lib/lab/view/radar';
import { r1, r2 } from '../classic/geom';

/** Beat bar: one flat segment per beat, the hook underlined in ink, rehook ticks above; labels below when tall. */
export function Strand({ strand, label, tall }: { strand: StrandView; label: string; tall?: boolean }) {
  return (
    <div data-l="Strand" className="l-lab-strand" data-tall={tall ? '' : undefined} role="img" aria-label={`${label}: ${strand.template}`}>
      <div className="l-lab-strand-bar">
        {strand.beats.map((b, i) => (
          <span key={i} className="l-lab-beat" data-beat={b.type} style={{ flexGrow: Math.max(0.5, b.endPct - b.startPct) }} title={`${b.label}: ${b.summary}`} />
        ))}
        {strand.hook && <span className="l-lab-strand-hook" style={{ left: `${strand.hook.startPct}%`, width: `${Math.max(1, strand.hook.endPct - strand.hook.startPct)}%` }} />}
        {strand.rehookTicks.map((t, i) => <span key={i} className="l-lab-strand-tick" style={{ left: `${t}%` }} />)}
      </div>
      {tall && (
        <div className="l-lab-strand-labels" aria-hidden="true">
          {strand.beats.map((b, i) => (
            <span key={i} style={{ flexGrow: Math.max(0.5, b.endPct - b.startPct) }}>{b.endPct - b.startPct >= 9 ? b.label : ''}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The Field as a monochrome scatter: x = breakout ratio (log), y = depth (log). Square markers; a breakout
 * is filled, the rest are faint; your posts are hollow squares, Dual-High double-ringed. One tab stop:
 * Left and Right step through the points, Enter opens the post.
 */
export function FieldPlot({ field, dualHighIds, onOpen, label, quadrantLabels, axis }: { field: FieldView; dualHighIds: string[]; onOpen: (postId: string) => void; label: string; quadrantLabels: Record<string, string>; axis: { x: string; y: string } }) {
  const lx = (v: number) => Math.log10(Math.max(v, 1e-6));
  const [x0, x1] = [lx(field.domain.x[0]), lx(field.domain.x[1])];
  const [y0, y1] = [lx(field.domain.y[0]), lx(field.domain.y[1])];
  const X = (v: number) => Math.max(0, Math.min(100, ((lx(v) - x0) / (x1 - x0 || 1)) * 100));
  const Y = (v: number) => Math.max(0, Math.min(100, 100 - ((lx(v) - y0) / (y1 - y0 || 1)) * 100));
  const pts = useMemo(() => [...field.points].sort((a, b) => a.x - b.x), [field.points]);
  const dual = useMemo(() => new Set(dualHighIds), [dualHighIds]);
  const [focus, setFocus] = useState(0);
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
    <div data-l="Field" className="l-lab-field">
      <div
        className="l-lab-field-plot"
        role="listbox"
        tabIndex={0}
        aria-label={label}
        aria-activedescendant={fp ? `lfp-${fp.postId}` : undefined}
        onKeyDown={onKey}
        style={{ ['--mx' as string]: `${mx}%`, ['--my' as string]: `${my}%` }}
      >
        <span className="l-lab-field-vline" />
        <span className="l-lab-field-hline" />
        <span className="l-lab-field-q" data-q="loyal">{quadrantLabels.loyal}</span>
        <span className="l-lab-field-q" data-q="ideal">{quadrantLabels.ideal}</span>
        <span className="l-lab-field-q" data-q="dud">{quadrantLabels.dud}</span>
        <span className="l-lab-field-q" data-q="clickbait">{quadrantLabels.clickbait}</span>
        {pts.map((p, i) => (
          <span
            key={p.postId}
            id={`lfp-${p.postId}`}
            role="option"
            aria-selected={i === focus}
            aria-label={`${p.label}, ${p.handle}`}
            title={`${p.handle}: ${p.label}`}
            className="l-lab-fp"
            data-owned={p.owned ? '' : undefined}
            data-dual={dual.has(p.postId) ? '' : undefined}
            data-breakout={p.isBreakout ? '' : undefined}
            data-focus={i === focus ? '' : undefined}
            data-lab-shared={`fp-${p.postId}`}
            onClick={() => { setFocus(i); onOpen(p.postId); }}
            style={{ left: `${r2(X(p.x))}%`, top: `${r2(Y(p.y))}%`, ['--r' as string]: `${r1(5 + p.r * 7)}px` }}
          />
        ))}
      </div>
      <div className="l-axis l-lab-field-axis">
        <span>{axis.y}</span>
        <span>{axis.x}</span>
      </div>
    </div>
  );
}

/** One Radar lane as a monochrome scatter: each source ping a square marker over [from, to], the coverage ribbon under it in hatched ink. */
export function LaneScatter({ lane, from, to, scaleMax }: { lane: RadarLaneModel['lane']; from: string; to: string; scaleMax?: number }) {
  const a = Date.parse(from);
  const b = Date.parse(to);
  const x = (iso: string) => Math.max(0, Math.min(100, ((Date.parse(iso) - a) / (b - a || 1)) * 100));
  if (!lane) return <span className="l-lab-lane-track" />;
  const rib = lane.ribbon;
  const maxC = Math.max(1, scaleMax ?? 0, ...rib.map((r) => r.creators));
  return (
    <span className="l-lab-lane-track" aria-hidden="true">
      {rib.length > 1 && (
        <svg className="l-lab-lane-ribbon" viewBox="0 0 100 20" preserveAspectRatio="none">
          <path
            d={`M${r2(x(rib[0].at))},20 ${rib.map((r) => `L${r2(x(r.at))},${r2(20 - (r.creators / maxC) * 16)}`).join(' ')} L${r2(x(rib[rib.length - 1].at))},20Z`}
            data-state={rib[rib.length - 1].state}
          />
        </svg>
      )}
      {lane.pings.map((p, i) => (
        <span key={i} className="l-lab-ping" data-family={p.family} style={{ left: `${r2(x(p.at))}%` }} />
      ))}
    </span>
  );
}

export type AngleCellLite = { angle: string; label: string; posts: number; medianRatio: number | null; n: number; taken: boolean };

/**
 * A launch's angle map: posts already on each angle across, median result up (log), square markers.
 * Filled when the median is readable (n of 5 or more), hollow when not; the recommended angle is ringed.
 */
export function AngleMap({ cells, recommended, label, axis }: { cells: AngleCellLite[]; recommended: string; label: string; axis: { x: string; y: string } }) {
  const maxP = Math.max(1, ...cells.map((c) => c.posts));
  const rs = cells.map((c) => (c.medianRatio !== null && c.n >= 5 ? c.medianRatio : null)).filter((v): v is number => v !== null);
  const lo = Math.log10(Math.max(0.1, Math.min(0.5, ...rs)));
  const hi = Math.log10(Math.max(4, ...rs));
  const Y = (r: number | null) => (r === null ? 88 : r2(88 - ((Math.log10(Math.max(0.1, r)) - lo) / (hi - lo || 1)) * 76));
  const X = (p: number) => r2(8 + (p / maxP) * 84);
  const one = Y(1);
  return (
    <div data-l="AngleMap" className="l-lab-anglemap">
      <div className="l-lab-anglemap-plot" role="img" aria-label={label}>
        <span className="l-lab-anglemap-one" style={{ top: `${one}%` }} />
        {cells.map((c) => (
          <span
            key={c.angle}
            className="l-lab-anglemap-pt"
            data-read={c.medianRatio !== null && c.n >= 5 ? '' : undefined}
            data-rec={c.angle === recommended ? '' : undefined}
            style={{ left: `${X(c.posts)}%`, top: `${Y(c.medianRatio !== null && c.n >= 5 ? c.medianRatio : null)}%` }}
          >
            <span className="l-lab-anglemap-label">{c.label}</span>
          </span>
        ))}
      </div>
      <div className="l-axis">
        <span>{axis.y}</span>
        <span>{axis.x}</span>
      </div>
    </div>
  );
}

/** Views at age: the owner's normal band (25th to 75th) hatched, this post as the ink line, log scale. */
export function AgeCurve({ curve, mini }: { curve: { points: { h: number; views: number }[]; band: { h: number; lo: number; hi: number }[] }; mini?: boolean }) {
  const W = 500, H = mini ? 60 : 120;
  const hatch = `l-lab-hatch-${useId().replace(/:/g, '')}`;
  const pts = curve.points;
  const maxH = Math.max(...pts.map((p) => p.h), ...curve.band.map((b) => b.h), 1);
  const vals = [...pts.map((p) => p.views), ...curve.band.flatMap((b) => [b.lo, b.hi])].filter((v) => v > 0);
  const lo = Math.log10(Math.max(1, Math.min(...vals)));
  const hi = Math.log10(Math.max(10, ...vals));
  const x = (h: number) => r1((h / maxH) * W);
  const y = (v: number) => r1(H - 6 - ((Math.log10(Math.max(1, v)) - lo) / (hi - lo || 1)) * (H - 12));
  const band = curve.band.length > 1
    ? `M${curve.band.map((b) => `${x(b.h)},${y(b.hi)}`).join(' L')} L${[...curve.band].reverse().map((b) => `${x(b.h)},${y(b.lo)}`).join(' L')}Z`
    : null;
  const line = `M${pts.map((p) => `${x(p.h)},${y(p.views)}`).join(' L')}`;
  const last = pts[pts.length - 1];
  return (
    <svg data-l="AgeCurve" className="l-lab-agecurve" data-mini={mini ? '' : undefined} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <pattern id={hatch} width="5" height="8" patternUnits="userSpaceOnUse">
          <rect width="1.2" height="8" className="l-lab-hatch" />
        </pattern>
      </defs>
      {band && <path d={band} fill={`url(#${hatch})`} className="l-lab-agecurve-band" />}
      <path d={line} className="l-lab-agecurve-line" fill="none" vectorEffect="non-scaling-stroke" />
      <rect x={x(last.h) - 4} y={y(last.views) - 4} width={8} height={8} className="l-lab-agecurve-pt" />
    </svg>
  );
}
