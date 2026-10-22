/**
 * The four Skyescraper agents, rebuilt on LangGraph.js instead of n8n.
 *
 * Each agent used to be a separately-hosted n8n workflow (webhook → Chat
 * Model → Memory → AI Agent → MySQL read tool + HTTP tools). Keeping that
 * alive in production meant keeping n8n itself always-on and publicly
 * reachable — a second service to host, separately from this app. Moving the
 * exact same tool-calling loop in-process with LangGraph's `createReactAgent`
 * removes that: these agents now run wherever this app runs (Netlify
 * included), with no separate webhook to expose.
 *
 * Reads go through Skyescraper's own listing endpoints now, not a read-only
 * MySQL credential — see lib/agents/skyescraper-api.ts for why. Writes always
 * went through the API only; that is unchanged.
 *
 * TO ADD A NEW AGENT LIKE THIS: add one entry to SKY_AGENTS below (id must
 * match a RuntimeAgent id in lib/agents/real.ts), give it a system prompt and
 * a tool array built from lib/agents/skyescraper-api.ts's `sky` client (or a
 * new method there if it needs an endpoint that isn't wrapped yet). Nothing
 * else to wire — lib/agents/chat.ts dispatches to SKY_AGENTS by id already.
 */
import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { sky } from '@/lib/agents/skyescraper-api';
import { rawLeads, skyescraperConfig } from '@/lib/real-estate-live';
import { runSkyAgent, type SkyAgentResult } from '@/lib/agents/langgraph-runner';
import { resolveCred, CRED_FILES } from '@/lib/creds';
import type { LlmMessage } from '@/lib/connectors/llm';

const ANTHROPIC_KEY = 'ANTHROPIC_API_KEY';
function resolveAnthropicKey(): string | undefined {
  return resolveCred(ANTHROPIC_KEY, [CRED_FILES.agentsEnv, CRED_FILES.socialMedia]);
}

const SAFETY_RULES = `
Safety rules, always:
- Never guess an id (lead, project, unit, agent, stage, reminder type/priority). Look it up with a read tool first.
- Never claim a write succeeded unless the tool's own result says so. If a tool call fails or returns an error, say exactly that — do not paper over it.
- Every write goes through Skyescraper's real API, so its own validation and permission rules apply; a rejected write is expected behaviour, not a bug to hide.
- Keep answers concise and concrete: names, ids and numbers from the real data, not generic filler.`;

const leadsReadTool = tool(
  async ({ search_key }: { search_key?: string }) => {
    const raw = await rawLeads();
    if (!raw) return 'Skyescraper is not configured (SKYESCRAPER_API_TOKEN missing).';
    const leads = search_key ? raw.leads.filter((l) => `${l.buyer_name ?? ''} ${l.buyer_email ?? ''} ${l.buyer_phone ?? ''}`.toLowerCase().includes(search_key.toLowerCase())) : raw.leads;
    return JSON.stringify(leads.slice(0, 50));
  },
  {
    name: 'list_leads',
    description: 'Read real leads (id, buyer name/email/phone, budget_range, stage, project, assigned agent). Optional search_key filters by buyer name/email/phone.',
    schema: z.object({ search_key: z.string().optional() }),
  },
);

const leadStagesTool = tool(
  async () => {
    const r = await sky.leadStages();
    return r.ok ? JSON.stringify(r.data) : `Error: ${r.error}`;
  },
  { name: 'list_lead_stages', description: 'Look up real lead pipeline stages (id, name, lead_type) — required before calling update_lead_stage.', schema: z.object({}) },
);

const teamTool = tool(
  async ({ search }: { search?: string }) => {
    const r = await sky.teamListing(search);
    return r.ok ? JSON.stringify(r.data) : `Error: ${r.error}`;
  },
  { name: 'list_agents', description: 'Look up real agents/users by name (id, name, email, role) — required before calling assign_lead_to_agent.', schema: z.object({ search: z.string().optional() }) },
);

const updateLeadStageTool = tool(
  async ({ lead_id, stage_id }: { lead_id: number; stage_id: number }) => {
    const r = await sky.updateLeadStage({ lead_id, stage_id });
    return r.ok ? `OK: ${r.data && (r.data as { message?: string }).message ? (r.data as { message?: string }).message : 'stage updated'}` : `FAILED: ${r.error}`;
  },
  { name: 'update_lead_stage', description: 'Move a real lead to a different real pipeline stage. Requires a real lead_id and stage_id (look both up first).', schema: z.object({ lead_id: z.number(), stage_id: z.number() }) },
);

const assignLeadTool = tool(
  async ({ lead_id, agent_id }: { lead_id: number; agent_id: number }) => {
    const r = await sky.assignLeadToAgent({ lead_id, agent_id });
    return r.ok ? 'OK: lead reassigned' : `FAILED: ${r.error}`;
  },
  { name: 'assign_lead_to_agent', description: 'Reassign a real lead to a different real agent. Requires a real lead_id and agent_id (look both up first).', schema: z.object({ lead_id: z.number(), agent_id: z.number() }) },
);

