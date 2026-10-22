'use client';
/**
 * The small 3D canvas engine both Lab network graphs share: the Today card's creator network
 * (HeroGraphs.tsx) and the full-page Creatorverse (Creatorverse.tsx). Layouts are computed on the server;
 * this only resolves theme colours, sizes the canvas for the device, and projects stored unit-sphere
 * coordinates through a turning, zooming camera with a little perspective. No colour lives here: every
 * colour is a CSS token read through a probe element, so each theme and accent paints in its own ink.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** `glow` is the blur scale: full on a dark ground (light ink), small on a light one, where a dark halo reads as a smudge. */
export type Ink = { ink: string; paper: string; font: string; glow: number };

/** Resolve CSS colour tokens (color-mix and var() included) to canvas-ready strings through one probe element. */
export function resolveColours(el: HTMLElement, tokens: readonly string[]): Record<string, string> {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
  el.appendChild(probe);
  const out: Record<string, string> = {};
  for (const t of tokens) {
    probe.style.color = `var(${t})`;
    out[t] = getComputedStyle(probe).color;
  }
  probe.remove();
  return out;
}

/** Relative luminance (0..1) of a computed colour string, for the glow scale. */
export function lumOf(colour: string): number {
  const nums = (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const scale = /^color\(/.test(colour) ? 1 : 255;
  return nums.length === 3 ? (0.2126 * nums[0] + 0.7152 * nums[1] + 0.0722 * nums[2]) / scale : 1;
}

/** Ink and paper from two tokens (the Today card reads its narrative pair). */
export function readInk(el: HTMLElement, inkVar = '--lab-narr-ink', paperVar = '--lab-narr-paper'): Ink {
  const probe = document.createElement('span');
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;color:var(${inkVar});background-color:var(${paperVar})`;
  el.appendChild(probe);
  const cs = getComputedStyle(probe);
  const ink = cs.color;
  const paper = cs.backgroundColor;
  const font = cs.fontFamily;
  probe.remove();
  return { ink, paper, font, glow: lumOf(ink) > 0.5 ? 1 : 0.25 };
}

/** A canvas that tracks its wrapper's size; `ctx()` returns a cleared, DPR-scaled context (null before layout). */
export function useCanvas(maxDpr = 2) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const set = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const ctx = useCallback(() => {
    const c = canvas.current;
    if (!c || !size.w) return null;
    const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
    if (c.width !== Math.round(size.w * dpr) || c.height !== Math.round(size.h * dpr)) {
      c.width = Math.round(size.w * dpr);
      c.height = Math.round(size.h * dpr);
    }
    const g = c.getContext('2d');
    if (!g) return null;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    return g;
  }, [size.w, size.h, maxDpr]);
  return { wrap, canvas, size, ctx };
}

export const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Theme, accent or mode flips re-read the ink. */
export const THEME_ATTRS = ['data-theme', 'data-mode', 'data-accent', 'data-ui', 'class', 'style'];

/** A filled label pill with knocked-out text, kept inside the canvas. */
export function pill(g: CanvasRenderingContext2D, ink: Ink, text: string, x: number, y: number, w: number, h: number) {
  g.font = `600 12px ${ink.font}`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  const tw = g.measureText(text).width;
  const pw = tw + 14;
  const px = Math.max(4, Math.min(w - pw - 4, x - pw / 2));
  const py = Math.max(4, Math.min(h - 26, y));
  g.save();
  g.globalAlpha = 0.92;
  g.fillStyle = ink.ink;
  g.beginPath();
  g.roundRect(px, py, pw, 22, 11);
  g.fill();
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'destination-out';
  g.fillText(text, px + 7, py + 15);
  g.restore();
}

/** Camera: turn (yaw, pitch), screen zoom, and the point it looks at (tx, ty, tz in layout units). */
export type Camera = { yaw: number; pitch: number; zoom: number; tx: number; ty: number; tz: number };
/** A projected point: screen x and y, perspective scale k, depth 0 (back) to 1 (front). */
export type Projected = { x: number; y: number; k: number; d: number };

/** Camera distance in layout units: enough perspective to read as 3D, never enough to distort. */
export const DIST = 3.2;

/** Project one layout point. `R` is the screen radius of the unit sphere at zoom 1. */
export function project(p: { x: number; y: number; z: number }, cam: Camera, cx: number, cy: number, R: number): Projected {
  const X = p.x - cam.tx, Y = p.y - cam.ty, Z = p.z - cam.tz;
  const cyw = Math.cos(cam.yaw), syw = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const x1 = X * cyw + Z * syw;
  const z1 = -X * syw + Z * cyw;
  const y2 = Y * cp - z1 * sp;
  const z2 = Y * sp + z1 * cp;
  const k = DIST / Math.max(0.6, DIST - z2);
  const d = Math.max(0, Math.min(1, (z2 + 1) / 2));
  return { x: cx + x1 * R * cam.zoom * k, y: cy + y2 * R * cam.zoom * k, k, d };
}
