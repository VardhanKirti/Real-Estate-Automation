import { describe, expect, it } from 'vitest';
import { formatCompact, formatFull, formatUsdCompact } from '@/lib/format-number';
import { fmtCredits, plural } from '@/lib/creative-engine/format';
import { dedupeSignals } from '@/lib/adpilot';
import type { Signal } from '@/lib/foreplay/signals';

/** SPEC X3 (number and credits formatting) and X5 (signal de-duplication). */

describe('X3 formatFull / formatCompact / formatUsdCompact (S10 FR-22)', () => {
  it('formatFull uses en-US separators', () => {
    expect(formatFull(12431)).toBe('12,431');
    expect(formatFull(0)).toBe('0');
    expect(formatFull(-5763)).toBe('-5,763');
  });

  it('under 10,000 shows the full value', () => {
    expect(formatCompact(9999)).toBe('9,999');
    expect(formatCompact(42)).toBe('42');
    expect(formatCompact(0)).toBe('0');
  });

  it('K with one decimal under 100K, none at or above', () => {
    expect(formatCompact(10_000)).toBe('10K');
    expect(formatCompact(12_431)).toBe('12.4K');
    expect(formatCompact(29_412)).toBe('29.4K');
    expect(formatCompact(179_000)).toBe('179K');
    expect(formatCompact(350_600)).toBe('351K');
    expect(formatCompact(631_000)).toBe('631K');
  });

  it('M and B, promoting values that round up to the next unit', () => {
    expect(formatCompact(1_240_000)).toBe('1.2M');
    expect(formatCompact(999_960)).toBe('1M');
    expect(formatCompact(99_960)).toBe('100K');
    expect(formatCompact(1_200_000_000)).toBe('1.2B');
    expect(formatCompact(1_234_000_000_000)).toBe('1,234B');
  });

  it('keeps the sign and never prints NaN', () => {
    expect(formatCompact(-29_412)).toBe('-29.4K');
    expect(formatCompact(-0.2)).toBe('0');
    expect(formatCompact(NaN)).toBe('—');
    expect(formatCompact(Infinity)).toBe('—');
  });

  it('formatUsdCompact prefixes $ after the sign', () => {
    expect(formatUsdCompact(396_650)).toBe('$397K');
    expect(formatUsdCompact(1500)).toBe('$1,500');
    expect(formatUsdCompact(-1500)).toBe('-$1,500');
    expect(formatUsdCompact(2_500_000)).toBe('$2.5M');
  });
});

describe('X3 fmtCredits and plural (one rule, §5 C10)', () => {
  it('10 or more: rounded integer with separators', () => {
    expect(fmtCredits(961.97)).toBe('962');
    expect(fmtCredits(38.03)).toBe('38');
    expect(fmtCredits(5763)).toBe('5,763');
    expect(fmtCredits(10)).toBe('10');
    expect(fmtCredits(-12.6)).toBe('-13');
  });

  it('under 10: one decimal, trailing .0 dropped', () => {
    expect(fmtCredits(2.5)).toBe('2.5');
    expect(fmtCredits(3)).toBe('3');
    expect(fmtCredits(3.04)).toBe('3');
    expect(fmtCredits(0.25)).toBe('0.3');
    expect(fmtCredits(9.96)).toBe('10');
    expect(fmtCredits(0)).toBe('0');
    expect(fmtCredits(-0.01)).toBe('0');
    expect(fmtCredits(NaN)).toBe('—');
  });

  it('plural', () => {
    expect(plural(1, 'charge')).toBe('1 charge');
    expect(plural(0, 'charge')).toBe('0 charges');
    expect(plural(3, 'credit')).toBe('3 credits');
    expect(plural(1200, 'credit')).toBe('1,200 credits');
    expect(plural(2, 'query', 'queries')).toBe('2 queries');
  });
});

describe('X5 dedupeSignals', () => {
  const sig = (message: string, at: string, adId?: string): Signal => ({
    type: 'new_launch',
    brandId: 'b1',
    brandName: 'Northwind Tools',
    adId,
    message,
    at,
  });
  const H = 3_600_000;

  it('collapses consecutive identical messages into { ...first, count, ids }', () => {
    const out = dedupeSignals([
      sig('Northwind Tools launched DPA', '2026-10-01T10:00:00Z', 'a1'),
      sig('Northwind Tools launched DPA', '2026-10-01T11:00:00Z', 'a2'),
      sig('Northwind Tools launched DPA', '2026-10-01T12:00:00Z', 'a3'),
      sig('Orbit Labs killed a video', '2026-10-01T13:00:00Z', 'a4'),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ message: 'Northwind Tools launched DPA', adId: 'a1', at: '2026-10-01T10:00:00Z', count: 3, ids: ['a1', 'a2', 'a3'] });
    expect(out[1]).toMatchObject({ count: 1, ids: ['a4'] });
  });

  it('only consecutive repeats merge; order is kept', () => {
    const out = dedupeSignals([sig('A', '2026-10-01T10:00:00Z'), sig('B', '2026-10-01T10:01:00Z'), sig('A', '2026-10-01T10:02:00Z')]);
    expect(out.map((s) => [s.message, s.count])).toEqual([
      ['A', 1],
      ['B', 1],
      ['A', 1],
    ]);
  });

  it('windowMs is measured from the first signal of the run (S04 B26, 24 h)', () => {
    const out = dedupeSignals(
      [sig('A', '2026-10-01T00:00:00Z', 'x1'), sig('A', '2026-10-01T23:00:00Z', 'x2'), sig('A', '2026-10-02T01:00:00Z', 'x3')],
      { windowMs: 24 * H },
    );
    expect(out.map((s) => s.ids)).toEqual([['x1', 'x2'], ['x3']]);
  });

  it('sameDay groups by local calendar day (S01 F25)', () => {
    const local = (d: number, h: number) => new Date(2026, 9, d, h).toISOString();
    const out = dedupeSignals([sig('A', local(1, 1)), sig('A', local(1, 23)), sig('A', local(2, 0))], { sameDay: true });
    expect(out.map((s) => s.count)).toEqual([2, 1]);
  });

  it('unparseable timestamps never merge under a time rule', () => {
    const out = dedupeSignals([sig('A', 'nope'), sig('A', 'nope')], { windowMs: H });
    expect(out.map((s) => s.count)).toEqual([1, 1]);
    expect(dedupeSignals([sig('A', 'nope'), sig('A', 'nope')]).map((s) => s.count)).toEqual([2]);
  });

  it('ids default to id, then adId, then at; idOf overrides', () => {
    const rows = [
      { message: 'A', at: '2026-10-01T00:00:00Z', id: 's1' },
      { message: 'A', at: '2026-10-01T00:01:00Z' },
    ];
    expect(dedupeSignals(rows)[0].ids).toEqual(['s1', '2026-10-01T00:01:00Z']);
    expect(dedupeSignals(rows, { idOf: (_s, i) => `row${i}` })[0].ids).toEqual(['row0', 'row1']);
  });

  it('does not mutate its input', () => {
    const input = [sig('A', '2026-10-01T00:00:00Z'), sig('A', '2026-10-01T00:01:00Z')];
    const copy = JSON.parse(JSON.stringify(input));
    dedupeSignals(input);
    expect(input).toEqual(copy);
  });
});
