import type { GladosDb } from '@/lib/db';
import { realAgents } from '@/lib/agents/real';
import type { Agent, Department, Skill } from '@/lib/schemas';

/**
 * Structural seed. A fresh install is a blank OS: the six operating pillars
 * and the agent roster exist (they are the system's own crew, mirrored from
 * lib/agents/real.ts so /agents can never list an agent that has no runtime),
 * and nothing else. People, tasks, tools, metrics, funnel and
 * social rows all start empty and are filled by the operator or by live
 * connectors.
 */
const GRAY = { white: '#fafafa', light: '#d4d4d4', mid: '#a3a3a3', dim: '#737373' };

// Pillar ids and order are load-bearing: lenses, setup and the graph use them.
const departments: Department[] = [
  { id: 'dept-sales', name: 'Sales', slug: 'sales', tagline: 'Pipeline and deals.', color: GRAY.white, order: 1 },
  { id: 'dept-marketing-growth', name: 'Marketing/Growth', slug: 'marketing-growth', tagline: 'Audience and content.', color: GRAY.light, order: 2 },
  { id: 'dept-tech', name: 'TECH', slug: 'tech', tagline: 'Infrastructure, the brain and the agents.', color: GRAY.dim, order: 3 },
  { id: 'dept-finance', name: 'Finances', slug: 'finances', tagline: 'Processors and books.', color: GRAY.mid, order: 4 },
  { id: 'dept-comms', name: 'Communications', slug: 'comms', tagline: 'Every inbox in one feed.', color: GRAY.mid, order: 5 },
  { id: 'dept-clients', name: 'Clients', slug: 'clients', tagline: 'Delivery and service.', color: GRAY.light, order: 6 },
];

/** Org structure over the runtime roster: who delegates to whom. */
const PARENT: Record<string, string> = {
  'crm-pulse': 'sales-agent',
  'deal-scanner': 'sales-agent',
  'deal-alerts': 'sales-agent',
  'inbound-watcher': 'draft-approval-bot',
  'brand-deal-drafter': 'draft-approval-bot',
  'markdown-auditor': 'data-agent',
  'gmail-worker': 'comms-agent',
  'whatsapp-worker': 'comms-agent',
  'slack-worker': 'comms-agent',
  'vector-auditor': 'data-agent',
};

const agents: Agent[] = realAgents.map((a) => ({
  id: a.id,
  departmentId: a.departmentId,
  name: a.name,
  role: a.description,
  status: 'active',
  tier: PARENT[a.id] ? 'worker' : 'lead',
  description: a.description,
  model: 'builtin',
  tools: [],
  parentId: PARENT[a.id] ?? null,
  instance: 'builtin',
  // Host-specific, never hardcoded here — synced from WEBHOOK_AGENTS below on
  // every process start, not just on this one-time structural seed.
  webhookUrl: null,
}));

export function seedDatabase(db: GladosDb): void {
  // INSERT OR REPLACE makes re-seeding idempotent by id; deleteWhereIdNotIn
  // retires rows that left the model.
  for (const d of departments) db.departments.insert(d);
  db.departments.deleteWhereIdNotIn(departments.map((d) => d.id));
  for (const a of agents) db.agents.insert(a);
  db.agents.deleteWhereIdNotIn(agents.map((a) => a.id));
}

