/**
 * Fathom connector: the AI notetaker on the operator's calls (pages/
 * feature-additions.md F4). Ported from the 2026-10-06 parts bin, extended to
 * map meetings onto call_recordings rows.
 *
 * Real API (developers.fathom.ai):
 *   GET https://api.fathom.ai/external/v1/meetings   header: X-Api-Key
 * Reads are free; the rate limit is 60 calls a minute per user, so the pull is
 * cached 10 minutes (FATHOM_PULL_MS) and the status check reads one page.
 *
 * Honest status: no key ⇒ not_configured; key rejected or network down ⇒
 * error. Never a fake "connected". fetch is injectable for offline tests.
 */
import { resolveCred } from '@/lib/creds';
import type { ConnectorStatus } from '@/lib/connectors/types';
import type { CallRecording } from '@/lib/schemas';

const KEY = 'FATHOM_API_KEY';
export const FATHOM_API = 'https://api.fathom.ai/external/v1';
export const FATHOM_PULL_MS = 10 * 60_000;

type Fetch = typeof fetch;

export type FathomMeeting = Omit<CallRecording, 'id' | 'source'>;

export function fathomKey(): string | undefined {
  return resolveCred(KEY, []);
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** Map the API payload to call recordings. Tolerant: an unrecognised shape is
 *  an empty list, and a meeting without an id or a time is skipped, never invented. */
export function parseFathomMeetings(body: unknown): FathomMeeting[] {
  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const out: FathomMeeting[] = [];
  for (const raw of items) {
    const m = (raw ?? {}) as Record<string, unknown>;
    const externalId = str(m.recording_id) ?? (typeof m.recording_id === 'number' ? String(m.recording_id) : null) ?? str(m.id) ?? str(m.url);
    const startedAt = str(m.recording_start_time) ?? str(m.scheduled_start_time) ?? str(m.created_at);
    if (!externalId || !startedAt) continue;
    const start = Date.parse(str(m.recording_start_time) ?? '');
    const end = Date.parse(str(m.recording_end_time) ?? '');
    const minutes = typeof m.recording_duration_in_minutes === 'number' ? m.recording_duration_in_minutes : null;
    const durationS = Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.round((end - start) / 1000) : minutes !== null ? Math.round(minutes * 60) : null;
    const invitees = Array.isArray(m.calendar_invitees) ? m.calendar_invitees : [];
    const participants = invitees
      .map((i) => {
        const o = (i ?? {}) as Record<string, unknown>;
        return str(o.name) ?? str(o.email);
      })
      .filter((x): x is string => Boolean(x));
    const summary = (m.default_summary as { markdown_formatted?: unknown } | undefined)?.markdown_formatted;
    out.push({
      externalId,
      title: str(m.meeting_title) ?? str(m.title) ?? 'Untitled meeting',
      startedAt,
      durationS,
      participants,
      summary: typeof summary === 'string' ? summary : '',
      transcriptUrl: str(m.share_url) ?? str(m.url),
    });
  }
  return out;
}

async function getMeetings(key: string, fetchFn: Fetch): Promise<FathomMeeting[]> {
  const res = await fetchFn(`${FATHOM_API}/meetings`, { headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(res.status === 401 ? 'HTTP 401 (key rejected)' : `HTTP ${res.status}`);
  return parseFathomMeetings(await res.json());
}

let lastPull: { at: number; key: string; meetings: FathomMeeting[] } | null = null;

/** Test hook. */
export function resetFathomCache(): void {
  lastPull = null;
}

/**
 * Recent meetings, at most one network read per 10 minutes. Throws on a real
 * failure so the caller can say so; no key resolves to [] with no request.
 */
export async function pullFathomMeetings(opts: { fetchFn?: Fetch; now?: number; fresh?: boolean } = {}): Promise<FathomMeeting[]> {
  const key = fathomKey();
  if (!key) return [];
  const now = opts.now ?? Date.now();
  if (!opts.fresh && lastPull && lastPull.key === key && now - lastPull.at < FATHOM_PULL_MS) return lastPull.meetings;
  const meetings = await getMeetings(key, opts.fetchFn ?? fetch);
  lastPull = { at: now, key, meetings };
  return meetings;
}

export async function fathomStatus(fetchFn: Fetch = fetch): Promise<ConnectorStatus> {
  const base = { id: 'fathom', name: 'Fathom', kind: 'crm' } as const;
  if (!fathomKey()) {
    return {
      ...base,
      state: 'not_configured',
      detail: 'Set FATHOM_API_KEY to pull recorded calls into Comms. Create a key in Fathom under Settings, API.',
    };
  }
  try {
    const meetings = await pullFathomMeetings({ fetchFn });
    return {
      ...base,
      state: 'connected',
      detail: `Fathom reachable · ${meetings.length} recent meeting${meetings.length === 1 ? '' : 's'} visible to this key`,
      meta: { meetings: meetings.length },
    };
  } catch (err) {
    return { ...base, state: 'error', detail: `FATHOM_API_KEY is set but the call failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
