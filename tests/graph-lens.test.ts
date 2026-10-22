import { describe, expect, test } from 'vitest';
import { openDb, type GladosDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import { realAgents } from '@/lib/agents/real';
import { buildKnowledgeGraph } from '@/lib/knowledge-graph';
import { ACTION_LENSES, ALL_LENSES, ENTITY_LENSES, FUNCTION_LENSES, lensNodeSet, type LensContext } from '@/lib/graph-lens';

function contextFromSeed(): LensContext {
  const db: GladosDb = openDb(':memory:');
  seedDatabase(db);
  const graph = buildKnowledgeGraph(db.agents.all(), db.departments.all(), db.people.all(), db.sopTasks.all());
  // dept resolver mirroring the component's teamForFocus: worker → its dept
  const deptOf = new Map<string, string>();
  for (const a of db.agents.all()) deptOf.set(`emp:${a.id}`, `team:${a.departmentId}`);
  for (const p of db.people.all()) deptOf.set(`person:${p.id}`, `team:${p.departmentId}`);
  return { nodes: graph.nodes, teamOf: (id) => deptOf.get(id) ?? null };
}

const ctx = contextFromSeed();

describe('graph lenses (roster realigned 2026-08-19)', () => {
  test('the requested categories all exist', () => {
    expect(ENTITY_LENSES.map((l) => l.label)).toEqual([
      'All people', 'Sub-agents', 'Tools', 'Workflows', 'SOPs', 'Projects', 'Teams', 'Departments',
    ]);
    expect(FUNCTION_LENSES.map((l) => l.label)).toEqual(['Core', 'Enabling']);
    expect(ACTION_LENSES).toHaveLength(9);
    expect(new Set(ALL_LENSES.map((l) => l.id)).size).toBe(ALL_LENSES.length);
  });

  test('entity lenses match by node kind against the seeded graph (blank install)', () => {
    expect(lensNodeSet('ent-people', ctx).size).toBe(0);
    expect(lensNodeSet('ent-subagents', ctx).size).toBe(realAgents.length);
    // A pillar with no agents projects no team node yet, so this is ≥ not =.
    expect(lensNodeSet('ent-departments', ctx).size).toBeGreaterThanOrEqual(5);
    expect(lensNodeSet('ent-sops', ctx).size).toBe(0);
    expect(lensNodeSet('ent-tools', ctx).size).toBe(0);
  });

  test('workflows and projects are honestly empty until modeled', () => {
    expect(lensNodeSet('ent-workflows', ctx).size).toBe(0);
    expect(lensNodeSet('ent-projects', ctx).size).toBe(0);
  });

  test('core and enabling split the pillars cleanly and light whole sectors', () => {
    const core = lensNodeSet('fn-core', ctx);
    const enabling = lensNodeSet('fn-enabling', ctx);
    expect(core.has('team:dept-sales')).toBe(true);
    expect(enabling.has('team:dept-tech')).toBe(true);
    // a node is never both core and enabling
    for (const id of core) expect(enabling.has(id), id).toBe(false);
    // sectors include their workers, not just the gateways
    expect(core.has('emp:sales-agent')).toBe(true);
  });

  test('venture team lenses are empty until ventures are configured', () => {
    expect(lensNodeSet('fn-anything', ctx).size).toBe(0);
    expect(lensNodeSet('ent-teams', ctx).size).toBe(0);
  });

  test('every action lens resolves to real seeded agents', () => {
    for (const lens of ACTION_LENSES) {
      const set = lensNodeSet(lens.id, ctx);
      expect(set.size, lens.label).toBeGreaterThan(0);
      for (const id of set) expect(id.startsWith('emp:'), `${lens.label} → ${id}`).toBe(true);
    }
  });

  test('specific action mappings hold', () => {
    expect(lensNodeSet('act-deal-triage', ctx).has('emp:draft-approval-bot')).toBe(true);
    expect(lensNodeSet('act-pipeline', ctx).has('emp:sales-agent')).toBe(true);
    expect(lensNodeSet('act-sending', ctx).has('emp:gsend-sender')).toBe(true);
    expect(lensNodeSet('act-retrieval', ctx).has('emp:data-agent')).toBe(true);
  });

  test('unknown lens returns an empty set, never throws', () => {
    expect(lensNodeSet('nope', ctx).size).toBe(0);
  });
});
