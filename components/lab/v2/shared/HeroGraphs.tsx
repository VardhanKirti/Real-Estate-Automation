'use client';
/**
 * The graphs on Today's two gradient cards: a slowly turning 3D creator network and a compact breakout
 * chart. Both draw on canvas from server-built view models (lib/lab/view/hero-graphs.ts). Every colour is
 * read from the card's CSS custom properties, so each theme and accent paints them in its own ink.
 * One tab stop each: Left and Right move through the items, Enter opens the focused one.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { BreakoutChartView, CreatorNetworkView } from '@/lib/lab/view/hero-graphs';
import { openSheetHref } from './useSheetRoute';
import { THEME_ATTRS, pill, project, readInk, reducedMotion, useCanvas, type Ink } from './graph3d';
import { useKitMark } from './kitMark';

/* ── creator network ─────────────────────────────────────────────────── */

export function CreatorNetworkGraph({ view }: { view: CreatorNetworkView }) {
  const kit = useKitMark();
  const router = useRouter();
  const { wrap, canvas, size, ctx } = useCanvas();
  const order = useMemo(() => view.nodes.map((n, i) => ({ n, i })).sort((a, b) => b.n.breakouts - a.n.breakouts || a.n.handle.localeCompare(b.n.handle)).map((x) => x.i), [view.nodes]);
  const st = useRef({ yaw: 0.6, pitch: -0.32, hover: -1, focus: -1, drag: null as null | { x: number; y: number; moved: boolean; yaw: number; pitch: number }, proj: [] as { x: number; y: number; r: number; d: number }[] });
  const [focusIdx, setFocusIdx] = useState(-1);
  const [hoverIdx, setHoverIdx] = useState(-1);
  const inkRef = useRef<Ink | null>(null);

  const draw = useCallback(() => {
    const g = ctx();
    const el = wrap.current;
    if (!g || !el) return;
    if (!inkRef.current) inkRef.current = readInk(el, '--lab-narr-ink', '--lab-narr-paper');
    const ink = inkRef.current;
    const { w, h } = size;
    const s = st.current;
    const R = Math.min(w * 0.4, h * 0.36);
    const maxB = Math.max(1, view.maxBreakouts);
    const cam = { yaw: s.yaw, pitch: s.pitch, zoom: 1, tx: 0, ty: 0, tz: 0 };
    s.proj = view.nodes.map((n) => {
      const p = project(n, cam, w / 2, h / 2, R); // d: 0 back, 1 front
      return { x: p.x, y: p.y, r: (2.4 + 6 * Math.sqrt(n.breakouts / maxB)) * p.k, d: p.d };
    });
    const P = s.proj;
    const active = s.hover >= 0 ? s.hover : s.focus;
    g.lineCap = 'round';
    g.strokeStyle = ink.ink;
    for (const e of view.edges) {
      const a = P[e.a], b = P[e.b];
      const lit = active >= 0 && (e.a === active || e.b === active);
      g.globalAlpha = lit ? 0.8 : (0.12 + (e.kind === 'event' ? 0.4 : 0.25) * e.w) * (0.3 + 0.7 * Math.min(a.d, b.d)) * (active >= 0 ? 0.45 : 1);
      g.lineWidth = lit ? 1.4 : e.kind === 'event' ? 1 : 0.7;
      g.setLineDash(e.kind === 'topic' ? [2, 3] : []);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    g.setLineDash([]);
    const byDepth = view.nodes.map((_, i) => i).sort((a, b) => Number(a === active) - Number(b === active) || P[a].d - P[b].d);
    g.fillStyle = ink.ink;
    for (const i of byDepth) {
      const p = P[i], n = view.nodes[i];
      const fog = i === active ? 1 : 0.28 + 0.72 * p.d;
      g.save();
      if (n.hot) {
        g.shadowColor = ink.ink;
        g.shadowBlur = (14 * p.d + 4) * ink.glow;
      }
      g.globalAlpha = (n.breakouts > 0 ? 0.95 : 0.55) * fog;
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      g.fill();
      g.restore();
      if (n.hot || i === active) {
        g.globalAlpha = (i === active ? 0.95 : 0.55) * fog;
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(p.x, p.y, p.r + 3.5, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // The three biggest names stay labelled, faded with depth, so the graph reads without hovering.
    g.font = `500 11px ${ink.font}`;
    g.textAlign = 'center';
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    for (const i of order.slice(0, 3)) {
      if (i === active || !view.nodes[i].breakouts) continue;
      const p = P[i];
      const tw = g.measureText(view.nodes[i].handle).width;
      // Below the node, else above; skipped when it would cover another label. A soft paper chip keeps it legible over edges.
      const spots = [p.y + p.r + 4, p.y - p.r - 21].map((y) => ({ x: p.x - tw / 2 - 5, y, w: tw + 10, h: 17 }));
      const box = spots.find((b) =>
        b.x >= 0 && b.x + b.w <= w && b.y >= 0 && b.y + b.h <= h &&
        !boxes.some((o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h));
      if (!box) continue;
      boxes.push(box);
      g.globalAlpha = 0.55;
      g.fillStyle = ink.paper;
      g.beginPath();
      g.roundRect(box.x, box.y, box.w, box.h, 8);
      g.fill();
      g.fillStyle = ink.ink;
      g.globalAlpha = 0.5 + 0.5 * p.d;
      g.fillText(view.nodes[i].handle, p.x, box.y + 12.5);
    }
    g.textAlign = 'left';
    g.globalAlpha = 1;
    if (active >= 0 && P[active]) {
      const p = P[active], n = view.nodes[active];
      pill(g, ink, `${n.handle} · ${n.breakouts === 1 ? '1 breakout' : `${n.breakouts} breakouts`}`, p.x, p.y - p.r - 30, w, h);
    }
  }, [ctx, order, size, view, wrap]);

  useEffect(() => {
    inkRef.current = null;
    const el = wrap.current;
    if (!el || !size.w || !view.nodes.length) return;
    // Re-read ink when the theme, accent or mode flips.
    const mo = new MutationObserver(() => { inkRef.current = null; draw(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: THEME_ATTRS });
    const card = el.closest('.lab2-narr');
    let raf = 0;
    let last = performance.now();
    const still = reducedMotion();
    const tick = (t: number) => {
      const dt = Math.min(64, t - last);
      last = t;
      const paused = !!card?.hasAttribute('data-lab-paused') || st.current.drag !== null || st.current.hover >= 0 || st.current.focus >= 0;
      if (!still && !paused) st.current.yaw += dt * 0.00011;
      draw();
      raf = requestAnimationFrame(tick);
    };
    if (still) draw();
    else raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); mo.disconnect(); };
  }, [draw, size.w, view.nodes.length, wrap]);

  const pick = (x: number, y: number) => {
    const P = st.current.proj;
    let best = -1, bd = Infinity;
    for (let i = 0; i < P.length; i++) {
      const d = Math.hypot(P[i].x - x, P[i].y - y) - P[i].r;
      if (d < 8 && (d < bd || (d === bd && P[i].d > P[best].d))) { best = i; bd = d; }
    }
    return best;
  };
  const local = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = local(e);
    st.current.drag = { x, y, moved: false, yaw: st.current.yaw, pitch: st.current.pitch };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = local(e);
    const d = st.current.drag;
    if (d) {
      if (Math.hypot(x - d.x, y - d.y) > 4) d.moved = true;
      if (d.moved) {
        st.current.yaw = d.yaw + (x - d.x) * 0.008;
        st.current.pitch = Math.max(-1.2, Math.min(1.2, d.pitch + (y - d.y) * 0.008));
        if (reducedMotion()) draw();
      }
      return;
    }
    const i = pick(x, y);
    if (i !== st.current.hover) {
      st.current.hover = i;
      setHoverIdx(i);
      if (reducedMotion()) draw();
    }
  };
  const onUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = st.current.drag;
    st.current.drag = null;
    if (d && !d.moved) {
      const { x, y } = local(e);
      const i = pick(x, y);
      if (i >= 0) router.push(view.nodes[i].href);
    }
  };
  const onLeave = () => {
    st.current.hover = -1;
    setHoverIdx(-1);
    if (reducedMotion()) draw();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!order.length) return;
    const pos = order.indexOf(st.current.focus);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
      const next = order[pos < 0 ? 0 : (pos + (fwd ? 1 : -1) + order.length) % order.length];
      st.current.focus = next;
      setFocusIdx(next);
      if (reducedMotion()) draw();
    } else if (e.key === 'Enter' && st.current.focus >= 0) {
      e.preventDefault();
      router.push(view.nodes[st.current.focus].href);
    } else if (e.key === 'Escape') {
      st.current.focus = -1;
      setFocusIdx(-1);
    }
  };
  const cur = focusIdx >= 0 ? view.nodes[focusIdx] : null;
  return (
    <div
      ref={wrap}
      className="lab2-graph lab2-graph-net"
      tabIndex={0}
      role="application"
      {...kit('LabGraph')}
      aria-roledescription="graph"
      aria-label={cur ? `${cur.title}. Enter opens their breakouts.` : `${view.label}. ${view.summary} Arrow keys move through creators, Enter opens one.`}
      onKeyDown={onKey}
      onBlur={() => { st.current.focus = -1; setFocusIdx(-1); }}
      data-hover={hoverIdx >= 0 ? '' : undefined}
    >
      <canvas
        ref={canvas}
        width={0}
        height={0}
       
        aria-hidden="true"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onLeave}
      />
      <p className="lab2-sr">{view.summary}</p>
    </div>
  );
}

