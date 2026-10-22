import fs from 'node:fs';
import path from 'node:path';

/**
 * One place that decides WHICH data directory the OS reads and writes.
 *
 * Real data lives in data/. Filming data lives in demo-data/. Nothing ever
 * writes fabricated rows into data/ — filming flips the directory, it does not
 * seed over the top of the real stores. That is the whole safety property here:
 * you cannot lose real financial history by toggling a switch in the UI.
 *
 * Resolution order:
 *   1. GLADOS_DATA_DIR — explicit override. The mac mini pins this so the
 *      always-on instance can never be talked into filming mode.
 *   2. DEMO_MODE=1 / DEMO_MODE=0 — forces filming on or off for this process.
 *   3. .glados-mode — written by the Settings toggle. Read per call (cached for
 *      a second) so flipping it takes effect without restarting the server.
 *   4. no choice made yet — GLADOS_DEFAULT_MODE, 'demo' unless set: a fresh
 *      FounderOS clone opens on the demo company (lib/demo/store.ts) until
 *      Settings switches it to real data, which writes 'real' to .glados-mode.
 */

const REAL_DIR = 'data';
const FILMING_DIR = 'demo-data';

/** Lives at the project root, outside both data dirs, so switching never loses it.
 *  GLADOS_MODE_FILE redirects it — tests set that so they never touch the real one. */
export const modeFile = (): string =>
  process.env.GLADOS_MODE_FILE ?? path.join(process.cwd(), '.glados-mode');

let cached: { value: boolean; at: number } | null = null;
const CACHE_MS = 1000;

/** True when this process should read and write the filming dataset. */
export function filmingMode(): boolean {
  if (process.env.GLADOS_DATA_DIR) return false;
  if (process.env.DEMO_MODE === '1') return true;
  if (process.env.DEMO_MODE === '0') return false;

  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.value;

  let value: boolean;
  try {
    value = fs.readFileSync(modeFile(), 'utf8').trim() === 'filming';
  } catch {
    value = (process.env.GLADOS_DEFAULT_MODE ?? 'demo') !== 'real';
  }
  cached = { value, at: now };
  return value;
}

/** Forget the cached mode — call after writing the mode file. */
export function invalidateModeCache(): void {
  cached = null;
}

/** Absolute path of the data directory currently in force. */
export function dataDir(): string {
  const override = process.env.GLADOS_DATA_DIR;
  if (override) return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
  return path.join(process.cwd(), filmingMode() ? FILMING_DIR : REAL_DIR);
}

/** Absolute path to a file or folder inside the current data directory. */
export function dataPath(...segments: string[]): string {
  return path.join(dataDir(), ...segments);
}

/** True when the given path sits inside the REAL data directory. */
export function isRealDataPath(target: string): boolean {
  const real = path.resolve(process.cwd(), REAL_DIR);
  const resolved = path.resolve(target);
  return resolved === real || resolved.startsWith(real + path.sep);
}

/**
 * Refuse to run a destructive seed against the real stores.
 *
 * Every seeder calls this first. Filming mode is the only way a seed is allowed
 * to proceed, unless the caller explicitly sets GLADOS_ALLOW_REAL_SEED=1, which
 * exists for first-time setup on a fresh machine and nothing else.
 */
export function assertSeedTarget(target: string = dataDir()): void {
  if (process.env.GLADOS_ALLOW_REAL_SEED === '1') return;
  if (!isRealDataPath(target)) return;
  throw new Error(
    `Refusing to seed ${target} — that is the real data directory.\n` +
      `Turn on filming mode (Settings, or DEMO_MODE=1) so the seed writes to ${FILMING_DIR}/ instead.\n` +
      `If this really is a fresh machine with nothing to lose, set GLADOS_ALLOW_REAL_SEED=1.`,
  );
}

export const DATA_DIR_NAMES = { real: REAL_DIR, filming: FILMING_DIR } as const;
