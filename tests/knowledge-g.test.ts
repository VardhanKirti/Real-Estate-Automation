import { describe, expect, it } from 'vitest';
import { RANK_PAGE, filterRank, monthLabel, openClusters, timelineMonths, timelineSentence, topClusters } from '@/lib/knowledge-g';
import type { KIEntity } from '@/lib/knowledge-index';

/** glados-ui SPEC S05 F05.34 to F05.36, AC05.10, AC05.11: the rules behind the GladOS /knowledge tree. */

const NOW = Date.UTC(2026, 9, 9, 12);
const ent = (id: string, kind: string, days: number | null): KIEntity => ({ id, kind, days, label: id, cluster: 'c' }) as unknown as KIEntity;

describe('timeline (F05.35)', () => {
  it('buckets dated records by month and category, oldest first', () => {
    const { months, dated } = timelineMonths([ent('a', 'page', 1), ent('b', 'skill', 2), ent('c', 'page', 40), ent('d', 'agent', null)], NOW);
    expect(dated).toBe(3);
    expect(months.map((m) => m.key)).toEqual(['2026-08', '2026-10']);
    expect(months[1].counts).toEqual([1, 1, 0, 0, 0]);
  });

  it('states one sentence instead of a one-bar chart (AC05.11)', () => {
    const { months, dated } = timelineMonths([ent('a', 'page', 1), ent('b', 'page', 3)], NOW);
    expect(timelineSentence(months, dated)).toBe(`All 2 dated records were last touched in ${monthLabel('2026-10')}.`);
  });

  it('draws the chart from three months up', () => {
    const { months, dated } = timelineMonths([ent('a', 'page', 1), ent('b', 'page', 40), ent('c', 'page', 80)], NOW);
    expect(timelineSentence(months, dated)).toBeNull();
  });

  it('says so when nothing is dated (edge 6)', () => {
    expect(timelineSentence([], 0)).toBe('No dated records: these come from the database, not files.');
  });
});

describe('ranking (F05.36, AC05.10)', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ label: `Record ${i}`, cluster: i % 2 ? 'Sales' : 'Ops', kind: 'page' }));
  it('pages by 25', () => {
    expect(RANK_PAGE).toBe(25);
  });
  it('filters by label, cluster or kind and returns everything for an empty query', () => {
    expect(filterRank(rows, '')).toHaveLength(60);
    expect(filterRank(rows, 'sales')).toHaveLength(30);
    expect(filterRank(rows, 'record 5')).toHaveLength(11);
  });
});

describe('cluster lists (F05.34)', () => {
  const m = { clusters: ['A', 'B', 'C'], counts: [[0, 1, 0], [1, 0, 9], [0, 9, 0]], internal: [1, 0, 1] };
  it('ranks the least open clusters first with their share', () => {
    const list = openClusters(m);
    expect(list.map((c) => c.cluster)).toEqual(['A', 'C', 'B']);
    expect(Math.round(list[0].pct)).toBe(50);
  });
  it('keeps the most connected clusters in library order', () => {
    expect(topClusters(m, 2).clusters).toEqual(['B', 'C']);
    expect(topClusters(m, 5)).toBe(m);
  });
});
