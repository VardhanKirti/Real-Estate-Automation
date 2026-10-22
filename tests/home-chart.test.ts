import { describe, expect, test } from 'vitest';
import { bucketSeries, chartHeight, dayLabel, isoWeekStart, monthTicks, visibleTicks } from '@/lib/home-chart';
import { formatCompact, formatUsdCompact } from '@/lib/format-number';

/** `n` consecutive UTC day keys ending on `last`. */
function daysEnding(last: string, n: number): string[] {
  const end = Date.parse(`${last}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

describe('bucketSeries (S10 FR-11)', () => {
  const days90 = daysEnding('2026-10-09', 90);
  const series = [
    { key: 'email', label: 'email', points: days90.map((_, i) => i % 3) },
    { key: 'slack', label: 'slack', points: days90.map(() => 1) },
  ];

  test('90 days at a 300px plot become 13 or 14 weekly buckets with sums preserved', () => {
    const b = bucketSeries(days90, series, 300);
    expect(b.weekly).toBe(true);
    expect(b.days.length).toBeGreaterThanOrEqual(13);
    expect(b.days.length).toBeLessThanOrEqual(14);
    for (let s = 0; s < series.length; s++) {
      const before = series[s].points.reduce((a, v) => a + v, 0);
      const after = b.series[s].points.reduce((a, v) => a + v, 0);
      expect(after).toBe(before);
    }
    expect(b.series[0].key).toBe('email');
    expect(b.series[0]).toHaveProperty('label', 'email');
  });

  test('bucket keys are Mondays and labels read "Week of …"', () => {
    const b = bucketSeries(days90, series, 300);
    for (const d of b.days) expect(new Date(`${d}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(b.labels[1]).toMatch(/^Week of [A-Z][a-z]{2} \d{1,2}$/);
  });

  test('leaves daily bars alone when each bar gets at least 5px', () => {
    const b = bucketSeries(days90, series, 900);
    expect(b.weekly).toBe(false);
    expect(b.days).toBe(days90);
    expect(b.series).toBe(series);
    expect(b.labels[0]).toBe(dayLabel(days90[0]));
  });

  test('30 days at a narrow plot become 5 or 6 weeks', () => {
    const d30 = daysEnding('2026-10-09', 30);
    const b = bucketSeries(d30, [{ key: 'a', points: d30.map(() => 2) }], 120);
    expect(b.days.length).toBeGreaterThanOrEqual(5);
    expect(b.days.length).toBeLessThanOrEqual(6);
    expect(b.series[0].points.reduce((a, v) => a + v, 0)).toBe(60);
  });

  test('empty input stays empty', () => {
    expect(bucketSeries([], [], 100)).toEqual({ days: [], labels: [], series: [], weekly: false });
  });
});

describe('ticks and sizes', () => {
  test('isoWeekStart finds the Monday', () => {
    expect(isoWeekStart('2026-10-09')).toBe('2026-10-05'); // Friday
    expect(isoWeekStart('2026-10-05')).toBe('2026-10-05'); // Monday
    expect(isoWeekStart('2026-10-11')).toBe('2026-10-05'); // Sunday
  });

  test('monthTicks marks the first bar of each month', () => {
    expect(monthTicks(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])).toEqual([
      { i: 0, label: 'Sep' },
      { i: 2, label: 'Oct' },
    ]);
  });

  test('visibleTicks drops a label within 28px of the previous one', () => {
    const ticks = [
      { i: 0, label: 'Jul' },
      { i: 2, label: 'Aug' },
      { i: 10, label: 'Sep' },
    ];
    expect(visibleTicks(ticks, (i) => i * 10).map((t) => t.label)).toEqual(['Jul', 'Sep']);
    expect(visibleTicks(ticks, (i) => i * 20).map((t) => t.label)).toEqual(['Jul', 'Aug', 'Sep']);
  });

  test('chartHeight keeps the 940x420 ratio inside 180..420', () => {
    expect(chartHeight(940)).toBe(420);
    expect(chartHeight(2000)).toBe(420);
    expect(chartHeight(600)).toBe(268);
    expect(chartHeight(200)).toBe(180);
  });
});

describe('formatCompact boundaries the home page relies on (S10 §10)', () => {
  test.each([
    [9999, '9,999'],
    [10_000, '10K'],
    [29_400, '29.4K'],
    [99_950, '100K'],
    [631_240, '631K'],
    [1_250_000, '1.3M'],
    [0, '0'],
    [-29_400, '-29.4K'],
  ])('%d -> %s', (n, s) => {
    expect(formatCompact(n)).toBe(s);
  });

  test('usd variant', () => {
    expect(formatUsdCompact(350_630)).toBe('$351K');
    expect(formatUsdCompact(-12_345_678)).toBe('-$12.3M');
  });
});
