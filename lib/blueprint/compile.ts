import type { GladosDb } from '@/lib/db';
import { realAgents } from '@/lib/agents/real';
import { allConnectorStatuses } from '@/lib/connectors';
import type { ConnectorStatus } from '@/lib/connectors/types';
import { CONTENT_TOOLS } from '@/lib/content-schema';
import { findModel, SOUL_MODELS, ELEMENT_MODELS, identitySupport } from '@/lib/higgsfield/catalog';
import { NAV_ITEMS } from '@/lib/nav';
import { readDesignedAgents } from '@/lib/wizard/designed';
import { engineStatus } from '@/lib/wizard/claude';
import {
  BlueprintGraphSchema,
  validateGraph,
  type BlueprintEdge,
  type BlueprintGraph,
  type BlueprintNode,
} from '@/lib/blueprint/graph';
import { OPERATOR_NAME } from '@/lib/operator';

/**
 * The compiler: assembles the Blueprint graph from the REAL registries so
 * the map can never drift from the system. Adding an agent, connector or
 * skill changes the graph with zero edits here — tests enforce that every
 * registered thing appears (completeness), and validateGraph enforces that
 * every edge lands on a real node (honesty).
 */

/** Static infrastructure inventory — the only hand-listed layer, because
 *  hosts/daemons/stores live outside this repo's registries. Keep tiny and
 *  factual; everything else is derived. */
const HOSTS: BlueprintNode[] = [
  { id: 'host-macbook', kind: 'host', name: 'Workstation', layer: 4, status: 'live', blurb: 'Where the OS is built and operated.', facts: {}, icon: 'laptop' },
  { id: 'host-mini', kind: 'host', name: 'Always-on host', layer: 4, status: 'live', blurb: 'The machine the OS serves from; daemons and scheduled jobs run here.', facts: {}, icon: 'server' },
];

const STORES: BlueprintNode[] = [
  { id: 'store-db', kind: 'store', name: 'OS database', layer: 4, status: 'live', blurb: 'Agents, runs, departments, metrics (SQLite).', facts: { path: 'data/glados.db' }, icon: 'database' },
  {
    id: 'store-brain',
    kind: 'store',
    name: 'Brain store',
    layer: 4,
    status: 'live',
    blurb: 'The markdown knowledge base Optimal Engine retrieves from.',
    // Static, honest facts — the real provider shells the engine CLI (see
    // lib/connectors/gbrain.ts), so its live status is NOT polled here; that
    // would mean this page's compile shells a subprocess on every request.
    facts: { provider: 'engine CLI (PGLite)', note: 'status not polled at compile time — the provider shells a CLI subprocess' },
    icon: 'book-open',
  },
  { id: 'store-queue', kind: 'store', name: 'Content queue', layer: 4, status: 'live', blurb: 'Render tasks + fulfillment specs.', facts: { path: 'data/content-queue.json' }, icon: 'list' },
  { id: 'store-pipelines', kind: 'store', name: 'Pipelines', layer: 4, status: 'live', blurb: 'Saved media workflows.', facts: { path: 'data/content-pipelines.json' }, icon: 'workflow' },
  { id: 'store-ad-intel', kind: 'store', name: 'Ad intel', layer: 4, status: 'live', blurb: "Adscout's synced ads, signals and saves.", facts: { path: 'data/ad-intel/' }, icon: 'radar' },
  { id: 'store-wizard', kind: 'store', name: 'Wizard threads', layer: 4, status: 'live', blurb: 'Conversations and projects.', facts: { path: 'data/wizard/' }, icon: 'messages-square' },
  { id: 'store-lab', kind: 'store', name: 'Content Lab', layer: 4, status: 'live', blurb: 'Scraped posts, metric snapshots, dissections, profiles, ideas and scripts.', facts: { path: 'data/glados.db (lab_* tables)' }, icon: 'flask-conical' },
];

/** Honest inventory of the background processes named in the scaffold.
 *  They run on the mini, not this machine — status is 'configured' (wired
 *  and specified, host present) rather than 'live', because this compiler
 *  cannot reach the mini to verify a live run. */