/* ── breakout chart ──────────────────────────────────────────────────── */

const M = { l: 34, r: 8, t: 10, b: 22 };

export function BreakoutChartGraph({ view }: { view: BreakoutChartView }) {
  const kit = useKitMark();
  const { wrap, canvas, size, ctx } = useCanvas();
  const st = useRef({ hover: -1, focus: -1 });
  const [focusIdx, setFocusIdx] = useState(-1);
  const [hoverIdx, setHoverIdx] = useState(-1);
  const keys = useMemo(() => view.points.map((p, i) => ({ p, i })).filter((x) => x.p.breakout).sort((a, b) => b.p.ageD - a.p.ageD).map((x) => x.i), [view.points]);
  const inkRef = useRef<Ink | null>(null);
  const [y0, y1] = [Math.log10(view.yDomain[0]), Math.log10(view.yDomain[1])];
  const geo = useCallback(() => {
    const { w, h } = size;
    const sx = (age: number) => M.l + (1 - age / view.windowDays) * (w - M.l - M.r);
    const sy = (r: number) => h - M.b - ((Math.log10(Math.max(view.yDomain[0], Math.min(view.yDomain[1], r))) - y0) / Math.max(1e-6, y1 - y0)) * (h - M.t - M.b);
    return { sx, sy };
  }, [size, view.windowDays, view.yDomain, y0, y1]);

  const draw = useCallback(() => {
    const g = ctx();
    const el = wrap.current;
    if (!g || !el) return;
    if (!inkRef.current) inkRef.current = readInk(el, '--lab-narr-ink', '--lab-narr-paper');
    const ink = inkRef.current;
    const { w, h } = size;
    const { sx, sy } = geo();
    g.fillStyle = ink.ink;
    g.strokeStyle = ink.ink;
    // This week, shaded.
    g.globalAlpha = 0.07;
    g.fillRect(sx(7), M.t, sx(0) - sx(7), h - M.t - M.b);
    // Axes and guides.
    g.font = `500 11px ${ink.font}`;
    g.textBaseline = 'middle';
    for (const t of [0.1, 0.3, 1, 3, 10, 30]) {
      if (t < view.yDomain[0] || t > view.yDomain[1]) continue;
      const y = sy(t);
      const key = t === 1 || t === view.threshold;
      g.globalAlpha = key ? 0.45 : 0.14;
      g.lineWidth = 1;
      g.setLineDash(t === view.threshold ? [4, 4] : []);
      g.beginPath();
      g.moveTo(M.l, y);
      g.lineTo(w - M.r, y);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = key ? 0.85 : 0.55;
      g.textAlign = 'right';
      g.fillText(`${t}x`, M.l - 6, y);
    }
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.globalAlpha = 0.7;
    g.fillText(`${view.windowDays}d ago`, Math.max(M.l + 22, sx(view.windowDays) + 22), h - 6);
    g.fillText('7d', sx(7), h - 6);
    g.textAlign = 'right';
    g.fillText('now', w - M.r, h - 6);
    // Points: the field first, breakouts on top, this week's glowing.
    const active = st.current.hover >= 0 ? st.current.hover : st.current.focus;
    for (let pass = 0; pass < 3; pass++) {
      for (const p of view.points) {
        const lvl = p.thisWeek ? 2 : p.breakout ? 1 : 0;
        if (lvl !== pass) continue;
        const x = sx(p.ageD), y = sy(p.ratio);
        g.save();
        if (lvl === 2) {
          g.shadowColor = ink.ink;
          g.shadowBlur = 12 * ink.glow;
        }
        g.globalAlpha = lvl === 0 ? 0.3 : lvl === 1 ? 0.6 : 1;
        g.beginPath();
        g.arc(x, y, lvl === 0 ? 2 : lvl === 1 ? 3 : 4.2, 0, Math.PI * 2);
        g.fill();
        g.restore();
        if (lvl === 2) {
          g.globalAlpha = 0.5;
          g.lineWidth = 1;
          g.beginPath();
          g.arc(x, y, 7.5, 0, Math.PI * 2);
          g.stroke();
        }
      }
    }
    if (active >= 0 && view.points[active]) {
      const p = view.points[active];
      const x = sx(p.ageD), y = sy(p.ratio);
      g.globalAlpha = 1;
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(x, y, 9, 0, Math.PI * 2);
      g.stroke();
      pill(g, ink, p.title, x, y - 36 < M.t ? y + 14 : y - 36, w, h);
    }
    g.globalAlpha = 1;
  }, [ctx, geo, size, view, wrap]);

  useEffect(() => {
    inkRef.current = null;
    draw();
    const mo = new MutationObserver(() => { inkRef.current = null; draw(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: THEME_ATTRS });
    return () => mo.disconnect();
  }, [draw]);

  const pick = (x: number, y: number) => {
    const { sx, sy } = geo();
    let best = -1, bd = 10;
    view.points.forEach((p, i) => {
      const d = Math.hypot(sx(p.ageD) - x, sy(p.ratio) - y) - (p.breakout ? 2 : 0);
      if (d < bd) { best = i; bd = d; }
    });
    return best;
  };
  const open = (i: number) => openSheetHref(view.points[i].href, { title: 'Post' });
  const local = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = local(e);
    const i = pick(x, y);
    if (i !== st.current.hover) {
      st.current.hover = i;
      setHoverIdx(i);
      draw();
    }
  };
  const onLeave = () => { st.current.hover = -1; setHoverIdx(-1); draw(); };
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = pick(e.clientX - r.left, e.clientY - r.top);
    if (i >= 0) open(i);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!keys.length) return;
    const pos = keys.indexOf(st.current.focus);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = keys[pos < 0 ? (e.key === 'ArrowRight' ? 0 : keys.length - 1) : Math.max(0, Math.min(keys.length - 1, pos + (e.key === 'ArrowRight' ? 1 : -1)))];
      st.current.focus = next;
      setFocusIdx(next);
      draw();
    } else if (e.key === 'Enter' && st.current.focus >= 0) {
      e.preventDefault();
      open(st.current.focus);
    } else if (e.key === 'Escape') {
      st.current.focus = -1;
      setFocusIdx(-1);
      draw();
    }
  };
  const cur = focusIdx >= 0 ? view.points[focusIdx] : null;
  return (
    <div
      ref={wrap}
      className="lab2-graph lab2-graph-chart"
      tabIndex={0}
      role="application"
      {...kit('LabGraph')}
      aria-roledescription="chart"
      aria-label={cur ? `${cur.title}. Enter opens the post.` : `${view.label}. ${view.summary} Left and Right move through breakouts, Enter opens one.`}
      onKeyDown={onKey}
      onBlur={() => { st.current.focus = -1; setFocusIdx(-1); draw(); }}
      data-hover={hoverIdx >= 0 ? '' : undefined}
    >
      <canvas ref={canvas} width={0} height={0} aria-hidden="true" onPointerMove={onMove} onPointerLeave={onLeave} onClick={onClick} />
      <p className="lab2-sr">{view.summary}</p>
    </div>
  );
}

/** A graph's plain state (empty, not built, error): the sentence and, when there is one, the next step. */
export function GraphNote({ message, action }: { message: string | null; action: { label: string; href: string } | null }) {
  return (
    <div className="lab2-graph lab2-graph-note">
      <p className="lab2-graph-note-text" data-lab-ink="">{message}</p>
      {action && <Link href={action.href} scroll={false} className="lab2-narr-action lab2-graph-note-action">{action.label}</Link>}
    </div>
  );
}

/** The creator network card's visual: the graph when there is one, else its plain state. */
export function NetworkVisual({ view }: { view: CreatorNetworkView }) {
  return view.state.kind === 'ready' && view.nodes.length ? <CreatorNetworkGraph view={view} /> : <GraphNote message={view.state.message} action={view.state.action} />;
}

/** The breakouts card's visual: the chart when there is one, else its plain state. */
export function ChartVisual({ view }: { view: BreakoutChartView }) {
  return view.state.kind === 'ready' && view.points.length ? <BreakoutChartGraph view={view} /> : <GraphNote message={view.state.message} action={view.state.action} />;
}
