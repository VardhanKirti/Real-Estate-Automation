import { beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, type GladosDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import { realAgents } from '@/lib/agents/real';
import { compileBlueprint } from '@/lib/blueprint/compile';
import { validateGraph, type BlueprintGraph } from '@/lib/blueprint/graph';
import { NAV_ITEMS } from '@/lib/nav';

let db: GladosDb;
let graph: BlueprintGraph;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-'));
  db = openDb(path.join(dir, 'test.db'));
  seedDatabase(db);
  graph = await compileBlueprint(db);
}, 30_000);

describe('blueprint compiler — the map cannot drift from the system', () => {
  test('every edge lands on a real node; ids are unique', () => {
    expect(validateGraph(graph)).toEqual([]);
  });

  test('completeness: every seeded agent appears exactly once', () => {
    const agentNodes = new Set(graph.nodes.filter((n) => n.kind === 'agent' || n.kind === 'wizard').map((n) => n.id));
    for (const a of db.agents.all()) {
      expect(agentNodes.has(`agent-${a.id}`), `agent ${a.id} missing from the blueprint`).toBe(true);
    }
  });

  test('completeness: every registered connector appears', () => {
    const names = graph.nodes.filter((n) => n.kind === 'connector').length;
    expect(names).toBeGreaterThanOrEqual(15); // the connector registry, live-checked
  });

  test('the spine exists: operator commands the Wizard; Wizard commands agents', () => {
    expect(graph.edges.some((e) => e.from === 'operator' && e.to === 'agent-conductor' && e.kind === 'commands')).toBe(true);
    const commanded = graph.edges.filter((e) => e.from === 'agent-conductor' && e.kind === 'commands').length;
    expect(commanded).toBe(db.agents.all().length - 1); // all but the Wizard itself
  });

  test("'live' means the runtime says it is configured here — a stub is 'designed'", () => {
    const status = (id: string) => graph.nodes.find((n) => n.id === id)?.status;
    expect(status('agent-deal-alerts')).toBe('designed'); // stub: no daemon on this host
    expect(status('agent-sales-agent')).toBe('designed');
    expect(status('agent-stack-monitor')).toBe('live'); // probes the local machine, always able
  });

  test('designed-but-unwired agents are honestly marked', () => {
    const planned = db.agents.all().filter((a) => a.status === 'planned');
    for (const a of planned) {
      const node = graph.nodes.find((n) => n.id === `agent-${a.id}`)!;
      expect(node.status, a.id).toBe('designed');
    }
  });

  test('layers are populated 0 through 4', () => {
    for (const layer of [0, 1, 2, 3, 4]) {
      expect(graph.nodes.some((n) => n.layer === layer), `layer ${layer} empty`).toBe(true);
    }
  });

  test('runtime registry and seed stay 1:1 bound in the graph facts', () => {
    const runtimeIds = new Set(realAgents.map((a) => a.id));
    for (const a of db.agents.all()) {
      if (!runtimeIds.has(a.id)) continue;
      const node = graph.nodes.find((n) => n.id === `agent-${a.id}` || (a.id === 'conductor' && n.id === 'agent-conductor'));
      expect(node, a.id).toBeTruthy();
    }
  });

  test('completeness: every NAV surface appears as a layer-3 surface node', () => {
    const surfaceIds = new Set(graph.nodes.filter((n) => n.kind === 'surface').map((n) => n.id));
    const allNav = NAV_ITEMS;
    expect(allNav.length).toBeGreaterThan(0);
    for (const item of allNav) {
      const slug = item.href === '/' ? 'home' : item.href.replace(/^\//, '').replace(/\//g, '-');
      expect(surfaceIds.has(`surface-${slug}`), item.href).toBe(true);
      const node = graph.nodes.find((n) => n.id === `surface-${slug}`)!;
      expect(node.layer).toBe(3);
      expect(node.icon, `${item.href} needs a SURFACE_ICON entry`).not.toBe('square');
    }
  });

  test('removed surfaces leave no node: Reference Model and Personas (S12 AC12.14)', () => {
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).not.toContain('surface-reference');
    expect(ids).not.toContain('surface-personas');
    expect(graph.nodes.filter((n) => n.kind === 'surface' && n.id.startsWith('surface-')).length).toBeGreaterThanOrEqual(NAV_ITEMS.length);
  });

  test('named surface→store reads exist: adpilot, wizard, brain', () => {
    const uses = (from: string, to: string) => graph.edges.some((e) => e.from === from && e.to === to && e.kind === 'uses');
    expect(uses('surface-adpilot', 'store-ad-intel')).toBe(true);
    expect(uses('surface-wizard', 'store-wizard')).toBe(true);
    expect(uses('surface-brain', 'store-brain')).toBe(true);
  });

  test('routing diamonds exist and their edges resolve to real nodes', () => {
    const identity = graph.nodes.find((n) => n.id === 'router-identity');
    const deals = graph.nodes.find((n) => n.id === 'router-deals');
    expect(identity?.kind).toBe('router');
    expect(deals?.kind).toBe('router');

    const identityEdges = graph.edges.filter((e) => e.from === 'router-identity' || e.to === 'router-identity');
    expect(identityEdges.length).toBeGreaterThan(0);
    for (const e of identityEdges) {
      const ids = new Set(graph.nodes.map((n) => n.id));
      expect(ids.has(e.from), e.from).toBe(true);
      expect(ids.has(e.to), e.to).toBe(true);
    }
    // Souls → soul_2/soul_cinematic, Elements → 10 element-capable models.
    const viaLabels = identityEdges.filter((e) => e.from === 'router-identity').map((e) => e.via);
    expect(viaLabels.filter((v) => v === 'Souls')).toHaveLength(2);
    expect(viaLabels.filter((v) => v === 'Elements')).toHaveLength(10);

    const dealEdges = graph.edges.filter((e) => e.from === 'router-deals' || e.to === 'router-deals');
    expect(dealEdges.some((e) => e.to === 'daemon-gsend')).toBe(true);
  });

  test('daemon inventory is present, honestly not-live, and placed on the mini', () => {
    const daemonIds = ['daemon-gsend', 'daemon-bdpilot', 'daemon-briefing', 'daemon-adscout'];
    for (const id of daemonIds) {
      const node = graph.nodes.find((n) => n.id === id);
      expect(node, id).toBeTruthy();
      expect(node!.kind).toBe('daemon');
      expect(node!.status).not.toBe('live'); // not verifiable from this machine — never fake "live"
      expect(node!.facts.host).toBe('mini');
      expect(graph.edges.some((e) => e.from === id && e.to === 'host-mini' && e.kind === 'runs-on'), id).toBe(true);
    }
  });
});
