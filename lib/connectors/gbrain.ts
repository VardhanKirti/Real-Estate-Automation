import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { brainStoreDir, gbrainBin } from '@/lib/stores';
import { filmingMode } from '@/lib/paths';
import { BRAIN_SWR_PREFIX, TTL, swr } from '@/lib/swr';
import type { BrainProvider, BrainSearchResult, BrainStatus } from '@/lib/brain';

export type ExecResult = { stdout: string; stderr: string; code: number };
export type ExecFn = (cmd: string, args: string[], stdin?: string) => Promise<ExecResult>;

const READ_TIMEOUT_MS = 15_000;

const WRITE_TIMEOUT_MS = 60_000;

/**
 * One gbrain result per line: `[0.4172] slug -- snippet`. A long snippet wraps
 * onto continuation lines that carry no score and no ` -- `, so matching the
 * whole shape (not splitting on ` -- `) is what keeps wrapped text from being
 * rendered as its own bogus result. The score prefix is optional because
 * older/plain output omits it.
 */
const RESULT_LINE = /^(?:\[(\d+(?:\.\d+)?)\]\s+)?(\S+)\s+--\s+(.*)$/;

/**
 * Reads (doctor/query/stats) must fail fast so a paused Supabase never hangs a
 * page render — 15s → local fallback. Writes (capture/import/embed) embed
 * synchronously through ZeroEntropy + Supabase and run 13–24s+, so they get a
 * generous 60s or execFile kills them mid-embed (SIGTERM).
 */
export function execTimeoutFor(args: string[]): number {
  const cmd = args[0];
  return cmd === 'capture' || cmd === 'import' || cmd === 'embed' ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS;
}

const defaultExec: ExecFn = (cmd, args, stdin) =>
  new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      {
        timeout: execTimeoutFor(args),
        maxBuffer: 4 * 1024 * 1024,
        // In Filming mode the demo stub must answer from the demo brain; the
        // real CLI keeps exactly the environment it was configured with.
        env: { ...process.env, ...(filmingMode() ? { GBRAIN_STORE: brainStoreDir() } : {}), GBRAIN_DISABLE_DIRECT_POOL: process.env.GBRAIN_DISABLE_DIRECT_POOL ?? '1' },
      },
      (err, stdout, stderr) => {
        resolve({
          stdout: stdout?.toString() ?? '',
          // `||` not `??`: on timeout/kill stderr is an empty string, so surface
          // the real error (e.g. "Command failed … SIGTERM") instead of losing it.
          stderr: stderr?.toString() || (err ? err.message : ''),
          code: err ? 1 : 0,
        });
      },
    );
    if (stdin !== undefined) {
      child.stdin?.write(stdin);
      child.stdin?.end();
    }
  });

