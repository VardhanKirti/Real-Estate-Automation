import { zernioKey } from '@/lib/connectors/zernio';

/** A signed upload URL for one media file (FounderOS v1 lib/connectors/zernio.ts). */
export async function zernioUploadTarget(fileName: string, contentType: string): Promise<{ uploadUrl: string; accessUrl: string }> {
  const key = zernioKey();
  if (!key) throw new Error('ZERNIO_API_KEY not configured');
  const base = process.env.ZERNIO_BASE_URL ?? 'https://getlate.dev/api';
  const qs = new URLSearchParams({ fileName, contentType });
  const res = await fetch(`${base}/media/uploadUrl?${qs}`, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`uploadUrl failed: HTTP ${res.status}`);
  const body = (await res.json()) as { uploadUrl?: string; accessUrl?: string };
  if (!body.uploadUrl || !body.accessUrl) throw new Error('uploadUrl response missing fields');
  return { uploadUrl: body.uploadUrl, accessUrl: body.accessUrl };
}
