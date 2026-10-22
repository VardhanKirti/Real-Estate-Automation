/**
 * Superset connector (pages/clients.md, "Start draft in Superset"). Ported
 * from FounderOS (v1 `lib/connectors/superset.ts`, v2 `connectors/superset`).
 *
 * GladOS never does client work in-process: a launch shells the local Superset
 * CLI to create an isolated workspace (own worktree and branch) with a coding
 * or writing agent inside, carrying the brief and the house rules. Starting an
 * agent spends money, so launch() is only reachable through
 * POST /api/clients/work/[id]/launch, behind GLADOS_WRITES=1 and an explicit
 * confirm (lib/gates.ts). SUPERSET_API_KEY is handed to the CLI's environment.
 *
 * The status check never runs the CLI (Home renders connector status and must
 * not spawn a subprocess, feature-additions H-2): it only looks for the key
 * and for the binary on PATH. Exec is injectable so tests stay offline;
 * failures carry the CLI's own stderr, never a fake success.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveCred } from '@/lib/creds';
import type { ConnectorStatus } from '@/lib/connectors/types';

export type ExecResult = { stdout: string; stderr: string; code: number };
export type ExecFn = (cmd: string, args: string[], env: Record<string, string | undefined>) => Promise<ExecResult>;

export type SupersetLaunch = { workspaceId: string; branch: string };

const BRANCH_MAX = 80;

export function supersetKey(): string | undefined {
  return resolveCred('SUPERSET_API_KEY', []);
}

export function supersetBin(): string {
  return resolveCred('SUPERSET_BIN', [])?.trim() || 'superset';
}

/** Is the CLI on this machine? A path is checked directly, a bare name on PATH. */
export function supersetCliFound(bin = supersetBin(), pathEnv = process.env.PATH ?? ''): boolean {
  if (bin.includes('/')) return fs.existsSync(bin);
  return pathEnv.split(path.delimiter).some((dir) => dir && fs.existsSync(path.join(dir, bin)));
}

const defaultExec: ExecFn = (cmd, args, env) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 60_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
      resolve({ stdout: stdout?.toString() ?? '', stderr: stderr?.toString() || (err ? err.message : ''), code: err ? 1 : 0 });
    });
  });

export function branchFor(clientName: string, now: Date = new Date()): string {
  const slug =
    clientName
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
      .replace(/-$/, '') || 'client';
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `client/${slug}-${stamp}`.slice(0, BRANCH_MAX);
}

/** The agent's prompt: the brief plus the draft-first rules (nothing is sent). */
export function draftPromptFor(input: { clientName: string; brief: string }, branch: string): string {
  return [
    `You are drafting client work for ${input.clientName} on branch \`${branch}\` in an isolated Superset workspace.`,
    '',
    'Brief from the operator:',
    input.brief,
    '',
    'Rules (non-negotiable):',
    '- Draft only. Do not publish, send, email, post or invoice anything.',
    '- Do not state fees, contract terms or revenue unless the brief gives them.',
    '- Commit your draft locally on this branch. Never push to any remote.',
    '- When the draft is ready, stop and summarise what you made and what needs the operator.',
  ].join('\n');
}

/**
 * Create the workspace. Callers MUST have passed the write gate first; this
 * function does not re-check it (it is also used by tests with a fake exec).
 */
export async function launchSupersetDraft(
  input: { clientName: string; brief: string; projectId: string },
  opts: { exec?: ExecFn; now?: Date } = {},
): Promise<SupersetLaunch> {
  const brief = input.brief.trim();
  if (!brief) throw new Error('the brief is empty');
  if (!input.projectId.trim()) throw new Error('no Superset project: set the client’s Superset project or SUPERSET_PROJECT_ID');
  const exec = opts.exec ?? defaultExec;
  const branch = branchFor(input.clientName, opts.now);
  const res = await exec(
    supersetBin(),
    ['workspaces', 'create', '--local', '--project', input.projectId, '--branch', branch, '--agent', 'claude', '--prompt', draftPromptFor({ clientName: input.clientName, brief }, branch), '--json'],
    { SUPERSET_API_KEY: supersetKey() },
  );
  if (res.code !== 0) throw new Error(`superset workspaces create failed: ${(res.stderr || res.stdout).slice(0, 300)}`.trim());
  let created: Record<string, unknown>;
  try {
    created = JSON.parse(res.stdout) as Record<string, unknown>;
  } catch {
    throw new Error('superset workspaces create returned unparseable JSON');
  }
  const ws = (created.workspace ?? created) as Record<string, unknown>;
  if (typeof ws.id !== 'string' || !ws.id) throw new Error('superset workspaces create returned no workspace id');
  return { workspaceId: ws.id, branch };
}

export function supersetStatus(opts: { key?: string; cliFound?: boolean } = {}): ConnectorStatus {
  const base = { id: 'superset', name: 'Superset', kind: 'orchestration' } as const;
  const key = 'key' in opts ? opts.key : supersetKey();
  if (!key) {
    return {
      ...base,
      state: 'not_configured',
      detail: 'Set SUPERSET_API_KEY to start client drafts in Superset workspaces. Launches also need GLADOS_WRITES=1.',
    };
  }
  const found = opts.cliFound ?? supersetCliFound();
  if (!found) {
    return { ...base, state: 'error', detail: `SUPERSET_API_KEY is set but the ${supersetBin()} CLI is not on this machine's PATH.` };
  }
  return { ...base, state: 'connected', detail: 'Superset CLI found · launches need GLADOS_WRITES=1 and a confirm' };
}

export async function supersetConnectorStatus(): Promise<ConnectorStatus> {
  return supersetStatus();
}
