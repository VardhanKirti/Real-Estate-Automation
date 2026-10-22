/**
 * The /clients payload (pages/clients.md §2). The roster is the local
 * `client_confirmations` table: an Attio deal appears only once the operator
 * confirms it (CL-1), and a hand-added client needs no connector at all. The
 * Attio deal list feeds the confirm picker only, read through the shared
 * stale-while-revalidate cache (a free read, never on a cold path twice).
 *
 * No fee, contract term or revenue is computed here (CL-4): the payload
 * carries no money field.
 */
import { getDb } from '@/lib/data';
import { attioClients } from '@/lib/connectors/attio';
import { supersetStatus } from '@/lib/connectors/superset';
import type { ConnectorStatus } from '@/lib/connectors/types';
import { resolveAttioKey } from '@/lib/creds';
import { sampleClients, type FoMode } from '@/lib/fo-sample';
import { writesEnabled } from '@/lib/gates';
import type { ClientConfirmation, ClientWork, ClientWorkStatus } from '@/lib/schemas';

export type ClientCandidate = { clientId: string; name: string; status: string };

export type ClientsPayload = {
  roster: ClientConfirmation[];
  work: ClientWork[];
  /** Attio deals not yet confirmed: the confirm picker. Empty when Attio is not keyed. */
  candidates: ClientCandidate[];
  attio: { state: 'connected' | 'not_configured' | 'error' };
  superset: ConnectorStatus;
  /** GLADOS_WRITES: the launch button is disabled with the reason when false (CL-3). */
  writes: boolean;
  counts: Record<ClientWorkStatus, number>;
  mode: FoMode;
  sample: boolean;
};

function countByStatus(work: ClientWork[]): Record<ClientWorkStatus, number> {
  const out: Record<ClientWorkStatus, number> = { draft: 0, queued: 0, running: 0, done: 0, failed: 0 };
  for (const w of work) out[w.status] += 1;
  return out;
}

/**
 * attioClients() already reads through the shared SWR cache under
 * `attio:clients:<tag>`. Wrapping it in a second swr() on the same key made
 * the inner read return the outer pending promise, so a keyed install never
 * resolved; call it directly.
 */
async function attioDeals(): Promise<{ state: 'connected' | 'not_configured' | 'error'; clients: { id: string; name: string; status: string }[] }> {
  if (!resolveAttioKey()) return { state: 'not_configured', clients: [] };
  return attioClients();
}

export async function clientsPayload(mode: FoMode, now: Date = new Date()): Promise<ClientsPayload> {
  if (mode !== 'live') {
    const s = sampleClients(now);
    return {
      roster: s.roster,
      work: s.work,
      candidates: [],
      attio: { state: 'connected' },
      superset: { id: 'superset', name: 'Superset', kind: 'orchestration', state: 'connected', detail: 'Sample data' },
      writes: false,
      counts: countByStatus(s.work),
      mode,
      sample: true,
    };
  }
  const db = getDb();
  const roster = db.clientConfirmations.all();
  const work = db.clientWork.all();
  const attio = await attioDeals();
  const confirmed = new Set(roster.map((c) => c.clientId));
  return {
    roster,
    work,
    candidates: attio.clients.filter((c) => !confirmed.has(c.id)).map((c) => ({ clientId: c.id, name: c.name, status: c.status })),
    attio: { state: attio.state },
    superset: supersetStatus(),
    writes: writesEnabled(),
    counts: countByStatus(work),
    mode,
    sample: false,
  };
}

/** Blank = nothing confirmed and no work: the only case ?sample=1 previews. */
export function clientsBlank(): boolean {
  const db = getDb();
  return db.clientConfirmations.all().length === 0 && db.clientWork.all().length === 0;
}
