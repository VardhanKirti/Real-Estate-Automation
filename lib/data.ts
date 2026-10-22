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

export function getDb(): GladosDb {
  if (instance) return instance;
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
  return instance;
}
