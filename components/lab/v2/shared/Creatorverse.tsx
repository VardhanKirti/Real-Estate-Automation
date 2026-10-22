'use client';
/**
 * Creatorverse: every creator the Lab follows as one full-page 3D network, sized and arranged by audience
 * (server model: lib/lab/view/creatorverse.ts). Shared by the GladOS and Classic trees, which pass `tree`
 * so the controls wear each tree's chip and button classes.
 *
 * Drawing runs on the shared canvas engine (graph3d.ts) in one requestAnimationFrame loop that only runs
 * while something moves (the slow turn, a fly-to, a drag) and stops when the graph is off-screen or the tab
 * is hidden. The turn pauses on any interaction and never runs with prefers-reduced-motion.
 *
 * Keyboard: the graph is one tab stop. Arrow keys move through creators biggest first, Enter selects,
 * Escape clears, + and - zoom, 0 resets, Shift with an arrow turns the graph. The search box finds and flies
 * to a creator. A screen reader gets the summary, a table of every creator, and a live line on selection.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import type { CreatorverseView, VerseKind, VerseNode, VersePlatform } from '@/lib/lab/view/creatorverse';
import { THEME_ATTRS, lumOf, project, readInk, reducedMotion, resolveColours, useCanvas, type Camera, type Ink, type Projected } from './graph3d';
import { IconArrowUpRight, IconChevronRight, IconClose, IconCollapse, IconExpand, IconMinus, IconPlus, IconRecentre, IconSearch } from './icons';
import { fmtCount } from '@/lib/lab/view/format';
import { VERSE_UI } from '@/lib/lab/view/creatorverse-copy';
import { platKey, searchCreators, shownMask, toggleFacet } from './creatorverse-filter';
import './creatorverse.css';

const fillT = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));

/** Which tree hosts the graph: GladOS, Classic, or Bennett Legacy (founderos-ui pages/lab.md). */
type Tree = 'g' | 'c' | 'l';
type Pal = { ink: Ink; colour: Record<string, string>; lightGround: boolean };
type Anim = { tx: number; ty: number; tz: number; zoom: number } | null;

const ZOOM_MIN = 0.55;
const ZOOM_MAX = 5;
const IDLE_MS = 4000;

