/**
 * The v1 to v2 data jobs (08.11.2), run once by `lab-sync -- migrate-v2` and by the first tick
 * after `schema_version` was raised. The DDL half (columns, tables, backfills) is S0's single
 * `migrateLabV2` in lib/db.ts and already ran when the database opened. Nothing is deleted.
 *   1. recompute measures with 04's age-matched maths (recomputeMeasuresV2)
 *   2. lab_spend.line and actual_source backfills (done in the DDL migration)
 *   3. local-hash embeddings for existing transcripts (07 backfill)
 * Done is recorded in lab_priors `migrate:v2`; a step that fails is retried on the next tick.
 */
import type { LabStore } from '@/lib/lab/store';
import { recomputeMeasuresV2 } from '@/lib/lab/measure/compute';
import { backfill } from '@/lib/lab/gen/embed';

export type MigrateResult = { ran: boolean; ok: boolean; detail: string };

export async function runMigrateV2(store: LabStore, opts: { onlyOnce: boolean; now?: Date } = { onlyOnce: true }): Promise<MigrateResult> {
  const now = opts.now ?? new Date();
  const done = store.priors.get('migrate:v2')?.value as { doneAt?: string | null } | null | undefined;
  if (opts.onlyOnce && done?.doneAt) return { ran: false, ok: true, detail: 'Already migrated.' };
  const notes: string[] = [];
  let ok = true;
  try {
    const m = recomputeMeasuresV2(store, { now });
    notes.push(`measures ${m.measured} of ${m.posts}`);
  } catch (err) {
    ok = false;
    notes.push(`measures: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    const e = await backfill(store, { kinds: ['post'], limit: 5000, scheduled: true });
    notes.push(`embeddings ${e.embedded} (${e.model})`);
  } catch (err) {
    ok = false;
    notes.push(`embeddings: ${err instanceof Error ? err.message : String(err)}`);
  }
  const detail = notes.join('; ');
  store.priors.set({ key: 'migrate:v2', value: { doneAt: ok ? now.toISOString() : null, detail, at: now.toISOString() }, n: 0, supersedesDefault: false, updatedAt: now.toISOString() });
  return { ran: true, ok, detail };
}