const DAEMONS: BlueprintNode[] = [
  {
    id: 'daemon-gsend',
    kind: 'daemon',
    name: 'Gsend queue sender',
    layer: 4,
    status: 'configured',
    blurb: 'Sends anything labeled for the queue within minutes. Runs on the mini via launchd — presence and last run cannot be verified from this machine.',
    facts: { host: 'mini' },
    icon: 'send',
  },
  {
    id: 'daemon-bdpilot',
    kind: 'daemon',
    name: 'Brand-deal autopilot',
    layer: 4,
    status: 'configured',
    blurb: 'Telegram bot that drafts sponsor replies for a send/skip/edit decision. Runs on the mini — not verifiable from this machine.',
    facts: { host: 'mini' },
    icon: 'message-circle',
  },
  {
    id: 'daemon-briefing',
    kind: 'daemon',
    name: 'Daily briefing',
    layer: 4,
    status: 'configured',
    blurb: 'Weekday learning run that grows the understanding doc. Runs on the mini — not verifiable from this machine.',
    facts: { host: 'mini', schedule: 'weekdays 06:30' },
    icon: 'sunrise',
  },
  {
    id: 'daemon-adscout',
    kind: 'daemon',
    name: 'Adscout sync',
    layer: 4,
    status: 'configured',
    blurb: 'Scheduled sync of ad intelligence into the ad-intel store. Runs on the mini — not verifiable from this machine.',
    facts: { host: 'mini' },
    icon: 'radar',
  },
];

const KIND_ICON: Record<string, string> = {
  agent: 'bot',
  department: 'folder',
  connector: 'plug',
  model: 'cpu',
  skillpack: 'sparkles',
  person: 'user-round',
};

/** Honest tool→connector matches only. A tool with no real connector behind
 *  it (telegram, gsend, claude-code, broadcast, …) stays a fact on the
 *  agent, never a fabricated edge. */
const TOOL_TO_CONNECTOR: Record<string, string> = {
  gmail: 'email',
  gcal: 'calendar',
  attio: 'attio',
  notion: 'notion',
  zernio: 'zernio',
  stripe: 'payments',
  manychat: 'manychat',
  gbrain: 'gbrain',
  tmux: 'local-stack',
};

/** One node per OS page in the nav — the surface layer. Icon names match the
 *  canvas's own Lucide-language map (see components/blueprint/icons.ts). */
const SURFACE_ICON: Record<string, string> = {
  '/': 'home',
  '/wizard': 'wand-2',
  '/inbox': 'message-square',
  '/funnel': 'filter',
  '/brand-deals': 'handshake',
  '/workflows': 'workflow',
  '/social': 'share-2',
  '/adpilot': 'crosshair',
  '/creative-engine': 'clapperboard',
  '/finances': 'wallet',
  '/trading': 'candlestick-chart',
  '/agents': 'users',
  '/chats': 'messages-square',
  '/tasks': 'list-checks',
  '/skills': 'sparkles',
  '/blueprint': 'network',
  '/compute': 'monitor-smartphone',
  '/usage': 'gauge',
  '/brain': 'brain',
  '/database': 'folder-tree',
  '/knowledge': 'waypoints',
  '/drift': 'git-compare-arrows',
  '/setup': 'wrench',
  '/integrations': 'plug',
  '/roadmap': 'map',
  '/analytics': 'bar-chart-3',
  '/lab': 'flask-conical',
  '/clients': 'briefcase',
  '/lead-magnets': 'magnet',
};

/** Obvious surface→store reads the operator named explicitly. Every other surface
 *  is honestly just a node with no fabricated data edge. */
const SURFACE_STORE_EDGES: Record<string, string[]> = {
  '/adpilot': ['store-ad-intel'],
  '/wizard': ['store-wizard'],
  '/brain': ['store-brain'],
  '/lab': ['store-lab'],
};

const ALL_NAV = NAV_ITEMS;

