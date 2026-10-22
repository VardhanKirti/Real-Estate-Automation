import fs from 'node:fs';
import path from 'node:path';
import { CampaignSchema } from '@/lib/creative-engine/schemas';

/**
 * The Ad Engine → Creative Engine on-disk rename (S02 FR-13, FR-14).
 *
 * Two directories move, each once, by a same-filesystem rename (atomic, no
 * copy, nothing deleted):
 *   <data dir>/ad-engine                → <data dir>/creative-engine
 *   public/content-media/ad-engine      → public/content-media/creative-engine
 * and stored public paths `/content-media/ad-engine/…` in campaign files are
 * rewritten to the new prefix, each file backed up once beside itself as
 * `<file>.pre-rename.bak` before it changes. A backup is never overwritten
 * or removed.
 *
 * Every function here is idempotent and never throws: a failure warns and
 * leaves the old layout readable, so a boot never dies on the migration.
 * The glue (which dirs, memoised per data dir) lives in store.ts.
 */

export const LEGACY_DIR_NAME = 'ad-engine';
export const DIR_NAME = 'creative-engine';
export const LEGACY_PUBLIC_PREFIX = '/content-media/ad-engine/';
export const PUBLIC_PREFIX = '/content-media/creative-engine/';
export const BACKUP_SUFFIX = '.pre-rename.bak';

export type Warn = (message: string) => void;

const defaultWarn: Warn = (m) => console.warn(`[creative-engine] ${m}`);

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

export type DirResolution = {
  /** The directory to use for this process. */
  dir: string;
  /** True when this call renamed old → next. */
  migrated: boolean;
  /** True when the old directory is in use (rename off or failed). */
  legacy: boolean;
};

/**
 * Pick the directory to use, renaming the old one into place when only it
 * exists. Rules (S02 FR-13, edge cases 1 and 2):
 *  - next exists: use it; if old also exists, warn and never touch or merge it.
 *  - only old exists: rename it to next; on any error read old and warn.
 *  - neither: next (created lazily by the first write).
 * `migrate: false` reads old in place instead of renaming it.
 */
export function resolveRenamedDir(
  next: string,
  old: string,
  opts: { migrate?: boolean; warn?: Warn; rename?: (from: string, to: string) => void } = {},
): DirResolution {
  const warn = opts.warn ?? defaultWarn;
  try {
    if (exists(next)) {
      if (exists(old)) warn(`legacy ${LEGACY_DIR_NAME} directory left in place at ${old}; using ${next}, nothing was merged`);
      return { dir: next, migrated: false, legacy: false };
    }
    if (!exists(old)) return { dir: next, migrated: false, legacy: false };
    if (opts.migrate === false) return { dir: old, migrated: false, legacy: true };
    try {
      (opts.rename ?? fs.renameSync)(old, next);
      return { dir: next, migrated: true, legacy: false };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code ?? String(err);
      warn(`could not rename ${old} to ${next} (${code}); reading the old directory for this process, nothing was copied or deleted`);
      return { dir: old, migrated: false, legacy: true };
    }
  } catch (err) {
    warn(`directory check failed (${String(err)}); using ${next}`);
    return { dir: next, migrated: false, legacy: false };
  }
}

/** Strip either public prefix, giving the path relative to the asset root. */
export function relFromPublic(publicPath: string): string {
  if (publicPath.startsWith(PUBLIC_PREFIX)) return publicPath.slice(PUBLIC_PREFIX.length);
  if (publicPath.startsWith(LEGACY_PUBLIC_PREFIX)) return publicPath.slice(LEGACY_PUBLIC_PREFIX.length);
  return publicPath;
}

export type RewriteReport = { rewritten: string[]; skipped: string[] };

/** Write `text` to `file` atomically: temp file in the same dir, then rename. */
function replaceFile(file: string, text: string): void {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** Keep the first original as `<file>.pre-rename.bak`; an existing backup is never touched. */
function backupOnce(file: string, original: string): void {
  try {
    fs.writeFileSync(file + BACKUP_SUFFIX, original, { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err;
  }
}

function rewriteOne(file: string, valid: (parsed: unknown) => boolean, report: RewriteReport, warn: Warn): void {
  let original: string;
  try {
    original = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  if (!original.includes(LEGACY_PUBLIC_PREFIX)) return;
  const next = original.split(LEGACY_PUBLIC_PREFIX).join(PUBLIC_PREFIX);
  let ok = false;
  try {
    ok = valid(JSON.parse(next));
  } catch {
    ok = false;
  }
  if (!ok) {
    report.skipped.push(file);
    warn(`kept ${file} unchanged: the rewritten file did not parse; its old paths still resolve`);
    return;
  }
  try {
    backupOnce(file, original);
    replaceFile(file, next);
    report.rewritten.push(file);
  } catch (err) {
    report.skipped.push(file);
    warn(`could not rewrite ${file} (${String(err)}); kept the original`);
  }
}

/**
 * Rewrite `/content-media/ad-engine/` to `/content-media/creative-engine/`
 * in every campaign file of a store, plus runs.json if it carries the prefix.
 * Each changed file is backed up once; a campaign whose rewritten text fails
 * CampaignSchema keeps its original. Safe to run any number of times.
 */
export function rewriteLegacyAssetPaths(storeDir: string, opts: { warn?: Warn } = {}): RewriteReport {
  const warn = opts.warn ?? defaultWarn;
  const report: RewriteReport = { rewritten: [], skipped: [] };
  try {
    const campaigns = path.join(storeDir, 'campaigns');
    let names: string[] = [];
    try {
      names = fs.readdirSync(campaigns).filter((n) => n.endsWith('.json'));
    } catch {
      names = [];
    }
    for (const n of names) rewriteOne(path.join(campaigns, n), (v) => CampaignSchema.safeParse(v).success, report, warn);
    rewriteOne(path.join(storeDir, 'runs.json'), (v) => Array.isArray(v), report, warn);
  } catch (err) {
    warn(`asset path rewrite stopped (${String(err)})`);
  }
  return report;
}
