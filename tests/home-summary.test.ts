import { describe, expect, test } from 'vitest';
import { hourlyBuckets, hourlyBucketStarts, inboundSummary, lastRunCaption, relAge, revenueSummary } from '@/lib/home-summary';
import { inboundLast24h, type CommsItem } from '@/lib/comms';

const NOW = new Date('2026-10-09T12:30:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const H = 3_600_000;
const item = (ts: string, extra: Partial<CommsItem> = {}): CommsItem => ({ source: 'email', title: 't', preview: 'p', ts, ...extra });

describe('hourlyBuckets — 24 trailing hours, same window as inboundLast24h', () => {
  test('24 buckets, newest last', () => {
    const b = hourlyBuckets([item(ago(5 * 60_000)), item(ago(90 * 60_000)), item(ago(90 * 60_000))], NOW);
    expect(b).toHaveLength(24);
    expect(b[23]).toBe(1);
    expect(b[22]).toBe(2);
  });

  test('an item exactly 24h old counts, in bucket 0; older is dropped', () => {
    const b = hourlyBuckets([item(ago(24 * H)), item(ago(24 * H + 1))], NOW);
    expect(b[0]).toBe(1);
    expect(b.reduce((s, v) => s + v, 0)).toBe(1);
  });

  test('future and unparseable timestamps are dropped', () => {
    const b = hourlyBuckets([item(new Date(NOW.getTime() + 60_000).toISOString()), item('not a date'), { ts: undefined }], NOW);
    expect(b.every((v) => v === 0)).toBe(true);
  });

  test('sum equals inboundLast24h on a mixed feed', () => {
    const feed = [0, 1, 59, 60, 61, 600, 1439, 1440, 1441, 3000, -5].map((m) => item(ago(m * 60_000)));
    const sum = hourlyBuckets(feed, NOW).reduce((s, v) => s + v, 0);
    expect(sum).toBe(inboundLast24h(feed, NOW));
  });

  test('bucket starts are hourly and end at now', () => {
    const s = hourlyBucketStarts(NOW);
    expect(s).toHaveLength(24);
    expect(s[0]).toBe(ago(24 * H));
    expect(s[23]).toBe(ago(H));
  });
});

describe('inboundSummary — the Inbound · 24h figure (S01 FR-3, FR-4)', () => {
  const connected = [{ id: 'email', state: 'connected' }];

  test('count, priority, channels and configured', () => {
    const feed = [
      item(ago(H), { priority: 1 }),
      item(ago(2 * H), { source: 'whatsapp', priority: 2 }),
      item(ago(30 * H), { priority: 1 }),
    ];
    const s = inboundSummary(feed, connected, NOW);
    expect(s.count).toBe(2);
    expect(s.count).toBe(inboundLast24h(feed, NOW));
    expect(s.priority).toBe(1);
    expect(s.channels).toBe(2);
    expect(s.configured).toBe(true);
    expect(s.capped).toBe(false);
    expect(s.hourly.reduce((a, b) => a + b, 0)).toBe(2);
  });

  test('no comms connector connected means unconfigured, not zero', () => {
    expect(inboundSummary([], [{ id: 'email', state: 'unconfigured' }, { id: 'zernio', state: 'connected' }], NOW).configured).toBe(false);
    expect(inboundSummary([], [{ id: 'slack', state: 'connected' }], NOW).configured).toBe(true);
  });

  test('a full feed still inside 24h is capped (show N+)', () => {
    const feed = Array.from({ length: 3 }, (_, i) => item(ago(i * H)));
    expect(inboundSummary(feed, connected, NOW, 3).capped).toBe(true);
    expect(inboundSummary(feed, connected, NOW, 4).capped).toBe(false);
    expect(inboundSummary([...feed.slice(0, 2), item(ago(30 * H))], connected, NOW, 3).capped).toBe(false);
  });
});

describe('revenueSummary — total, leader and shares (S01 FR-2)', () => {
  const cats = [
    { key: 'deployments', label: 'Deployments', usd: 350_630 },
    { key: 'course', label: 'Course', usd: 231_210 },
    { key: 'brand', label: 'Brand deals', usd: 40_000 },
    { key: 'community', label: 'Community', usd: 9_400 },
  ];

  test('top category and total', () => {
    const r = revenueSummary(cats)!;
    expect(r.total).toBe(631_240);
    expect(r.top.label).toBe('Deployments');
    expect(r.top.share).toBe(56);
  });

  test('shares sum to exactly 100', () => {
    expect(revenueSummary(cats)!.segments.reduce((s, x) => s + x.share, 0)).toBe(100);
    const thirds = revenueSummary([
      { key: 'a', label: 'A', usd: 1 },
      { key: 'b', label: 'B', usd: 1 },
      { key: 'c', label: 'C', usd: 1 },
    ])!;
    expect(thirds.segments.map((s) => s.share)).toEqual([34, 33, 33]);
  });

  test('one category is 100%', () => {
    const r = revenueSummary([{ key: 'a', label: 'A', usd: 5 }, { key: 'b', label: 'B', usd: 0 }])!;
    expect(r.segments).toHaveLength(1);
    expect(r.top.share).toBe(100);
  });

  test('all zero or empty returns null', () => {
    expect(revenueSummary([])).toBeNull();
    expect(revenueSummary([{ key: 'a', label: 'A', usd: 0 }])).toBeNull();
  });
});

describe('relAge and lastRunCaption — a zero run count is explained (H4)', () => {
  test('compact ages', () => {
    expect(relAge(ago(30_000), NOW)).toBe('now');
    expect(relAge(ago(12 * 60_000), NOW)).toBe('12m');
    expect(relAge(ago(5 * H), NOW)).toBe('5h');
    expect(relAge(ago(46 * 24 * H), NOW)).toBe('46d');
  });

  test('caption reads "last run 46d ago"; null when nothing ran', () => {
    expect(lastRunCaption(ago(46 * 24 * H), NOW)).toBe('last run 46d ago');
    expect(lastRunCaption(ago(10_000), NOW)).toBe('last run just now');
    expect(lastRunCaption(null, NOW)).toBeNull();
    expect(lastRunCaption('garbage', NOW)).toBeNull();
  });
});
