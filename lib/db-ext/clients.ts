/**
 * Clients repository (pages/clients.md §2): the local confirmation flag that
 * turns an Attio deal (or a hand-added name) into a client, and the work
 * requests drafted for them. Nothing is seeded; a draft makes no outbound call.
 */
import type Database from 'better-sqlite3';
import {
  ClientConfirmationSchema,
  ClientWorkSchema,
  ClientWorkStatusSchema,
  type ClientConfirmation,
  type ClientConfirmationInput,
  type ClientWork,
  type ClientWorkInput,
  type ClientWorkStatus,
} from '@/lib/schemas';

type ConfirmationRaw = {
  client_id: string; name: string; company: string; source: string; retainer: number;
  slack_channel: string | null; superset_project: string | null; confirmed_at: string;
};
const toConfirmation = (r: ConfirmationRaw): ClientConfirmation =>
  ClientConfirmationSchema.parse({
    clientId: r.client_id, name: r.name, company: r.company, source: r.source, retainer: r.retainer === 1,
    slackChannel: r.slack_channel, supersetProject: r.superset_project, confirmedAt: r.confirmed_at,
  });

type WorkRaw = {
  id: string; client_id: string; brief: string; status: string; superset_workspace: string | null;
  created_at: string; finished_at: string | null; detail: string;
};
const toWork = (r: WorkRaw): ClientWork =>
  ClientWorkSchema.parse({
    id: r.id, clientId: r.client_id, brief: r.brief, status: r.status, supersetWorkspace: r.superset_workspace,
    createdAt: r.created_at, finishedAt: r.finished_at, detail: r.detail,
  });

export function clientConfirmationsRepo(db: InstanceType<typeof Database>) {
  return {
    /** Add or edit a confirmation (idempotent on clientId). */
    upsert(input: ClientConfirmationInput): ClientConfirmation {
      const c = ClientConfirmationSchema.parse(input);
      db.prepare(
        `INSERT INTO client_confirmations (client_id, name, company, source, retainer, slack_channel, superset_project, confirmed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(client_id) DO UPDATE SET
           name = excluded.name, company = excluded.company, source = excluded.source,
           retainer = excluded.retainer, slack_channel = excluded.slack_channel,
           superset_project = excluded.superset_project`,
      ).run(c.clientId, c.name, c.company, c.source, c.retainer ? 1 : 0, c.slackChannel, c.supersetProject, c.confirmedAt);
      return this.get(c.clientId)!;
    },
    get(clientId: string): ClientConfirmation | null {
      const r = db.prepare('SELECT * FROM client_confirmations WHERE client_id = ?').get(clientId) as ConfirmationRaw | undefined;
      return r ? toConfirmation(r) : null;
    },
    all(): ClientConfirmation[] {
      return (db.prepare('SELECT * FROM client_confirmations ORDER BY confirmed_at DESC, rowid DESC').all() as ConfirmationRaw[]).map(toConfirmation);
    },
    /** Unconfirm: the client leaves the roster; their work rows stay. */
    remove(clientId: string): void {
      db.prepare('DELETE FROM client_confirmations WHERE client_id = ?').run(clientId);
    },
  };
}

export function clientWorkRepo(db: InstanceType<typeof Database>) {
  return {
    insert(input: ClientWorkInput): ClientWork {
      const w = ClientWorkSchema.parse(input);
      db.prepare(
        `INSERT INTO client_work (id, client_id, brief, status, superset_workspace, created_at, finished_at, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(w.id, w.clientId, w.brief, w.status, w.supersetWorkspace, w.createdAt, w.finishedAt, w.detail);
      return w;
    },
    get(id: string): ClientWork | null {
      const r = db.prepare('SELECT * FROM client_work WHERE id = ?').get(id) as WorkRaw | undefined;
      return r ? toWork(r) : null;
    },
    /** Newest first; optionally one client's. */
    all(clientId?: string): ClientWork[] {
      const rows = clientId
        ? db.prepare('SELECT * FROM client_work WHERE client_id = ? ORDER BY created_at DESC, rowid DESC').all(clientId)
        : db.prepare('SELECT * FROM client_work ORDER BY created_at DESC, rowid DESC').all();
      return (rows as WorkRaw[]).map(toWork);
    },
    /** Status change. done and failed stamp finishedAt; any other status clears it. */
    setStatus(id: string, status: ClientWorkStatus, opts: { at?: string; detail?: string; supersetWorkspace?: string | null } = {}): ClientWork | null {
      ClientWorkStatusSchema.parse(status);
      const current = this.get(id);
      if (!current) return null;
      const finished = status === 'done' || status === 'failed' ? (opts.at ?? new Date().toISOString()) : null;
      const next = ClientWorkSchema.parse({
        ...current,
        status,
        finishedAt: finished,
        detail: opts.detail ?? current.detail,
        supersetWorkspace: opts.supersetWorkspace !== undefined ? opts.supersetWorkspace : current.supersetWorkspace,
      });
      db.prepare('UPDATE client_work SET status = ?, finished_at = ?, detail = ?, superset_workspace = ? WHERE id = ?').run(
        next.status, next.finishedAt, next.detail, next.supersetWorkspace, id,
      );
      return next;
    },
  };
}