/* ───────────────────────────────────────────────────────────────────────────
 * Webhook-backed agents (n8n workflows) — ONE place per agent.
 *
 * A webhook-backed agent's chat bypasses the built-in LLM gateway entirely
 * (lib/agents/chat.ts): the n8n workflow owns its own model, memory and
 * tools. This registry is what makes that agent show up correctly and
 * honestly everywhere in the app — /agents, /org, /chats, /blueprint,
 * /workflows and /skills — with zero further manual wiring.
 *
 * TO ADD A NEW AGENT LIKE THIS:
 *   1. Add it to lib/agents/real.ts (RuntimeAgent: id, name, description,
 *      departmentId, configured(), run()).
 *   2. Build its n8n workflow with, at minimum:
 *        - a Chat Model node with an EXPLICIT model set (never leave the
 *          node's implicit default — see `model` below, which must match)
 *        - a Memory node (@n8n/n8n-nodes-langchain.memoryBufferWindow)
 *          wired via ai_memory, sessionKey = a fixed string unique to this
 *          agent (FounderOS keeps one rolling thread per agent, not per
 *          visitor, so one session key per agent is correct)
 *        - its read tool(s) and action tool(s)
 *   3. Add one entry below with its webhook env var, the real model string
 *      (as "provider/model", matching the Chat Model node), its tool slugs,
 *      and a skill (the SKILL.md-style playbook shown on /skills and in its
 *      /agents sheet's "What it does" / "Connected to" sections).
 *   4. Add the env var itself to .env.local.
 *   5. Restart. syncWebhookAgents() + syncAgentWorkflows() + syncAgentSkills()
 *      below do the rest on every process start — no other file to touch.
 * ──────────────────────────────────────────────────────────────────────── */

type WebhookAgentConfig = {
  webhookEnvVar: string;
  /** "provider/model" — must match what the n8n Chat Model node actually
   *  runs; this is informational (Blueprint/Org/Failover display), it does
   *  not control n8n itself. Change the node too if you change this. */
  model: string;
  /** Real capabilities, shown as facts on /agents, /org and /blueprint. */
  tools: string[];
  memorySessionKey: string;
  workflow: { name: string; subtitle: string; detail: string; order: number };
  skill: { name: string; category: string; description: string; markdown: string };
};

