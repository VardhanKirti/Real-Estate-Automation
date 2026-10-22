import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { funnelSummary } from '@/lib/funnel';
import type { FunnelJourney } from '@/lib/schemas';
import { periodStats, touchSeries, worstStep, defaultStage, laneOf, WEEKDAY_INITIALS, PAGE_ROWS } from '@/components/funnel/model';
import { sampleFunnelJourneys } from '@/components/funnel/sample';
import { G_READY, G_TREE_FILES } from '@/lib/g-ready';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const NOW = new Date('2026-10-09T12:00:00Z');
const journeys: FunnelJourney[] = sampleFunnelJourneys(NOW, 'default');

describe('funnel model (S02 §7: numbers from data already on the client)', () => {
  test('period stats: weekday columns sum to the window counts; no compare window for all time', () => {
    const s = periodStats(journeys, NOW, 90, 'previous');
    expect(s.leadCols.reduce((a, b) => a + b, 0)).toBe(s.leadsIn.length);
    expect(s.convCols.reduce((a, b) => a + b, 0)).toBe(s.convIn.length);
    expect(Object.values(s.byLane).reduce((a, b) => a + b, 0)).toBe(s.revenue);
    expect(periodStats(journeys, NOW, 0, 'previous').cmp).toBeNull();
    expect(periodStats(journeys, NOW, 90, 'none').cmp).toBeNull();
  });
  test('touch series: 6 months or 12 weeks, labelled', () => {
    const m = touchSeries(journeys, NOW, 'monthly');
    expect(m.series).toHaveLength(6);
    expect(m.labels).toHaveLength(6);
    expect(m.labels[5]).toBe('Oct');
    const w = touchSeries(journeys, NOW, 'weekly');
    expect(w.series).toHaveLength(12);
  });
  test('the leak and the default stage agree', () => {
    const summary = funnelSummary(journeys);
    const w = worstStep(summary);
    if (w) expect(defaultStage(summary)).toBe(w.to);
  });
  test('lanes and weekday initials', () => {
    expect(WEEKDAY_INITIALS).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(['organic', 'ads', 'crm']).toContain(laneOf(journeys[0]));
    expect(PAGE_ROWS).toBe(50);
  });
});

describe('funnel GladOS tree (AC02.5 to AC02.12, GP4)', () => {
  const src = read('components/funnel/FunnelDashboardG.tsx');
  test('one fetch, two trees; registered for the guard', () => {
    const page = read('app/funnel/page.tsx');
    expect(page).toMatch(/treeFor\(getAppearance\(\), '\/funnel'\) === 'glados'/);
    expect(page).toContain('<FunnelDashboard {...props} />');
    expect(page).toContain("setupHrefFor(status.id)");
    expect(G_READY).toContain('/funnel');
    expect(G_TREE_FILES['/funnel']).toContain('components/funnel/FunnelDashboardG.tsx');
  });
  test('grain lives in the Touches card and still writes ?grain= (AC02.9)', () => {
    const touches = src.slice(src.indexOf('const touchCard'), src.indexOf('const dotCard'));
    expect(touches).toContain('label="Touches chart grain"');
    expect(src).toContain("put('grain', grain, 'monthly')");
  });
  test('every URL param round-trips (AC02.12)', () => {
    for (const k of ['view', 'stage', 'period', 'grain', 'compare', 'lane', 'lead']) expect(src).toContain(`put('${k}'`);
  });
  test('the revenue delta goes through the shared delta rule (AC02.8)', () => {
    expect(src).toMatch(/<GDelta cur=\{stats\.revenue\} prev=\{stats\.revenuePrev\} money/);
    expect(src).toContain("(stats.revenue > 0 || stats.revenuePrev > 0) && <GDelta"); // nothing against nothing shows no delta (S02 §8)
  });
  test('journeys paginate by 50 and the trail collapses to the last touch (AC02.10, FR-F8)', () => {
    expect(src).toContain('tableJourneys.slice(0, shown)');
    expect(src).toContain('Show {Math.min(PAGE_ROWS');
    expect(src).toContain("label: 'Last touch'");
  });
  test('no kebabs, no sparkle, no raw controls, no literals, no mono, no brand literal', () => {
    expect(src).not.toMatch(/Kebab|Sparkles|fc-/);
    expect(src).not.toMatch(/<(button|input|select|textarea)\b/);
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(/);
    expect(src).not.toMatch(/font-mono/);
    expect(code(src)).not.toContain('GladOS');
  });
  test('the empty pipeline and the down sources route to setup', () => {
    expect(src).toMatch(/No journeys yet\.[\s\S]{0,200}setupHref=\{attioHref\}/);
    expect(src).toContain('href={c.href}');
  });
});
