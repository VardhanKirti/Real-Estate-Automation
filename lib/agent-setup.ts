/**
 * Per-agent setup guides. An agent that is not yet active gets a green
 * SET UP box on its roster card linking to /agents/setup/<id>, which walks
 * the real wiring steps: env keys (entered inline via /api/keys), external
 * actions only the operator can do, and builds that are still owed.
 */

import type { Agent } from '@/lib/schemas';
import { BRAND } from '@/lib/brand';

export type SetupStep =
  | { kind: 'env'; envVar: string; label: string; hint?: string }
  | { kind: 'external'; label: string; detail: string; href?: string }
  | { kind: 'build'; label: string; detail: string };

export type AgentSetup = { agentId: string; blurb: string; steps: SetupStep[] };

export const AGENT_SETUPS: AgentSetup[] = [
  {
    agentId: 'crm-pulse',
    blurb: 'Reads the pipeline from your CRM. Read-only by standing rule.',
    steps: [
      {
        kind: 'env',
        envVar: 'ATTIO_API_KEY',
        label: 'Attio API key',
        hint: 'Attio → your workspace → Settings → Developers → create a read-scoped key',
      },
      {
        kind: 'external',
        label: 'Keep the read-only rule',
        detail: 'CRM writes stay manual unless the operator asks in the moment — scope the key read-only.',
      },
    ],
  },
  {
    agentId: 'gmail-worker',
    blurb: 'IMAP triage across the inboxes. Needs the the verified sender app password.',
    steps: [
      { kind: 'env', envVar: 'INBOX_1_HOST', label: 'Inbox 1 host', hint: 'imap.gmail.com' },
      { kind: 'env', envVar: 'INBOX_1_USER', label: 'Inbox 1 user', hint: 'you@yourdomain.com' },
      {
        kind: 'env',
        envVar: 'INBOX_1_PASS',
        label: 'Inbox 1 app password',
        hint: 'Google account → Security → App passwords (needs 2FA on)',
      },
    ],
  },
  {
    agentId: 'comms-agent',
    blurb: 'The unified comms lead. Wakes up once at least one inbox slot is keyed.',
    steps: [
      { kind: 'env', envVar: 'INBOX_1_HOST', label: 'Inbox 1 host', hint: 'imap.gmail.com' },
      { kind: 'env', envVar: 'INBOX_1_USER', label: 'Inbox 1 user', hint: 'you@yourdomain.com' },
      { kind: 'env', envVar: 'INBOX_1_PASS', label: 'Inbox 1 app password' },
    ],
  },
  {
    agentId: 'slack-worker',
    blurb: 'Latest messages across joined Slack channels.',
    steps: [
      {
        kind: 'env',
        envVar: 'SLACK_BOT_TOKEN',
        label: 'Slack bot token',
        hint: 'xoxb-… with chat:write, from api.slack.com → your app → OAuth',
      },
    ],
  },
  {
    agentId: 'whatsapp-worker',
    blurb: 'Reads the local WhatsApp store. No key — a macOS permission.',
    steps: [
      {
        kind: 'external',
        label: 'Grant Full Disk Access',
        detail:
          `System Settings → Privacy & Security → Full Disk Access → allow the ${BRAND.name} node process on the mini so ChatStorage.sqlite is readable.`,
      },
      {
        kind: 'external',
        label: 'Decide the ingestion path',
        detail: 'Bridge vs WhatsApp Cloud API is still an open decision — this worker covers local reads either way.',
      },
    ],
  },
  {
    agentId: 'notion-sync',
    blurb: 'Mirrors Notion docs into reach of the brain.',
    steps: [
      {
        kind: 'env',
        envVar: 'NOTION_API_KEY',
        label: 'Notion integration secret',
        hint: 'notion.so/my-integrations → new internal integration → share the target pages with it',
      },
    ],
  },
  {
    agentId: 'data-agent',
    blurb: 'Optimal Engine retrieval. Runs on the grep fallback until the CLI lands.',
    steps: [
      {
        kind: 'external',
        label: 'Install the engine CLI',
        detail: 'Install with `bun install -g github:garrytan/gbrain` (never the npm package of the same name). Once it is on PATH (or GBRAIN_BIN is set), hybrid retrieval replaces the grep fallback.',
      },
      { kind: 'env', envVar: 'GBRAIN_STORE', label: 'Brain-store path override', hint: 'defaults to ~/knowledge/brain-store' },
    ],
  },
  {
    agentId: 'deal-alerts',
    blurb: 'The loud chat bot: deal-closed alerts, action-needed pings, team briefings.',
    steps: [
      {
        kind: 'external',
        label: 'Create the bot in BotFather',
        detail: 'Telegram → @BotFather → /newbot → hand the token over in a session. Message the new bot once so it can learn your chat.',
        href: 'https://t.me/BotFather',
      },
      { kind: 'env', envVar: 'DEAL_ALERTS_BOT_TOKEN', label: 'Alerts bot token', hint: 'from BotFather' },
      { kind: 'build', label: 'Alert daemon build', detail: 'Deal-closed + action-needed detection rides the Deal Scanner build (autopilot spec §5-6).' },
    ],
  },
  {
    agentId: 'deal-scanner',
    blurb: 'Scheduled inbox scan: classify deal states, draft replies, close the follow-up gap.',
    steps: [
      {
        kind: 'build',
        label: 'Scanner build',
        detail: 'Scan inbound via the verified sender, classify per the deal-state model, draft per your brand-deals playbook skill.',
      },
    ],
  },
  {
    agentId: 'team-briefing',
    blurb: 'Daily digest to your media or ops lead after the last send window.',
    steps: [
      { kind: 'build', label: 'Briefing build', detail: 'Generated from the same scan data as the Deal Scanner — it ships right after the scanner does.' },
    ],
  },
  {
    agentId: 'automation-jobs',
    blurb: 'The four inert launchd jobs scaffolded in brain/Automation.',
    steps: [
      {
        kind: 'external',
        label: 'Load the launchd jobs on the mini',
        detail: 'Plists are written and validated but not loaded. Enable order: daily-reconcile → heartbeat → newsletter → operator. Say "enable the automation jobs" in a session.',
      },
    ],
  },
];

const BY_ID = new Map(AGENT_SETUPS.map((s) => [s.agentId, s]));

export function setupFor(agentId: string): AgentSetup | null {
  return BY_ID.get(agentId) ?? null;
}

/** Active agents are wired; everything else with a guide gets the SET UP box. */
export function needsSetup(agent: Pick<Agent, 'id' | 'status'>): boolean {
  return agent.status !== 'active' && BY_ID.has(agent.id);
}
