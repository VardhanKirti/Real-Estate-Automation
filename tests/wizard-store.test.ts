import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendMessages,
  applyTaskChanges,
  createProject,
  deleteProject,
  readProject,
  readProjects,
  setTaskState,
  updateProject,
  UNTITLED,
} from '@/lib/wizard/store';
import { projectProgress } from '@/lib/wizard/ui';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-'));
  process.env.WIZARD_DATA_DIR = tmp;
});
afterEach(() => {
  delete process.env.WIZARD_DATA_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('wizard projects', () => {
  it('creates, names from the first user line, resumes via sessionId', () => {
    const p = createProject();
    expect(p.name).toBe(UNTITLED);
    expect(p.status).toBe('active');
    appendMessages(p.id, [{ role: 'user', text: 'Close the Northwind deal\nand keep it moving', at: new Date().toISOString() }]);
    expect(readProject(p.id)?.name).toBe('Close the Northwind deal and keep it moving');
    updateProject(p.id, { sessionId: 'sess-1', model: 'claude-opus-5', addCostUsd: 0.12 });
    const back = readProject(p.id)!;
    expect(back.sessionId).toBe('sess-1');
    expect(back.totalCostUsd).toBeCloseTo(0.12);
    deleteProject(p.id);
    expect(readProjects()).toHaveLength(0);
  });

  it('progress is structural: null without tasks, done/total with them', () => {
    const p = createProject({ name: 'Cut verticals' });
    expect(projectProgress(p)).toBeNull();
    applyTaskChanges(p.id, {
      add: [
        { title: 'Cut 1-3', ownerId: 'carti', ownerName: 'Playboi Carti' },
        { title: 'Cut 4-6', ownerId: 'carti', ownerName: 'Playboi Carti' },
      ],
    });
    expect(projectProgress(readProject(p.id)!)).toEqual({ done: 0, total: 2 });
    applyTaskChanges(p.id, { done: ['cut 1-3'] });
    const after = readProject(p.id)!;
    expect(projectProgress(after)).toEqual({ done: 1, total: 2 });
    expect(after.status).toBe('active');
  });

  it('auto-completes when every task is done and reopens on a task reopen', () => {
    const p = createProject({ name: 'Brief' });
    applyTaskChanges(p.id, { add: [{ title: 'Move summary up', ownerId: null, ownerName: 'Wizard' }] });
    applyTaskChanges(p.id, { done: ['Move summary'] }); // prefix match
    expect(readProject(p.id)?.status).toBe('done');
    const task = readProject(p.id)!.tasks[0];
    setTaskState(p.id, task.id, 'open');
    expect(readProject(p.id)?.status).toBe('active');
  });

  it('migrates legacy threads.json into projects once', () => {
    fs.writeFileSync(
      path.join(tmp, 'threads.json'),
      JSON.stringify([
        {
          id: 'wt-old1',
          title: 'Old thread',
          projectId: null,
          sessionId: 'sess-old',
          model: null,
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
          messages: [{ role: 'user', text: 'hi', at: '2026-09-01T00:00:00.000Z' }],
        },
      ]),
    );
    const projects = readProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ id: 'wt-old1', name: 'Old thread', sessionId: 'sess-old', tasks: [] });
    expect(fs.existsSync(path.join(tmp, 'projects.json'))).toBe(true);
  });
});