const ACTIVITY_TYPES = ['client_call', 'site_visit_completed', 'email_sent', 'deal_closed', 'client_meeting', 'follow_up_call', 'document_submitted', 'lead_lost', 'visit_scheduled'] as const;

const logActivityTool = tool(
  async ({ lead_id, activity_type, activity }: { lead_id: number; activity_type: (typeof ACTIVITY_TYPES)[number]; activity: string }) => {
    const r = await sky.logLeadActivity({ lead_id, activity_type, activity });
    return r.ok ? 'OK: activity logged' : `FAILED: ${r.error}`;
  },
  {
    name: 'log_lead_activity',
    description: 'Log a real activity against a real lead.',
    schema: z.object({ lead_id: z.number(), activity_type: z.enum(ACTIVITY_TYPES), activity: z.string().describe('A short description of what happened.') }),
  },
);

const projectsReadTool = tool(
  async ({ search_key }: { search_key?: string }) => {
    const r = await sky.projectListing({ page_no: 1, limit: 50, ...(search_key ? { search_key } : {}) });
    return r.ok ? JSON.stringify(r.data?.projects) : `Error: ${r.error}`;
  },
  { name: 'list_projects', description: 'Read real projects (id, name, location, price, units_count, sold/available unit counts, publish state).', schema: z.object({ search_key: z.string().optional() }) },
);

const unitStatusesTool = tool(
  async () => {
    const r = await sky.unitStatuses();
    return r.ok ? JSON.stringify(r.data) : `Error: ${r.error}`;
  },
  { name: 'list_unit_statuses', description: 'Look up real unit status ids (e.g. Available/Held/Sold) — required before calling update_unit_status.', schema: z.object({}) },
);

const unitsReadTool = tool(
  async ({ project_id }: { project_id: number }) => {
    const r = await sky.unitListing({ project_id });
    return r.ok ? JSON.stringify(r.data) : `Error: ${r.error}`;
  },
  {
    name: 'list_units_for_project',
    description:
      "Read a real project's unit sheet. Each returned sheet has `headers`/`heading` (its own columns — these vary per project) and `records` (the rows); every row carries `__unit_status` (its current Available/Held/Sold label) and whatever column holds its unit id/number for that project's sheet.",
    schema: z.object({ project_id: z.number() }),
  },
);

const updateUnitStatusTool = tool(
  async ({ unit_id, status }: { unit_id: number; status: number }) => {
    const r = await sky.updateUnitStatus({ unit_id, status });
    return r.ok ? 'OK: unit status updated' : `FAILED: ${r.error}`;
  },
  { name: 'update_unit_status', description: 'Set a real unit to a real status id (look it up with list_unit_statuses first).', schema: z.object({ unit_id: z.number(), status: z.number() }) },
);

const publishToggleTool = tool(
  async ({ project_id, type }: { project_id: number; type?: 'publish' | 'archive' }) => {
    const r = await sky.publishToggleProject({ project_id, type });
    return r.ok ? 'OK: project publish state updated' : `FAILED: ${r.error}`;
  },
  { name: 'publish_toggle_project', description: 'Publish or archive a real project listing.', schema: z.object({ project_id: z.number(), type: z.enum(['publish', 'archive']).optional() }) },
);

const projectNotesReadTool = tool(
  async ({ project_id }: { project_id: number }) => {
    const r = await sky.projectNoteListing({ page_no: 1, project_id, limit: 50 });
    return r.ok ? JSON.stringify(r.data?.notes) : `Error: ${r.error}`;
  },
  { name: 'list_project_notes', description: 'Read real existing notes on a real project.', schema: z.object({ project_id: z.number() }) },
);

const addProjectNoteTool = tool(
  async ({ project_id, note }: { project_id: number; note: string }) => {
    const r = await sky.addProjectNote({ project_id, note });
    return r.ok ? 'OK: note saved' : `FAILED: ${r.error}`;
  },
  { name: 'add_project_note', description: 'Save a real note on a real project.', schema: z.object({ project_id: z.number(), note: z.string() }) },
);

const remindersReadTool = tool(
  async ({ lead_id }: { lead_id: number }) => {
    const r = await sky.reminderListing({ page_no: 1, lead_id, limit: 50 });
    return r.ok ? JSON.stringify(r.data?.reminders) : `Error: ${r.error}`;
  },
  { name: 'list_reminders', description: "Read a real lead's existing reminders.", schema: z.object({ lead_id: z.number() }) },
);