const WEBHOOK_AGENTS: Record<string, WebhookAgentConfig> = {
  'lead-management': {
    webhookEnvVar: 'SKYESCRAPER_N8N_LEAD_WEBHOOK',
    model: 'anthropic/claude-sonnet-5-5',
    tools: ['mysql-readonly', 'skyescraper-api', 'memory'],
    memorySessionKey: 'lead-management-main',
    workflow: {
      name: 'Lead Management (Skyescraper)',
      subtitle: 'Captures, scores and acts on real leads via an n8n workflow',
      detail:
        'The Lead Management Agent reads live leads from the Skyescraper database and, on request, writes stage moves, agent assignments and activity log entries back through the Skyescraper API. Remembers the last 20 turns per conversation. Reachable from /chats.',
      order: 9000,
    },
    skill: {
      name: 'Skyescraper Lead Triage & Pipeline Actions',
      category: 'Sales',
      description: 'Reads real Skyescraper leads and can move stages, assign agents and log activity on request.',
      markdown: `# Skyescraper Lead Triage & Pipeline Actions

**Owner:** Lead Management Agent
**Model:** Claude Sonnet 5.5 (via the n8n AI Agent node)
**Memory:** last 20 turns, one rolling conversation (session key \`lead-management-main\`)

## What it does
Reads real leads, stages, projects and units from the live Skyescraper MySQL
database (read-only credential — it cannot write SQL directly), and can take
three real actions through Skyescraper's own API:

- **Update Lead Stage** — move a lead to a different pipeline stage
- **Assign Lead to Agent** — reassign a lead to a specific agent
- **Log Lead Activity** — record a call, email, visit or note against a lead

## Tools
| Tool | Kind | What it touches |
|---|---|---|
| Query Skyescraper DB (read-only) | Read | \`leads\`, \`lead_stages\`, \`projects\`, \`units\` |
| Update Lead Stage | Write | \`POST /api/lead/update-stage\` |
| Assign Lead to Agent | Write | \`POST /api/lead/agent-assign\` |
| Log Lead Activity | Write | \`POST /api/lead/activity/save\` |

## Safety rules (enforced in its own system prompt)
- Never guesses an id — always looks one up with the read tool first.
- Never claims an action succeeded unless the tool's own result confirms it.
- All writes go through Skyescraper's real API, never a direct database write,
  so the app's own validation and permission checks always run.

## Example prompts
- "Move Rachel Sawayn's lead from Negotiation to Closed — she confirmed the deal."
- "Log a site visit completed for Keara Boyle."
- "Find all leads still in the Open stage and summarise them."
`,
    },
  },
  'property-inventory': {
    webhookEnvVar: 'SKYESCRAPER_N8N_INVENTORY_WEBHOOK',
    model: 'anthropic/claude-sonnet-5-5',
    tools: ['mysql-readonly', 'skyescraper-api', 'memory'],
    memorySessionKey: 'property-inventory-main',
    workflow: {
      name: 'Property Inventory (Skyescraper)',
      subtitle: 'Reads and updates real unit and project status via an n8n workflow',
      detail:
        'The Property Inventory Agent reads live units and projects from the Skyescraper database and, on request, updates a unit’s availability (Available/Held/Sold) or publishes/archives a project through the Skyescraper API. Remembers the last 20 turns per conversation. Reachable from /chats.',
      order: 9001,
    },
    skill: {
      name: 'Skyescraper Inventory Status Control',
      category: 'Sales',
      description: 'Reads real Skyescraper inventory and can update unit availability and project publish status.',
      markdown: `# Skyescraper Inventory Status Control

**Owner:** Property Inventory Agent
**Model:** Claude Sonnet 5.5 (via the n8n AI Agent node)
**Memory:** last 20 turns, one rolling conversation (session key \`property-inventory-main\`)

## What it does
Reads real units and projects from the live Skyescraper MySQL database
(read-only credential), and can take two real actions through Skyescraper's
own API:

- **Update Unit Status** — mark a unit Available, Held or Sold
- **Publish or Archive Project** — publish or archive a project listing

## Tools
| Tool | Kind | What it touches |
|---|---|---|
| Query Skyescraper DB (read-only) | Read | \`units\`, \`unit_statuses\`, \`projects\` |
| Update Unit Status | Write | \`POST /api/unit/status-update\` |
| Publish or Archive Project | Write | \`POST /api/project/publish-toggle\` |

## Safety rules (enforced in its own system prompt)
- Never guesses an id — always looks one up with the read tool first.
- Never claims an action succeeded unless the tool's own result confirms it
  (this was caught failing once in testing when the Skyescraper server was
  briefly down, and fixed).
- All writes go through Skyescraper's real API, never a direct database write.

## Example prompts
- "Mark unit UNIT-9-2 as Sold."
- "How many units are Available vs Sold right now?"
- "Archive project 6, it's fully sold out."
`,
    },
  },
  'property-intelligence': {
    webhookEnvVar: 'SKYESCRAPER_N8N_INTEL_WEBHOOK',
    model: 'anthropic/claude-sonnet-5-5',
    tools: ['mysql-readonly', 'skyescraper-api', 'memory'],
    memorySessionKey: 'property-intelligence-main',
    workflow: {
      name: 'Property Intelligence (Skyescraper)',
      subtitle: 'Summarises listings and writes real market/data-quality notes via an n8n workflow',
      detail:
        'The Property Intelligence Agent reads live projects, units and lead-interest counts from the Skyescraper database, and writes its findings — data-quality gaps, demand signals, market observations — as real project notes through the Skyescraper API. Remembers the last 20 turns per conversation. Reachable from /chats.',
      order: 9002,
    },
    skill: {
      name: 'Skyescraper Listing Analysis & Notes',
      category: 'Marketing',
      description: 'Reads real Skyescraper listings and demand data, and records its findings as real project notes.',
      markdown: `# Skyescraper Listing Analysis & Notes

**Owner:** Property Intelligence Agent
**Model:** Claude Sonnet 5.5 (via the n8n AI Agent node)
**Memory:** last 20 turns, one rolling conversation (session key \`property-intelligence-main\`)

## What it does
Reads real projects, units and lead-interest counts from the live Skyescraper
MySQL database (read-only credential), and records what it finds —
data-quality gaps, demand signals, market observations — as a real note on
the project through Skyescraper's own API, rather than just saying it in chat
and losing it.

## Tools
| Tool | Kind | What it touches |
|---|---|---|
| Query Skyescraper DB (read-only) | Read | \`projects\`, \`units\`, \`unit_statuses\`, \`leads\`, \`project_notes\` |
| Add Project Note | Write | \`POST /api/project-notes/save\` |

## Safety rules (enforced in its own system prompt)
- Never guesses an id — always looks one up with the read tool first.
- Never claims a note was saved unless the tool's own result confirms it (this
  genuinely failed once in testing — the \`project_notes\` table didn't exist
  in the database at all; fixed with a migration, re-tested, confirmed real).
- All writes go through Skyescraper's real API, never a direct database write.

## Example prompts
- "Look at project 9. How many units does it have and how many leads are interested? Write a note with your findings."
- "Compare the available units in projects 6 and 9."
- "Flag any project where total_units doesn't match the actual unit records."
`,
    },
  },
  'client-care': {
    webhookEnvVar: 'SKYESCRAPER_N8N_CARE_WEBHOOK',
    model: 'anthropic/claude-sonnet-5-5',
    tools: ['mysql-readonly', 'skyescraper-api', 'memory'],
    memorySessionKey: 'client-care-main',
    workflow: {
      name: 'Client Care (Skyescraper)',
      subtitle: 'Creates real follow-up reminders and lead notes via an n8n workflow',
      detail:
        'The Client Care Agent reads live leads and reminders from the Skyescraper database and, on request, creates a real follow-up reminder or attaches a note to a lead through the Skyescraper API. Remembers the last 20 turns per conversation. Reachable from /chats.',
      order: 9003,
    },
    skill: {
      name: 'Skyescraper Follow-up & Note Taking',
      category: 'Sales',
      description: 'Reads real Skyescraper leads and reminders, and can create real follow-up reminders and lead notes.',
      markdown: `# Skyescraper Follow-up & Note Taking

**Owner:** Client Care Agent
**Model:** Claude Sonnet 5.5 (via the n8n AI Agent node)
**Memory:** last 20 turns, one rolling conversation (session key \`client-care-main\`)

## What it does
Reads real leads and reminders from the live Skyescraper MySQL database
(read-only credential), and can take two real actions through Skyescraper's
own API:

- **Create Follow-up Reminder** — schedule a reminder tied to a lead (call, site visit, follow-up, negotiation or other), with a priority
- **Add Lead Note** — attach a note to a lead

## Tools
| Tool | Kind | What it touches |
|---|---|---|
| Query Skyescraper DB (read-only) | Read | \`leads\`, \`reminders\`, \`reminder_types\`, \`reminder_priorities\`, \`lead_notes\` |
| Create Follow-up Reminder | Write | \`POST /api/reminder/save\` |
| Add Lead Note | Write | \`POST /api/lead-notes/save\` |

## Safety rules (enforced in its own system prompt)
- Never guesses a lead id — always looks one up with the read tool first.
- Never claims a reminder or note was saved unless the tool's own result confirms it.
- All writes go through Skyescraper's real API, never a direct database write.

## Example prompts
- "Create a follow-up phone call reminder for lead 29 tomorrow at 3pm, high priority, to discuss financing options."
- "Which leads have no reminder scheduled at all?"
- "Add a note to lead 8 that the deal closed and they're thrilled."
`,
    },
  },
};

