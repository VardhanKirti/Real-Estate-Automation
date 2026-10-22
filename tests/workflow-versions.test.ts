process.env.GLADOS_DB = ':memory:';

import { describe, expect, test } from 'vitest';
import { GET as listVersions } from '@/app/api/workflows/[id]/versions/route';
import { POST as restoreVersion } from '@/app/api/workflows/[id]/versions/restore/route';
import { getDb } from '@/lib/data';
import type { Workflow } from '@/lib/schemas';

function workflow(id: string, title: string): Workflow {
  return {
    id,
    name: 'Versioned workflow',
    subtitle: 'Round-trips through the version log.',
    revenueUsd: 0,
    order: 0,
    steps: [
      {
        id: `${id}-s1`,
        title,
        detail: 'A step.',
        ownerKind: 'agent',
        owner: 'Bot',
        ownerAgentId: 'bot',
        hoursPerWeek: 1,
        tools: ['gmail'],
        edgeLabel: 'next',
        leakUsd: null,
        automation: null,
        branch: null,
        kind: 'ai-agent',
        config: { prompt: 'hello' },
        pos: { x: 10, y: 20 },
      },
    ],
    ratioTarget: 0.5,
  };
}

describe('workflow versions', () => {
  test('every save records a version; identical saves do not', () => {
    const db = getDb();
    db.workflows.insert(workflow('wf-v', 'First'), 'seed');
    db.workflows.insert(workflow('wf-v', 'First'), 'seed again');
    expect(db.workflowVersions.list('wf-v').map((v) => v.version)).toEqual([1]);
    db.workflows.insert(workflow('wf-v', 'Second'), 'renamed the step');
    const versions = db.workflowVersions.list('wf-v');
    expect(versions.map((v) => [v.version, v.note])).toEqual([
      [2, 'renamed the step'],
      [1, 'seed'],
    ]);
    // canvas fields survive the round trip
    const live = db.workflows.get('wf-v')!;
    expect(live.steps[0].kind).toBe('ai-agent');
    expect(live.steps[0].pos).toEqual({ x: 10, y: 20 });
    expect(live.steps[0].ownerAgentId).toBe('bot');
    expect(live.ratioTarget).toBe(0.5);
  });

  test('GET lists versions and POST restore appends a new version with the old content', async () => {
    const db = getDb();
    db.workflows.insert(workflow('wf-r', 'Original'), 'seed');
    db.workflows.insert(workflow('wf-r', 'Edited'), 'edit');
    const list = await listVersions(new Request('http://test'), { params: { id: 'wf-r' } });
    const { versions } = (await list.json()) as { versions: { id: string; version: number }[] };
    expect(versions.map((v) => v.version)).toEqual([2, 1]);

    const res = await restoreVersion(
      new Request('http://test', { method: 'POST', body: JSON.stringify({ versionId: 'wf-r-v1' }) }),
      { params: { id: 'wf-r' } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workflow: Workflow; versions: { version: number; note: string }[] };
    expect(body.workflow.steps[0].title).toBe('Original');
    expect(body.versions[0]).toMatchObject({ version: 3, note: 'restore of v1' });
    expect(db.workflows.get('wf-r')!.steps[0].title).toBe('Original');
  });

  test('restore refuses a version from another workflow', async () => {
    const db = getDb();
    db.workflows.insert(workflow('wf-a', 'A'), 'seed');
    db.workflows.insert(workflow('wf-b', 'B'), 'seed');
    const res = await restoreVersion(
      new Request('http://test', { method: 'POST', body: JSON.stringify({ versionId: 'wf-a-v1' }) }),
      { params: { id: 'wf-b' } },
    );
    expect(res.status).toBe(404);
  });
});
