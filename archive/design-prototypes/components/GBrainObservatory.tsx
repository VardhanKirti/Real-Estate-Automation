'use client';

import { usePalette } from '@/lib/use-palette';

/**
 * G-Brain Observatory — cinematic view of the knowledge core, built to be
 * FILMED (short-form vertical video of the screen). Design notes in
 * docs/DESIGN-GBRAIN.md. This page is the sanctioned cinematic exception to
 * the Console matte law: glow is allowed here because the camera needs it.
 *
 * Everything rendered is real: clusters are the brain-store's folders, the
 * larger dots are its pages (chunk dots orbit their page), cross links are
 * resolved wikilinks, and the prompt bar runs REAL queries through
 * GET /api/brain — auto every ~16s, or type your own (focus stops auto).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ObservatoryData } from '@/lib/gbrain-observatory';
import { useGBrainThoughts } from '@/components/gbrain-live';

type Node = {
  cluster: number;
  bx: number; // base position (layout space, center-origin)
  by: number;
  z: number; // depth 0.35..1 — parallax + size + brightness
  r: number; // base radius
  phase: number;
  speed: number;
  label?: string; // drawn on canvas (hub pages only)
  name?: string; // hover tooltip (every page anchor)
};
type Link = { a: number; b: number; cross: boolean };

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lay the real store out as a constellation — pages on golden-angle spirals, chunks orbiting their page. */
function buildGraph(data: ObservatoryData) {
  const rnd = mulberry32(4100);
  const nodes: Node[] = [];
  const links: Link[] = [];
  const anchorOf: number[] = new Array(data.notes.length).fill(-1);
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));

  data.clusters.forEach((c, ci) => {
    const ang = (ci / data.clusters.length) * Math.PI * 2 - Math.PI / 2 + (rnd() - 0.5) * 0.3;
    const cx = Math.cos(ang) * (0.62 + (rnd() - 0.5) * 0.1);
    const cy = Math.sin(ang) * (0.44 + (rnd() - 0.5) * 0.08);
    const members = data.notes.map((n, idx) => ({ n, idx })).filter((x) => x.n.c === ci);
    members.forEach((m, i) => {
      const rad = 0.3 * Math.sqrt((i + 0.6) / members.length) * (0.85 + rnd() * 0.3);
      const th = i * GOLDEN + rnd() * 0.35;
      const ax = cx + Math.cos(th) * rad * 1.12;
      const ay = cy + Math.sin(th) * rad * 0.86;
      const anchor = nodes.length;
      anchorOf[m.idx] = anchor;
      nodes.push({
        cluster: ci,
        bx: ax,
        by: ay,
        z: 0.72 + rnd() * 0.28,
        r: m.n.hub ? 3.4 + rnd() * 1.2 : 1.9 + rnd() * 0.7,
        phase: rnd() * Math.PI * 2,
        speed: 0.4 + rnd() * 1.1,
        label: m.n.hub ? m.n.t : undefined,
        name: m.n.t,
      });
      // chunk dots — the page's embedded pieces, tight around their page
      for (let k = 1; k < m.n.k; k++) {
        const ca = rnd() * Math.PI * 2;
        const cr = 0.018 + Math.pow(rnd(), 0.7) * 0.05;
        nodes.push({
          cluster: ci,
          bx: ax + Math.cos(ca) * cr * 1.1,
          by: ay + Math.sin(ca) * cr * 0.85,
          z: 0.35 + rnd() * 0.5,
          r: 0.9 + rnd() * 1.3,
          phase: rnd() * Math.PI * 2,
          speed: 0.4 + rnd() * 1.1,
        });
        links.push({ a: nodes.length - 1, b: anchor, cross: false });
      }
    });
  });
  // real wikilinks between pages
  for (const [i, j] of data.links) {
    const a = anchorOf[i];
    const b = anchorOf[j];
    if (a < 0 || b < 0) continue;
    links.push({ a, b, cross: nodes[a].cluster !== nodes[b].cluster });
  }
  return { nodes, links };
}

// Deep-background dust — presentation only (far-field stars, no data claim).
const DUST = (() => {
  const rnd = mulberry32(910);
  return Array.from({ length: 130 }, () => ({
    bx: (rnd() - 0.5) * 1.9,
    by: (rnd() - 0.5) * 1.3,
    z: 0.08 + rnd() * 0.16,
    r: 0.5 + rnd() * 0.9,
    phase: rnd() * Math.PI * 2,
    speed: 0.2 + rnd() * 0.5,
  }));
})();

/** Pre-rendered radial glow sprite per color — fast additive glow. */
function makeSprite(color: string, size = 64): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.25, color + 'aa');
  grad.addColorStop(1, color + '00');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Themes the lobe colours (console hex → active palette) before the scene
 *  sees them, so every effect keyed on `data` re-runs when the theme flips. */
