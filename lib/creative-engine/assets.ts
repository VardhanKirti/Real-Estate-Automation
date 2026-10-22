import fs from 'node:fs';
import path from 'node:path';
import { assetPathFor } from '@/lib/creative-engine/store';

/**
 * Rehoster — Arcads download URLs are presigned S3 links that expire, so
 * nothing the panel shows may point at them. Files land under
 * public/content-media/creative-engine/<campaign>/ and are served statically.
 * Thumbnails come from ffmpeg when it is present; when it is not, the
 * asset honestly has no thumbnail rather than a fake one.
 */

const EXT_FOR: Record<string, string> = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

function extFromUrl(url: string, contentType: string | null, kind: 'video' | 'image'): string {
  if (contentType && EXT_FOR[contentType.split(';')[0]]) return EXT_FOR[contentType.split(';')[0]];
  const m = url.split('?')[0].match(/\.(mp4|mov|png|jpe?g|webp)$/i);
  if (m) return `.${m[1].toLowerCase().replace('jpeg', 'jpg')}`;
  return kind === 'video' ? '.mp4' : '.png';
}

export async function rehost(input: { campaignId: string; assetId: string; sourceUrl: string; kind: 'video' | 'image'; fetchImpl?: typeof fetch }): Promise<{ path: string; abs: string; bytes: number }> {
  const f = input.fetchImpl ?? fetch;
  const res = await f(input.sourceUrl, { signal: AbortSignal.timeout(120_000), cache: 'no-store' });
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const ext = extFromUrl(input.sourceUrl, res.headers.get('content-type'), input.kind);
  const { abs, publicPath } = assetPathFor(input.campaignId, input.assetId, ext);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return { path: publicPath, abs, bytes: buf.byteLength };
}

/** Best-effort poster frame. Returns null when ffmpeg is missing or fails. */
export async function thumbnailFor(campaignId: string, assetId: string, videoAbs: string): Promise<string | null> {
  const { execFile } = await import('node:child_process');
  const { abs, publicPath } = assetPathFor(campaignId, `${assetId}-thumb`, '.jpg');
  return new Promise((resolve) => {
    try {
      // a missing or wrong-architecture ffmpeg can throw synchronously (spawn EBADARCH after an OS upgrade): still no thumbnail, never a failed delivery
      const child = execFile('ffmpeg', ['-y', '-ss', '00:00:00.5', '-i', videoAbs, '-frames:v', '1', '-q:v', '4', abs], { timeout: 20_000 }, (err) => {
        resolve(err || !fs.existsSync(abs) ? null : publicPath);
      });
      child.on('error', () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}