const reminderTypesTool = tool(
  async () => {
    const r = await sky.reminderTypes();
    return r.ok ? JSON.stringify(r.data) : `Error: ${r.error}`;
  },
  { name: 'list_reminder_types', description: 'Look up real reminder type ids — required before calling create_reminder.', schema: z.object({}) },
);

const reminderPrioritiesTool = tool(
  async () => {
    const r = await sky.reminderPriorities();
    return r.ok ? JSON.stringify(r.data) : `Error: ${r.error}`;
  },
  { name: 'list_reminder_priorities', description: 'Look up real reminder priority ids — required before calling create_reminder.', schema: z.object({}) },
);

const createReminderTool = tool(
  async (args: { lead_id: number; reminder_type_id: number; title: string; description?: string; date: string; time: string; priority_id: number }) => {
    const r = await sky.createReminder(args);
    return r.ok ? 'OK: reminder created' : `FAILED: ${r.error}`;
  },
  {
    name: 'create_reminder',
    description: 'Create a real follow-up reminder for a real lead. date is YYYY-MM-DD, time is HH:MM (24h).',
    schema: z.object({
      lead_id: z.number(),
      reminder_type_id: z.number(),
      title: z.string(),
      description: z.string().optional(),
      date: z.string(),
      time: z.string(),
      priority_id: z.number(),
    }),
  },
);

const leadNotesReadTool = tool(
  async ({ lead_id }: { lead_id: number }) => {
    const r = await sky.leadNoteListing({ page_no: 1, lead_id, limit: 50 });
    return r.ok ? JSON.stringify(r.data?.notes) : `Error: ${r.error}`;
  },
  { name: 'list_lead_notes', description: "Read a real lead's existing notes.", schema: z.object({ lead_id: z.number() }) },
);

const addLeadNoteTool = tool(
  async ({ lead_id, note }: { lead_id: number; note: string }) => {
    const r = await sky.addLeadNote({ lead_id, note });
    return r.ok ? 'OK: note saved' : `FAILED: ${r.error}`;
  },
  { name: 'add_lead_note', description: 'Save a real note on a real lead.', schema: z.object({ lead_id: z.number(), note: z.string() }) },
);

type SkyAgentDef = { systemPrompt: string; tools: StructuredToolInterface[] };

export const SKY_AGENTS: Record<string, SkyAgentDef> = {
  'lead-management': {
    systemPrompt: `You are the Lead Management Agent for a real estate CRM (Skyescraper). You read real leads and can move a lead's stage, reassign it to a different agent, and log activity against it.${SAFETY_RULES}`,
    tools: [leadsReadTool, leadStagesTool, teamTool, updateLeadStageTool, assignLeadTool, logActivityTool],
  },
  'property-inventory': {
    systemPrompt: `You are the Property Inventory Agent for a real estate CRM (Skyescraper). You read real projects and units and can update a unit's status or publish/archive a project.${SAFETY_RULES}`,
    tools: [projectsReadTool, unitsReadTool, unitStatusesTool, updateUnitStatusTool, publishToggleTool],
  },
  'property-intelligence': {
    systemPrompt: `You are the Property Intelligence Agent for a real estate CRM (Skyescraper). You read real projects, units and leads, analyse them, and record real findings as project notes.${SAFETY_RULES}`,
    tools: [projectsReadTool, unitsReadTool, leadsReadTool, projectNotesReadTool, addProjectNoteTool],
  },
  'client-care': {
    systemPrompt: `You are the Client Care Agent for a real estate CRM (Skyescraper). You read real leads, reminders and notes, and can create a real follow-up reminder or add a real note to a lead.${SAFETY_RULES}`,
    tools: [leadsReadTool, remindersReadTool, reminderTypesTool, reminderPrioritiesTool, createReminderTool, leadNotesReadTool, addLeadNoteTool],
  },
};

export function skyAgentConfigured(): boolean {
  return Boolean(skyescraperConfig()) && Boolean(resolveAnthropicKey());
}

export async function chatWithSkyAgent(agentId: string, history: LlmMessage[]): Promise<SkyAgentResult> {
  const def = SKY_AGENTS[agentId];
  if (!def) throw new Error(`no Skyescraper LangGraph agent registered for ${agentId}`);
  if (!skyescraperConfig()) return { text: 'Skyescraper is not configured — set SKYESCRAPER_API_TOKEN and SKYESCRAPER_API_URL in .env.local.', toolCalls: [] };
  const apiKey = resolveAnthropicKey();
  if (!apiKey) return { text: 'ANTHROPIC_API_KEY is not set — add it to .env.local to enable this agent.', toolCalls: [] };
  try {
    return await runSkyAgent({ systemPrompt: def.systemPrompt, tools: def.tools, history, apiKey });
  } catch (err) {
    return { text: `${agentId} hit an error: ${err instanceof Error ? err.message : String(err)}`, toolCalls: [] };
  }
}
