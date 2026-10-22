import fs from 'node:fs';
import { dataPath } from '@/lib/paths';
import { DeliverableDecisionSchema, type DeliverableDecision } from './schemas';

/**
 * Approve and dismiss calls on the Agents board's deliverables (FounderOS v1).
 * GladOS records decisions per agent run; the board decides per staged file, so
 * these live beside the database in the current data directory.
 */
const file = () => dataPath('founderos-deliverable-decisions.json');

function read(): DeliverableDecision[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8')) as unknown[];
    return raw.flatMap((r) => {
      const p = DeliverableDecisionSchema.safeParse(r);
      return p.success ? [p.data] : [];
    });
  } catch {
    return [];
  }
}

function write(rows: DeliverableDecision[]): void {
  fs.writeFileSync(file(), `${JSON.stringify(rows, null, 2)}\n`);
}

export const deliverableDecisions = {
  all(): DeliverableDecision[] {
    return read().sort((a, b) => b.decidedAt.localeCompare(a.decidedAt) || a.id.localeCompare(b.id));
  },
  /** Deciding again on the same id replaces: one open call per deliverable. */
  set(d: DeliverableDecision): void {
    const v = DeliverableDecisionSchema.parse(d);
    write([...read().filter((r) => r.id !== v.id), v]);
  },
  /** Undo: the row returns to the open queue. */
  clear(id: string): void {
    write(read().filter((r) => r.id !== id));
  },
};
