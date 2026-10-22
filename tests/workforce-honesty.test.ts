import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { leafPositions, r2 } from '@/components/SkillHierarchy';

/**
 * Phase 0 lane 0d (SPEC §3.4 H25 to H32, GP5): the honesty fixes on the
 * workforce pages, in the shared code both styles render. Source scans guard
 * the copy and wiring; the logic itself is unit-tested in
 * tasks-metrics.test.ts and inbox-triage.test.ts.
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('workforce honesty (both styles)', () => {
  test('H25: the agent profile has no "Send a directive" input', () => {
    const s = src('components/AgentPanel.tsx');
    expect(s).not.toMatch(/placeholder="Send a directive/);
    expect(s).not.toMatch(/<input\b/);
    expect(s).not.toMatch(/submitDirective/);
  });

  test('H27: run empty states never claim nothing has run, and tabs say Last N days', () => {
    expect(src('components/tasks/ActivityGraph.tsx')).not.toMatch(/Nothing has run on this/);
    const trend = src('components/tasks/OutcomeTrend.tsx');
    expect(trend).not.toMatch(/First \{w\} days/);
    expect(trend).toMatch(/Last \{w\} days/);
    const empty = src('components/tasks/RunsEmpty.tsx');
    expect(empty).toMatch(/last run \{sinceText/);
    expect(empty).toMatch(/Widen to/);
  });

  test('H28: to-do rows are not labels around a button; the toggle says Open only', () => {
    expect(src('components/tasks/Board.tsx')).not.toMatch(/<label\b/);
    const workload = src('components/tasks/WorkloadTable.tsx');
    expect(workload).toMatch(/Open only/);
    expect(workload).not.toMatch(/^\s*Filters\s*$/m);
  });

  test('H28: skill hierarchy coordinates are rounded so server and client agree', () => {
    for (const mode of ['compact', 'bloom'] as const) {
      for (const p of leafPositions(9, 0.7, 123.456789, -98.7654321, mode)) {
        expect(p.x).toBe(r2(p.x));
        expect(p.y).toBe(r2(p.y));
      }
    }
    expect(src('components/SkillHierarchy.tsx')).toMatch(/const spoke = r2\(/);
  });

  test('H29: the workflow timer is hidden unless a run sets is-timing', () => {
    expect(src('components/workflow-canvas/canvas.css')).toMatch(
      /\.dock-bar:not\(\.is-timing\) \.bar-timer \{ display: none; \}/,
    );
    const engine = src('components/workflow-canvas/engine.ts');
    expect(engine).toMatch(/classList\.add\('is-timing'\)/);
    expect(engine).toMatch(/classList\.remove\('is-timing'\)/);
  });

  test('H30: Wizard delete goes through a confirm; crew states its window', () => {
    const conv = src('components/wizard/Conversation.tsx');
    expect(conv).toMatch(/<DeleteProjectConfirm onDelete=\{onDelete\} disabled=\{pending\} \/>/);
    expect(conv).not.toMatch(/onClick=\{onDelete\}/);
    const confirm = src('components/wizard/DeleteProjectConfirm.tsx');
    expect(confirm).toMatch(/Delete this project and its history\?/);
    expect(confirm).toMatch(/role="alertdialog"/);
    expect(src('components/wizard/CrewPanel.tsx')).toMatch(/runs · \{crew\.windowDays\} days/);
  });

  test('H31 (Classic minimum): non-clickable org and roadmap items do not lift on hover', () => {
    expect(src('app/roadmap/page.tsx')).not.toMatch(/hoverable/);
    const org = src('app/org/page.tsx');
    // only the System cards, which are links, keep the hover lift
    expect(org.match(/hoverable/g) ?? []).toHaveLength(1);
    expect(org).toMatch(/<Link\s+href=\{href\}\s+className="hoverable/);
  });

  test('H32: Inbox Done and Snooze go through the triage store and say where they are saved', () => {
    // the behaviour moved into the hook both trees share (glados-ui X5)
    const ws = src('components/inbox/useInboxWorkspace.ts');
    expect(ws).toMatch(/from '@\/lib\/inbox-triage'/);
    expect(ws).toMatch(/Saved on this browser\./);
    expect(ws).toMatch(/label: 'Undo'/);
  });
});