function walkMarkdown(dir: string, files: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(full, files);
    else if (entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

function localSearch(storePath: string, query: string, limit = 5): BrainSearchResult[] {
  const needle = query.toLowerCase();
  const results: BrainSearchResult[] = [];
  for (const file of walkMarkdown(storePath)) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const line = content.split('\n').find((l) => l.toLowerCase().includes(needle));
    if (line) {
      results.push({
        title: path.relative(storePath, file).replace(/\.md$/, ''),
        snippet: line.trim().slice(0, 240),
        source: 'brain-store',
      });
      if (results.length >= limit) break;
    }
  }
  return results;
}

/** Read every markdown page in the store as { path (posix-relative), content }. */
export function readStoreNotes(storePath: string = brainStoreDir()): { path: string; content: string }[] {
  const notes: { path: string; content: string }[] = [];
  for (const file of walkMarkdown(storePath)) {
    try {
      notes.push({
        path: path.relative(storePath, file).split(path.sep).join('/'),
        content: fs.readFileSync(file, 'utf8'),
      });
    } catch {
      // unreadable file — skip it
    }
  }
  return notes.sort((a, b) => a.path.localeCompare(b.path));
}

export type DoctorCheck = { name: string; status: string; message: string };

export type BrainOverview = {
  store: {
    path: string;
    totalFiles: number;
    folders: { name: string; files: number }[];
  };
  doctor: {
    connected: boolean;
    status: string;
    healthScore: number | null;
    checks: DoctorCheck[];
    detail: string;
    /** CLI version, only when `engine doctor --json` reports one (H33: never a literal). */
    version?: string | null;
  };
};

export type GBrainStats = {
  pages: number;
  chunks: number;
  embedded: number;
  byType: { type: string; count: number }[];
};

export type CaptureInput = { text: string; title?: string; type?: string; slug?: string };
export type CaptureOutcome =
  | { ok: true; slug: string; contentHash: string }
  | { ok: false; error: string };

/** Parse the plain-text output of `gbrain stats` into structured counts. */
export function parseGbrainStats(text: string): GBrainStats {
  const num = (label: string): number => {
    const m = text.match(new RegExp(`${label}:\\s*(\\d+)`, 'i'));
    return m ? Number(m[1]) : 0;
  };
  const byType: { type: string; count: number }[] = [];
  const afterHeader = text.split(/By type:/i)[1] ?? '';
  for (const line of afterHeader.split('\n')) {
    const m = line.match(/^\s+([\w-]+):\s*(\d+)\s*$/);
    if (m) byType.push({ type: m[1], count: Number(m[2]) });
  }
  return { pages: num('Pages'), chunks: num('Chunks'), embedded: num('Embedded'), byType };
}

export type GBrainProvider = BrainProvider & {
  localStats(): Promise<{ markdownFiles: number; storePath: string }>;
  overview(): Promise<BrainOverview>;
  stats(): Promise<GBrainStats | null>;
  capture(input: CaptureInput): Promise<CaptureOutcome>;
};

function storeFolders(storePath: string): { name: string; files: number }[] {
  const counts = new Map<string, number>();
  for (const file of walkMarkdown(storePath)) {
    const rel = path.relative(storePath, file);
    const top = rel.includes(path.sep) ? rel.split(path.sep)[0] : '(root)';
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The read-only health calls (`doctor`, `stats`) are the slow part of Home, Optimal Engine and the
 * connector board: a CLI spawn that can take seconds (up to the 15s read timeout on a paused
 * Supabase). With the real CLI they go through lib/swr.ts: a real answer at most 5 min old renders
 * at once, an older one (up to 30 min) renders while a new check runs. Local file counts and every
 * search or write stay live. An injected exec (tests) is never cached.
 */
function cachedReads(exec: ExecFn, injected: boolean): ExecFn {
  if (injected) return exec;
  return (cmd, args, stdin) => {
    if (stdin !== undefined || (args[0] !== 'doctor' && args[0] !== 'stats')) return exec(cmd, args, stdin);
    const key = `${BRAIN_SWR_PREFIX}${cmd}:${args.join(' ')}:${filmingMode() ? 'filming' : 'live'}`;
    return swr(key, TTL.brain, () => exec(cmd, args));
  };
}

export function createGBrainProvider(opts: { exec?: ExecFn; storePath?: string } = {}): GBrainProvider {
  const exec = cachedReads(opts.exec ?? defaultExec, Boolean(opts.exec));
  const storePath = opts.storePath ?? brainStoreDir();

  return {
    name: 'gbrain',

    async status(): Promise<BrainStatus> {
      const localFiles = walkMarkdown(storePath).length;
      const result = await exec(gbrainBin(), ['doctor', '--json', '--fast']);
      if (result.code === 0 && result.stdout.trim()) {
        try {
          const doctor = JSON.parse(result.stdout) as { status?: string; health_score?: number };
          return {
            connected: true,
            provider: 'gbrain',
            detail: `engine ${doctor.status ?? 'ok'} · health ${doctor.health_score ?? '?'}/100 · ${localFiles} local pages in brain-store`,
          };
        } catch {
          // fall through to the error path below
        }
      }
      const firstError = (result.stderr || result.stdout).split('\n').find(Boolean) ?? 'engine CLI unavailable';
      return {
        connected: false,
        provider: 'gbrain',
        detail: `${firstError.trim().slice(0, 200)} · local fallback active (${localFiles} markdown pages)`,
      };
    },

    async search(query: string): Promise<BrainSearchResult[]> {
      const result = await exec(gbrainBin(), ['query', query, '--no-expand']);
      if (result.code === 0 && result.stdout.trim() && !/cannot connect/i.test(result.stdout)) {
        const hits = result.stdout
          .split('\n')
          .map((line) => RESULT_LINE.exec(line))
          .filter((m): m is RegExpExecArray => m !== null)
          .slice(0, 8)
          .map((m) => ({ title: m[2], snippet: m[3].trim() || m[2], source: 'gbrain' }));
        if (hits.length > 0) return hits;
      }
      return localSearch(storePath, query);
    },

    async localStats() {
      return { markdownFiles: walkMarkdown(storePath).length, storePath };
    },

    async overview(): Promise<BrainOverview> {
      const folders = storeFolders(storePath);
      const store = {
        path: storePath,
        totalFiles: folders.reduce((sum, f) => sum + f.files, 0),
        folders,
      };

      const result = await exec(gbrainBin(), ['doctor', '--json', '--fast']);
      if (result.code === 0 && result.stdout.trim()) {
        try {
          const doctor = JSON.parse(result.stdout) as {
            status?: string;
            health_score?: number;
            checks?: { name?: string; status?: string; message?: string }[];
            version?: unknown;
            cli_version?: unknown;
          };
          const version = [doctor.version, doctor.cli_version].find((v): v is string => typeof v === 'string' && v.trim() !== '');
          return {
            store,
            doctor: {
              connected: true,
              status: doctor.status ?? 'ok',
              healthScore: doctor.health_score ?? null,
              checks: (doctor.checks ?? []).map((c) => ({
                name: c.name ?? 'unknown',
                status: c.status ?? 'unknown',
                message: c.message ?? '',
              })),
              detail: `engine ${doctor.status ?? 'ok'} · health ${doctor.health_score ?? '?'}/100`,
              version: version ?? null,
            },
          };
        } catch {
          // fall through to the disconnected path below
        }
      }
      const firstError = (result.stderr || result.stdout).split('\n').find(Boolean) ?? 'engine CLI unavailable';
      return {
        store,
        doctor: {
          connected: false,
          status: 'unreachable',
          healthScore: null,
          checks: [],
          detail: firstError.trim().slice(0, 200),
          version: null,
        },
      };
    },

    async stats(): Promise<GBrainStats | null> {
      const result = await exec(gbrainBin(), ['stats']);
      if (result.code === 0 && /Pages:/i.test(result.stdout)) {
        return parseGbrainStats(result.stdout);
      }
      return null;
    },

    async capture(input: CaptureInput): Promise<CaptureOutcome> {
      const title = input.title?.trim();
      const body = input.text.trim();
      if (!body) return { ok: false, error: 'nothing to capture (empty content)' };
      const content = title ? `# ${title}\n\n${body}` : body;

      const args = ['capture', '--stdin', '--json'];
      if (input.type) args.push('--type', input.type);
      if (input.slug) args.push('--slug', input.slug);

      const result = await exec(gbrainBin(), args, content);
      if (result.code === 0 && result.stdout.trim()) {
        try {
          const receipt = JSON.parse(result.stdout) as { slug?: string; content_hash?: string };
          if (receipt.slug) {
            return { ok: true, slug: receipt.slug, contentHash: receipt.content_hash ?? '' };
          }
        } catch {
          // malformed JSON — fall through to the honest error path
        }
      }
      const err = (result.stderr || result.stdout).split('\n').find(Boolean) ?? 'gbrain capture failed';
      return { ok: false, error: err.trim().slice(0, 200) };
    },
  };
}
