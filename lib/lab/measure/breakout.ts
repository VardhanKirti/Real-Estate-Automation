/**
 * The v2 breakout rule (04 3.7), the cold-start growth offsets (3.3) and Dual-High (3.11). Pure.
 * This module imports nothing from lib/lab/measures.ts (that file re-exports from here).
 */
import type { LabConfidence, LabPlatform } from '@/lib/schemas';
import type { Surface } from '@/lib/lab/measure/baseline';

export const BREAKOUT_RATIO = 3;
export const BREAKOUT_Z = 2;
export const BREAKOUT_MIN_AGE_H = 24;
/** Dual-High needs this many tracked posts in the niche cell (3.11). */
export const NICHE_MIN_N = 20;
/** The projected route needs this many posts with both values for c(a) (3.3). */
export const OFFSET_MIN_N = 20;

/** high n >= 30; ok n >= 10, or n 5 to 9 with a fitted (OLS, 8+ cells) prior; low otherwise. */
export function baselineConfidence(n: number, hasPrior = false): LabConfidence {
  if (n >= 30) return 'high';
  if (n >= 10) return 'ok';
  if (n >= 5 && hasPrior) return 'ok';
  return 'low';
}

/** ratio >= 3 && z >= 2 && confidence !== 'low' && judgedAgeH !== null && judgedAgeH >= 24 */
export function isBreakoutV2(m: { ratio: number | null; z: number | null; confidence: LabConfidence; judgedAgeH: number | null }): boolean {
  return m.ratio !== null && m.ratio >= BREAKOUT_RATIO && m.z !== null && m.z >= BREAKOUT_Z && m.confidence !== 'low' && m.judgedAgeH !== null && m.judgedAgeH >= BREAKOUT_MIN_AGE_H;
}

/** Both the creator ratio and the niche ratio at 3 or more (04 3.11). */
export function isDualHigh(creatorRatio: number | null, nicheRatio: number | null): boolean {
  return creatorRatio !== null && nicheRatio !== null && creatorRatio >= 3 && nicheRatio >= 3;
}

const medianOf = (xs: readonly number[]): number => {
  const v = [...xs].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

/** Raw median of tracked posts' basis on one platform x surface at one age, last 90 days; null under n 20. */
export function nicheBaseline(competitorValues: readonly number[]): { median: number; n: number } | null {
  const xs = competitorValues.filter((x) => Number.isFinite(x));
  if (xs.length < NICHE_MIN_N) return null;
  return { median: medianOf(xs), n: xs.length };
}

export type GrowthOffset = { platform: LabPlatform; surface: Surface; ageH: number; c: number; sd: number; n: number };

/**
 * c(a) = median over posts of (y_mature - y_a) per platform x surface x age, with sd = 1.4826 x MAD
 * of those differences. `ages` maps age in hours to y; `matureH` is read from the row (X 48, else 336).
 */
export function growthOffsets(rows: readonly { platform: LabPlatform; surface: Surface; ages: Record<number, number>; matureH?: number }[]): GrowthOffset[] {
  const groups = new Map<string, { platform: LabPlatform; surface: Surface; ageH: number; d: number[] }>();
  for (const r of rows) {
    const matureH = r.matureH ?? (r.platform === 'twitter' ? 48 : 336);
    const ym = r.ages[matureH];
    if (ym === undefined || !Number.isFinite(ym)) continue;
    for (const [k, y] of Object.entries(r.ages)) {
      const a = Number(k);
      if (a === matureH || !Number.isFinite(y)) continue;
      const key = `${r.platform}|${r.surface}|${a}`;
      const g = groups.get(key) ?? { platform: r.platform, surface: r.surface, ageH: a, d: [] };
      g.d.push(ym - y);
      groups.set(key, g);
    }
  }
  return [...groups.values()].map((g) => {
    const c = medianOf(g.d);
    return { platform: g.platform, surface: g.surface, ageH: g.ageH, c, sd: 1.4826 * medianOf(g.d.map((x) => Math.abs(x - c))), n: g.d.length };
  });
}
