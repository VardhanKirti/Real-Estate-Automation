import { describe, expect, test } from 'vitest';
import {
  taskStats, formatRuntime, taskOverview, workloadRows,
  activityByWeekday, outcomeTrend, todoGroups, resolveRange,
  deltaIfMeaningful, latestRunAt, sinceText, rangeContaining,
} from '@/lib/tasks-metrics';
import type { AgentRun, AgentTask, Agent, Department } from '@/lib/schemas';

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0); // Mon 15 Jun 2026
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const task = (p: Partial<AgentTask> & { id: string }): AgentTask => ({
  agentId: 'a1', title: 't', status: 'open', createdAt: at(1), updatedAt: at(1),
  detail: '', dueAt: null, priority: 'normal', ownerKind: 'agent', horizon: null, runId: null,
  ...p,
});
const run = (p: Partial<AgentRun> & { id: string }): AgentRun => ({
  agentId: 'a1', startedAt: at(1), finishedAt: at(1), ok: true, summary: '', ...p,
});

describe('resolveRange', () => {
  test('defaults to 30 days and ignores junk', () => {
    expect(resolveRange(null).id).toBe('30d');
    expect(resolveRange('nope').id).toBe('30d');
    expect(resolveRange('7d').id).toBe('7d');
  });
});

describe('taskStats', () => {
  test('counts the window and compares against the one before it', () => {
    const prevWindow = [8, 9, 10, 11, 12].map((d) => task({ id: `p${d}`, createdAt: at(d) }));
    const s = taskStats(
      [
        task({ id: 'a', createdAt: at(2) }), task({ id: 'b', createdAt: at(3) }),
        task({ id: 'c', createdAt: at(4) }), ...prevWindow,
      ],
      [], 7, NOW,
    );
    expect(s.total.value).toBe(3);   // 3 in the window
    expect(s.total.prev).toBe(5);
    expect(s.total.delta).toBe(-40); // against 5 in the window before it
  });

  test('small base: a previous window under 5 tasks hides the delta (H26)', () => {
    const s = taskStats(
      [
        ...[1, 2, 3, 4, 5, 6].map((d) => task({ id: `n${d}`, createdAt: at(d) })),
        task({ id: 'old', createdAt: at(12) }),
      ],
      [], 7, NOW,
    );
    expect(s.total.value).toBe(6);
    expect(s.total.delta).toBeNull(); // was "500%" off a base of 1
  });

  test('runtime with no runs in the window has no delta and keeps the last run', () => {
    const old = Array.from({ length: 12 }, (_, i) =>
      run({ id: `o${i}`, startedAt: at(40 + i), finishedAt: at(40 + i) }),
    );
    const s = taskStats([], old, 30, NOW);
    expect(s.runsInWindow).toBe(0);
    expect(s.runtimeMs!.delta).toBeNull(); // never "down 100%"
    expect(s.lastRunAt).toBe(at(40));
  });

  test('runtime delta needs at least 10 runs in the previous window', () => {
    const cur = [1, 2].map((d) => run({ id: `c${d}`, startedAt: at(d), finishedAt: new Date(NOW - d * DAY + 60_000).toISOString() }));
    const prev = (n: number) => Array.from({ length: n }, (_, i) =>
      run({ id: `p${i}`, startedAt: at(10), finishedAt: new Date(NOW - 10 * DAY + 60_000).toISOString() }));
    expect(taskStats([], [...cur, ...prev(9)], 7, NOW).runtimeMs!.delta).toBeNull();
    expect(taskStats([], [...cur, ...prev(10)], 7, NOW).runtimeMs!.delta).toBe(-80);
  });

  test('a delta from nothing is null, never a percentage', () => {
    const s = taskStats([task({ id: 'a', createdAt: at(1) })], [], 7, NOW);
    expect(s.total.delta).toBeNull();
  });

  test('overdue is null when no task carries a due date', () => {
    expect(taskStats([task({ id: 'a' })], [], 30, NOW).overdue).toBeNull();
  });

  test('overdue counts only past-due, not-done tasks that have a date', () => {
    const s = taskStats(
      [
        task({ id: 'late', dueAt: at(2) }),
        task({ id: 'late-but-done', dueAt: at(2), status: 'done' }),
        task({ id: 'future', dueAt: at(-5) }),
        task({ id: 'undated' }),
      ],
      [], 30, NOW,
    );
    expect(s.overdue).toBe(1);
  });

  test('runtime is null until something has actually run', () => {
    expect(taskStats([task({ id: 'a' })], [], 30, NOW).runtimeMs).toBeNull();
  });

  test('runtime sums real run durations in the window', () => {
    const s = taskStats([], [
      run({ id: 'r1', startedAt: at(1), finishedAt: new Date(NOW - DAY + 30 * 60_000).toISOString() }),
      run({ id: 'r2', startedAt: at(2), finishedAt: new Date(NOW - 2 * DAY + 90 * 60_000).toISOString() }),
      run({ id: 'old', startedAt: at(60), finishedAt: at(60) }),
    ], 30, NOW);
    expect(s.runtimeMs!.value).toBe(120 * 60_000);
  });

  test('needsYou counts blocked, inProgress counts doing', () => {
    const s = taskStats(
      [task({ id: 'a', status: 'blocked' }), task({ id: 'b', status: 'doing' }), task({ id: 'c' })],
      [], 30, NOW,
    );
    expect(s.needsYou).toBe(1);
    expect(s.inProgress).toBe(1);
  });
});

