import { afterEach, describe, expect, test } from 'vitest';
import { openDb, type GladosDb } from '@/lib/db';
import { createRuntime, type RuntimeAgent } from '@/lib/agents/runtime';

let db: GladosDb;

afterEach(() => {
  db?.close();
});

const okAgent: RuntimeAgent = {
  id: 'test-ok',
  name: 'OK Agent',
  description: 'Always succeeds',
  departmentId: 'dept-tech',
  async run() {
    return { ok: true, summary: 'did the thing', data: { count: 3 } };
  },
};

const failAgent: RuntimeAgent = {
  id: 'test-fail',
  name: 'Fail Agent',
  description: 'Always throws',
  departmentId: 'dept-tech',
  async run(): Promise<never> {
    throw new Error('connector exploded');
  },
};

describe('agent runtime', () => {
  test('lists registered agents', () => {
    db = openDb(':memory:');
    const runtime = createRuntime(db, [okAgent, failAgent]);
    expect(runtime.list().map((a) => a.id)).toEqual(['test-ok', 'test-fail']);
  });

  test('runs an agent and persists the run with its summary', async () => {
    db = openDb(':memory:');
    const runtime = createRuntime(db, [okAgent]);
    const run = await runtime.run('test-ok');
    expect(run.ok).toBe(true);
    expect(run.summary).toBe('did the thing');
    const stored = db.agentRuns.byAgent('test-ok');
    expect(stored).toHaveLength(1);
    expect(stored[0].ok).toBe(true);
    expect(stored[0].finishedAt >= stored[0].startedAt).toBe(true);
  });

  test('captures a throwing agent as a failed run instead of crashing', async () => {
    db = openDb(':memory:');
    const runtime = createRuntime(db, [failAgent]);
    const run = await runtime.run('test-fail');
    expect(run.ok).toBe(false);
    expect(run.summary).toContain('connector exploded');
    expect(db.agentRuns.byAgent('test-fail')).toHaveLength(1);
  });

  test('throws on an unknown agent id', async () => {
    db = openDb(':memory:');
    const runtime = createRuntime(db, [okAgent]);
    await expect(runtime.run('nope')).rejects.toThrow(/unknown agent/i);
  });

  test('agentRuns.recent returns newest first across agents', async () => {
    db = openDb(':memory:');
    const runtime = createRuntime(db, [okAgent, failAgent]);
    await runtime.run('test-ok');
    await runtime.run('test-fail');
    const recent = db.agentRuns.recent(10);
    expect(recent).toHaveLength(2);
    expect(recent[0].agentId).toBe('test-fail');
  });

  test('agentRuns.count is uncapped and latest is the newest run (SPEC C20)', async () => {
    db = openDb(':memory:');
    expect(db.agentRuns.count()).toBe(0);
    expect(db.agentRuns.latest()).toBeNull();
    for (let i = 0; i < 12; i++) {
      const ts = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
      db.agentRuns.insert({ id: `r${i}`, agentId: i % 2 ? 'a' : 'b', startedAt: ts, finishedAt: ts, ok: true, summary: `run ${i}` });
    }
    expect(db.agentRuns.recent(5)).toHaveLength(5);
    expect(db.agentRuns.count()).toBe(12);
    expect(db.agentRuns.latest()?.id).toBe('r11');
    expect(db.agentRuns.latest()).toEqual(db.agentRuns.recent(1)[0]);
  });
});
