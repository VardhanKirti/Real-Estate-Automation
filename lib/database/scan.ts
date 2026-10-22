import { existsSync, openSync, readSync, closeSync, readdirSync, lstatSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataPath, filmingMode } from '@/lib/paths';

/**
 * The brain folder as a size tree, for the Database page's block map.
 * Apparent sizes, symlinks never followed. The folder is BRAIN_DIR, else
 * ~/Desktop/brain (the MacBook), else ~/Sync/brain (the Mac mini).
 */

export type DbNode = {
  name: string;
  /** path relative to the brain root, '' for the root */
  path: string;
  dir: boolean;
  size: number;
  files: number;
  mtime: number;
  children?: DbNode[];
};

export type DbTree = { configured: true; root: string; tree: DbNode; scannedAt: string; truncated: boolean } | { configured: false; tried: string[] };

const MAX_NODES = 60_000;

export function brainCandidates(): string[] {
  if (filmingMode()) return [dataPath('brain')];
  const env = process.env.BRAIN_DIR?.trim();
  const home = os.homedir();
  return env ? [env.replace(/^~(?=$|\/)/, home)] : [path.join(home, 'Desktop/brain'), path.join(home, 'Sync/brain')];
}

export function brainRoot(): string | null {
  for (const p of brainCandidates()) {
    try {
      if (existsSync(p) && statSync(p).isDirectory()) return p;
    } catch { /* unreadable: try the next */ }
  }
  return null;
}

let cache: { at: number; root: string; value: DbTree } | null = null;

export function scanBrain(maxAgeMs = 60_000): DbTree {
  const root = brainRoot();
  if (!root) return { configured: false, tried: brainCandidates() };
  if (cache && cache.root === root && Date.now() - cache.at < maxAgeMs) return cache.value;
  let count = 0;
  let truncated = false;
  const walk = (abs: string, rel: string, name: string): DbNode => {
    count++;
    let st;
    try { st = lstatSync(abs); } catch { return { name, path: rel, dir: false, size: 0, files: 0, mtime: 0 }; }
    if (!st.isDirectory()) return { name, path: rel, dir: false, size: st.isFile() ? st.size : 0, files: st.isFile() ? 1 : 0, mtime: st.mtimeMs };
    const node: DbNode = { name, path: rel, dir: true, size: 0, files: 0, mtime: st.mtimeMs, children: [] };
    let entries: string[] = [];
    try { entries = readdirSync(abs); } catch { return node; }
    for (const e of entries) {
      if (count >= MAX_NODES) { truncated = true; break; }
      const c = walk(path.join(abs, e), rel ? `${rel}/${e}` : e, e);
      node.children!.push(c);
      node.size += c.size;
      node.files += c.files;
    }
    node.children!.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
    return node;
  };
  const tree = walk(root, '', path.basename(root));
  const value: DbTree = { configured: true, root, tree, scannedAt: new Date().toISOString(), truncated };
  cache = { at: Date.now(), root, value };
  return value;
}

/** Folders and names whose contents never leave the machine through this page. */
const PRIVATE = [/^Vault(\/|$)/i, /(^|\/)\.git(\/|$)/, /(^|\/)\.env/i, /(^|\/)\.ssh(\/|$)/, /\.(pem|key|p12|pfx|keychain|dmg)$/i, /(token|secret|password|credential|recovery)/i];
const TEXT = /\.(md|markdown|txt|json|ya?ml|toml|csv|tsv|ts|tsx|js|mjs|cjs|py|sh|zsh|html|css|xml|ini|conf|log|sql|rb|go|rs|swift|plist)$/i;
const PREVIEW_BYTES = 24_000;

export function isPrivatePath(rel: string): boolean {
  return PRIVATE.some((re) => re.test(rel));
}

export type FilePreview =
  | { ok: true; path: string; size: number; mtime: number; kind: 'text'; text: string; truncated: boolean }
  | { ok: true; path: string; size: number; mtime: number; kind: 'binary' | 'private' }
  | { ok: false; error: string };

export function previewFile(rel: string): FilePreview {
  const root = brainRoot();
  if (!root) return { ok: false, error: 'The brain folder is not configured.' };
  const clean = rel.replace(/^\/+/, '');
  const abs = path.resolve(root, clean);
  if (abs !== root && !abs.startsWith(root + path.sep)) return { ok: false, error: 'Outside the brain folder.' };
  let st;
  try { st = lstatSync(abs); } catch { return { ok: false, error: 'No such file.' }; }
  if (!st.isFile()) return { ok: false, error: 'Not a file.' };
  const base = { ok: true as const, path: clean, size: st.size, mtime: st.mtimeMs };
  if (isPrivatePath(clean)) return { ...base, kind: 'private' };
  if (!TEXT.test(clean)) return { ...base, kind: 'binary' };
  const fd = openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(Math.min(PREVIEW_BYTES, st.size));
    readSync(fd, buf, 0, buf.length, 0);
    return { ...base, kind: 'text', text: buf.toString('utf8'), truncated: st.size > PREVIEW_BYTES };
  } finally {
    closeSync(fd);
  }
}
