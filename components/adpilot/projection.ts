/**
 * Orthographic globe projection for the AdPilot globe (SPEC S11 §7). Pure,
 * so the maths is unit-tested in node (tests/adpilot-globe.test.ts).
 *
 * Adapted from FounderOS-DEMO (github.com/Bennettxai/FounderOS-DEMO)
 * components/adpilot/Globe.tsx @ 3397780, MIT License, Copyright (c) 2026
 * FounderOS: `latLngToVec` and `rotate` are its functions; the rest is ours.
 */

export type Vec = { x: number; y: number; z: number };

/** Pitch limits for drag, keyboard and focus tweens (radians). */
export const PITCH_LIMIT = 0.9;

/** Bad sync data must never throw: lat is clamped to ±90, lng wraps (S11 §8 edge 10). */
export function normaliseLatLng(lat: number, lng: number): { lat: number; lng: number } {
  const la = Number.isFinite(lat) ? Math.max(-90, Math.min(90, lat)) : 0;
  const ln = Number.isFinite(lng) ? ((((lng + 180) % 360) + 360) % 360) - 180 : 0;
  return { lat: la, lng: ln };
}

/** Unit vector on the sphere: +y north, +z toward the viewer at yaw 0 (lng −90 faces the viewer). */
export function latLngToVec(lat: number, lng: number): Vec {
  const n = normaliseLatLng(lat, lng);
  const phi = (n.lat * Math.PI) / 180;
  const lambda = (n.lng * Math.PI) / 180;
  return { x: Math.cos(phi) * Math.cos(lambda), y: Math.sin(phi), z: -Math.cos(phi) * Math.sin(lambda) };
}

/** Rotate about Y (yaw) then about X (pitch). */
export function rotate(v: Vec, yaw: number, pitch: number): Vec {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = v.x * cy + v.z * sy;
  const z1 = -v.x * sy + v.z * cy;
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);
  const y2 = v.y * cx - z1 * sx;
  const z2 = v.y * sx + z1 * cx;
  return { x: x1, y: y2, z: z2 };
}

/** Screen position of a rotated vector; `visible` is the front hemisphere (z > 0). */
export function project(v: Vec, cx: number, cy: number, R: number): { x: number; y: number; visible: boolean } {
  return { x: cx + v.x * R, y: cy - v.y * R, visible: v.z > 0 };
}

/** Planet radius for a canvas: Bennett's 0.36 of the shorter side, never under 110px (S11 §8 edge 7). */
export function planetRadius(w: number, h: number): number {
  return Math.max(110, Math.min(w, h) * 0.36);
}

/**
 * Yaw and pitch that bring a lat/lng to the centre of the disc. Pitch is the
 * latitude itself, clamped to ±PITCH_LIMIT, so a city above ~51.6° lands just
 * below centre instead of tipping the globe over.
 */
export function centreOn(lat: number, lng: number): { yaw: number; pitch: number } {
  const v = latLngToVec(lat, lng);
  const yaw = Math.atan2(-v.x, v.z);
  const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, Math.atan2(v.y, Math.hypot(v.x, v.z))));
  return { yaw, pitch };
}

/** The target yaw closest to `from` (so a tween never takes the long way round). */
export function nearestYaw(from: number, to: number): number {
  const d = (((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  return from + d;
}

/** Great-circle angle between two lat/lng points, radians. */
export function angleBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const u = latLngToVec(a.lat, a.lng);
  const v = latLngToVec(b.lat, b.lng);
  const dot = Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y + u.z * v.z));
  return Math.acos(dot);
}

/** The focus tween's ease (S11 §5.3 names cubic-bezier(.2,.7,.2,1)); an ease-out cubic is close enough. */
export function easeOut(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - c, 3);
}