function surfaceSlug(href: string): string {
  return href === '/' ? 'home' : href.replace(/^\//, '').replace(/\//g, '-');
}

function connectorStatusToNode(status: ConnectorStatus): BlueprintNode {
  const map: Record<string, BlueprintNode['status']> = {
    connected: 'live',
    not_configured: 'not-configured',
    error: 'configured',
  };
  return {
    id: `connector-${status.id}`,
    kind: 'connector',
    name: status.name,
    layer: 3,
    status: map[status.state] ?? 'configured',
    blurb: status.detail.slice(0, 140),
    facts: { kind: status.kind },
    icon: 'plug',
  };
}

export async function compileBlueprint(db: GladosDb): Promise<BlueprintGraph> {
  const nodes: BlueprintNode[] = [];
  const edges: BlueprintEdge[] = [];
  const runtimeIds = new Set(realAgents.map((a) => a.id));
  const runtimeById = new Map(realAgents.map((r) => [r.id, r]));
  const agents = db.agents.all();
  const departments = db.departments.all();
  const skills = db.skills.all();
  const people = db.people.all();

  // Fetched early so the agent loop below can wire honest tool→connector
  // edges without a second pass.
  const connectors = await allConnectorStatuses();
  const connectorNodeIds = new Set(connectors.map((c) => `connector-${c.id}`));

  // L0 + L1 — the spine.
  nodes.push({ id: 'operator', kind: 'operator', name: OPERATOR_NAME, layer: 0, status: 'live', blurb: 'The operator. Everything answers upward to here.', facts: {}, icon: 'user-round' });
  nodes.push({ id: 'agent-conductor', kind: 'wizard', name: 'Wizard', layer: 1, status: 'live', blurb: 'The super agent: talks to everything, routes to everyone.', facts: {}, icon: 'wand-2' });
  edges.push({ from: 'operator', to: 'agent-conductor', kind: 'commands' });

  // L2 — departments + agents from the DB, bound against the runtime
  // registry: a seeded agent whose runtime is a stub is honestly 'designed'.
  for (const d of departments) {
    nodes.push({ id: `dept-${d.slug}`, kind: 'department', name: d.name, layer: 2, status: 'live', blurb: d.tagline, facts: {}, icon: KIND_ICON.department });
  }
  for (const a of agents) {
    if (a.id === 'conductor') continue; // already the L1 spine node
    const wired = runtimeIds.has(a.id);
    // 'live' must mean it can actually run here: a runtime that reports itself
    // unconfigured (no key, no binary, no daemon) is honestly 'designed'.
    const configured = wired && (runtimeById.get(a.id)?.configured?.() ?? true);
    const planned = a.status === 'planned';
    nodes.push({
      id: `agent-${a.id}`,
      kind: 'agent',
      name: a.name,
      layer: 2,
      status: planned ? 'designed' : configured ? 'live' : 'designed',
      blurb: a.description.slice(0, 140),
      facts: { role: a.role, model: a.model, tools: a.tools.join(', '), tier: a.tier },
      icon: KIND_ICON.agent,
    });
    edges.push({ from: 'agent-conductor', to: `agent-${a.id}`, kind: 'commands' });
    const dept = departments.find((d) => d.id === a.departmentId);
    if (dept) edges.push({ from: `agent-${a.id}`, to: `dept-${dept.slug}`, kind: 'member-of' });

    // Honest agent→connector `uses` edges: only tools with a real connector
    // behind them get an edge; everything else stays a fact on the node.
    for (const tool of a.tools) {
      const connectorId = TOOL_TO_CONNECTOR[tool];
      const nodeId = connectorId ? `connector-${connectorId}` : undefined;
      if (nodeId && connectorNodeIds.has(nodeId)) {
        edges.push({ from: `agent-${a.id}`, to: nodeId, kind: 'uses' });
      }
    }
  }
  for (const p of people) {
    nodes.push({ id: `person-${p.id}`, kind: 'person', name: p.name, layer: 2, status: 'live', blurb: p.role, facts: {}, icon: KIND_ICON.person });
    const dept = departments.find((d) => d.id === p.departmentId);
    if (dept) edges.push({ from: `person-${p.id}`, to: `dept-${dept.slug}`, kind: 'member-of' });
  }
  // Agents filed from the Wizard's plus button: specified, not wired — ghosts
  // in their department until a runtime exists.
  for (const d of readDesignedAgents()) {
    const dept = departments.find((x) => x.id === d.departmentId);
    nodes.push({
      id: `designed-${d.id}`,
      kind: 'agent',
      name: d.name,
      layer: 2,
      status: 'designed',
      blurb: d.purpose.slice(0, 140),
      facts: { tools: d.tools.join(', '), filed: d.createdAt.slice(0, 10) },
      icon: KIND_ICON.agent,
    });
    if (dept) edges.push({ from: `designed-${d.id}`, to: `dept-${dept.slug}`, kind: 'member-of' });
  }

  // The engine the Wizard actually runs on: the local claude binary.
  const engine = await engineStatus();
  nodes.push({
    id: 'model-claude-engine',
    kind: 'model',
    name: 'Claude engine',
    layer: 3,
    status: engine.present ? 'live' : 'not-configured',
    blurb: engine.present ? `Local claude binary${engine.version ? ` · ${engine.version}` : ''}. Every Wizard message is one exchange in a resumed session.` : 'claude binary not found on this host; the Wizard cannot answer here.',
    facts: { binary: 'claude', mode: 'headless, session resumed by id' },
    icon: 'cpu',
  });
  edges.push({ from: 'agent-conductor', to: 'model-claude-engine', kind: 'runs-on' });

  // L3 — skills, connectors (live statuses), generation models in use.
  for (const s of skills) {
    nodes.push({ id: `skill-${s.id}`, kind: 'skillpack', name: s.name, layer: 3, status: 'live', blurb: (s as { description?: string }).description?.slice(0, 120) ?? '', facts: {}, icon: KIND_ICON.skillpack });
  }
  for (const c of connectors) nodes.push(connectorStatusToNode(c));

  // Model nodes: every content-tool default, plus every identity-routable
  // model (Souls + Elements) so the identity router below lands on real
  // nodes instead of fabricating targets.
  const modelIds = new Set(CONTENT_TOOLS.map((t) => t.defaultModel));
  for (const id of SOUL_MODELS) modelIds.add(id);
  for (const id of ELEMENT_MODELS) modelIds.add(id);
  for (const id of modelIds) {
    const model = findModel(id);
    nodes.push({
      id: `model-${id}`,
      kind: 'model',
      name: model?.name ?? id,
      layer: 3,
      status: 'live',
      blurb: model?.description.slice(0, 140) ?? 'Model referenced by identity routing.',
      facts: { family: model?.family ?? '', identity: identitySupport(id) },
      icon: KIND_ICON.model,
    });
  }

  // L3 — surface nodes: one per OS page, wired to the stores the operator named
  // explicitly as obvious reads. Every other surface is honestly bare.
  for (const item of ALL_NAV) {
    const slug = surfaceSlug(item.href);
    nodes.push({
      id: `surface-${slug}`,
      kind: 'surface',
      name: item.label,
      layer: 3,
      status: 'live',
      blurb: `OS page at ${item.href}.`,
      facts: { route: item.href },
      icon: SURFACE_ICON[item.href] ?? 'square',
    });
    for (const storeId of SURFACE_STORE_EDGES[item.href] ?? []) {
      edges.push({ from: `surface-${slug}`, to: storeId, kind: 'uses' });
    }
  }

  // L4 — infrastructure.
  nodes.push(...HOSTS, ...STORES, ...DAEMONS);
  edges.push({ from: 'store-db', to: 'host-macbook', kind: 'runs-on' });
  edges.push({ from: 'agent-conductor', to: 'store-wizard', kind: 'writes' });
  for (const d of DAEMONS) edges.push({ from: d.id, to: 'host-mini', kind: 'runs-on' });

  // Routing diamonds — the two places a real routing rule lives.
  nodes.push({
    id: 'router-identity',
    kind: 'router',
    name: 'Identity routing',
    layer: 3,
    status: 'live',
    blurb: 'Identity routing — Souls → soul models · Elements → 10 models',
    facts: { rule: 'trained Souls work only with soul_2/soul_cinematic; reference Elements work only with the element-capable models' },
    icon: 'route',
  });
  // The content surface is archived (archive/content-page); the router stays for the models it gates.
  if (nodes.some((n) => n.id === 'surface-content')) edges.push({ from: 'surface-content', to: 'router-identity', kind: 'uses' });
  for (const id of SOUL_MODELS) edges.push({ from: 'router-identity', to: `model-${id}`, kind: 'uses', via: 'Souls' });
  for (const id of ELEMENT_MODELS) edges.push({ from: 'router-identity', to: `model-${id}`, kind: 'uses', via: 'Elements' });

  nodes.push({
    id: 'router-deals',
    kind: 'router',
    name: 'Deal routing',
    layer: 3,
    status: 'live',
    blurb: 'Deal routing — inbound → drafts → approval → gsend',
    facts: { rule: 'inbound sponsor messages become drafts, drafts wait for a send/skip decision, approved drafts queue for gsend' },
    icon: 'route',
  });
  if (nodes.some((n) => n.id === 'surface-inbox')) edges.push({ from: 'surface-inbox', to: 'router-deals', kind: 'uses', via: 'inbound' });
  if (nodes.some((n) => n.id === 'surface-funnel')) edges.push({ from: 'surface-funnel', to: 'router-deals', kind: 'uses', via: 'pipeline' });
  if (nodes.some((n) => n.id === 'surface-brand-deals')) edges.push({ from: 'surface-brand-deals', to: 'router-deals', kind: 'uses', via: 'drafts' });
  edges.push({ from: 'router-deals', to: 'daemon-gsend', kind: 'uses', via: 'approval → gsend' });

  const graph = BlueprintGraphSchema.parse({ compiledAt: new Date().toISOString(), nodes, edges });
  const problems = validateGraph(graph);
  if (problems.length > 0) throw new Error(`blueprint graph invalid: ${problems.join('; ')}`);
  return graph;
}