export function GBrainObservatory({ data }: { data: ObservatoryData }) {
  const palette = usePalette();
  const themed = useMemo(
    () => ({ ...data, clusters: data.clusters.map((c) => ({ ...c, color: palette.observatory[c.color] ?? c.color })) }),
    [data, palette],
  );
  return <GBrainObservatoryInner data={themed} />;
}

function GBrainObservatoryInner({ data }: { data: ObservatoryData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; label: string; cluster: number } | null>(null);
  const focusRef = useRef<number | null>(null);
  focusRef.current = focus;
  const { typed, answer, sources, phase, phaseRef, litRef, manual, inputProps, statusWord, showAnswer } =
    useGBrainThoughts(data);
  const graph = useMemo(() => buildGraph(data), [data]);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  // ——— main canvas engine ———
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data.mounted) return;
    const ctx = canvas.getContext('2d')!;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const GRAPH = graphRef.current;
    const sprites = data.clusters.map((c) => makeSprite(c.color));
    const coreSprite = makeSprite('#ffffff');
    // near-white hues clip first under additive blending — damp their glow
    const damp = data.clusters.map((c) => ({ '#d9e4fb': 0.55, '#8fb4f6': 0.8, '#ffe9c2': 0.55, '#ffd98f': 0.8 }[c.color] ?? 1));
    let w = 0;
    let h = 0;
    let raf = 0;
    const mouse = { x: 0, y: 0 };
    let zoomCur = 1;
    let camX = 0;
    let camY = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = (e.clientX - rect.left) / rect.width - 0.5;
      mouse.y = (e.clientY - rect.top) / rect.height - 0.5;
    };
    window.addEventListener('mousemove', onMove);

    // hover picking (page anchors only — cheap linear scan on move)
    const onCanvasMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let best: { d: number; n: Node; x: number; y: number } | null = null;
      for (const n of GRAPH.nodes) {
        if (!n.name) continue;
        const p = project(n);
        const d = Math.hypot(p.x - mx, p.y - my);
        if (d < 22 && (!best || d < best.d)) best = { d, n, x: p.x, y: p.y };
      }
      setHover(best ? { x: best.x, y: best.y, label: best.n.name!, cluster: best.n.cluster } : null);
    };
    canvas.addEventListener('mousemove', onCanvasMove);

    const scaleBase = () => Math.min(w, h) * 0.62;

    function project(n: Node) {
      const s = scaleBase() * zoomCur;
      const par = 26 * n.z; // parallax strength by depth
      return {
        x: w / 2 + camX + n.bx * s + mouse.x * par,
        y: h / 2 + camY + n.by * s * 1.02 + mouse.y * par,
      };
    }

    let t = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      const ph = phaseRef.current;

      // camera: slow breathing zoom; focused cluster pulls the camera + zoom
      const fc = focusRef.current;
      const zoomTarget = fc != null ? 1.32 : 1 + 0.035 * Math.sin(t * 0.11);
      zoomCur += (zoomTarget - zoomCur) * (1 - Math.exp(-dt * 2.2));
      let cxT = 0;
      let cyT = 0;
      if (fc != null) {
        // center of the focused cluster in layout space
        let sx = 0, sy = 0, n = 0;
        GRAPH.nodes.forEach((nd) => {
          if (nd.cluster === fc) {
            sx += nd.bx;
            sy += nd.by;
            n++;
          }
        });
        const s = scaleBase() * zoomCur;
        cxT = -(sx / n) * s;
        cyT = -(sy / n) * s * 1.02;
      }
      camX += (cxT - camX) * (1 - Math.exp(-dt * 2.2));
      camY += (cyT - camY) * (1 - Math.exp(-dt * 2.2));

      // ——— paint ———
      ctx.clearRect(0, 0, w, h);
      // vignette atmosphere
      const vg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.72);
      vg.addColorStop(0, 'rgba(28,26,48,0.55)');
      vg.addColorStop(0.55, 'rgba(12,12,20,0.25)');
      vg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

      const active = ph === 'retrieve' || ph === 'answer';
      const litClusters = active ? litRef.current : new Set<number>();

      // far-field dust (drawn first — everything else floats above it)
      const ds = scaleBase() * zoomCur;
      for (const d of DUST) {
        const tw = reduced ? 1 : 0.75 + 0.25 * Math.sin(t * d.speed + d.phase);
        ctx.fillStyle = `rgba(190,196,226,${(0.16 * tw).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(
          w / 2 + camX * 0.4 + d.bx * ds + mouse.x * 8 * d.z * 40,
          h / 2 + camY * 0.4 + d.by * ds + mouse.y * 8 * d.z * 40,
          d.r,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

      // links
      ctx.lineWidth = 1;
      for (const l of GRAPH.links) {
        const a = GRAPH.nodes[l.a];
        const b = GRAPH.nodes[l.b];
        const pa = project(a);
        const pb = project(b);
        const depth = (a.z + b.z) / 2;
        let alpha = (l.cross ? 0.1 : 0.09) * depth;
        const inFocus = fc == null || a.cluster === fc || b.cluster === fc;
        if (!inFocus) alpha *= 0.25;
        if (active && (litClusters.has(a.cluster) || litClusters.has(b.cluster))) alpha *= 1.9;
        ctx.strokeStyle = `rgba(158,168,214,${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1;

      // nodes (glow sprite + white core), depth-sorted feel via z-driven size
      for (let i = 0; i < GRAPH.nodes.length; i++) {
        const n = GRAPH.nodes[i];
        const p = project(n);
        const tw = reduced ? 1 : 1 + 0.05 * Math.sin(t * n.speed + n.phase);
        let r = n.r * (0.55 + n.z * 0.8) * tw;
        let glowA = 0.34 * n.z * damp[n.cluster];
        const dimmed = (fc != null && n.cluster !== fc) || (active && !litClusters.has(n.cluster));
        if (dimmed) glowA *= 0.3;
        if (active && litClusters.has(n.cluster)) {
          glowA = Math.min(0.85, glowA * 2.4);
          if (n.label) r *= 1.35;
        }
        const gs = r * 9;
        ctx.globalAlpha = glowA;
        ctx.drawImage(sprites[n.cluster], p.x - gs / 2, p.y - gs / 2, gs, gs);
        ctx.globalAlpha = Math.min(1, 0.5 + n.z * 0.6) * (dimmed ? 0.45 : 1);
        ctx.drawImage(coreSprite, p.x - r, p.y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      // hub labels
      ctx.font = '10.5px var(--font-mono), monospace';
      ctx.textBaseline = 'middle';
      for (const n of GRAPH.nodes) {
        if (!n.label) continue;
        const dimmed = (fc != null && n.cluster !== fc) || (active && !litClusters.has(n.cluster));
        if (dimmed) continue;
        const p = project(n);
        ctx.fillStyle = active && litClusters.has(n.cluster) ? 'rgba(240,240,250,0.95)' : 'rgba(170,176,205,0.6)';
        ctx.fillText(n.label, p.x + 9, p.y);
      }

      raf = requestAnimationFrame(frame);
    };

    if (reduced) {
      // one static frame
      last = performance.now();
      frame(last);
      cancelAnimationFrame(raf);
    } else {
      raf = requestAnimationFrame(frame);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mousemove', onCanvasMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.mounted]);

  return (
    <div className="gb-root relative h-full w-full overflow-hidden" style={{ background: 'var(--viz-stage)' }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* viewfinder corner brackets — the camera cue */}
      {(['lt', 'rt', 'lb', 'rb'] as const).map((c) => (
        <div key={c} className={`gb-corner gb-${c}`} aria-hidden />
      ))}

      {/* top-left — identity + status */}
      <div className="pointer-events-none absolute left-7 top-6">
        <div className="flex items-center gap-2.5">
          <span className={`dot ${data.mounted ? 'ok' : 'warn'}`} />
          <span className="text-[15px] font-medium tracking-[-0.01em] text-[#f0f0f6]">G-Brain</span>
          <span className="text-[12px] text-[#66666e]">knowledge core</span>
        </div>
        <div className="mt-1.5 font-mono text-[10.5px] leading-relaxed text-[#6d6d78]">{data.statusLine}</div>
      </div>

      {/* top-right — real store counters */}
      {data.mounted && (
        <div className="pointer-events-none absolute right-7 top-6 text-right">
          <div className="text-[26px] font-normal tabular-nums leading-none text-[#f0f0f6]">
            {data.totalChunks.toLocaleString()}
            <span className="ml-1.5 text-[12px] text-[#66666e]">chunks</span>
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-[#6d6d78]">
            {data.wikilinks.toLocaleString()} wikilinks
            {data.shownChunks < data.totalChunks ? ` · showing ${data.shownChunks.toLocaleString()}` : ''}
          </div>
        </div>
      )}

      {/* empty state — no store, no invented brain */}
      {!data.mounted && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-[14px] text-[#9a9aa3]">brain-store not mounted</div>
            <div className="mt-1.5 font-mono text-[11px] text-[#55555e]">
              expected at ~/knowledge/brain-store (or GBRAIN_STORE)
            </div>
          </div>
        </div>
      )}

      {/* left rail — real folders (clickable: focuses the cluster) */}
      <div className="absolute left-7 top-1/2 -translate-y-1/2">
        {data.clusters.map((c, i) => (
          <button
            key={c.key}
            onClick={() => setFocus(focus === i ? null : i)}
            className="group flex w-full items-center gap-2.5 rounded-[7px] px-2 py-[5px] text-left transition-colors hover:bg-white/[0.05]"
            style={{ opacity: focus === null || focus === i ? 1 : 0.35 }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: c.color, boxShadow: `0 0 8px ${c.color}88` }} />
            <span className={`text-[12px] ${focus === i ? 'text-[#f0f0f6]' : 'text-[#9a9aa3]'}`}>{c.name}</span>
            <span className="ml-auto font-mono text-[10.5px] tabular-nums text-[#5c5c66]">{c.pages}</span>
          </button>
        ))}
        {focus !== null && (
          <button
            onClick={() => setFocus(null)}
            className="mt-2 w-full rounded-[7px] px-2 py-[4px] text-left text-[11px] text-[#66666e] transition-colors hover:bg-white/[0.05] hover:text-[#9a9aa3]"
          >
            ← whole brain
          </button>
        )}
      </div>

      {/* hover tooltip on page nodes */}
      {hover && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 rounded-[8px] border px-2.5 py-1.5 font-mono text-[10.5px]"
          style={{
            left: hover.x,
            top: hover.y - 34,
            background: 'var(--viz-hud-3)',
            borderColor: data.clusters[hover.cluster].color + '55',
            color: '#d5d5e0',
          }}
        >
          {hover.label}
        </div>
      )}

      {/* the answer card — real retrieval results */}
      <div
        className="absolute bottom-[118px] right-7 w-[360px] rounded-[12px] border p-4 transition-all duration-500"
        style={{
          background: 'var(--viz-hud)',
          borderColor: showAnswer ? 'rgba(122,107,239,0.5)' : 'rgba(255,255,255,0.06)',
          boxShadow: showAnswer ? '0 0 40px rgba(102,86,227,0.18), 0 16px 48px rgba(0,0,0,0.5)' : 'none',
          opacity: showAnswer ? 1 : 0,
          transform: showAnswer ? 'translateY(0)' : 'translateY(10px)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="dot ok" />
          <span className="text-[11px] text-[#8a8a95]">
            {sources.length > 0 ? `retrieved from ${sources.length} notes` : 'retrieval'}
          </span>
        </div>
        <p className="text-[13px] leading-relaxed text-[#e8e8f0]">{answer}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {sources.map((s) => (
            <span key={s} className="rounded-[6px] border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9.5px] text-[#9a9aa3]">
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* the prompt bar — a real input; focus stops auto, Enter queries the brain */}
      <div className="absolute bottom-[64px] left-1/2 w-[520px] max-w-[80vw] -translate-x-1/2">
        <div
          className="flex items-center gap-3 rounded-[12px] border px-4 py-3 transition-all duration-300"
          style={{
            background: 'var(--viz-hud-2)',
            borderColor: phase === 'typing' || phase === 'scan' ? 'rgba(122,107,239,0.55)' : 'rgba(255,255,255,0.08)',
            boxShadow: phase === 'typing' || phase === 'scan' ? '0 0 32px rgba(102,86,227,0.22)' : '0 8px 30px rgba(0,0,0,0.4)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <span className="font-mono text-[12.5px] text-[#7a6bef]">g-brain ›</span>
          <input
            {...inputProps}
            disabled={!data.mounted}
            placeholder={data.mounted ? '' : 'brain-store not mounted'}
            spellCheck={false}
            className="min-h-[18px] flex-1 border-0 bg-transparent font-mono text-[12.5px] text-[#e8e8f0] caret-[#7a6bef] outline-none placeholder:text-[#55555e]"
          />
          <span className="font-mono text-[10px] text-[#55555e]">{statusWord}</span>
        </div>
      </div>

      {/* honesty note, unobtrusive */}
      <div className="pointer-events-none absolute bottom-2 right-7 font-mono text-[9px] text-[#3d3d46]">
        {manual ? 'live retrieval' : 'auto queries · live retrieval'}
      </div>

      <style>{`
        .gb-corner { position: absolute; width: 22px; height: 22px; border-color: rgba(255,255,255,0.14); border-style: solid; border-width: 0; }
        .gb-lt { left: 14px; top: 14px; border-left-width: 1px; border-top-width: 1px; }
        .gb-rt { right: 14px; top: 14px; border-right-width: 1px; border-top-width: 1px; }
        .gb-lb { left: 14px; bottom: 14px; border-left-width: 1px; border-bottom-width: 1px; }
        .gb-rb { right: 14px; bottom: 14px; border-right-width: 1px; border-bottom-width: 1px; }
      `}</style>
    </div>
  );
}