/**
 * Runs on every process start (lib/data.ts getDb()), not just the one-time
 * structural seed: reconciles the FULL roster, so an agent added to
 * lib/agents/real.ts at any point — before or after the seed already ran
 * once — always has a DB row and therefore always appears on /agents,
 * /chats, /org and /blueprint. Before this, a late-added agent's row simply
 * never existed, and any per-field UPDATE (e.g. a webhook URL) silently
 * touched zero rows.
 *
 * Per-agent chat webhooks, model and tools are host/env + code config, not
 * structural data, so they are re-synced every start — changing WEBHOOK_AGENTS
 * above or the env var and restarting is enough, no reseed needed. Honest or
 * absent: an unset env var clears any previously-stored webhook rather than
 * leaving a stale one.
 */
export function syncWebhookAgents(db: GladosDb): void {
  for (const runtime of realAgents) {
    if (!db.agents.get(runtime.id)) {
      const cfg = WEBHOOK_AGENTS[runtime.id];
      db.agents.insert({
        id: runtime.id,
        departmentId: runtime.departmentId,
        name: runtime.name,
        role: runtime.description,
        status: 'active',
        tier: PARENT[runtime.id] ? 'worker' : 'lead',
        description: runtime.description,
        model: cfg?.model ?? 'builtin',
        tools: cfg?.tools ?? [],
        parentId: PARENT[runtime.id] ?? null,
        instance: 'builtin',
        webhookUrl: null,
      });
    }
    const cfg = WEBHOOK_AGENTS[runtime.id];
    if (!cfg) continue;
    db.agents.setWebhookUrl(runtime.id, process.env[cfg.webhookEnvVar] ?? null);
    db.agents.setTools(runtime.id, cfg.tools);
    db.agents.setModel(runtime.id, cfg.model);
  }
}


