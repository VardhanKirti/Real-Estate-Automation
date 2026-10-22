import { describe, it, expect } from 'vitest';
import { runsPerDay, inboundPerDay, stateOfWorld, statusPill } from '@/lib/pulse-history';

const NOW = Date.parse('2026-07-13T12:00:00Z'); // days 07-07 … 07-13

describe('runsPerDay — real agent-run counts bucketed by day', () => {
  it('counts runs into the last 7 UTC days, oldest first', () => {
    const runs = [
      { startedAt: '2026-07-13T09:00:00Z' },
      { startedAt: '2026-07-13T01:00:00Z' },
      { startedAt: '2026-07-12T23:00:00Z' },
      { startedAt: '2026-07-08T10:00:00Z' },
      { startedAt: '2026-07-01T10:00:00Z' }, // outside the window
    ];
    expect(runsPerDay(runs, 7, NOW)).toEqual([0, 1, 0, 0, 0, 1, 2]);
  });

  it('returns an all-zero series of the right length when there are no runs', () => {
    expect(runsPerDay([], 7, NOW)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('ignores unparseable timestamps', () => {
    expect(runsPerDay([{ startedAt: 'nope' }, { startedAt: '2026-07-13T00:00:00Z' }], 7, NOW)).toEqual([
      0, 0, 0, 0, 0, 0, 1,
    ]);
  });
});

describe('inboundPerDay — real inbound counts bucketed by day', () => {
  it('counts feed items by their ts into the last N days', () => {
    const items = [
      { ts: '2026-07-13T08:00:00Z' },
      { ts: '2026-07-11T08:00:00Z' },
      { ts: '2026-07-11T09:00:00Z' },
    ];
    expect(inboundPerDay(items, 7, NOW)).toEqual([0, 0, 0, 0, 2, 0, 1]);
  });
});

describe('stateOfWorld — honest attention-first status line', () => {
  const base = {
    activeAgents: 5,
    totalAgents: 8,
    connected: 6,
    totalConnectors: 6,
    inbound: 0,
    failedRuns: 0,
  };

  it('with nothing wrong, the pill reads "All nominal" and the segments are facts only', () => {
    const segs = stateOfWorld(base);
    expect(statusPill(segs)).toEqual({ text: 'All nominal', tone: 'ok' });
    expect(segs).toEqual([{ text: '5/8 agents live', tone: 'ok', href: '/agents' }]);
  });

  it('surfaces failed runs first, in error tone', () => {
    const segs = stateOfWorld({ ...base, failedRuns: 2 });
    expect(segs[0]).toEqual({ text: '2 runs failed', tone: 'err', href: '/agents' });
    expect(statusPill(segs)).toEqual({ text: '1 needs attention', tone: 'err' });
  });

  it('the pill counts every warn and err segment and takes the worst tone (H2)', () => {
    expect(statusPill(stateOfWorld({ ...base, connected: 4 }))).toEqual({ text: '1 needs attention', tone: 'warn' });
    expect(statusPill(stateOfWorld({ ...base, connected: 4, failedRuns: 1 }))).toEqual({ text: '2 need attention', tone: 'err' });
  });

  it('inbound is a fact, not a problem: it never flips the pill', () => {
    expect(statusPill(stateOfWorld({ ...base, inbound: 22 }))).toEqual({ text: 'All nominal', tone: 'ok' });
  });

  it('reports down connectors', () => {
    const segs = stateOfWorld({ ...base, connected: 4, totalConnectors: 6 });
    expect(segs).toContainEqual({ text: '2 connectors down', tone: 'warn', href: '/integrations' });
  });

  it('G-Brain health is no longer an input (F1): no brain segment ever', () => {
    const segs = stateOfWorld({ ...base, failedRuns: 1, connected: 3 });
    expect(segs.some((s) => /G-Brain/.test(s.text))).toBe(false);
  });

  it('reports inbound as arrivals in 24h, never "need reply" (H1)', () => {
    const segs = stateOfWorld({ ...base, inbound: 7 });
    expect(segs).toContainEqual({ text: '7 inbound · 24h', tone: 'accent', href: '/inbox' });
    expect(segs.some((s) => /reply/.test(s.text))).toBe(false);
  });

  it('singularizes one failed run and one connector down', () => {
    const segs = stateOfWorld({ ...base, failedRuns: 1, connected: 5, totalConnectors: 6 });
    expect(segs).toContainEqual({ text: '1 run failed', tone: 'err', href: '/agents' });
    expect(segs).toContainEqual({ text: '1 connector down', tone: 'warn', href: '/integrations' });
  });

  it('gives every fact segment the page it lives on (S10 FR-9)', () => {
    const segs = stateOfWorld({ ...base, failedRuns: 1, connected: 5, inbound: 2 });
    expect(segs.map((s) => s.href)).toEqual(['/agents', '/integrations', '/inbox', '/agents']);
  });
});