export function CreatorverseGraph({ view, tree }: { view: CreatorverseView; tree: Tree }) {
  const nodes = view.nodes;
  const root = useRef<HTMLDivElement>(null);
  const { wrap, canvas, size, ctx } = useCanvas();
  const tip = useRef<HTMLDivElement>(null);

  const [hiddenKinds, setHiddenKinds] = useState<Set<VerseKind>>(() => new Set());
  const [hiddenPlats, setHiddenPlats] = useState<Set<VersePlatform>>(() => new Set());
  const [colourBy, setColourBy] = useState<'kind' | 'platform'>('kind');
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState(-1);
  const [hover, setHover] = useState(-1);
  const [focus, setFocus] = useState(-1);
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [activeOpt, setActiveOpt] = useState(0);
  const [full, setFull] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [legendOpen, setLegendOpen] = useState(true);
  // A phone starts with the legend folded so the graph has the room.
  useEffect(() => { if (window.matchMedia?.('(max-width: 760px)').matches) setLegendOpen(false); }, []);
  // On a desktop the stage runs from where it starts to the bottom of the window, so the whole graph is in view.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const fit = () => {
      const stage = el.querySelector<HTMLElement>('.lab2-verse-stage');
      if (!stage) return;
      const top = stage.getBoundingClientRect().top + window.scrollY;
      el.style.setProperty('--lab-verse-h', `${Math.max(380, Math.round(window.innerHeight - top - 24))}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    const bar = el.querySelector('.lab2-verse-bar');
    if (ro && bar) ro.observe(bar);
    return () => { window.removeEventListener('resize', fit); ro?.disconnect(); };
  }, []);

  const cam = useRef<Camera>({ yaw: 0.5, pitch: -0.28, zoom: 1, tx: 0, ty: 0, tz: 0 });
  const anim = useRef<Anim>(null);
  const live = useRef({ hover: -1, focus: -1, selected: -1, lastInteract: -Infinity, drag: null as null | { x: number; y: number; yaw: number; pitch: number; moved: boolean }, pinch: null as null | { d: number; zoom: number }, visible: true });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const proj = useRef<(Projected & { r: number })[]>([]);
  const pal = useRef<Pal | null>(null);
  const loop = useRef({ raf: 0, last: 0, dirty: true });

  live.current.hover = hover;
  live.current.focus = focus;
  live.current.selected = selected;

  const visible = useMemo(() => shownMask(nodes, hiddenKinds, hiddenPlats), [nodes, hiddenKinds, hiddenPlats]);
  const shownN = visible.filter(Boolean).length;
  /** biggest first, the keyboard order */
  const order = useMemo(() => nodes.map((n, i) => ({ r: n.rank, i })).sort((a, b) => a.r - b.r).map((x) => x.i).filter((i) => visible[i]), [nodes, visible]);
  const neighbours = useMemo(() => {
    const m = nodes.map(() => new Set<number>());
    for (const e of view.edges) { m[e.a].add(e.b); m[e.b].add(e.a); }
    return m;
  }, [nodes, view.edges]);
  const tokens = useMemo(() => [...new Set([...view.kinds.map((k) => k.token), ...view.platforms.map((p) => p.token)])], [view.kinds, view.platforms]);
  const kindToken = useMemo(() => new Map(view.kinds.map((k) => [k.id, k.token])), [view.kinds]);
  const platToken = useMemo(() => new Map(view.platforms.map((p) => [p.id, p.token])), [view.platforms]);

  const kick = useCallback(() => {
    loop.current.dirty = true;
    if (!loop.current.raf && typeof window !== 'undefined') loop.current.raf = requestAnimationFrame((t) => stepRef.current(t));
  }, []);
  const touch = useCallback(() => { live.current.lastInteract = performance.now(); }, []);

  /* ── drawing ── */
  const draw = useCallback(() => {
    const g = ctx();
    const el = wrap.current;
    if (!g || !el) return;
    if (!pal.current) {
      const ink = readInk(el, '--lab-ink-hero', '--lab-glass-solid');
      pal.current = { ink, colour: resolveColours(el, tokens), lightGround: lumOf(ink.ink) < 0.5 };
    }
    const { ink, colour } = pal.current;
    const { w, h } = size;
    const c = cam.current;
    const L = live.current;
    const panelOpen = L.selected >= 0 && w >= 900;
    const cx = panelOpen ? (w - 340) / 2 : w / 2;
    const cy = h / 2;
    const R = Math.min(panelOpen ? w - 340 : w, h) * 0.46;
    const base = Math.max(0.7, Math.min(1.2, Math.min(w, h) / 620));
    const zr = Math.sqrt(c.zoom);
    const P = nodes.map((n) => {
      const p = project(n, c, cx, cy, R);
      const r = (n.sizeBasis === 'none' ? 2.8 : 3 + 17 * Math.pow(n.s, 1.3)) * base * p.k * zr;
      return { ...p, r };
    });
    proj.current = P;
    const active = L.hover >= 0 ? L.hover : L.focus >= 0 ? L.focus : L.selected;
    const near = active >= 0 ? neighbours[active] : null;
    const colourOf = (n: VerseNode) => colour[(colourBy === 'kind' ? kindToken.get(n.kind) : platToken.get(platKey(n.platform))) ?? ''] ?? ink.ink;

    // Edges first, faded with depth; the active creator's links light up.
    g.lineCap = 'round';
    g.strokeStyle = ink.ink;
    for (const e of view.edges) {
      if (!visible[e.a] || !visible[e.b]) continue;
      const lit = active >= 0 && (e.a === active || e.b === active);
      if (!showAll && !e.strong && !lit) continue;
      const a = P[e.a], b = P[e.b];
      const depth = 0.3 + 0.7 * Math.min(a.d, b.d);
      g.globalAlpha = lit ? 0.5 : (0.07 + (e.kind === 'event' ? 0.22 : 0.14) * e.w) * depth * (active >= 0 ? 0.4 : 1) * (showAll && !e.strong ? 0.6 : 1);
      g.lineWidth = lit ? 1.2 : e.kind === 'event' ? 1 : 0.8;
      g.setLineDash(e.kind === 'topic' ? [2, 4] : []);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    g.setLineDash([]);

    const drawOrder = nodes.map((_, i) => i).filter((i) => visible[i]).sort((a, b) => Number(a === active) - Number(b === active) || P[a].d - P[b].d);
    for (const i of drawOrder) {
      const p = P[i], n = nodes[i];
      if (p.x < -40 || p.y < -40 || p.x > w + 40 || p.y > h + 40) continue;
      const col = colourOf(n);
      const fog = i === active || i === L.selected ? 1 : 0.3 + 0.7 * p.d;
      const dim = active >= 0 && i !== active && !near?.has(i) && i !== L.selected ? 0.3 : 1;
      const a = fog * dim;
      const shape = () => {
        g.beginPath();
        if (n.kind === 'watch') {
          const q = p.r * 1.15;
          g.moveTo(p.x, p.y - q); g.lineTo(p.x + q, p.y); g.lineTo(p.x, p.y + q); g.lineTo(p.x - q, p.y); g.closePath();
        } else g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      };
      g.save();
      if (n.sizeBasis === 'none') {
        g.globalAlpha = 0.85 * a;
        g.strokeStyle = col;
        g.lineWidth = 1.4;
        shape();
        g.stroke();
      } else {
        if (n.hot && dim === 1) {
          g.shadowColor = col;
          g.shadowBlur = (4 + 8 * p.d) * ink.glow;
        }
        g.globalAlpha = (n.sizeBasis === 'median_views' ? 0.45 : n.kind === 'suggested' ? 0.55 : 0.92) * a;
        g.fillStyle = col;
        shape();
        g.fill();
      }
      g.restore();
      if (n.kind === 'suggested' || n.kind === 'owned') {
        g.save();
        g.globalAlpha = 0.8 * a;
        g.strokeStyle = n.kind === 'owned' ? ink.ink : col;
        g.lineWidth = n.kind === 'owned' ? 1.5 : 1.2;
        if (n.kind === 'suggested') g.setLineDash([3, 3]);
        g.beginPath();
        g.arc(p.x, p.y, p.r + (n.kind === 'owned' ? 3.5 : 3), 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }
      if (i === active || i === L.selected) {
        g.save();
        g.globalAlpha = 1;
        g.strokeStyle = ink.ink;
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(p.x, p.y, p.r + 6.5, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }
    }

    // Labels: the biggest few, the selected creator and its neighbours; never overlapping.
    const want: number[] = [];
    if (L.selected >= 0 && visible[L.selected]) want.push(L.selected);
    // the selected creator's five biggest neighbours, not all of them: a hub can have dozens
    if (L.selected >= 0) want.push(...[...neighbours[L.selected]].filter((j) => visible[j]).sort((a, b) => nodes[a].rank - nodes[b].rank).slice(0, 5));
    const topN = w < 600 ? 4 : w < 1100 ? 7 : 10;
    for (const i of order.slice(0, topN)) want.push(i);
    // Labels never sit under the legend, the zoom rail or the panel.
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    const base0 = el.getBoundingClientRect();
    for (const o of el.parentElement?.querySelectorAll<HTMLElement>('.lab2-verse-legend, .lab2-verse-zoom, .lab2-verse-panel') ?? []) {
      const r = o.getBoundingClientRect();
      boxes.push({ x: r.left - base0.left - 4, y: r.top - base0.top - 4, w: r.width + 8, h: r.height + 8 });
    }
    g.font = `500 12px ${ink.font}`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const seen = new Set<number>();
    for (const i of want) {
      if (seen.has(i) || i === active) continue;
      seen.add(i);
      const p = P[i];
      const label = nodes[i].handle;
      const tw = g.measureText(label).width;
      const spots = [p.y + p.r + 5, p.y - p.r - 23].map((y) => ({ x: p.x - tw / 2 - 6, y, w: tw + 12, h: 18 }));
      const box = spots.find((b) => b.x >= 2 && b.x + b.w <= w - 2 && b.y >= 2 && b.y + b.h <= h - 2 && !boxes.some((o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h));
      if (!box) continue;
      boxes.push(box);
      const fade = i === L.selected ? 1 : 0.45 + 0.55 * p.d;
      g.globalAlpha = 0.72 * fade;
      g.fillStyle = ink.paper;
      g.beginPath();
      g.roundRect(box.x, box.y, box.w, box.h, 9);
      g.fill();
      g.globalAlpha = fade;
      g.fillStyle = ink.ink;
      g.fillText(label, p.x, box.y + 13);
    }
    g.globalAlpha = 1;
    g.textAlign = 'left';

    // The hover card follows its node without a React render.
    const t = tip.current;
    if (t) {
      const hi = L.hover >= 0 ? L.hover : L.focus;
      if (hi >= 0 && P[hi]) {
        const p = P[hi];
        const tw = t.offsetWidth || 220, th = t.offsetHeight || 90;
        let x = p.x + p.r + 12, y = p.y - th / 2;
        if (x + tw > w - 8) x = p.x - p.r - 12 - tw;
        y = Math.max(8, Math.min(h - th - 8, y));
        t.style.transform = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(y)}px)`;
      }
    }
  }, [ctx, wrap, size, nodes, view.edges, visible, showAll, colourBy, neighbours, order, tokens, kindToken, platToken]);

  /* ── the loop: turn, fly, draw; stops when nothing moves ── */
  const stepRef = useRef<(t: number) => void>(() => {});
  stepRef.current = (t: number) => {
    const lp = loop.current;
    lp.raf = 0;
    const L = live.current;
    if (!L.visible || (typeof document !== 'undefined' && document.hidden)) { lp.last = 0; return; }
    const dt = lp.last ? Math.min(64, t - lp.last) : 16;
    lp.last = t;
    const still = reducedMotion();
    const c = cam.current;
    let moving = false;
    const a = anim.current;
    if (a) {
      const k = still ? 1 : 1 - Math.pow(0.86, dt / 16);
      c.tx += (a.tx - c.tx) * k; c.ty += (a.ty - c.ty) * k; c.tz += (a.tz - c.tz) * k; c.zoom += (a.zoom - c.zoom) * k;
      if (Math.abs(a.tx - c.tx) + Math.abs(a.ty - c.ty) + Math.abs(a.tz - c.tz) + Math.abs(a.zoom - c.zoom) < 0.002) {
        Object.assign(c, { tx: a.tx, ty: a.ty, tz: a.tz, zoom: a.zoom });
        anim.current = null;
      } else moving = true;
    }
    const idle = performance.now() - L.lastInteract > IDLE_MS && L.drag === null && L.hover < 0 && L.focus < 0 && L.selected < 0;
    if (!still && idle) {
      c.yaw += dt * 0.00007;
      moving = true;
    } else if (!still && L.drag === null && L.selected < 0 && L.hover < 0 && L.focus < 0) moving = true; // waiting out the idle pause
    if (lp.dirty || moving) {
      lp.dirty = false;
      draw();
    }
    if (moving) lp.raf = requestAnimationFrame((tt) => stepRef.current(tt));
  };

  useEffect(() => { kick(); }, [draw, kick]);

  // Theme flips re-read the palette; off-screen and hidden tabs stop the loop.
  useEffect(() => {
    const mo = new MutationObserver(() => { pal.current = null; kick(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: THEME_ATTRS });
    const el = wrap.current;
    let io: IntersectionObserver | null = null;
    if (el && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((es) => {
        live.current.visible = es.some((e) => e.isIntersecting);
        if (live.current.visible) kick();
      });
      io.observe(el);
    }
    const vis = () => { if (!document.hidden) kick(); };
    document.addEventListener('visibilitychange', vis);
    const lp = loop.current;
    return () => {
      mo.disconnect();
      io?.disconnect();
      document.removeEventListener('visibilitychange', vis);
      if (lp.raf) cancelAnimationFrame(lp.raf);
      lp.raf = 0;
    };
  }, [kick, wrap]);

  /* ── camera actions ── */
  const flyTo = useCallback((i: number) => {
    const n = nodes[i];
    anim.current = { tx: n.x * 0.7, ty: n.y * 0.7, tz: n.z * 0.7, zoom: Math.max(cam.current.zoom, 1.25) };
    kick();
  }, [nodes, kick]);
  const zoomBy = useCallback((f: number) => {
    touch();
    const c = cam.current;
    const target = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (anim.current?.zoom ?? c.zoom) * f));
    anim.current = { tx: anim.current?.tx ?? c.tx, ty: anim.current?.ty ?? c.ty, tz: anim.current?.tz ?? c.tz, zoom: target };
    kick();
  }, [kick, touch]);
  const recentre = useCallback(() => {
    touch();
    anim.current = { tx: 0, ty: 0, tz: 0, zoom: 1 };
    kick();
  }, [kick, touch]);

  const select = useCallback((i: number, opts: { fly?: boolean } = {}) => {
    touch();
    setSelected(i);
    live.current.selected = i;
    if (i >= 0) {
      setAnnounce(fillT(VERSE_UI.selected, { name: `${nodes[i].handle}, ${nodes[i].sizeText}` }));
      if (opts.fly !== false) flyTo(i);
    }
    kick();
  }, [flyTo, kick, nodes, touch]);

  // ?creator=<id> selects on load.
  const initial = useRef(false);
  useEffect(() => {
    if (initial.current || !view.selected || !size.w) return;
    initial.current = true;
    const i = nodes.findIndex((n) => n.id === view.selected);
    if (i >= 0) select(i);
  }, [view.selected, nodes, select, size.w]);

  // Selecting or hiding re-draws; a hidden selection closes.
  useEffect(() => {
    if (selected >= 0 && !visible[selected]) setSelected(-1);
    kick();
  }, [visible, selected, showAll, colourBy, kick]);

  /* ── pointer, wheel, pinch ── */
  const pick = (x: number, y: number) => {
    const P = proj.current;
    let best = -1, bd = Infinity;
    for (let i = 0; i < P.length; i++) {
      if (!visible[i]) continue;
      const d = Math.hypot(P[i].x - x, P[i].y - y) - P[i].r;
      if (d < 7 && (d < bd - 0.5 || (Math.abs(d - bd) <= 0.5 && P[i].d > P[best].d))) { best = i; bd = d; }
    }
    return best;
  };
  const local = (e: { clientX: number; clientY: number; currentTarget: Element }) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    touch();
    const pt = local(e);
    pointers.current.set(e.pointerId, pt);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      live.current.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.current.zoom };
      live.current.drag = null;
    } else {
      live.current.drag = { x: pt.x, y: pt.y, yaw: cam.current.yaw, pitch: cam.current.pitch, moved: false };
    }
  };
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const pt = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, pt);
    const L = live.current;
    if (L.pinch && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      cam.current.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, L.pinch.zoom * (d / Math.max(1, L.pinch.d))));
      anim.current = null;
      touch();
      kick();
      return;
    }
    const d = L.drag;
    if (d) {
      if (Math.hypot(pt.x - d.x, pt.y - d.y) > 4) d.moved = true;
      if (d.moved) {
        cam.current.yaw = d.yaw + (pt.x - d.x) * 0.006;
        cam.current.pitch = Math.max(-1.3, Math.min(1.3, d.pitch + (pt.y - d.y) * 0.006));
        touch();
        kick();
      }
      return;
    }
    const i = pick(pt.x, pt.y);
    if (i !== L.hover) {
      L.hover = i;
      setHover(i);
      if (i >= 0) touch();
      kick();
    }
  };
  const onUp = (e: RPointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    const L = live.current;
    if (pointers.current.size < 2) L.pinch = null;
    const d = L.drag;
    L.drag = null;
    touch();
    if (d && !d.moved) {
      const pt = local(e);
      const i = pick(pt.x, pt.y);
      select(i, { fly: i >= 0 });
    }
    kick();
  };
  const onLeave = () => {
    if (live.current.drag) return;
    live.current.hover = -1;
    setHover(-1);
    kick();
  };
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      cam.current.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.current.zoom * f));
      if (anim.current) anim.current.zoom = cam.current.zoom;
      touch();
      kick();
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  }, [canvas, kick, touch]);

  /* ── keyboard on the graph ── */
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    touch();
    const arrows = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'];
    if (arrows.includes(e.key) && e.shiftKey) {
      e.preventDefault();
      const c = cam.current;
      if (e.key === 'ArrowLeft') c.yaw -= 0.15;
      if (e.key === 'ArrowRight') c.yaw += 0.15;
      if (e.key === 'ArrowUp') c.pitch = Math.max(-1.3, c.pitch - 0.15);
      if (e.key === 'ArrowDown') c.pitch = Math.min(1.3, c.pitch + 0.15);
      kick();
      return;
    }
    if (arrows.includes(e.key)) {
      if (!order.length) return;
      e.preventDefault();
      const pos = order.indexOf(live.current.focus);
      const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
      const next = order[pos < 0 ? (fwd ? 0 : order.length - 1) : (pos + (fwd ? 1 : -1) + order.length) % order.length];
      live.current.focus = next;
      setFocus(next);
      kick();
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (live.current.focus < 0) return;
      e.preventDefault();
      select(live.current.focus);
    } else if (e.key === 'Escape') {
      if (live.current.focus >= 0 || selected >= 0) e.preventDefault();
      live.current.focus = -1;
      setFocus(-1);
      select(-1);
    } else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.25); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(0.8); }
    else if (e.key === '0') { e.preventDefault(); recentre(); }
  };

  /* ── search ── */
  const matches = useMemo(() => searchCreators(nodes, query), [nodes, query]);
  const choose = (i: number) => {
    const n = nodes[i];
    // A creator behind a filter brings its kind and platform back into view.
    if (hiddenKinds.has(n.kind)) setHiddenKinds((s) => { const t = new Set(s); t.delete(n.kind); return t; });
    if (hiddenPlats.has(platKey(n.platform))) setHiddenPlats((s) => { const t = new Set(s); t.delete(platKey(n.platform)); return t; });
    setQuery('');
    setListOpen(false);
    select(i);
  };
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && matches.length) { e.preventDefault(); setListOpen(true); setActiveOpt((a) => Math.min(matches.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp' && matches.length) { e.preventDefault(); setActiveOpt((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && matches.length) { e.preventDefault(); choose(matches[Math.min(activeOpt, matches.length - 1)]); }
    else if (e.key === 'Escape') { setListOpen(false); setQuery(''); }
  };

  /* ── full screen ── */
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  useEffect(() => {
    if (!full) return;
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && !document.fullscreenElement) setFull(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [full]);
  const toggleFull = () => {
    const el = root.current;
    if (!el) return;
    if (document.fullscreenElement) { void document.exitFullscreen?.(); return; }
    if (full) { setFull(false); return; }
    if (el.requestFullscreen) el.requestFullscreen().catch(() => setFull(true));
    else setFull(true);
  };

  /* ── render ── */
  const chip = tree === 'g' ? 'lab2g-fchip' : tree === 'l' ? 'l-lab-vchip' : 'lab2c-fchip';
  /** The GladOS control guard (scripts/g-audit.mjs) wants a kit marker within two levels of every control. */
  const kit = (name: string) => (tree === 'g' ? name : undefined);
  const btn = tree === 'g' ? 'lab2-pill lab2-verse-btn' : tree === 'l' ? 'l-pressable is-dark l-btn lab2-verse-btn' : 'lab2c-btn lab2-verse-btn';
  /** Under Legacy the controls carry the kit's data-l names instead (no GladOS marker, SPEC AC-6). */
  const lk = (name: string) => (tree === 'l' ? name : undefined);
  const hi = hover >= 0 ? hover : focus;
  const hn = hi >= 0 ? nodes[hi] : null;
  const sel = selected >= 0 ? nodes[selected] : null;
  const graphLabel = focus >= 0 ? fillT(VERSE_UI.focused, { title: nodes[focus].title }) : fillT(VERSE_UI.graphLabel, { summary: view.summary });

  return (
    <div ref={root} className="lab2-verse" data-tree={tree} data-full={full ? '' : undefined}>
      <div className="lab2-verse-bar" role="toolbar" aria-label={VERSE_UI.searchLabel}>
        <div className="lab2-verse-search" data-g={kit('LabSearchPill')} data-open={listOpen && query ? '' : undefined}>
          <IconSearch size={14} className="lab2-verse-search-icon" />
          <input
            type="search"
            className="lab2-verse-input"
            placeholder={VERSE_UI.searchPlaceholder}
            aria-label={VERSE_UI.searchLabel}
            role="combobox"
            aria-expanded={listOpen && matches.length > 0}
            aria-controls="lab2-verse-options"
            aria-autocomplete="list"
            aria-activedescendant={listOpen && matches.length ? `lab2-verse-opt-${matches[Math.min(activeOpt, matches.length - 1)]}` : undefined}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setListOpen(true); setActiveOpt(0); }}
            onFocus={() => setListOpen(true)}
            onBlur={() => window.setTimeout(() => setListOpen(false), 120)}
            onKeyDown={onSearchKey}
          />
          {listOpen && query.trim() && (
            <ul id="lab2-verse-options" role="listbox" className="lab2-verse-options" data-g={kit('LabListbox')} aria-label={VERSE_UI.searchLabel}>
              {matches.length ? matches.map((i, k) => (
                <li
                  key={nodes[i].id}
                  id={`lab2-verse-opt-${i}`}
                  role="option"
                  aria-selected={k === activeOpt}
                  className="lab2-verse-option"
                  onMouseDown={(e) => { e.preventDefault(); choose(i); }}
                >
                  <span className="lab2-verse-swatch" style={{ background: `var(${kindToken.get(nodes[i].kind)})` }} aria-hidden="true" />
                  <span className="lab2-verse-option-name">{nodes[i].handle}</span>
                  <span className="lab2-verse-option-meta">{nodes[i].platformLabel} · {nodes[i].sizeText}</span>
                </li>
              )) : <li className="lab2-verse-option" aria-disabled="true">{VERSE_UI.noMatch}</li>}
            </ul>
          )}
        </div>
        <div className="lab2-verse-filters">
        <span className="lab2-verse-group" role="group" aria-label={VERSE_UI.kindsLabel} data-g={kit('LabFilterChips')}>
          {view.kinds.map((k) => (
            <button key={k.id} type="button" className={chip} data-l={lk('ToggleChip')} data-verse="filter" aria-pressed={!hiddenKinds.has(k.id)} onClick={() => setHiddenKinds((s) => toggleFacet(s, k.id, view.kinds.map((x) => x.id)))}>
              {colourBy === 'kind' && <span className="lab2-verse-swatch" style={{ background: `var(${k.token})` }} aria-hidden="true" />}
              <span data-lab-ink="">{k.label}</span>
              <span className={`${chip}-n`}>{k.n}</span>
            </button>
          ))}
        </span>
        <span className="lab2-verse-group" role="group" aria-label={VERSE_UI.platformsLabel} data-g={kit('LabFilterChips')}>
          {view.platforms.map((p) => (
            <button key={p.id} type="button" className={chip} data-l={lk('ToggleChip')} data-verse="filter" aria-pressed={!hiddenPlats.has(p.id)} onClick={() => setHiddenPlats((s) => toggleFacet(s, p.id, view.platforms.map((x) => x.id)))}>
              {colourBy === 'platform' && <span className="lab2-verse-swatch" style={{ background: `var(${p.token})` }} aria-hidden="true" />}
              <span data-lab-ink="">{p.label}</span>
              <span className={`${chip}-n`}>{p.n}</span>
            </button>
          ))}
        </span>
        </div>
      </div>

      <div className="lab2-verse-stage" data-selected={sel ? '' : undefined}>
        <div
          ref={wrap}
          className="lab2-verse-canvas"
          data-g={kit('LabGraph')}
          tabIndex={0}
          role="application"
          aria-roledescription="graph"
          aria-label={graphLabel}
          onKeyDown={onKey}
          onBlur={() => { live.current.focus = -1; setFocus(-1); kick(); }}
          data-hover={hover >= 0 ? '' : undefined}
        >
          <canvas ref={canvas} width={0} height={0} aria-hidden="true" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onLeave} />
        </div>

        <div ref={tip} className="lab2-verse-tip" aria-hidden="true" data-on={hn && hi !== selected ? '' : undefined}>
          {hn && (
            <>
              <span className="lab2-verse-tip-name">{hn.handle}</span>
              <span className="lab2-verse-tip-meta">{hn.platformLabel} · {hn.kindLabel}{hn.paused ? ` · ${VERSE_UI.paused}` : ''}</span>
              <span className="lab2-verse-tip-row"><span>{VERSE_UI.audience}</span><b>{hn.sizeText}</b></span>
              <span className="lab2-verse-tip-row"><span>{VERSE_UI.breakouts30}</span><b>{hn.breakouts}</b></span>
            </>
          )}
        </div>

        <div className="lab2-verse-zoom" role="group" aria-label={VERSE_UI.recentre} data-g={kit('LabIconRail')}>
          <button type="button" className="lab2-verse-icon" onClick={() => zoomBy(1.25)} aria-label={VERSE_UI.zoomIn} title={VERSE_UI.zoomIn}><IconPlus size={16} /></button>
          <button type="button" className="lab2-verse-icon" onClick={() => zoomBy(0.8)} aria-label={VERSE_UI.zoomOut} title={VERSE_UI.zoomOut}><IconMinus size={16} /></button>
          <button type="button" className="lab2-verse-icon" onClick={recentre} aria-label={VERSE_UI.recentre} title={VERSE_UI.recentre}><IconRecentre size={16} /></button>
          <button type="button" className="lab2-verse-icon" onClick={toggleFull} aria-label={full ? VERSE_UI.exitFull : VERSE_UI.full} title={full ? VERSE_UI.exitFull : VERSE_UI.full} aria-pressed={full}>
            {full ? <IconCollapse size={16} /> : <IconExpand size={16} />}
          </button>
        </div>

        <aside className="lab2-verse-legend" aria-label={VERSE_UI.legendTitle} data-g={kit('LabLegend')} data-closed={legendOpen ? undefined : ''}>
          <button type="button" className="lab2-verse-legend-title" aria-expanded={legendOpen} aria-controls="lab2-verse-legend-body" onClick={() => setLegendOpen((o) => !o)}><IconChevronRight size={12} />{VERSE_UI.legendTitle}</button>
          <span id="lab2-verse-legend-body" className="lab2-verse-legend-body" hidden={!legendOpen}>
          <span className="lab2-verse-display" data-g={kit('LabSegmented')}>
            <span className="lab2-verse-seg" role="radiogroup" aria-label={VERSE_UI.colourLabel}>
              <span className="lab2-verse-seg-k">{VERSE_UI.colourLabel}</span>
              {(['kind', 'platform'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={colourBy === m} className="lab2-verse-mini" data-on={colourBy === m ? '' : undefined} onClick={() => setColourBy(m)}>
                  {m === 'kind' ? VERSE_UI.colourKind : VERSE_UI.colourPlatform}
                </button>
              ))}
            </span>
            <button type="button" className="lab2-verse-mini" data-on={showAll ? '' : undefined} aria-pressed={showAll} title={showAll ? VERSE_UI.linksTitleOn : VERSE_UI.linksTitleOff} onClick={() => setShowAll((v) => !v)}>
              {VERSE_UI.links}
            </button>
          </span>
          <span className="lab2-verse-sizekey" aria-hidden="true">
            <i data-s="1" /><i data-s="2" /><i data-s="3" />
            <span>{VERSE_UI.sizeKey}</span>
          </span>
          <span className="lab2-verse-legend-line">{view.legend.size}</span>
          <span className="lab2-verse-legend-line">{view.legend.centre}</span>
          {view.legend.fallback && <span className="lab2-verse-legend-line" data-mark="faded">{view.legend.fallback}</span>}
          {view.legend.none && <span className="lab2-verse-legend-line" data-mark="hollow">{view.legend.none}</span>}
          <span className="lab2-verse-legend-line">{view.legend.edges}</span>
          <span className="lab2-verse-legend-shapes" aria-hidden="true">
            {view.kinds.some((k) => k.id === 'owned') && <span><i data-shape="ring" />{view.kinds.find((k) => k.id === 'owned')!.label}</span>}
            {view.kinds.some((k) => k.id === 'watch') && <span><i data-shape="diamond" />{view.kinds.find((k) => k.id === 'watch')!.label}</span>}
            {view.kinds.some((k) => k.id === 'suggested') && <span><i data-shape="dashed" />{view.kinds.find((k) => k.id === 'suggested')!.label}</span>}
          </span>
          <span className="lab2-verse-legend-count">{fillT(VERSE_UI.shown, { n: shownN, t: nodes.length })}</span>
          </span>
        </aside>

        {sel && (
          <section className="lab2-verse-panel" aria-labelledby="lab2-verse-panel-title">
            <header className="lab2-verse-panel-head" data-g={kit('LabSheetHead')}>
              <span className="lab2-verse-swatch lab2-verse-swatch-lg" style={{ background: `var(${colourBy === 'kind' ? kindToken.get(sel.kind) : platToken.get(platKey(sel.platform))})` }} aria-hidden="true" />
              <span className="lab2-verse-panel-titles">
                <h2 id="lab2-verse-panel-title" className="lab2-verse-panel-title">{sel.handle}</h2>
                <span className="lab2-verse-panel-meta">{sel.name !== sel.handle ? `${sel.name} · ` : ''}{sel.platformLabel} · {sel.kindLabel}</span>
              </span>
              <button type="button" className="lab2-verse-icon" onClick={() => select(-1)} aria-label={VERSE_UI.close} title={VERSE_UI.close}><IconClose size={16} /></button>
            </header>
            <dl className="lab2-verse-stats">
              <div><dt>{VERSE_UI.audience}</dt><dd>{sel.sizeBasis === 'none' ? VERSE_UI.none : fmtCount(sel.followers ?? sel.medianViews ?? 0)}<small>{sel.sizeBasis === 'followers' ? (sel.platform === 'youtube' ? VERSE_UI.unitSubscribers : VERSE_UI.unitFollowers) : sel.sizeBasis === 'median_views' ? VERSE_UI.unitViews : VERSE_UI.unitNone}</small></dd></div>
              <div><dt>{VERSE_UI.breakouts30}</dt><dd>{sel.breakouts}{sel.hot && <small>{VERSE_UI.thisWeek}</small>}</dd></div>
              <div><dt>{VERSE_UI.posts}</dt><dd>{fmtCount(sel.posts)}</dd></div>
              <div><dt>{VERSE_UI.links_}</dt><dd>{sel.degree}</dd></div>
            </dl>
            {sel.topic && <p className="lab2-verse-panel-line"><span>{VERSE_UI.topic}</span> {sel.topic}</p>}
            {sel.reason && <p className="lab2-verse-panel-line">{sel.reason}</p>}
            {sel.paused && <p className="lab2-verse-panel-line">{VERSE_UI.paused}</p>}
            {!sel.breakoutsHref && <p className="lab2-verse-panel-line">{VERSE_UI.noPosts}</p>}
            <div className="lab2-verse-panel-actions" data-g={kit('LabActions')}>
              {sel.breakoutsHref && <Link href={sel.breakoutsHref} className={btn} data-lab-primary=""><span data-lab-ink="">{VERSE_UI.openBreakouts}</span></Link>}
              <Link href={sel.setupHref} scroll={false} className={btn}><span data-lab-ink="">{VERSE_UI.openSetup}</span></Link>
              {sel.url && <a href={sel.url} target="_blank" rel="noreferrer" className={btn}><span data-lab-ink="">{VERSE_UI.openProfile}</span><IconArrowUpRight size={12} /></a>}
            </div>
          </section>
        )}
      </div>

      <p className="lab2-sr">{view.summary}</p>
      <p className="lab2-sr" aria-live="polite">{announce}</p>
      <table className="lab2-sr">
        <caption>{VERSE_UI.tableCaption}</caption>
        <thead><tr><th scope="col">{VERSE_UI.colName}</th><th scope="col">{VERSE_UI.colPlatform}</th><th scope="col">{VERSE_UI.colKind}</th><th scope="col">{VERSE_UI.colAudience}</th><th scope="col">{VERSE_UI.colBreakouts}</th></tr></thead>
        <tbody>
          {order.map((i) => (
            <tr key={nodes[i].id}><th scope="row">{nodes[i].handle}</th><td>{nodes[i].platformLabel}</td><td>{nodes[i].kindLabel}</td><td>{nodes[i].sizeText}</td><td>{nodes[i].breakouts}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
