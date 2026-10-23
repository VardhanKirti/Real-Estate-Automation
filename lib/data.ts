import path from 'node:path';
import fs from 'node:fs';
import { openDb, type GladosDb } from '@/lib/db';
import { seedDatabase, syncWebhookAgents, syncAgentWorkflows, syncAgentSkills } from '@/lib/seed';
import { dataPath } from '@/lib/paths';
import { ensureDemoStore } from '@/lib/demo/store';

/**
 * App-level singleton. Larp-first, real-ready: every page and API route reads
 * through this seeded SQLite database, so swapping in live sources later is a
 * repo-level change, not a UI rewrite.
 */
let instance: GladosDb | null = null;

/**
 * Where the database lives. GLADOS_DB wins; otherwise `glados.db` in the data
 * directory. Installs from before the rename keep their data in
 * `founder-os.db` (and may still set FOUNDER_OS_DB): when no `glados.db`
 * exists yet, that file is opened in place, so an upgrade never boots onto an
 * empty database. Nothing is renamed or moved.
 */
export function resolveDbPath(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.GLADOS_DB ?? env.FOUNDER_OS_DB;
  if (explicit) return explicit;
  const current = dataPath('glados.db');
  const legacy = dataPath('founder-os.db');
  if (!fs.existsSync(current) && fs.existsSync(legacy)) return legacy;
  return current;
}

/**
 * A safe no-op stand-in for the whole GladosDb surface, used only when the
 * real database can't open at all (see the catch in getDb() below) — e.g.
 * better-sqlite3's native binary failing to load on a host whose runtime
 * doesn't match the one it was compiled for (ERR_DLOPEN_FAILED). Without
 * this, every page that calls getDb() for its own local-data features
 * (chats, tasks, workflows, clients, ...) 500s outright, which also makes
 * the whole app look broken even where the crash has nothing to do with
 * the real-estate data (that comes from the Skyescraper API, not this DB).
 *
 * Returns "nothing yet" shaped values for anything called on it: [] for
 * list/all/recent-style calls, null for get/find-style calls, undefined
 * for everything else (inserts, updates — silently no-op). This trades
 * away persistence for every *other* FounderOS feature on this specific
 * deployment, not for correctness of the ones that do work.
 */
function emptyDbStub(): GladosDb {
  // Methods that plainly return a single thing (get/find/latest/...) answer
  // null; everything else (all/list/recent/insert/update/...) answers an
  // empty array, which also behaves fine as a no-op when the call site
  // ignores the return value (inserts, syncs).
  const singularPattern = /^(get|find|latest|detail)/i;
  const methodStub = (methodName: string) => (..._args: unknown[]) =>
    singularPattern.test(methodName) ? null : [];

  const tableStub: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then' || typeof prop !== 'string') return undefined;
        return methodStub(prop);
      },
    },
  );

  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then' || typeof prop !== 'string') return undefined;
        return tableStub;
      },
    },
  ) as GladosDb;
}

export function getDb(): GladosDb {
  if (instance) return instance;
  try {
    // Demo mode opens on the demo company: built on first use, rebuilt weekly.
    if (!process.env.GLADOS_DB && !process.env.FOUNDER_OS_DB) ensureDemoStore();
    const dbPath = resolveDbPath();
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    instance = openDb(dbPath);
    // Seed the structural rows (departments) on first touch. Everything else
    // starts empty: a fresh install is a blank OS the operator fills in.
    if (instance.departments.all().length === 0) {
      seedDatabase(instance);
    }
    // Env-driven, not structural: re-synced on every process start so a changed
    // webhook URL takes effect on restart without needing a full reseed.
    syncWebhookAgents(instance);
    syncAgentWorkflows(instance);
    syncAgentSkills(instance);
  } catch (err) {
    console.error('[data] local database unavailable, falling back to an empty stub:', err);
    instance = emptyDbStub();
  }
  return instance;
}
