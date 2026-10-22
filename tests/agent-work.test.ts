import { describe, expect, test } from 'vitest';
import { openDb } from '@/lib/db';
import { describeCron } from '@/lib/cron';

function db() {
  return openDb(':memory:');
}

const T = '2026-06-12T01:00:00Z';

describe('agentTasks — the tasks overhaul fields (docs/TASKS-REDESIGN.md)', () => {
  test('the new fields default, so old callers keep working', () => {
    const d = db();
    d.agentTasks.insert({ id: 't1', agentId: 'a', title: 'x', status: 'open', createdAt: T, updatedAt: T });
    expect(d.agentTasks.get('t1')).toMatchObject({
      detail: '', dueAt: null, priority: 'normal', ownerKind: 'agent', horizon: null, runId: null,
    });
  });

  test('an operator-owned task needs no agent; an agent-owned one does', () => {
    const d = db();
    d.agentTasks.insert({
      id: 'mine', agentId: null, ownerKind: 'me', title: 'Call the designer',
      status: 'open', createdAt: T, updatedAt: T, horizon: 'week',
    });
    expect(d.agentTasks.get('mine')).toMatchObject({ agentId: null, ownerKind: 'me', horizon: 'week' });
    expect(() =>
      d.agentTasks.insert({ id: 'bad', agentId: null, ownerKind: 'agent', title: 'x', status: 'open', createdAt: T, updatedAt: T }),
    ).toThrow();
  });

  test('blocked is a real status — the honest form of "on hold"', () => {
    const d = db();
    d.agentTasks.insert({ id: 't1', agentId: 'a', title: 'x', status: 'open', createdAt: T, updatedAt: T });
    d.agentTasks.setStatus('t1', 'blocked', '2026-06-12T02:00:00Z');
    expect(d.agentTasks.get('t1')!.status).toBe('blocked');
  });

  test('update patches only what it is given and bumps updatedAt', () => {
    const d = db();
    d.agentTasks.insert({ id: 't1', agentId: 'a', title: 'x', status: 'open', createdAt: T, updatedAt: T, detail: 'keep me' });
    d.agentTasks.update('t1', { dueAt: '2026-06-20T00:00:00Z', priority: 'high' }, '2026-06-13T00:00:00Z');
    expect(d.agentTasks.get('t1')).toMatchObject({
      detail: 'keep me', dueAt: '2026-06-20T00:00:00Z', priority: 'high', updatedAt: '2026-06-13T00:00:00Z',
    });
  });

  test('delegating moves a task from the operator lane to an agent', () => {
    const d = db();
    d.agentTasks.insert({ id: 't1', agentId: null, ownerKind: 'me', title: 'Ship it', status: 'open', createdAt: T, updatedAt: T });
    d.agentTasks.update('t1', { agentId: 'data-agent', ownerKind: 'agent' }, '2026-06-13T00:00:00Z');
    expect(d.agentTasks.get('t1')).toMatchObject({ agentId: 'data-agent', ownerKind: 'agent' });
  });

  test('update on a missing id is a no-op, not a throw', () => {
    const d = db();
    expect(() => d.agentTasks.update('nope', { title: 'x' }, T)).not.toThrow();
  });
});

