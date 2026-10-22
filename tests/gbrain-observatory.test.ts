import { describe, expect, test } from 'vitest';
import { buildObservatoryData } from '@/lib/gbrain-observatory';

const page = (path: string, words: number, extra = '') => ({
  path,
  content: `# ${path}\n\n${Array.from({ length: words }, (_, i) => `word${i}`).join(' ')}\n${extra}`,
});

describe('gbrain observatory data', () => {
  test('empty store → honest unmounted state, no invented brain', () => {
    const d = buildObservatoryData([]);
    expect(d.mounted).toBe(false);
    expect(d.clusters).toEqual([]);
    expect(d.notes).toEqual([]);
    expect(d.statusLine).toContain('not mounted');
  });

  test('clusters are real folders with real page counts', () => {
    const d = buildObservatoryData([
      page('people/sam.md', 10),
      page('people/sam.md', 10),
      page('projects/glados.md', 10),
      page('root-note.md', 10),
    ]);
    expect(d.mounted).toBe(true);
    expect(d.totalPages).toBe(4);
    const byKey = Object.fromEntries(d.clusters.map((c) => [c.key, c.pages]));
    expect(byKey.people).toBe(2);
    expect(byKey.projects).toBe(1);
    expect(byKey['(root)']).toBe(1);
    // every note maps to a valid cluster and carries ≥1 chunk dot
    for (const n of d.notes) {
      expect(d.clusters[n.c]).toBeDefined();
      expect(n.k).toBeGreaterThanOrEqual(1);
    }
  });

  test('more than 7 folders folds the tail into misc', () => {
    const notes = Array.from({ length: 9 }, (_, i) => page(`folder${i}/note.md`, 5));
    const d = buildObservatoryData(notes);
    expect(d.clusters).toHaveLength(7);
    const misc = d.clusters.find((c) => c.key === 'misc');
    expect(misc?.pages).toBe(3);
  });

  test('chunk dots scale down under the budget but counts stay real', () => {
    // 20 pages × ~50 chunks (6000 words / 120-word chunks) ≫ budget
    const notes = Array.from({ length: 20 }, (_, i) => page(`k/big${i}.md`, 6000));
    const d = buildObservatoryData(notes);
    expect(d.totalChunks).toBeGreaterThan(700);
    expect(d.shownChunks).toBeLessThanOrEqual(d.totalChunks);
    expect(d.shownChunks).toBeLessThan(800); // budget + rounding slack
  });

  test('wikilinks resolve to note-index pairs, deduped, no self-links', () => {
    const d = buildObservatoryData([
      page('a/one.md', 10, 'see [[two]] and [[two]] and [[one]]'),
      page('b/two.md', 10, 'back to [[a/one]]'),
      page('b/three.md', 10, 'dangling [[nowhere]]'),
    ]);
    expect(d.wikilinks).toBe(1);
    const [i, j] = d.links[0];
    expect(new Set([d.notes[i].t, d.notes[j].t])).toEqual(new Set(['one.md', 'two.md']));
  });

  test('context health is 0-100 and rewards fresh, linked, substantial pages', () => {
    const now = Date.UTC(2026, 0, 1);
    const day = 86_400_000;
    const d = buildObservatoryData(
      [
        page('a/strong.md', 900, 'linked to [[stub]] and [[weak]]'),
        page('a/weak.md', 900),
        page('a/stub.md', 4),
      ],
      {
        now,
        mtimes: new Map([
          ['a/strong', now - 5 * day],
          ['a/weak', now - 800 * day],
          ['a/stub', now - 800 * day],
        ]),
      },
    );
    const health = Object.fromEntries(d.pages.map((pg) => [pg.t, pg.health]));
    for (const h of Object.values(health)) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(100);
    }
    // fresh + linked + long beats stale, and a stub is the worst of the three
    expect(health['strong.md']).toBeGreaterThan(health['weak.md']);
    expect(health['weak.md']).toBeGreaterThan(health['stub.md']);
    // above half means green in the radial — a current, woven-in page clears it
    expect(health['strong.md']).toBeGreaterThanOrEqual(50);
  });

  test('a page with no mtime scores neutral freshness rather than dead', () => {
    const d = buildObservatoryData([page('a/undated.md', 900)]);
    expect(d.pages[0].days).toBeNull();
    expect(d.pages[0].health).toBeGreaterThan(0);
  });

  test('the two biggest pages per folder are the labeled hubs', () => {
    const d = buildObservatoryData([
      page('x/small.md', 20),
      page('x/medium.md', 400),
      page('x/large.md', 900),
    ]);
    const hubs = d.notes.filter((n) => n.hub).map((n) => n.t);
    expect(hubs.sort()).toEqual(['large.md', 'medium.md']);
  });
});