/**
 * One /workflows canvas entry per webhook-backed agent, so the automation it
 * runs is visible there too, not just on /agents and /chats. Idempotent by id
 * (INSERT OR REPLACE), so re-running on every start never duplicates it; the
 * one-time version-history write (lib/db.ts workflows.insert) still records a
 * version, same as any other workflow save. Honest or absent: only synced
 * when that agent's webhook env var is actually set.
 */
export function syncAgentWorkflows(db: GladosDb): void {
  for (const [agentId, cfg] of Object.entries(WEBHOOK_AGENTS)) {
    if (!process.env[cfg.webhookEnvVar]) continue;
    const agent = db.agents.get(agentId);
    const id = `wf-${agentId}`;
    db.workflows.insert(
      {
        id,
        name: cfg.workflow.name,
        subtitle: cfg.workflow.subtitle,
        revenueUsd: 0,
        order: cfg.workflow.order,
        steps: [
          {
            id: `${id}-step-1`,
            title: cfg.workflow.subtitle,
            detail: cfg.workflow.detail,
            ownerKind: 'agent',
            owner: agent?.name ?? agentId,
            hoursPerWeek: 0,
            tools: cfg.tools,
            edgeLabel: null,
            leakUsd: null,
            automation: { title: `n8n workflow (${cfg.model.split('/')[1] ?? cfg.model} + MySQL + Skyescraper API)`, state: 'live', recoveredUsd: 0 },
            branch: null,
            ownerAgentId: agentId,
            kind: 'agent',
            config: { model: cfg.model, memorySessionKey: cfg.memorySessionKey, memoryWindow: 20 },
            pos: null,
          },
        ],
        ratioTarget: null,
      },
      'synced from lib/seed.ts on startup',
    );
  }
}

/**
 * One /skills entry per webhook-backed agent: the SKILL.md-style playbook
 * that documents what it actually does, its real tools, and its safety
 * rules. This is also what lights up an agent's "What it does" and
 * "Connected to" sections in its /agents detail sheet (app/agents/panel-data.ts
 * reads db.skills.filter(s => s.ownerAgentId === agent.id)). Honest or
 * absent: only synced while that agent's webhook is actually configured.
 */
export function syncAgentSkills(db: GladosDb): void {
  let order = 900;
  for (const [agentId, cfg] of Object.entries(WEBHOOK_AGENTS)) {
    const id = `skill-${agentId}`;
    if (!process.env[cfg.webhookEnvVar]) continue;
    const skill: Skill = {
      id,
      name: cfg.skill.name,
      category: cfg.skill.category,
      description: cfg.skill.description,
      ownerAgentId: agentId,
      status: 'live',
      tools: cfg.tools,
      markdown: cfg.skill.markdown,
      order: order++,
    };
    db.skills.insert(skill);
  }
}