describe('agentTasks repo', () => {
  test('insert + byAgent round-trips, newest first', () => {
    const d = db();
    d.agentTasks.insert({ id: 't1', agentId: 'social-agent', title: 'Draft 3 reels', status: 'open', createdAt: '2026-06-12T01:00:00Z', updatedAt: '2026-06-12T01:00:00Z' });
    d.agentTasks.insert({ id: 't2', agentId: 'social-agent', title: 'Schedule posts', status: 'open', createdAt: '2026-06-12T02:00:00Z', updatedAt: '2026-06-12T02:00:00Z' });
    d.agentTasks.insert({ id: 't3', agentId: 'crm-pulse', title: 'Other agent', status: 'open', createdAt: '2026-06-12T03:00:00Z', updatedAt: '2026-06-12T03:00:00Z' });
    const tasks = d.agentTasks.byAgent('social-agent');
    expect(tasks.map((t) => t.id)).toEqual(['t2', 't1']);
  });

  test('setStatus moves a task through open → doing → done and bumps updatedAt', () => {
    const d = db();
    d.agentTasks.insert({ id: 't1', agentId: 'a', title: 'x', status: 'open', createdAt: '2026-06-12T01:00:00Z', updatedAt: '2026-06-12T01:00:00Z' });
    d.agentTasks.setStatus('t1', 'doing', '2026-06-12T02:00:00Z');
    expect(d.agentTasks.byAgent('a')[0]).toMatchObject({ status: 'doing', updatedAt: '2026-06-12T02:00:00Z' });
    d.agentTasks.setStatus('t1', 'done', '2026-06-12T03:00:00Z');
    expect(d.agentTasks.byAgent('a')[0].status).toBe('done');
  });

  test('remove deletes; invalid status rejected', () => {
    const d = db();
    d.agentTasks.insert({ id: 't1', agentId: 'a', title: 'x', status: 'open', createdAt: '2026-06-12T01:00:00Z', updatedAt: '2026-06-12T01:00:00Z' });
    expect(() => d.agentTasks.setStatus('t1', 'bogus' as never, '2026-06-12T02:00:00Z')).toThrow();
    d.agentTasks.remove('t1');
    expect(d.agentTasks.byAgent('a')).toHaveLength(0);
  });
});

describe('agentCrons repo', () => {
  test('insert + byAgent + toggle round-trips', () => {
    const d = db();
    d.agentCrons.insert({ id: 'c1', agentId: 'social-agent', schedule: '0 9 * * 1-5', description: 'Morning content pass', enabled: true, createdAt: '2026-06-12T01:00:00Z' });
    const crons = d.agentCrons.byAgent('social-agent');
    expect(crons).toHaveLength(1);
    expect(crons[0]).toMatchObject({ schedule: '0 9 * * 1-5', enabled: true });
    d.agentCrons.setEnabled('c1', false);
    expect(d.agentCrons.byAgent('social-agent')[0].enabled).toBe(false);
  });

  test('rejects malformed cron schedules at the boundary', () => {
    const d = db();
    expect(() =>
      d.agentCrons.insert({ id: 'c1', agentId: 'a', schedule: 'not a cron', description: 'x', enabled: true, createdAt: '2026-06-12T01:00:00Z' }),
    ).toThrow();
  });

  test('all() lists across agents; remove deletes', () => {
    const d = db();
    d.agentCrons.insert({ id: 'c1', agentId: 'a', schedule: '*/15 * * * *', description: 'x', enabled: true, createdAt: '2026-06-12T01:00:00Z' });
    d.agentCrons.insert({ id: 'c2', agentId: 'b', schedule: '0 0 * * 0', description: 'y', enabled: true, createdAt: '2026-06-12T02:00:00Z' });
    expect(d.agentCrons.all()).toHaveLength(2);
    d.agentCrons.remove('c1');
    expect(d.agentCrons.all()).toHaveLength(1);
  });
});

describe('describeCron', () => {
  test('humanizes common schedules', () => {
    expect(describeCron('0 9 * * 1-5')).toBe('at 09:00, Mon–Fri');
    expect(describeCron('*/15 * * * *')).toBe('every 15 min');
    expect(describeCron('0 * * * *')).toBe('hourly at :00');
    expect(describeCron('0 0 * * 0')).toBe('at 00:00, Sun');
    expect(describeCron('30 8 * * *')).toBe('at 08:30, daily');
  });

  test('validates field count', () => {
    expect(describeCron('0 9 * *')).toBeNull();
    expect(describeCron('banana')).toBeNull();
  });
});
