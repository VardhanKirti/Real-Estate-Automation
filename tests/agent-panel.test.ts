import { describe, expect, test } from 'vitest';
import {
  buildLogicRules,
  buildStepTree,
  connectedChips,
  resolveWorksWith,
} from '@/app/agents/panel-data';
import type { Agent, AgentRun, Skill } from '@/lib/schemas';

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: 'conductor',
  departmentId: 'dept-tech',
  name: 'Conductor',
  role: 'Broadcast & Orchestration',
  status: 'active',
  tier: 'lead',
  description: 'Fans a directive out to every agent at once and collects the replies. The GladOS broadcast runtime.',
  model: 'fan-out runtime',
  tools: ['broadcast', 'tmux'],
  parentId: null,
  instance: 'glados-core',
  ...over,
});

const run = (over: Partial<AgentRun> = {}): AgentRun => ({
  id: 'run-1',
  agentId: 'conductor',
  startedAt: '2026-08-24T07:04:19.000Z',
  finishedAt: '2026-08-24T07:04:26.000Z',
  ok: true,
  summary: 'Fanned the directive to 16 agents · 16 acknowledged in 1.9s',
  ...over,
});

const skill = (over: Partial<Skill> = {}): Skill => ({
  id: 'skill-learn',
  name: 'Learn loop',
  category: 'Ops',
  description: 'Turns a correction into a routed, permanent lesson in the brain.',
  ownerAgentId: 'data-agent',
  status: 'live',
  tools: ['gbrain'],
  markdown: '# Learn loop',
  order: 0,
  ...over,
});

describe('buildStepTree', () => {
  test('splits the description into one step per sentence', () => {
    const steps = buildStepTree(agent(), null, []);
    expect(steps.map((s) => s.source)).toEqual(['description', 'description']);
    expect(steps[0].label).toBe('Fans a directive out to every agent at once and collects the replies.');
    expect(steps[1].label).toBe('The GladOS broadcast runtime.');
  });

  test('splits a latest run summary into one step per clause', () => {
    const steps = buildStepTree(
      agent({ description: 'Watches ports and disks.' }),
      run({ summary: '12 services up · disk 38% · bridge healthy' }),
      [],
    );
    const runSteps = steps.filter((s) => s.source === 'run');
    expect(runSteps.map((s) => s.label)).toEqual(['12 services up', 'disk 38%', 'bridge healthy']);
  });

  test('adds one step for a single owned skill, naming it', () => {
    const steps = buildStepTree(agent({ description: 'Retrieves pages.' }), null, [skill()]);
    const skillStep = steps.find((s) => s.source === 'skill');
    expect(skillStep?.label).toBe('Draws on its "Learn loop" skill');
  });

  test('collapses multiple owned skills into a single step listing all names', () => {
    const steps = buildStepTree(agent({ description: 'Sorts charges.' }), null, [
      skill({ id: 'skill-recon', name: 'Statement reconcile' }),
      skill({ id: 'skill-pricing', name: 'Pricing model' }),
    ]);
    const skillSteps = steps.filter((s) => s.source === 'skill');
    expect(skillSteps).toHaveLength(1);
    expect(skillSteps[0].label).toBe('Draws on 2 owned skills: Statement reconcile, Pricing model');
  });

  test('never pads — an agent with a one-sentence description and no run/skill gets exactly one step', () => {
    const steps = buildStepTree(agent({ description: 'Watches the bridge.' }), null, []);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual({ id: 'desc-0', label: 'Watches the bridge.', source: 'description' });
  });
});

