import { describe, expect, test } from 'vitest';
import { leafPositions } from '@/components/SkillHierarchy';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('leafPositions — a busy group never piles its leaves on top of each other', () => {
  for (const count of [1, 3, 6, 15, 24, 40]) {
    test(`${count} leaves: one position each, all apart, all near the group`, () => {
      const pts = leafPositions(count, Math.PI / 4, 100, 50);
      expect(pts).toHaveLength(count);
      for (let i = 0; i < pts.length; i++) {
        expect(dist(pts[i], { x: 100, y: 50 })).toBeLessThanOrEqual(260);
        for (let j = i + 1; j < pts.length; j++) expect(dist(pts[i], pts[j]), `${i}↔${j}`).toBeGreaterThanOrEqual(24);
      }
    });
  }
  test('deterministic and empty-safe', () => {
    expect(leafPositions(0, 0, 0, 0)).toEqual([]);
    expect(leafPositions(7, 1, 2, 3)).toEqual(leafPositions(7, 1, 2, 3));
  });
});

describe('leafPositions bloom — an open group reads as one labelled arc', () => {
  for (const count of [1, 6, 15, 40]) {
    test(`${count} leaves: one arc, ≥16 units of arc per label, compact extent`, () => {
      const g = { x: 100, y: 50 };
      const pts = leafPositions(count, Math.PI / 4, g.x, g.y, 'bloom');
      expect(pts).toHaveLength(count);
      // unsquash y to check the geometry on the true circle
      const angs = pts.map((p) => Math.atan2((p.y - g.y) / 0.82, p.x - g.x));
      const radii = pts.map((p) => Math.hypot((p.y - g.y) / 0.82, p.x - g.x));
      for (const r of radii) expect(Math.abs(r - radii[0])).toBeLessThan(0.01);
      for (let i = 1; i < angs.length; i++) expect((angs[i] - angs[i - 1]) * radii[0]).toBeGreaterThanOrEqual(15.9);
      expect(radii[0]).toBeLessThanOrEqual(300);
    });
  }
});
