import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eventMs, orderedEvents, placeEvents } from '@/lib/timeline-place';

const NOW = Date.parse('2026-10-08T12:00:00.000Z');
const H = 3600_000;
const D = 24 * H;
const ev = (id: string, ageMs: number, lane = 1, status = 'sent') => ({ id, at: new Date(NOW - ageMs).toISOString(), lane, status });

describe('placeEvents (SPEC X4: moved from the Creative Engine placeRuns)', () => {
  test('x is linear in time between the gutters', () => {
    const p = placeEvents([ev('a', 0), ev('b', 12 * H), ev('c', 24 * H)], D, 600, NOW, { padLeft: 84, padRight: 52 });
    expect(p.xOf.a).toBeCloseTo(548);
    expect(p.xOf.c).toBeCloseTo(84);
    expect(p.xOf.b).toBeCloseTo((84 + 548) / 2);
  });

  test('events older than the window are counted, not drawn', () => {
    const p = placeEvents([ev('old', 8 * D), ev('new', H)], 7 * D, 600, NOW);
    expect(p.earlier).toBe(1);
    expect(p.items.map((i) => i.id)).toEqual(['new']);
  });

  test('close events in one lane cluster; other lanes stay apart', () => {
    const p = placeEvents([ev('a', H), ev('b', H + 60_000), ev('c', H + 30_000, 2)], D, 600, NOW);
    expect(p.clusters).toHaveLength(1);
    expect(p.clusters[0].runIds.sort()).toEqual(['a', 'b']);
    expect(p.dots.map((d) => d.id)).toEqual(['c']);
  });

  test('any lane number works and output stays in time order', () => {
    const p = placeEvents([ev('x', 3 * H, 5), ev('y', 2 * H, 0), ev('z', H, 3)], D, 600, NOW);
    expect(p.items.map((i) => i.id)).toEqual(['x', 'y', 'z']);
  });

  test('epoch ms, future and unparseable times read sensibly', () => {
    expect(eventMs(NOW - H, NOW)).toBe(NOW - H);
    expect(eventMs(NOW + H, NOW)).toBe(NOW);
    expect(eventMs('not a date', NOW)).toBe(NOW);
  });

  test('a flood stays at or under maxItems and keeps every event', () => {
    const many = Array.from({ length: 300 }, (_, i) => ev(`e${i}`, (i / 300) * 29 * D, i % 3));
    const p = placeEvents(many, 30 * D, 564, NOW);
    expect(p.items.length).toBeLessThanOrEqual(40);
    expect(p.items.reduce((s, i) => s + i.runIds.length, 0)).toBe(300);
  });

  test('orderedEvents is oldest first inside the window', () => {
    expect(orderedEvents([ev('n', H), ev('o', 20 * H), ev('x', 3 * D)], D, NOW).map((e) => e.id)).toEqual(['o', 'n']);
  });
});

describe('the Creative Engine keeps one placement implementation', () => {
  test('lib/creative-engine/timeline.ts delegates placeRuns to lib/timeline-place.ts', () => {
    const src = readFileSync(path.join(process.cwd(), 'lib/creative-engine/timeline.ts'), 'utf8');
    expect(src).toMatch(/from '@\/lib\/timeline-place'/);
    expect(src).toMatch(/placeEvents</);
    expect(src).not.toMatch(/const build = \(merge/);
  });
});
