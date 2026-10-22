import { Miosa } from '@miosa/sdk';
import { resolveCred } from '@/lib/creds';
import { TTL, keyTag, swr } from '@/lib/swr';
import { filmingMode } from '@/lib/paths';

/**
 * MIOSA cloud computers for the Compute page. The key is MIOSA_API_KEY
 * (.env.local, set by Setup or the CLI). For now everything runs in the
 * tenant's default workspace; external, per-account workspaces come later.
 *
 * Listing goes straight to the REST API: @miosa/sdk 3.2.5's computers.list()
 * expects `data`, but the API answers `{ total, computers }` (checked
 * 2026-10-07). Single-computer calls and embed() go through the SDK.
 */

export const MIOSA_BASE = process.env.MIOSA_BASE_URL ?? 'https://api.miosa.ai/api/v1';

export function miosaKey(): string | undefined {
  return resolveCred('MIOSA_API_KEY', []);
}

export type ComputerRow = {
  id: string;
  name: string;
  status: string;
  size: string;
  template: string;
  resolution: string | null;
  region: string | null;
  workspaceId: string | null;
  desktop: boolean;
  createdAt: string | null;
};

export type ComputeSnapshot =
  | { configured: false }
  | { configured: true; ok: true; computers: ComputerRow[]; credits: number | null; creditsExpireAt: string | null; tenant: string | null }
  | { configured: true; ok: false; error: string };

type RawComputer = Record<string, unknown> & { id: string; name?: string; status?: string; size?: string; template_type?: string; resolution?: string; workspace_id?: string; region?: string; desktop_url?: string; inserted_at?: string; created_at?: string; infrastructure?: Record<string, unknown> };

function row(c: RawComputer): ComputerRow {
  const infra = (c.infrastructure ?? {}) as Record<string, unknown>;
  return {
    id: c.id,
    name: c.name ?? c.id.slice(0, 8),
    status: c.status ?? 'unknown',
    size: c.size ?? '',
    template: c.template_type ?? '',
    resolution: c.resolution ?? null,
    region: (c.region as string | undefined) ?? (infra.region as string | undefined) ?? null,
    workspaceId: c.workspace_id ?? null,
    desktop: Boolean(c.desktop_url) || String(c.template_type ?? '').includes('desktop'),
    createdAt: c.created_at ?? c.inserted_at ?? null,
  };
}

async function api<T>(key: string, path: string): Promise<T> {
  const r = await fetch(`${MIOSA_BASE}${path}`, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
  if (!r.ok) throw new Error(`MIOSA ${r.status} on ${path.split('?')[0]}`);
  return (await r.json()) as T;
}

/**
 * The Compute page's read: computers and credits. On the compute window (lib/swr.ts): a real
 * answer at most 30s old renders at once, an older one (up to 5 min) while one refresh runs. A
 * failed read is not stored. `fresh: true` (the API route) always asks MIOSA now.
 */
export async function computeSnapshot(opts: { fresh?: boolean } = {}): Promise<ComputeSnapshot> {
  // Demo mode: the demo company's four machines, never a call to MIOSA.
  if (filmingMode()) {
    const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const pc = (id: string, name: string, status: string, size: string, template: string, region: string, h: number): ComputerRow => ({
      id, name, status, size, template, resolution: template.includes('desktop') ? '1920x1080' : null, region, workspaceId: 'ws-default', desktop: template.includes('desktop'), createdAt: ago(h),
    });
    return {
      configured: true,
      ok: true,
      credits: 1840,
      creditsExpireAt: new Date(Date.now() + 41 * 86_400_000).toISOString(),
      tenant: 'founderos',
      computers: [
        pc('7f3c1a2e-0b41-4d7e-9a11-2c5d8e1f0a01', 'atlas-planner', 'running', 'medium', 'ubuntu-desktop', 'us-east', 310),
        pc('1b9e4c77-52a0-4f3b-8d26-7e0c4b9a1f02', 'quill-writer', 'running', 'small', 'ubuntu-desktop', 'us-east', 196),
        pc('c42d8f10-9e3b-4a65-b7f1-05a6d2e3c903', 'flint-ads-lab', 'stopped', 'large', 'chrome-desktop', 'eu-west', 88),
        pc('e8a07b35-6c1d-48f2-a9e4-3d7b1c0f5e04', 'sable-books', 'running', 'small', 'ubuntu-server', 'us-east', 52),
      ],
    };
  }
  const key = miosaKey();
  if (!key) return { configured: false };
  try {
    return await swr(`compute:snapshot:${keyTag(key)}`, opts.fresh ? { freshMs: 0, maxStaleMs: 0 } : TTL.compute, () => computeSnapshotLive(key));
  } catch (e) {
    return { configured: true, ok: false, error: e instanceof Error ? e.message : 'MIOSA did not answer' };
  }
}

async function computeSnapshotLive(key: string): Promise<ComputeSnapshot> {
  const [list, credits] = await Promise.all([
    api<{ computers?: RawComputer[]; data?: RawComputer[] }>(key, '/computers'),
    new Miosa({ apiKey: key, baseUrl: MIOSA_BASE }).credits.balance().catch(() => null) as Promise<Record<string, unknown> | null>,
  ]);
  const computers = (list.computers ?? list.data ?? []).map(row);
  return {
    configured: true,
    ok: true,
    computers,
    credits: credits ? Number(credits.balance_credits ?? credits.balance ?? NaN) || null : null,
    creditsExpireAt: credits ? ((credits.credit_expiry_at ?? credits.expires_at ?? null) as string | null) : null,
    tenant: credits ? ((credits.tenant_id as string | undefined) ?? null) : null,
  };
}

export type Embed = { ok: true; url: string; expiresAt: number; ttl: number } | { ok: false; error: string };

/** A short-lived, passwordless desktop link for one computer (about an hour). */
export async function desktopEmbed(id: string): Promise<Embed> {
  if (filmingMode()) return { ok: false, error: 'Live desktops are not part of the demo. Connect a compute key in Settings to open one.' };
  const key = miosaKey();
  if (!key) return { ok: false, error: 'MIOSA is not configured.' };
  if (!/^[0-9a-f-]{8,64}$/i.test(id)) return { ok: false, error: 'Not a computer id.' };
  try {
    const c = await new Miosa({ apiKey: key, baseUrl: MIOSA_BASE }).computers.get(id);
    const e = (await c.embed()) as Record<string, unknown>;
    const url = (e.embed_url ?? e.desktop_url ?? e.raw_desktop_url) as string | undefined;
    if (!url || !/^https:\/\/[a-z0-9.-]+\.miosa\.ai\//i.test(url)) return { ok: false, error: 'MIOSA returned no desktop link.' };
    return { ok: true, url, expiresAt: Number(e.expires_at ?? 0) * 1000 || Date.now() + 3_300_000, ttl: Number(e.ttl_seconds ?? 3600) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not open the desktop.' };
  }
}
