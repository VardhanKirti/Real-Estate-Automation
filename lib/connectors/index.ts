import { emailStatus } from '@/lib/connectors/email';
import { calendarStatus } from '@/lib/connectors/gcal';
import { whatsappStatus } from '@/lib/connectors/whatsapp';
import { ghlStatus } from '@/lib/connectors/ghl';
import { notionStatus } from '@/lib/connectors/notion';
import { llmStatus } from '@/lib/connectors/llm';
import { localStackStatus } from '@/lib/connectors/local-stack';
import { obsidianStatus } from '@/lib/connectors/obsidian';
import { getBrainProvider } from '@/lib/brain';
import { runtimeEnv } from '@/lib/creds';
import type { ConnectorStatus } from '@/lib/connectors/types';
import { isFilming, demoConnectors } from '@/lib/demo-mode';
import { CONNECTORS_SWR_KEY, CONNECTORS_SWR_PREFIX, TTL, swr } from '@/lib/swr';

/**
 * Connectors trimmed for Real Estate Agent use case.
 * Keeps: Email (IMAP/Gmail), WhatsApp (send), GoHighLevel CRM,
 *        LLM gateway (agent chat), Notion, Google Calendar,
 *        Local stack probe, Obsidian/Notes, Optimal Engine (brain).
 */
async function brainConnectorStatus(): Promise<ConnectorStatus> {
  const status = await getBrainProvider().status();
  return {
    id: 'gbrain',
    name: 'Optimal Engine',
    kind: 'brain',
    state: status.connected ? 'connected' : 'error',
    detail: status.detail,
    meta: { provider: status.provider },
  };
}

const CHECKS: [string, ConnectorStatus['kind'], () => Promise<ConnectorStatus>][] = [
  ['gbrain', 'brain', brainConnectorStatus],
  ['llm', 'orchestration', llmStatus],
  ['email', 'email', () => emailStatus(runtimeEnv())],
  ['whatsapp', 'social', whatsappStatus],
  ['ghl', 'crm', ghlStatus],
  ['notion', 'notion', () => notionStatus(runtimeEnv())],
  ['calendar', 'calendar', calendarStatus],
  ['obsidian', 'knowledge', obsidianStatus],
  ['local-stack', 'local', localStackStatus],
];

/**
 * Every connector's live status. Pages (Home, Connections, Setup, Blueprint) share one
 * stale-while-revalidate result (lib/swr.ts): a real check at most 60s old renders at once,
 * an older one (up to 10 min) renders while a fresh check runs behind it, and only a cold
 * server waits for the checks. `fresh: true` always checks now (and refreshes the shared
 * result). Saving or removing a key clears it (lib/creds.ts), so a new key shows on the
 * next render, never a stale "Not configured".
 */
export async function allConnectorStatuses(opts: { fresh?: boolean } = {}): Promise<ConnectorStatus[]> {
  // Filming mode: scripted stand-in (lib/demo-mode.ts)
  if (isFilming()) return demoConnectors();
  return swr(CONNECTORS_SWR_KEY, opts.fresh ? { freshMs: 0, maxStaleMs: 0 } : TTL.connector, checkAll);
}

async function checkAll(): Promise<ConnectorStatus[]> {
  return Promise.all(
    CHECKS.map(([id, kind, check]) =>
      check().catch(
        (err): ConnectorStatus => ({
          id,
          name: id,
          kind,
          state: 'error',
          detail: err instanceof Error ? err.message : String(err),
        }),
      ),
    ),
  );
}

/**
 * One connector's status for a page that shows a few of them (Funnel, Comms), on the
 * same window as the board: a real check at most 60s old renders at once, an older one (up to
 * 10 min) while one check runs behind it. Keyed per connector and per Filming state; saving or
 * removing a key clears it with the board (lib/creds.ts). A check that throws is not cached.
 */
export function cachedStatus(id: string, check: () => Promise<ConnectorStatus>): Promise<ConnectorStatus> {
  return swr(`${CONNECTORS_SWR_PREFIX}one:${id}:${isFilming() ? 'filming' : 'live'}`, TTL.connector, check);
}
