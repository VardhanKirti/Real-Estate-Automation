import { describe, it, expect } from 'vitest';
import { computeClusterTarget } from '@/components/SkillHierarchy';

describe('computeClusterTarget — deep-zoom framing math', () => {
  it('returns null for an empty cluster', () => {
    expect(computeClusterTarget([])).toBeNull();
  });

  it('centers the camera on the bbox midpoint', () => {
    const t = computeClusterTarget([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 50 },
    ]);
    expect(t).not.toBeNull();
    if (!t) return;
    // tx = -s*cx, ty = -s*cy for a bbox centered at (50, 25)
    expect(t.x).toBeCloseTo(-50 * t.s, 5);
    expect(t.y).toBeCloseTo(-25 * t.s, 5);
  });

  it('never zooms out past the standing overview (scale >= 1)', () => {
    // a cluster far wider than the frame itself
    const t = computeClusterTarget([
      { x: -2000, y: 0 },
      { x: 2000, y: 0 },
    ]);
    expect(t).not.toBeNull();
    expect(t!.s).toBeGreaterThanOrEqual(1);
  });

  it('caps the scale so a single tight point does not zoom in infinitely', () => {
    const t = computeClusterTarget([{ x: 10, y: 10 }]);
    expect(t).not.toBeNull();
    expect(t!.s).toBeLessThanOrEqual(4.2);
  });

  it('zooms in tighter for a smaller cluster than a larger one', () => {
    const small = computeClusterTarget([
      { x: -10, y: -10 },
      { x: 10, y: 10 },
    ]);
    const large = computeClusterTarget([
      { x: -300, y: -150 },
      { x: 300, y: 150 },
    ]);
    expect(small).not.toBeNull();
    expect(large).not.toBeNull();
    expect(small!.s).toBeGreaterThan(large!.s);
  });

  it('is a pure function — same input, same output', () => {
    const pts = [
      { x: 12, y: -8 },
      { x: -30, y: 44 },
      { x: 5, y: 5 },
    ];
    expect(computeClusterTarget(pts)).toEqual(computeClusterTarget(pts));
  });
});
