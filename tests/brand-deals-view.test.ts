import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { assembleSnapshot } from '@/lib/brand-deals';
import {
  CHAIN_DEPTH_BUCKETS,
  chainDepthBucket,
  chainDepthColumns,
  pollStatus,
  stageBars,
} from '@/lib/brand-deals-view';

const FIX = path.join(process.cwd(), 'tests', 'fixtures', 'brand-deals');
const state = JSON.parse(readFileSync(path.join(FIX, 'state.json'), 'utf8'));
const logText = readFileSync(path.join(FIX, 'bdpilot.log'), 'utf8');
const listText = readFileSync(path.join(FIX, 'gsend-list.txt'), 'utf8');
const sources = { state: true, log: true, drafts: true };

function snapWith(overrides: Parameters<typeof assembleSnapshot>[4] = []) {
  return assembleSnapshot(state, logText, listText, sources, overrides);
}

describe('stageBars (S02 §7)', () => {
  test('four columns in pipeline order, keyed by the filter they set', () => {
    const cols = stageBars(snapWith());
    expect(cols.map((c) => c.key)).toEqual(['all', 'sent', 'approval', 'closed']);
    expect(cols.map((c) => c.label)).toEqual(['Announced', 'Awaiting brand', 'Needs approval', 'Closed']);
  });

  test('column sums equal the volume and count fields the Deal Volume card reads', () => {
    const snap = snapWith();
    const [announced, awaiting, approval, closed] = stageBars(snap);
    expect(awaiting.usd).toBe(snap.volume.awaitingUsd);
    expect(approval.usd).toBe(snap.volume.approvalUsd);
    expect(awaiting.usd + approval.usd).toBe(snap.volume.openUsd);
    expect(closed.usd).toBe(snap.volume.wonUsd + snap.volume.lostUsd);
    expect(awaiting.count).toBe(snap.counts.sent);
    expect(approval.count).toBe(snap.counts.approval);
    expect(closed.count).toBe(snap.counts.closed);
    expect(announced.count).toBe(snap.deals.length);
    expect(announced.usd).toBe(snap.deals.reduce((n, d) => n + (d.quotedUsd ?? 0), 0));
  });

  test('Closed stacks won over lost and the segments sum to the column', () => {
    const snap = snapWith();
    const [a, b] = snap.deals;
    const withOutcomes = snapWith([
      { dealId: a.id, outcome: 'won', amountUsd: 12_000 },
      { dealId: b.id, outcome: 'lost', amountUsd: 4_000 },
    ]);
    const closed = stageBars(withOutcomes)[3];
    expect(closed.segments?.map((s) => s.key)).toEqual(['won', 'lost']);
    expect(closed.segments?.[0].usd).toBe(12_000);
    expect(closed.segments?.[1].usd).toBe(4_000);
    expect(closed.usd).toBe(16_000);
    expect(closed.segments!.reduce((n, s) => n + s.count, 0)).toBe(closed.count);
  });
});

describe('chainDepthBucket', () => {
  test('bucket edges: 1, 3, 4, 9, 10', () => {
    expect(chainDepthBucket(1)).toBe('1');
    expect(chainDepthBucket(2)).toBe('2-3');
    expect(chainDepthBucket(3)).toBe('2-3');
    expect(chainDepthBucket(4)).toBe('4-5');
    expect(chainDepthBucket(5)).toBe('4-5');
    expect(chainDepthBucket(6)).toBe('6-9');
    expect(chainDepthBucket(9)).toBe('6-9');
    expect(chainDepthBucket(10)).toBe('10+');
    expect(chainDepthBucket(250)).toBe('10+');
  });

  test('a thread with no cached messages has no bucket', () => {
    expect(chainDepthBucket(0)).toBeNull();
    expect(chainDepthBucket(-1)).toBeNull();
    expect(chainDepthBucket(Number.NaN)).toBeNull();
  });

  test('chainDepthColumns counts every bucket in order, skipping empty threads', () => {
    const cols = chainDepthColumns([{ chainLen: 0 }, { chainLen: 1 }, { chainLen: 3 }, { chainLen: 2 }, { chainLen: 12 }]);
    expect(cols.map((c) => c.label)).toEqual([...CHAIN_DEPTH_BUCKETS]);
    expect(cols.map((c) => c.count)).toEqual([1, 2, 0, 0, 1]);
  });
});

describe('pollStatus (H6)', () => {
  const t0 = Date.UTC(2026, 9, 9, 12, 0, 0);

  test('counts up from the last successful poll', () => {
    expect(pollStatus(t0, t0 + 12_000, false)).toMatchObject({ text: 'Updated 12 s ago', tone: 'ok' });
    expect(pollStatus(t0, t0 + 125_000, false).text).toBe('Updated 2 min ago');
    expect(pollStatus(t0, t0 + 2 * 3_600_000, false).text).toBe('Updated 2 h ago');
  });

  test('a failed poll turns the pill warn and never claims freshness', () => {
    const s = pollStatus(t0, t0 + 5_000, true);
    expect(s.tone).toBe('warn');
    expect(s.text).toBe('Last update failed · retrying');
    expect(s.text).not.toMatch(/live|Updated/);
  });

  test('before the first tick it does not invent an age', () => {
    expect(pollStatus(null, t0, false).text).not.toMatch(/\d/);
  });
});
