/**
 * Pure helpers for the GladOS tree of /knowledge (glados-ui SPEC S05 F05.31 to
 * F05.37). Kept out of the components so the rules are unit-tested
 * (tests/knowledge-g.test.ts).
 */
import type { KIEntity } from './knowledge-index';
import { KIND_CATEGORY } from './knowledge-views';

export const TIMELINE_SERIES = ['page', 'skill', 'agent', 'client', 'system'] as const;

export type TimelineMonth = { key: string; label: string; counts: number[] };

/** Records per month of last edit, stacked by category; undated records are not plotted (a guess). */
export function timelineMonths(entities: readonly KIEntity[], now = Date.now()): { months: TimelineMonth[]; dated: number } {
  const map = new Map<string, number[]>();
  let dated = 0;
  for (const e of entities) {
    if (e.days === null) continue;
    dated++;
    const d = new Date(now - e.days * 86_400_000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const counts = map.get(key) ?? TIMELINE_SERIES.map(() => 0);
    const cat = KIND_CATEGORY[e.kind] ?? 'system';
    const i = Math.max(0, TIMELINE_SERIES.indexOf(cat as (typeof TIMELINE_SERIES)[number]));
    counts[i] += 1;
    map.set(key, counts);
  }
  const months = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, counts]) => ({ key, label: monthLabel(key), counts }));
  return { months, dated };
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * F05.35 degenerate rule: with fewer than 3 months holding records a bar chart
 * answers nothing, so the page states the fact in one sentence instead.
 * Returns that sentence, or null when the chart should draw.
 */
export function timelineSentence(months: readonly TimelineMonth[], dated: number): string | null {
  if (dated === 0) return 'No dated records: these come from the database, not files.';
  const held = months.filter((m) => m.counts.some((c) => c > 0));
  if (held.length >= 3) return null;
  if (held.length === 1) return `All ${dated} dated records were last touched in ${held[0].label}.`;
  return `All ${dated} dated records were last touched in ${held.map((m) => m.label).join(' and ')}.`;
}

export const RANK_PAGE = 25;

/** Rows matching the search (label, cluster or kind), the ranking's filter. */
export function filterRank<T extends { label: string; cluster: string; kind: string }>(rows: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((r) => r.label.toLowerCase().includes(q) || r.cluster.toLowerCase().includes(q) || r.kind.includes(q));
}

export type OpenCluster = { cluster: string; out: number; total: number; pct: number };

/**
 * F05.34 cluster list beside the matrix: the clusters whose connections least
 * often leave them (silos first), as the Classic cards rank them. On demo data
 * most clusters send every connection out, so a most-open list would read
 * 100% six times and say nothing.
 */
export function openClusters(m: { clusters: string[]; counts: number[][]; internal: number[] }, n = 6): OpenCluster[] {
  return m.clusters
    .map((cluster, i) => {
      const out = m.counts[i].reduce((s, v) => s + v, 0);
      const total = out + m.internal[i];
      return { cluster, out, total, pct: total > 0 ? (out / total) * 100 : 0 };
    })
    .filter((c) => c.total > 0)
    .sort((a, b) => a.pct - b.pct || b.total - a.total)
    .slice(0, n);
}

/** The `limit` most connected clusters, in the library's order, with their cross counts. */
export function topClusters(m: { clusters: string[]; counts: number[][]; internal: number[] }, limit: number) {
  if (m.clusters.length <= limit) return m;
  const totals = m.clusters.map((_, i) => m.internal[i] + m.counts[i].reduce((s, v) => s + v, 0));
  const kept = m.clusters
    .map((_, i) => i)
    .sort((a, b) => totals[b] - totals[a])
    .slice(0, limit)
    .sort((a, b) => a - b);
  return { clusters: kept.map((i) => m.clusters[i]), counts: kept.map((i) => kept.map((j) => m.counts[i][j])), internal: kept.map((i) => m.internal[i]) };
}
