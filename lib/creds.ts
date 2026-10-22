import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BRAIN_SWR_PREFIX, CONNECTORS_SWR_PREFIX, invalidateSwr } from '@/lib/swr';

/**
 * Credential resolution for connectors. the operator's keys already live in
 * canonical locations around the machine (~/.config/social/.env,
 * knowledge/.env.agents, ~/.config/mcp.json, project .env files). Connectors
 * resolve from process.env first, then fall back to those files at runtime —
 * no secrets are ever copied into this repo.
 */

export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const stripped = line.startsWith('export ') ? line.slice(7) : line;
    const eq = stripped.indexOf('=');
    if (eq <= 0) continue;
    const key = stripped.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = stripped.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function extractMcpEnvKey(claudeJson: unknown, server: string, key: string): string | undefined {
  const servers = (claudeJson as { mcpServers?: Record<string, { env?: Record<string, string> }> })
    ?.mcpServers;
  return servers?.[server]?.env?.[key];
}

const HOME = os.homedir();

export const CRED_FILES = {
  socialMedia: path.join(HOME, '.config/social', '.env'),
  agentsEnv: path.join(HOME, 'knowledge', '.env.agents'),
  arcads: path.join(HOME, 'Projects', 'arcads-agent-skills', '.env'),
  /** the arcads-claude-code reference project keeps the same key; read when the skills file is absent */
  arcadsReference: path.join(HOME, 'Desktop', 'PROJECTS', 'arcads-claude-code', '.env'),
  claudeJson: path.join(HOME, '.config/mcp.json'),
};

function readEnvFileSafe(filePath: string): Record<string, string> {
  try {
    return parseEnvFile(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

/* ---- .env.local as a live store (the Connections board's connect flow) ----
 * Next only loads .env.local into process.env at boot; the connect flow needs
 * a paste to take effect immediately. So .env.local is ALSO read fresh at
 * call time, and it outranks process.env (the file is what booted the process,
 * so a fresh read is never staler than boot). GLADOS_ENV_LOCAL overrides
 * the path for tests. */

export function envLocalPath(): string {
  return process.env.GLADOS_ENV_LOCAL ?? path.join(process.cwd(), '.env.local');
}

export function readEnvLocal(): Record<string, string> {
  return readEnvFileSafe(envLocalPath());
}

/** Update or append KEY=value lines, preserving every unrelated line verbatim. */
export function upsertEnvLocal(values: Record<string, string>): void {
  const file = envLocalPath();
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    raw = '';
  }
  const lines = raw.length > 0 ? raw.split('\n') : [];
  const pending = new Map(Object.entries(values));
  const next = lines.map((line) => {
    const key = line.trim().replace(/^export /, '').split('=')[0]?.trim();
    if (key && pending.has(key)) {
      const v = pending.get(key)!;
      pending.delete(key);
      return `${key}=${v}`;
    }
    return line;
  });
  while (next.length > 0 && next[next.length - 1] === '') next.pop();
  for (const [key, v] of pending) next.push(`${key}=${v}`);
  fs.writeFileSync(file, next.join('\n') + '\n', { mode: 0o600 });
  // A key changed: the next render checks connectors (and the brain) for real (lib/swr.ts).
  invalidateSwr(CONNECTORS_SWR_PREFIX);
  invalidateSwr(BRAIN_SWR_PREFIX);
}

/** Drop the named keys; every other line stays byte-identical. */
export function removeEnvLocal(keys: string[]): void {
  const file = envLocalPath();
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  const drop = new Set(keys);
  const next = raw
    .split('\n')
    .filter((line) => !drop.has(line.trim().replace(/^export /, '').split('=')[0]?.trim() ?? ''));
  fs.writeFileSync(file, next.join('\n'), { mode: 0o600 });
  invalidateSwr(CONNECTORS_SWR_PREFIX);
  invalidateSwr(BRAIN_SWR_PREFIX);
}

/** process.env with a fresh .env.local overlay — hand this to connectors that
 *  take an env record so a just-pasted key connects without a restart. */
export function runtimeEnv(): Record<string, string | undefined> {
  return { ...process.env, ...readEnvLocal() };
}

/** Fresh .env.local first, then process.env, then each env file in order.
 *  A key that is PRESENT but blank (`KEY=` in .env.local, or an empty string
 *  in process.env) is a deliberate "unset": resolution stops there and returns
 *  undefined instead of falling through to the machine credential files. That
 *  is how an operator disables a connector without deleting a shared file. */
export function resolveCred(name: string, files: string[]): string | undefined {
  const local = readEnvLocal();
  if (Object.prototype.hasOwnProperty.call(local, name)) return local[name].trim() ? local[name] : undefined;
  const fromEnv = process.env[name];
  if (fromEnv !== undefined) return fromEnv.trim() ? fromEnv : undefined;
  for (const file of files) {
    const value = readEnvFileSafe(file)[name];
    if (value) return value;
  }
  return undefined;
}

/**
 * A key whose canonical home is an MCP registration in ~/.config/mcp.json (Attio, ManyChat).
 * Same order and the same blank rule as resolveCred: .env.local, then process.env, and a key that is
 * present there but blank is a deliberate unset (a masked env file during an audit, or an operator
 * disabling the connector), so it never falls through to the MCP file (founderos-ui SPEC O12).
 */
function resolveMcpKey(name: string, server: string): string | undefined {
  const local = readEnvLocal();
  if (Object.prototype.hasOwnProperty.call(local, name)) return local[name].trim() ? local[name] : undefined;
  const fromEnv = process.env[name];
  if (fromEnv !== undefined) return fromEnv.trim() ? fromEnv : undefined;
  try {
    const claudeJson = JSON.parse(fs.readFileSync(CRED_FILES.claudeJson, 'utf8'));
    return extractMcpEnvKey(claudeJson, server, name) || undefined;
  } catch {
    return undefined;
  }
}

/** Attio's key: .env.local / process.env, else the attio MCP registration (resolveMcpKey). */
export function resolveAttioKey(): string | undefined {
  return resolveMcpKey('ATTIO_API_KEY', 'attio');
}

/** ManyChat's key lives in ~/.config/mcp.json (the manychat MCP registration),
 *  same reuse pattern as Attio. .env.local / process.env still win. */
export function resolveManychatKey(): string | undefined {
  return resolveMcpKey('MANYCHAT_API_KEY', 'manychat');
}

/** An absolute http(s) URL, or null. Anything else (empty, relative,
 *  javascript:, malformed) is treated as unset, so a link built from config
 *  can never reload the page or run script. */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** bdpilot's Telegram approval bot link (SPEC S02 FR-B7, H5). Null when
 *  BDPILOT_BOT_URL is unset or not an http(s) URL: /brand-deals then hides
 *  the link instead of rendering a dead one. Fresh .env.local wins, as for
 *  every other key. */
export function resolveBdpilotBotUrl(): string | null {
  return safeHttpUrl(readEnvLocal().BDPILOT_BOT_URL || process.env.BDPILOT_BOT_URL);
}
