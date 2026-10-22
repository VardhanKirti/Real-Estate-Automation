import { describe, expect, it } from 'vitest';
import {
  alignDaily,
  deliveryAlpha,
  isStale,
  parseBrandDomain,
  periodDays,
  relativeAgo,
  rovingIndex,
  SYNC_STALE_MS,
  type DailyPoint,
} from '@/lib/adpilot';

/** Deck helpers behind SPEC S01 F6, F7, F9, F11, F24 and §8 edges 5-6. */

const day = (date: string, spend = 10): DailyPoint => ({ date, spend, leads: 1, bookings: 0 });
const range = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => day(new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10)));

describe('periodDays (F7, AC01.10)', () => {
  it('counts the daily series when present (dailies win over the inclusive period)', () => {
    const c = { period: { from: '2026-08-15', to: '2026-09-14' }, daily: range('2026-08-16', 30) };
    expect(periodDays([c])).toBe(30);
  });

  it('unions dates across campaigns', () => {
    const a = { period: { from: '2026-08-01', to: '2026-08-10' }, daily: range('2026-08-01', 10) };
    const b = { period: { from: '2026-08-06', to: '2026-08-15' }, daily: range('2026-08-06', 10) };
    expect(periodDays([a, b])).toBe(15);
  });

  it('falls back to the inclusive union of periods without dailies', () => {
    expect(periodDays([{ period: { from: '2026-08-15', to: '2026-09-14' } }])).toBe(31);
    expect(periodDays([{ period: { from: '2026-08-15', to: '2026-08-20' } }, { period: { from: '2026-08-25', to: '2026-09-14' } }])).toBe(31);
    expect(periodDays([{ period: { from: '2026-08-15', to: '2026-08-15' } }])).toBe(1);
  });

  it('is null for nothing to measure', () => {
    expect(periodDays([])).toBeNull();
    expect(periodDays([{ period: { from: 'x', to: 'y' } }])).toBeNull();
  });
});

describe('alignDaily (§8 edge 5)', () => {
  it('aligns rows by date key, not index', () => {
    const a = { id: 'a', daily: [day('2026-08-01'), day('2026-08-02')] };
    const b = { id: 'b', daily: [day('2026-08-02'), day('2026-08-03')] };
    const { dates, rows } = alignDaily([a, b]);
    expect(dates).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
    expect(rows[0].cells.map((c) => c?.date ?? null)).toEqual(['2026-08-01', '2026-08-02', null]);
    expect(rows[1].cells.map((c) => c?.date ?? null)).toEqual([null, '2026-08-02', '2026-08-03']);
  });

  it('handles campaigns without dailies', () => {
    expect(alignDaily([{ id: 'x' } as { id: string; daily?: DailyPoint[] }]).rows[0].cells).toEqual([]);
  });
});

describe('sync freshness (F6)', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  it('relativeAgo renders against an explicit now', () => {
    expect(relativeAgo(null, now)).toBe('never');
    expect(relativeAgo('2026-10-08T11:59:50Z', now)).toBe('just now');
    expect(relativeAgo('2026-10-08T11:30:00Z', now)).toBe('30m ago');
    expect(relativeAgo('2026-10-08T07:00:00Z', now)).toBe('5h ago');
    expect(relativeAgo('2026-09-14T07:00:00Z', now)).toBe('24d ago');
  });
  it('isStale flips past 48h', () => {
    expect(isStale(new Date(now - SYNC_STALE_MS + 60_000).toISOString(), now)).toBe(false);
    expect(isStale(new Date(now - SYNC_STALE_MS - 60_000).toISOString(), now)).toBe(true);
    expect(isStale(null, now)).toBe(false);
  });
});

describe('parseBrandDomain (F24)', () => {
  it('normalises what people paste', () => {
    expect(parseBrandDomain('brand.com')).toBe('brand.com');
    expect(parseBrandDomain('  https://www.Lumen-Desk.co.uk/shop?x=1 ')).toBe('lumen-desk.co.uk');
    expect(parseBrandDomain('http://orbitlabs.io:8080/')).toBe('orbitlabs.io');
  });
  it('refuses non-domains', () => {
    for (const bad of ['', 'not a domain', 'localhost', 'a.b', 'halyard', '-bad.com', 'x..com']) {
      expect(parseBrandDomain(bad), bad).toBeNull();
    }
  });
});

describe('rovingIndex (F9, F21)', () => {
  it('wraps arrows and jumps to the ends', () => {
    expect(rovingIndex('ArrowRight', 2, 3)).toBe(0);
    expect(rovingIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(rovingIndex('Home', 2, 3)).toBe(0);
    expect(rovingIndex('End', 0, 3)).toBe(2);
    expect(rovingIndex('a', 0, 3)).toBeNull();
    expect(rovingIndex('ArrowRight', 0, 0)).toBeNull();
  });
});

describe('deliveryAlpha', () => {
  it('quiet days are empty, the peak is near full', () => {
    expect(deliveryAlpha(0)).toBe(0);
    expect(deliveryAlpha(0.01)).toBe(0);
    expect(deliveryAlpha(1)).toBe(0.98);
    expect(deliveryAlpha(0.5)).toBeGreaterThan(0.1);
  });
});
