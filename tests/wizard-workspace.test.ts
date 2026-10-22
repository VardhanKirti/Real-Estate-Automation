import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDesignedAgent, readDesignedAgents } from '@/lib/wizard/designed';
import {
  durationLabel,
  elapsedLabel,
  heatmapDays,
  parseToolsInput,
  relativeTime,
  ringFraction,
  shortSessionId,
} from '@/lib/wizard/helpers';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-designed-'));
  process.env.WIZARD_DATA_DIR = tmp;
});
afterEach(() => {
  delete process.env.WIZARD_DATA_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('designed-agents store', () => {
  it('round-trips a filed agent spec, honestly unwired', () => {
    expect(readDesignedAgents()).toHaveLength(0);
    const agent = createDesignedAgent({
      name: 'Invoice reconciler',
      departmentId: 'dept-finance',
      purpose: 'Match Stripe payouts to invoices.',
      tools: ['stripe', 'gmail'],
    });
    expect(agent.id).toMatch(/^da-/);
    const back = readDesignedAgents();
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({
      name: 'Invoice reconciler',
      departmentId: 'dept-finance',
      purpose: 'Match Stripe payouts to invoices.',
      tools: ['stripe', 'gmail'],
    });
  });

  it('sorts newest first and keeps entries independent', () => {
    createDesignedAgent({ name: 'First', departmentId: 'dept-tech', purpose: 'a', tools: [] });
    createDesignedAgent({ name: 'Second', departmentId: 'dept-tech', purpose: 'b', tools: [] });
    const all = readDesignedAgents();
    expect(all).toHaveLength(2);
    expect(all[0].name).toBe('Second');
    expect(all[1].name).toBe('First');
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-09-15T12:00:00.000Z');
  it('handles null and empty gracefully', () => {
    expect(relativeTime(null, now)).toBe('—');
    expect(relativeTime(undefined, now)).toBe('—');
  });
  it('buckets seconds/minutes/hours/days', () => {
    expect(relativeTime(new Date(now - 10_000).toISOString(), now)).toBe('just now');
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5m ago');
    expect(relativeTime(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('3h ago');
    expect(relativeTime(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe('2d ago');
  });
});

describe('elapsedLabel / durationLabel', () => {
  it('formats sub-minute and multi-minute durations', () => {
    expect(elapsedLabel(9)).toBe('9s');
    expect(elapsedLabel(65)).toBe('1m 05s');
  });
  it('derives a real duration from two timestamps', () => {
    expect(durationLabel('2026-09-15T12:00:00.000Z', '2026-09-15T12:03:12.000Z')).toBe('3m 12s');
    expect(durationLabel('2026-09-15T12:00:00.000Z', '2026-09-15T11:59:00.000Z')).toBe('—');
  });
});

describe('ringFraction', () => {
  it('clamps to [0,1] and reads total<=0 as 0', () => {
    expect(ringFraction(2, 4)).toBe(0.5);
    expect(ringFraction(4, 4)).toBe(1);
    expect(ringFraction(9, 4)).toBe(1);
    expect(ringFraction(0, 0)).toBe(0);
  });
});

describe('heatmapDays', () => {
  const now = Date.parse('2026-09-15T12:00:00.000Z');
  it('produces exactly `days` buckets ending today, empty with no runs', () => {
    const days = heatmapDays([], 30, now);
    expect(days).toHaveLength(30);
    expect(days[days.length - 1].date).toBe('2026-09-15');
    expect(days.every((d) => d.tint === 'empty')).toBe(true);
  });
  it('tints a day err if any run that day failed, ok if all succeeded', () => {
    const days = heatmapDays(
      [
        { startedAt: '2026-09-15T09:00:00.000Z', ok: true },
        { startedAt: '2026-09-14T09:00:00.000Z', ok: true },
        { startedAt: '2026-09-14T15:00:00.000Z', ok: false },
      ],
      30,
      now,
    );
    const byDate = Object.fromEntries(days.map((d) => [d.date, d.tint]));
    expect(byDate['2026-09-15']).toBe('ok');
    expect(byDate['2026-09-14']).toBe('err');
    expect(byDate['2026-09-13']).toBe('empty');
  });
});

describe('parseToolsInput', () => {
  it('trims, dedupes, and drops empties', () => {
    expect(parseToolsInput('gmail, attio,  gmail ,,')).toEqual(['gmail', 'attio']);
    expect(parseToolsInput('')).toEqual([]);
  });
});

describe('shortSessionId', () => {
  it('takes the first 6 alnum characters', () => {
    expect(shortSessionId('a1b2c3d4-e5f6')).toBe('a1b2c3');
    expect(shortSessionId(null)).toBeNull();
    expect(shortSessionId('')).toBeNull();
  });
});
