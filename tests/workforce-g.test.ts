import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { G_READY, G_TREE_FILES, usesGTree } from '@/lib/appearance';
import { dailyRunCounts, runAge } from '@/lib/agent-runs-view';
import { domainOf } from '@/components/skills/SkillsG';

/**
 * Workforce under the GladOS style (docs/projects/glados-ui/SPEC.md S04, Phase 3 lane W).
 * Source scans for AC04.1 / AC04.2 on the GladOS-tree files, the lane's G_READY
 * registration, and the pure helpers the trees lean on.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
/** Source without comments, so the scans judge code and copy, not the notes that explain a cut. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ROUTES = ['/agents', '/agents/setup/:id', '/tasks', '/wizard', '/inbox', '/skills', '/org', '/roadmap', '/workflows'];
const G_FILES = [
  'components/agents/AgentsG.tsx',
  'components/agents/AgentCard.tsx',
  'components/agents/AgentFace.tsx',
  'components/agents/AgentSheet.tsx',
  'components/agents/SheetChat.tsx',
  'components/agents/SheetWork.tsx',
  'components/agents/SetupG.tsx',
  'components/tasks/TasksG.tsx',
  'components/tasks/TimeGrid.tsx',
  'components/wizard/WizardG.tsx',
  'components/inbox/InboxG.tsx',
  'components/skills/SkillsG.tsx',
  'components/org/OrgG.tsx',
  'components/roadmap/RoadmapG.tsx',
  'components/workflow-canvas/kit.ts',
];

describe('lane W routes are converted', () => {
  test('every workforce route is in G_READY with its tree files', () => {
    for (const r of ROUTES) {
      expect(G_READY, r).toContain(r);
      expect(G_TREE_FILES[r]?.length ?? 0, r).toBeGreaterThan(0);
    }
  });
  test('the dynamic setup route is matched by its pattern, not a concrete id', () => {
    expect(usesGTree({ ui: 'glados' }, '/agents/setup/:id')).toBe(true);
    expect(usesGTree({ ui: 'classic' }, '/agents/setup/:id')).toBe(false);
  });
});

describe('AC04.1 / AC04.2: the GladOS trees carry no literal colours and no Classic surfaces', () => {
  for (const f of G_FILES) {
    test(f, () => {
      const src = read(f);
      expect(src).not.toMatch(/['"`]#[0-9a-fA-F]{3,8}['"`]/);
      expect(src).not.toMatch(/rgba?\(/);
      for (const cls of ['glass-panel', 'glass-label', 'glass-chip', 'hoverable', 'rounded-lg-t', 'c-pop', 'c-btn']) expect(src, cls).not.toContain(cls);
    });
  }
  test('the workforce CSS block uses tokens only', () => {
    const css = read('app/globals.css');
    const start = css.indexOf('/* ── W workforce (G)');
    const end = css.indexOf('/* ── end W workforce (G) ── */');
    expect(start).toBeGreaterThan(0);
    const block = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/rgba?\(/);
  });
});

describe('honest copy in the GladOS trees', () => {
  test('AgentSheet has no directive input (AC04.9) and no Logic restatement', () => {
    const src = code('components/agents/AgentSheet.tsx');
    expect(src).not.toMatch(/directive/i);
    expect(src).not.toContain('buildLogicRules');
  });
  test('Tasks: no window.prompt (AC04.15), no "My Schedule" or "My Activity" (AC04.17), honest run empty copy (AC04.14)', () => {
    const src = code('components/tasks/TasksG.tsx') + code('components/tasks/TimeGrid.tsx');
    expect(src).not.toContain('window.prompt');
    expect(src).not.toMatch(/My Schedule|My Activity/);
    expect(src).not.toContain('Nothing has run on this install');
    expect(src).toContain('last run ${sinceText(lastRunAt, now)}');
    expect(src).toMatch(/Widen to \$\{/);
  });
  test('Wizard delete goes through a confirm (AC04.24) and the crew states its window (AC04.26)', () => {
    const src = code('components/wizard/WizardG.tsx');
    expect(src).toMatch(/<GDialog[\s\S]{0,200}Delete this project and its history\?/);
    expect(src).toContain('Agent performance · ${crew.windowDays} days');
    expect(src).toContain('with no runs');
  });
  test('Inbox: no "Channels live" card and no n/n connected in the header (AC04.34)', () => {
    const src = code('components/inbox/InboxG.tsx');
    expect(src).not.toContain('Channels live');
    expect(src).not.toContain('connectedCount');
  });
  test('Roadmap: no strike-through and no hover lift on items (AC04.31)', () => {
    const src = code('components/roadmap/RoadmapG.tsx');
    expect(src).not.toMatch(/line-through/);
    expect(src).not.toContain('href=');
  });
  test('Org: no life-area legend, spark tiles or tool chips (AC04.30)', () => {
    const src = code('components/org/OrgG.tsx');
    expect(src).not.toMatch(/Life areas|SparkIcon|Agent tools/);
  });
});

describe('run helpers (F0.2, F-A2)', () => {
  const day = 86_400_000;
  const now = Date.UTC(2026, 9, 9, 12);
  test('dailyRunCounts buckets by day, oldest first, and ignores runs outside the window', () => {
    const runs = [
      { startedAt: new Date(now - 1000).toISOString() },
      { startedAt: new Date(now - 1000).toISOString() },
      { startedAt: new Date(now - 2 * day).toISOString() },
      { startedAt: new Date(now - 40 * day).toISOString() },
      { startedAt: 'not a date' },
    ];
    const out = dailyRunCounts(runs, 7, now);
    expect(out).toHaveLength(7);
    expect(out[6]).toBe(2);
    expect(out[4]).toBe(1);
    expect(out.reduce((a, b) => a + b, 0)).toBe(3);
  });
  test('runAge reads minutes, hours and days, and null without a run', () => {
    expect(runAge(null, now)).toBeNull();
    expect(runAge(new Date(now - 30_000).toISOString(), now)).toBe('just now');
    expect(runAge(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5 min ago');
    expect(runAge(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('3 h ago');
    expect(runAge(new Date(now - 46 * day).toISOString(), now)).toBe('46 d ago');
  });
  test('domainOf takes the part before the slash, or the whole group (S04 edge 10)', () => {
    expect(domainOf('Engineering/Quality')).toBe('Engineering');
    expect(domainOf('General')).toBe('General');
  });
});
