/**
 * Usage readings repository (pages/usage.md §2): token burn PUSHED by other
 * machines (POST /api/usage/push). This machine's own burn is read locally
 * (lib/usage.ts) and never stored. A plan no machine reported has no rows,
 * which the page shows as "Not reported", never 0.
 */
import type Database from 'better-sqlite3';
import { UsageReadingSchema, type UsagePlan, type UsageReading } from '@/lib/schemas';

type Raw = {
  machine: string; plan: string; day: string; model: string; input: number; output: number;
  cache_write: number; pushed_at: string;
};
const toReading = (r: Raw): UsageReading =>
  UsageReadingSchema.parse({
    machine: r.machine, plan: r.plan, day: r.day, model: r.model, input: r.input, output: r.output,
    cacheWrite: r.cache_write, pushedAt: r.pushed_at,
  });

export function usageReadingsRepo(db: InstanceType<typeof Database>) {
  return {
    /**
     * Store one machine's push. Each (plan, day) the push names is replaced
     * whole for that machine, so a re-push of a day is not double counted.
     */
    replaceForMachine(machine: string, readings: Omit<UsageReading, 'machine' | 'pushedAt'>[], pushedAt = new Date().toISOString()): number {
      const rows = readings.map((r) => UsageReadingSchema.parse({ ...r, machine, pushedAt }));
      db.transaction(() => {
        const del = db.prepare('DELETE FROM usage_readings WHERE machine = ? AND plan = ? AND day = ?');
        const seen = new Set<string>();
        for (const r of rows) {
          const k = `${r.plan}|${r.day}`;
          if (seen.has(k)) continue;
          seen.add(k);
          del.run(machine, r.plan, r.day);
        }
        const ins = db.prepare(
          `INSERT INTO usage_readings (machine, plan, day, model, input, output, cache_write, pushed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(machine, plan, day, model) DO UPDATE SET
             input = input + excluded.input, output = output + excluded.output,
             cache_write = cache_write + excluded.cache_write, pushed_at = excluded.pushed_at`,
        );
        for (const r of rows) ins.run(r.machine, r.plan, r.day, r.model, r.input, r.output, r.cacheWrite, r.pushedAt);
      })();
      return rows.length;
    },
    /** Rows on or after `sinceDay` (YYYY-MM-DD), optionally one plan. */
    since(sinceDay: string, plan?: UsagePlan): UsageReading[] {
      const rows = plan
        ? db.prepare('SELECT * FROM usage_readings WHERE day >= ? AND plan = ? ORDER BY day, machine, model').all(sinceDay, plan)
        : db.prepare('SELECT * FROM usage_readings WHERE day >= ? ORDER BY day, machine, model').all(sinceDay);
      return (rows as Raw[]).map(toReading);
    },
    /** Every machine that ever pushed, with its newest push per plan. */
    machines(): { machine: string; plan: UsagePlan; lastPushAt: string }[] {
      return db
        .prepare('SELECT machine, plan, MAX(pushed_at) AS lastPushAt FROM usage_readings GROUP BY machine, plan ORDER BY machine, plan')
        .all() as { machine: string; plan: UsagePlan; lastPushAt: string }[];
    },
    count(): number {
      return (db.prepare('SELECT COUNT(*) AS n FROM usage_readings').get() as { n: number }).n;
    },
  };
}
