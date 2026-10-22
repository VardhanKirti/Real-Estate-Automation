'use client';

import { usePalette } from '@/lib/use-palette';

/**
 * G-Brain Core — 3D variant of the filmed knowledge core (variant 2;
 * variant 1, the flat constellation, is saved at /design/gbrain).
 *
 * The brain is a rotating volumetric core: the brain-store's REAL folders as
 * lobes on a sphere, its real pages as anchor dots (their embedded chunks
 * orbiting them), resolved wikilinks as cross-lobe fibres. True perspective
 * projection, drag-to-orbit with inertia. The prompt bar runs REAL queries
 * through GET /api/brain — during a thought the core rotates itself so the
 * lobes the answer actually came from face the camera. Same honesty rules as
 * variant 1: no fake metrics, no decorative pulses.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ObservatoryData } from '@/lib/gbrain-observatory';
import { useGBrainThoughts } from '@/components/gbrain-live';

type Node3 = {
  cluster: number;
  x: number;
  y: number;
  z: number;
  r: number;
  phase: number;
  speed: number;
  label?: string;
};
type Link3 = { a: number; b: number; cross: boolean };

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gaussian-ish via sum of uniforms. */
function gauss(rnd: () => number) {
  return (rnd() + rnd() + rnd() - 1.5) / 1.5;
}

const LATS = [0.18, -0.22, 0.3, -0.05, 0.05, -0.35, 0.28, 0.12];

/** Real folders as lobes on a sphere; pages and their chunks as 3D blobs. */
function buildBrain(data: ObservatoryData) {
  const rnd = mulberry32(4100);
  const nodes: Node3[] = [];
  const links: Link3[] = [];
  const centers: { x: number; y: number; z: number }[] = [];
  const anchorOf: number[] = new Array(data.notes.length).fill(-1);
  data.clusters.forEach((c, ci) => {
    const th = (ci / data.clusters.length) * Math.PI * 2;
    const lat = LATS[ci % LATS.length];
    const R = 1.18;
    const cx = Math.cos(th) * Math.cos(lat) * R;
    const cy = Math.sin(lat) * R * 0.9;
    const cz = Math.sin(th) * Math.cos(lat) * R;
    centers.push({ x: cx, y: cy, z: cz });
    const members = data.notes.map((n, idx) => ({ n, idx })).filter((x) => x.n.c === ci);
    for (const m of members) {
      const spread = m.n.hub ? 0.09 : 0.24;
      const ax = (cx + gauss(rnd) * spread) * 1.12;
      const ay = (cy + gauss(rnd) * spread * 0.82) * 0.88;
      const az = (cz + gauss(rnd) * spread) * 1.0;
      const anchor = nodes.length;
      anchorOf[m.idx] = anchor;
      nodes.push({
        cluster: ci,
        // brain-shaped: wider than tall, slightly flattened front-back
        x: ax,
        y: ay,
        z: az,
        r: m.n.hub ? 3.6 + rnd() * 1.1 : 1.7 + rnd() * 0.8,
        phase: rnd() * Math.PI * 2,
        speed: 0.4 + rnd() * 1.0,
        label: m.n.hub ? m.n.t : undefined,
      });
      // chunk dots — the page's embedded pieces, tight around their page
      for (let k = 1; k < m.n.k; k++) {
        nodes.push({
          cluster: ci,
          x: ax + gauss(rnd) * 0.06,
          y: ay + gauss(rnd) * 0.05,
          z: az + gauss(rnd) * 0.06,
          r: 0.9 + rnd() * 1.2,
          phase: rnd() * Math.PI * 2,
          speed: 0.4 + rnd() * 1.0,
        });
        links.push({ a: nodes.length - 1, b: anchor, cross: false });
      }
    }
  });
  // real wikilinks between pages
  for (const [i, j] of data.links) {
    const a = anchorOf[i];
    const b = anchorOf[j];
    if (a < 0 || b < 0) continue;
    links.push({ a, b, cross: nodes[a].cluster !== nodes[b].cluster });
  }
  return { nodes, links, centers };
}

const DUST = (() => {
  const rnd = mulberry32(910);
  return Array.from({ length: 110 }, () => ({
    sx: rnd(), // static screen-fraction position
    sy: rnd(),
    r: 0.4 + rnd() * 0.9,
    a: 0.05 + rnd() * 0.12,
  }));
})();

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
export function GBrainCore3D({ data }: { data: ObservatoryData }) {
  const palette = usePalette();
  const themed = useMemo(
    () => ({ ...data, clusters: data.clusters.map((c) => ({ ...c, color: palette.observatory[c.color] ?? c.color })) }),
    [data, palette],
  );
  return <GBrainCore3DInner data={themed} />;
}