test('formatRuntime matches the reference format', () => {
  expect(formatRuntime(142 * 3600_000 + 40 * 60_000)).toBe('142h 40m');
  expect(formatRuntime(25 * 60_000)).toBe('25m');
});

describe('taskOverview', () => {
  test('monthly returns 12 buckets ending on the current month', () => {
    const b = taskOverview([], 'monthly', NOW);
    expect(b).toHaveLength(12);
    expect(b[11].label).toBe('Jun');
  });

  test('pending and completed are counted on different timestamps', () => {
    const b = taskOverview(
      [
        task({ id: 'open-now', createdAt: at(1) }),
        task({ id: 'done-now', status: 'done', createdAt: at(200), updatedAt: at(1) }),
      ],
      'monthly', NOW,
    );
    expect(b[11]).toMatchObject({ pending: 1, completed: 1 });
  });

  test('daily is a trailing fortnight, yearly is five years', () => {
    expect(taskOverview([], 'daily', NOW)).toHaveLength(14);
    expect(taskOverview([], 'yearly', NOW)).toHaveLength(5);
  });
});

describe('workloadRows', () => {
  const agents = [
    { id: 'a1', departmentId: 'd1', name: 'Data Agent' },
    { id: 'a2', departmentId: 'd1', name: 'Sales Agent' },
    { id: 'idle', departmentId: 'd1', name: 'Idle Agent' },
  ] as unknown as Agent[];
  const depts = [{ id: 'd1', name: 'Tech', color: '#0f0' }] as unknown as Department[];

  test('only agents holding work appear, busiest first', () => {
    const rows = workloadRows(
      [
        task({ id: '1', agentId: 'a1' }), task({ id: '2', agentId: 'a1', status: 'doing' }),
        task({ id: '3', agentId: 'a1', status: 'done' }), task({ id: '4', agentId: 'a2' }),
      ],
      agents, depts,
    );
    expect(rows.map((r) => r.agentId)).toEqual(['a1', 'a2']);
    expect(rows[0]).toMatchObject({ assigned: 3, completed: 1, ongoing: 1, pending: 1, department: 'Tech' });
  });

  test('load is banded against the fleet, not an invented threshold', () => {
    const rows = workloadRows(
      [
        ...Array.from({ length: 8 }, (_, i) => task({ id: `h${i}`, agentId: 'a1' })),
        task({ id: 'l1', agentId: 'a2' }),
      ],
      agents, depts,
    );
    expect(rows.find((r) => r.agentId === 'a1')!.load).toBe('high');
  });

  test('operator-owned tasks never land in the agent workload', () => {
    const rows = workloadRows([task({ id: 'mine', agentId: null, ownerKind: 'me' })], agents, depts);
    expect(rows).toEqual([]);
  });
});

