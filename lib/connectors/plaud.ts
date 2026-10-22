/**
 * Plaud connector (pages/feature-additions.md F4): the voice recorder for
 * everything that is not a video call. GladOS does not pull Plaud's API; a
 * Plaud relay (or the Plaud MCP run by an agent) PUSHES finished recordings to
 * POST /api/plaud/ingest with PLAUD_INGEST_TOKEN, and they land in
 * call_recordings next to Fathom's.
 *
 *   no PLAUD_INGEST_TOKEN   not_configured (the endpoint only takes the
 *                           operator's own session, so nothing can push)
 *   token set               connected: the endpoint is accepting pushes; the
 *                           detail says how many recordings arrived and when
 *
 * Reads the local store only, never the network.
 */
import { resolveCred } from '@/lib/creds';
import type { ConnectorStatus } from '@/lib/connectors/types';
import type { CallRecording } from '@/lib/schemas';

export function plaudIngestConfigured(): boolean {
  return Boolean(resolveCred('PLAUD_INGEST_TOKEN', [])?.trim());
}

export function plaudStatus(configured: boolean, recordings: Pick<CallRecording, 'startedAt'>[]): ConnectorStatus {
  const base = { id: 'plaud', name: 'Plaud', kind: 'knowledge' } as const;
  if (!configured) {
    return {
      ...base,
      state: 'not_configured',
      detail: 'Set PLAUD_INGEST_TOKEN, then point the Plaud relay at POST /api/plaud/ingest with that token as a Bearer header.',
    };
  }
  if (recordings.length === 0) {
    return { ...base, state: 'connected', detail: 'Ingest endpoint ready · no recordings received yet', meta: { recordings: 0 } };
  }
  const newest = recordings.reduce((a, b) => (a.startedAt >= b.startedAt ? a : b));
  return {
    ...base,
    state: 'connected',
    detail: `${recordings.length} recording${recordings.length === 1 ? '' : 's'} received · newest ${newest.startedAt.slice(0, 10)}`,
    meta: { recordings: recordings.length },
  };
}

export async function plaudConnectorStatus(): Promise<ConnectorStatus> {
  const { getDb } = await import('@/lib/data');
  return plaudStatus(plaudIngestConfigured(), getDb().callRecordings.recent(500, 'plaud'));
}
