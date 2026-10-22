import { describe, expect, test } from 'vitest';
import { deltaIfMeaningful, deltaPct, deltaTone, formatDelta, formatPct, MAX_PCT } from '@/lib/delta';

describe('formatDelta — percentage, or absolute off a tiny base (S02 FR-F6, H12)', () => {
  test('normal change reads as a percentage with a sign', () => {
    const d = formatDelta(112, 100)!;
    expect(d.kind).toBe('pct');
    expect(d.text).toBe('+12%');
    expect(d.tone).toBe('ok');
    expect(d.direction).toBe('up');
    expect(formatDelta(98.6, 100)!.text).toBe('-1.4%');
    expect(formatDelta(98.6, 100)!.tone).toBe('err');
  });

  test('above 999% the delta is absolute, never a huge percentage', () => {
    const d = formatDelta(374_000, 22_400, { money: true })!; // +1570%
    expect(d.kind).toBe('abs');
    expect(d.text).toBe('+$352K vs previous');
    expect(d.text).not.toMatch(/%/);
    expect(d.pct).toBeGreaterThan(MAX_PCT);
    expect(d.title).toBe('Previous $22,400 · now $374,000');
  });

  test('exactly 999% still reads as a percentage', () => {
    expect(formatDelta(1099, 110)!.kind).toBe('pct');
  });

  test('previous 0 reads "vs nothing before"', () => {
    const d = formatDelta(374_000, 0, { money: true })!;
    expect(d.kind).toBe('abs');
    expect(d.pct).toBeNull();
    expect(d.text).toBe('+$374K vs nothing before');
    expect(formatDelta(12, 0)!.text).toBe('+12 vs nothing before');
  });

  test('0 to 0 is flat, not "+0 vs nothing before"', () => {
    const d = formatDelta(0, 0)!;
    expect(d.text).toBe('0.0%');
    expect(d.tone).toBe('neutral');
    expect(d.direction).toBe('flat');
  });

  test('big drops are absolute and negative', () => {
    const d = formatDelta(-5000, 400, { money: true })!; // -1350%
    expect(d.kind).toBe('abs');
    expect(d.text).toBe('-$5,400 vs previous');
    expect(d.tone).toBe('err');
  });

  test('missing sides mean compare is off: null, so the pill hides', () => {
    expect(formatDelta(10, null)).toBeNull();
    expect(formatDelta(undefined, 10)).toBeNull();
    expect(formatDelta(Number.NaN, 10)).toBeNull();
  });
});

describe('deltaTone and flat changes (S01 FR-12)', () => {
  test('under 0.05% is neutral', () => {
    expect(deltaTone(0.04)).toBe('neutral');
    expect(deltaTone(-0.049)).toBe('neutral');
    expect(deltaTone(0.05)).toBe('ok');
    expect(deltaTone(-0.2)).toBe('err');
    expect(deltaTone(null)).toBe('neutral');
  });

  test('a flat delta prints 0.0% and points nowhere', () => {
    const d = formatDelta(100_020, 100_000)!; // +0.02%
    expect(d.text).toBe('0.0%');
    expect(d.direction).toBe('flat');
    expect(d.tone).toBe('neutral');
  });

  test('formatPct keeps one decimal under 10%', () => {
    expect(formatPct(0.1)).toBe('+0.1%');
    expect(formatPct(-9.94)).toBe('-9.9%');
    expect(formatPct(10.4)).toBe('+10%');
  });

  test('deltaPct uses the magnitude of a negative base', () => {
    expect(deltaPct(-50, -100)).toBe(50);
    expect(deltaPct(5, 0)).toBeNull();
  });
});

describe('deltaIfMeaningful — hidden under a small base (S04 F-T3, H26)', () => {
  test('prev under the minimum returns null', () => {
    expect(deltaIfMeaningful(19, 2, 5)).toBeNull(); // the "↑850%" case
  });

  test('prev 0 returns null', () => {
    expect(deltaIfMeaningful(0, 0, 0)).toBeNull();
    expect(deltaIfMeaningful(5, 0, 0)).toBeNull();
  });

  test('a meaningful base returns the delta', () => {
    const d = deltaIfMeaningful(12, 10, 5)!;
    expect(d.text).toBe('+20%');
    expect(deltaIfMeaningful(10, 10, 10)!.direction).toBe('flat');
  });

  test('the "0m ↓100%" runtime case is hidden below its base', () => {
    expect(deltaIfMeaningful(0, 4, 10)).toBeNull();
  });
});