describe('activityByWeekday', () => {
  test('null when nothing has run — the panel says so instead of drawing zero', () => {
    expect(activityByWeekday([], 30, NOW)).toBeNull();
  });

  test('success rate per weekday, Monday first', () => {
    const a = activityByWeekday(
      [
        run({ id: 'r1', startedAt: at(0.2), ok: true }),   // Mon
        run({ id: 'r2', startedAt: at(0.2), ok: false }),  // Mon
        run({ id: 'r3', startedAt: at(4), ok: true }),   // Thu
      ],
      30, NOW,
    )!;
    expect(a.days[0].label).toBe('Mon');
    expect(a.days[0]).toMatchObject({ pct: 50, runs: 2 });
    expect(a.pct).toBe(67);
    expect(a.peakRuns).toBe(2);
  });
});

describe('outcomeTrend', () => {
  test('null with no runs; otherwise splits succeeded and failed per day', () => {
    expect(outcomeTrend([], 4, NOW)).toBeNull();
    const t = outcomeTrend(
      [run({ id: 'r1', startedAt: at(0.2), ok: true }), run({ id: 'r2', startedAt: at(0.2), ok: false })],
      4, NOW,
    )!;
    expect(t.points).toHaveLength(4);
    expect({ s: t.succeeded, f: t.failed }).toEqual({ s: 1, f: 1 });
  });
});

describe('todoGroups', () => {
  test('groups the operator lane by horizon and hides nothing', () => {
    const g = todoGroups([
      task({ id: 'w', agentId: null, ownerKind: 'me', horizon: 'week' }),
      task({ id: 'u', agentId: null, ownerKind: 'me' }),
      task({ id: 'done', agentId: null, ownerKind: 'me', horizon: 'week', status: 'done' }),
      task({ id: 'fleet' }),
    ]);
    expect(g.map((x) => x.id)).toEqual(['week', 'unsorted']);
    expect(g[0].tasks.map((t) => t.id)).toEqual(['w']);
  });
});

describe('GET /api/tasks/export', () => {
  test('serves a CSV download with a header row', async () => {
    const { GET } = await import('@/app/api/tasks/export/route');
    const res = await GET(new Request('http://localhost/api/tasks/export?range=90d'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('tasks-90d.csv');
    const body = await res.text();
    expect(body.split('\n')[0]).toBe(
      'id,title,status,priority,owner,assignee,horizon,due_at,created_at,updated_at,detail',
    );
  });
});

describe('small-base helpers (H26, H27)', () => {
  test('deltaIfMeaningful hides deltas under the threshold or from zero', () => {
    expect(deltaIfMeaningful(17, 2, 5)).toBeNull();
    expect(deltaIfMeaningful(5, 0, 0)).toBeNull();
    expect(deltaIfMeaningful(6, 5, 5)).toBe(20);
    expect(deltaIfMeaningful(0, 10, 5)).toBe(-100);
  });

  test('latestRunAt picks the newest start in any order', () => {
    expect(latestRunAt([])).toBeNull();
    expect(latestRunAt([run({ id: 'a', startedAt: at(9) }), run({ id: 'b', startedAt: at(3) })])).toBe(at(3));
  });

  test('sinceText reads in days past 48 hours', () => {
    expect(sinceText(at(46), NOW)).toBe('46d ago');
    expect(sinceText(new Date(NOW - 5 * 3600_000).toISOString(), NOW)).toBe('5h ago');
  });

  test('rangeContaining offers the smallest page range holding the run', () => {
    expect(rangeContaining(at(46), NOW)!.id).toBe('90d');
    expect(rangeContaining(at(3), NOW)!.id).toBe('7d');
    expect(rangeContaining(at(400), NOW)).toBeNull();
  });
});
