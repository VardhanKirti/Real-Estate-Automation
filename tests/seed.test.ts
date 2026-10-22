import { afterEach, describe, expect, test } from 'vitest';
import { openDb, type GladosDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import { realAgents } from '@/lib/agents/real';

let db: GladosDb;

afterEach(() => {
  db?.close();
});

describe('seedDatabase (structural: a fresh install is blank)', () => {
  test('seeds the six operating pillars, in order, and nothing else the operator owns', () => {
    db = openDb(':memory:');
    seedDatabase(db);
    expect(db.departments.all().map((d) => d.name)).toEqual([
      'Sales',
      'Marketing/Growth',
      'TECH',
      'Finances',
      'Communications',
      'Clients',
    ]);
    expect(db.people.all()).toEqual([]);
    expect(db.tools.all()).toEqual([]);
    expect(db.roadmap.all()).toEqual([]);
    expect(db.metrics.all()).toEqual([]);
    expect(db.phases.all()).toEqual([]);
    expect(db.workflows.all()).toEqual([]);
    expect(db.skills.all()).toEqual([]);
    expect(db.agentTasks.all()).toEqual([]);
    expect(db.emailList.snapshots()).toEqual([]);
    expect(db.social.accounts()).toEqual([]);
  });

  test('the agent roster mirrors the runtime exactly — no larp in either direction', () => {
    db = openDb(':memory:');
    seedDatabase(db);
    const seeded = new Set(db.agents.all().map((a) => a.id));
    const runtime = new Set(realAgents.map((a) => a.id));
    expect(seeded).toEqual(runtime);
  });

  test('every agent belongs to an existing department', () => {
    db = openDb(':memory:');
    seedDatabase(db);
    const deptIds = new Set(db.departments.all().map((d) => d.id));
    for (const agent of db.agents.all()) expect(deptIds.has(agent.departmentId)).toBe(true);
  });

  test('agents are homed in the right department', () => {
    db = openDb(':memory:');
    seedDatabase(db);
    const byId = new Map(db.agents.all().map((a) => [a.id, a.departmentId]));
    for (const id of ['sales-agent', 'crm-pulse', 'deal-scanner', 'draft-approval-bot', 'inbound-watcher']) expect(byId.get(id)).toBe('dept-sales');
    for (const id of ['comms-agent', 'gsend-sender', 'daily-briefing', 'automation-jobs']) expect(byId.get(id)).toBe('dept-comms');
    for (const id of ['conductor', 'data-agent', 'markdown-auditor', 'vector-auditor', 'notion-sync', 'stack-monitor']) expect(byId.get(id)).toBe('dept-tech');
    for (const id of ['team-briefing', 'brand-deal-drafter', 'adscout']) expect(byId.get(id)).toBe('dept-marketing-growth');
    expect(byId.get('deal-alerts')).toBe('dept-clients');
  });

  test('workers are parented beneath the agent that delegates to them', () => {
    db = openDb(':memory:');
    seedDatabase(db);
    const byId = new Map(db.agents.all().map((a) => [a.id, a]));
    for (const w of ['inbound-watcher', 'brand-deal-drafter']) expect(byId.get(w)?.parentId).toBe('draft-approval-bot');
    for (const w of ['crm-pulse', 'deal-scanner', 'deal-alerts']) expect(byId.get(w)?.parentId).toBe('sales-agent');
    for (const w of ['markdown-auditor', 'vector-auditor']) expect(byId.get(w)?.parentId).toBe('data-agent');
    for (const top of ['comms-agent', 'draft-approval-bot', 'gsend-sender', 'daily-briefing', 'automation-jobs', 'conductor']) {
      expect(byId.get(top)?.parentId).toBeNull();
      expect(byId.get(top)?.tier).toBe('lead');
    }
    expect(byId.get('crm-pulse')?.tier).toBe('worker');
  });

  test('re-seeding retires departments and agents that left the model', () => {
    db = openDb(':memory:');
    seedDatabase(db);
    db.departments.insert({ id: 'dept-ghost', name: 'Ghost', slug: 'ghost', tagline: '', color: '#fff', order: 99 });
    db.agents.insert({
      id: 'ghost', departmentId: 'dept-tech', name: 'Ghost', role: 'r', status: 'active',
      tier: 'lead', description: '', model: 'm', tools: [], parentId: null, instance: 'builtin',
    });
    seedDatabase(db);
    expect(db.departments.all().some((d) => d.id === 'dept-ghost')).toBe(false);
    expect(db.agents.all().some((a) => a.id === 'ghost')).toBe(false);
  });

  test('is idempotent — seeding twice does not duplicate rows', () => {
    db = openDb(':memory:');
    seedDatabase(db);
    const before = { departments: db.departments.all().length, agents: db.agents.all().length };
    seedDatabase(db);
    expect(db.departments.all().length).toBe(before.departments);
    expect(db.agents.all().length).toBe(before.agents);
  });

  test('seeded data passes schema validation end to end', () => {
    db = openDb(':memory:');
    seedDatabase(db);
    expect(() => {
      db.departments.all();
      db.agents.all();
    }).not.toThrow();
  });
});