describe('resolveWorksWith', () => {
  const all: Agent[] = [
    agent({ id: 'data-agent', name: 'G-Brain', parentId: null }),
    agent({ id: 'vector-auditor', name: 'Vector Auditor', parentId: 'data-agent' }),
    agent({ id: 'markdown-auditor', name: 'Markdown Auditor', parentId: 'data-agent' }),
    agent({ id: 'conductor', name: 'Conductor', parentId: null }),
  ];

  test('resolves the parent from parentId when it exists in the roster', () => {
    const entries = resolveWorksWith(all[1], all); // vector-auditor
    expect(entries).toContainEqual({ agent: all[0], relation: 'parent' });
  });

  test('resolves children as every agent whose parentId points back at this one', () => {
    const entries = resolveWorksWith(all[0], all); // data-agent
    const children = entries.filter((e) => e.relation === 'child').map((e) => e.agent.name);
    expect(children).toEqual(['Markdown Auditor', 'Vector Auditor']); // sorted by name
  });

  test('an agent with no parentId and no children resolves to an empty list', () => {
    expect(resolveWorksWith(all[3], all)).toEqual([]); // conductor
  });

  test('a dangling parentId that is not in the roster resolves to no parent entry', () => {
    const orphan = agent({ id: 'orphan', parentId: 'nobody' });
    expect(resolveWorksWith(orphan, all)).toEqual([]);
  });
});

describe('connectedChips', () => {
  test('unions the agent tools with its owned skills\' names and tools, deduped', () => {
    const a = agent({ tools: ['gbrain', 'claude-code'] });
    const chips = connectedChips(a, [skill({ name: 'Learn loop', tools: ['gbrain'] })]);
    expect(chips).toEqual(['Learn loop', 'gbrain', 'claude-code']);
  });

  test('an agent with no tools and no owned skills has no chips', () => {
    expect(connectedChips(agent({ tools: [] }), [])).toEqual([]);
  });
});

describe('buildLogicRules', () => {
  test('states the parent relation as a routing rule when a parent exists', () => {
    const a = agent({ id: 'vector-auditor', parentId: 'data-agent' });
    const dataAgent = agent({ id: 'data-agent', name: 'G-Brain' });
    const rules = buildLogicRules(a, resolveWorksWith(a, [a, dataAgent]), [], null);
    expect(rules[0]).toBe("Reports to G-Brain — its output rolls up into that agent's directive.");
  });

  test('states coordinated children by name', () => {
    const a = agent({ id: 'data-agent', name: 'G-Brain', parentId: null });
    const child = agent({ id: 'vector-auditor', name: 'Vector Auditor', parentId: 'data-agent' });
    const rules = buildLogicRules(a, resolveWorksWith(a, [a, child]), [], null);
    expect(rules).toContain('Coordinates 1 sub-agent: Vector Auditor.');
  });

  test('quotes the latest run\'s real outcome and summary', () => {
    const a = agent({ id: 'crm-pulse', name: 'Attio CRM', parentId: 'drake', status: 'planned' });
    const drake = agent({ id: 'drake', name: 'Drake' });
    const failedRun = run({ ok: false, summary: 'Attio CRM is specced, not built — nothing to run yet' });
    const rules = buildLogicRules(a, resolveWorksWith(a, [a, drake]), [], failedRun);
    expect(rules).toContain(
      'Last recorded run reported failure: "Attio CRM is specced, not built — nothing to run yet".',
    );
  });

  test('falls back to the agent\'s own description when nothing else is derivable', () => {
    const a = agent({ id: 'lonely', name: 'Lonely', parentId: null, description: 'Does one thing quietly.' });
    const rules = buildLogicRules(a, [], [], null);
    expect(rules).toEqual(['Does one thing quietly.']);
  });

  test('caps at 4 rules even when every source is derivable', () => {
    const a = agent({ id: 'busy', name: 'Busy', parentId: 'boss' });
    const boss = agent({ id: 'boss', name: 'Boss' });
    const child = agent({ id: 'helper', name: 'Helper', parentId: 'busy' });
    const rules = buildLogicRules(
      a,
      resolveWorksWith(a, [a, boss, child]),
      [skill({ name: 'Some skill' })],
      run(),
    );
    expect(rules.length).toBeLessThanOrEqual(4);
  });
});