function GBrainCore3DInner({ data }: { data: ObservatoryData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const focusRef = useRef<number | null>(null);
  focusRef.current = focus;
  const { typed, answer, sources, phase, phaseRef, litRef, primaryRef, manual, inputProps, statusWord, showAnswer } =
    useGBrainThoughts(data);
  const brain = useMemo(() => buildBrain(data), [data]);
  const brainRef = useRef(brain);
  brainRef.current = brain;

  // ——— 3D engine ———
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data.mounted) return;
    const ctx = canvas.getContext('2d')!;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const BRAIN = brainRef.current;
    const sprites = data.clusters.map((c) => makeSprite(c.color));
    const coreSprite = makeSprite('#ffffff');
    // additive-blend exposure per lobe — near-white hues clip first in 3D depth stacks
    const damp = data.clusters.map((c) => ({ '#d9e4fb': 0.55, '#8fb4f6': 0.8, '#f2b33d': 0.95, '#ffe9c2': 0.55, '#ffd98f': 0.8 }[c.color] ?? 1));
    let w = 0;
    let h = 0;
    let raf = 0;

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

    // orbit state — auto-rotation, drag with inertia, thought-driven easing
    let yaw = 0.6;
    let pitch = -0.12;
    let yawVel = 0;
    let pitchVel = 0;
    let dragging = false;
    let lastDragAt = 0;
    let lastX = 0;
    let lastY = 0;
    let zoomCur = 1;

    const down = (e: MouseEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      lastDragAt = performance.now();
    };
    const move = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      yawVel = dx * 0.004;
      pitchVel = dy * 0.003;
      yaw += yawVel;
      pitch += pitchVel;
      lastDragAt = performance.now();
    };
    const up = () => {
      dragging = false;
      lastDragAt = performance.now();
    };
    canvas.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);

    const F = 3.1; // perspective strength (in brain radii)

    /** Rotate + project a brain-space point to screen. */
    const project = (x: number, y: number, z: number, S: number) => {
      const cy0 = Math.cos(yaw);
      const sy0 = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const x1 = x * cy0 - z * sy0;
      const z1 = x * sy0 + z * cy0;
      const y2 = y * cp - z1 * sp;
      const z2 = y * sp + z1 * cp;
      const persp = F / (F + z2);
      return { x: w / 2 + x1 * S * persp, y: h / 2 + y2 * S * persp, d: z2, k: persp };
    };

    /** Yaw that brings a lobe center to face the camera. */
    const facingYaw = (ci: number) => {
      const c = BRAIN.centers[ci];
      return Math.atan2(-c.x, -c.z);
    };
    const easeAngle = (cur: number, target: number, f: number) => {
      let d = target - cur;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return cur + d * f;
    };

    let t = 0;
    let last = performance.now();
    const order = BRAIN.nodes.map((_, i) => i);
    const depth = new Float32Array(BRAIN.nodes.length);
    const px = new Float32Array(BRAIN.nodes.length);
    const py = new Float32Array(BRAIN.nodes.length);
    const pk = new Float32Array(BRAIN.nodes.length);

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      const ph = phaseRef.current;
      const fc = focusRef.current;
      const active = ph === 'retrieve' || ph === 'answer';
      const litClusters = active ? litRef.current : new Set<number>();
      const primary = active ? primaryRef.current : null;

      // camera: drag wins; focus/thought steer; otherwise slow auto-orbit
      const idleFor = (performance.now() - lastDragAt) / 1000;
      if (!dragging) {
        yaw += yawVel;
        pitch += pitchVel;
        yawVel *= 0.94;
        pitchVel *= 0.94;
        if (fc != null) {
          yaw = easeAngle(yaw, facingYaw(fc), 1 - Math.exp(-dt * 2.4));
          pitch += (-0.1 - pitch) * (1 - Math.exp(-dt * 2.4));
        } else if (primary != null) {
          yaw = easeAngle(yaw, facingYaw(primary), 1 - Math.exp(-dt * 1.6));
        } else if (idleFor > 2.5 && !reduced) {
          yaw += dt * 0.07;
          pitch += (-0.12 + 0.05 * Math.sin(t * 0.13) - pitch) * (1 - Math.exp(-dt * 0.8));
        }
      }
      pitch = Math.max(-0.9, Math.min(0.9, pitch));
      const zoomTarget = fc != null ? 1.22 : active ? 1.08 : 1;
      zoomCur += (zoomTarget - zoomCur) * (1 - Math.exp(-dt * 2.0));

      const S = Math.min(w, h) * 0.295 * zoomCur;

      // ——— paint ———
      ctx.clearRect(0, 0, w, h);
      const vg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      vg.addColorStop(0, 'rgba(26,24,46,0.5)');
      vg.addColorStop(0.6, 'rgba(10,10,18,0.2)');
      vg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

      // static far dust
      for (const d of DUST) {
        ctx.fillStyle = `rgba(190,196,226,${d.a})`;
        ctx.beginPath();
        ctx.arc(d.sx * w, d.sy * h, d.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // project all nodes once
      for (let i = 0; i < BRAIN.nodes.length; i++) {
        const n = BRAIN.nodes[i];
        const p = project(n.x, n.y, n.z, S);
        px[i] = p.x;
        py[i] = p.y;
        pk[i] = p.k;
        depth[i] = p.d;
      }

      // links — depth-faded
      ctx.lineWidth = 1;
      for (const l of BRAIN.links) {
        const a = BRAIN.nodes[l.a];
        const b = BRAIN.nodes[l.b];
        const dAvg = (depth[l.a] + depth[l.b]) / 2; // -1 front … +1 back
        let alpha = (l.cross ? 0.09 : 0.085) * (0.85 - dAvg * 0.5);
        if (alpha <= 0.008) continue;
        const inFocus = fc == null || a.cluster === fc || b.cluster === fc;
        if (!inFocus) alpha *= 0.22;
        if (active && (litClusters.has(a.cluster) || litClusters.has(b.cluster))) alpha *= 1.9;
        ctx.strokeStyle = `rgba(158,168,214,${Math.max(0, alpha).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(px[l.a], py[l.a]);
        ctx.lineTo(px[l.b], py[l.b]);
        ctx.stroke();
      }

      // nodes back-to-front
      order.sort((a, b) => depth[b] - depth[a]);
      ctx.globalCompositeOperation = 'lighter';
      for (const i of order) {
        const n = BRAIN.nodes[i];
        const k = pk[i];
        const front = 0.55 + (1 - (depth[i] + 1) / 2) * 0.7; // brightness by depth
        const tw = reduced ? 1 : 1 + 0.05 * Math.sin(t * n.speed + n.phase);
        let r = n.r * Math.min(k, 1.45) * tw;
        let glowA = 0.2 * front * damp[n.cluster];
        const dimmed = (fc != null && n.cluster !== fc) || (active && !litClusters.has(n.cluster));
        if (dimmed) glowA *= 0.28;
        if (active && litClusters.has(n.cluster)) {
          glowA = Math.min(0.5, glowA * 2.1);
          if (n.label) r *= 1.3;
        }
        const gs = r * 6.5;
        ctx.globalAlpha = glowA;
        ctx.drawImage(sprites[n.cluster], px[i] - gs / 2, py[i] - gs / 2, gs, gs);
        ctx.globalAlpha = Math.min(1, 0.38 + front * 0.5) * (dimmed ? 0.4 : 1);
        ctx.drawImage(coreSprite, px[i] - r, py[i] - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      // hub labels — front hemisphere only, billboarded
      ctx.font = '10.5px var(--font-mono), monospace';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < BRAIN.nodes.length; i++) {
        const n = BRAIN.nodes[i];
        if (!n.label || depth[i] > 0.15) continue;
        const dimmed = (fc != null && n.cluster !== fc) || (active && !litClusters.has(n.cluster));
        if (dimmed) continue;
        ctx.fillStyle = active && litClusters.has(n.cluster) ? 'rgba(240,240,250,0.95)' : 'rgba(170,176,205,0.55)';
        ctx.fillText(n.label, px[i] + 9, py[i]);
      }

      raf = requestAnimationFrame(frame);
    };

    if (reduced) {
      last = performance.now();
      frame(last);
      cancelAnimationFrame(raf);
    } else {
      raf = requestAnimationFrame(frame);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('mousedown', down);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.mounted]);

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: 'var(--viz-stage)' }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing" />

      {(['lt', 'rt', 'lb', 'rb'] as const).map((c) => (
        <div key={c} className={`gb-corner gb-${c}`} aria-hidden />
      ))}

      <div className="pointer-events-none absolute left-7 top-6">
        <div className="flex items-center gap-2.5">
          <span className={`dot ${data.mounted ? 'ok' : 'warn'}`} />
          <span className="text-[15px] font-medium tracking-[-0.01em] text-[#f0f0f6]">G-Brain</span>
          <span className="text-[12px] text-[#66666e]">knowledge core · 3D</span>
        </div>
        <div className="mt-1.5 font-mono text-[10.5px] leading-relaxed text-[#6d6d78]">{data.statusLine}</div>
      </div>

      {data.mounted && (
        <div className="pointer-events-none absolute right-7 top-6 text-right">
          <div className="text-[26px] font-normal tabular-nums leading-none text-[#f0f0f6]">
            {data.totalChunks.toLocaleString()}
            <span className="ml-1.5 text-[12px] text-[#66666e]">chunks</span>
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-[#6d6d78]">
            {data.wikilinks.toLocaleString()} wikilinks
            {data.shownChunks < data.totalChunks ? ` · showing ${data.shownChunks.toLocaleString()}` : ''} · drag to orbit
          </div>
        </div>
      )}

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
