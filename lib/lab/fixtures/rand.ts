/**
 * Named random streams for the v2 fixture layers (08.7.2): each concern draws from its own
 * stream, so rewriting text in text.ts changes no number. stream(name) is a mulberry32 seeded by
 * hashSeed(`${FIXTURE_SEED}:${name}`). The v1 world (world.ts) keeps its own single seed.
 */
export const FIXTURE_SEED = 20261011;

/** FNV-1a 32-bit. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Stream = {
  next(): number;
  int(lo: number, hi: number): number;
  between(lo: number, hi: number): number;
  chance(p: number): boolean;
  pick<T>(xs: readonly T[]): T;
  normal(): number;
};

export function stream(name: string): Stream {
  let a = hashSeed(`${FIXTURE_SEED}:${name}`);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    between: (lo, hi) => lo + next() * (hi - lo),
    chance: (p) => next() < p,
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    normal: () => {
      const u = Math.max(1e-9, next());
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}
