import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { dataPath } from '@/lib/paths';

/**
 * User uploads into the content studio — source footage, reference images,
 * audio tracks. Files land in public/content-media/uploads/; rows live in a
 * JSON store so the library's Uploads section and the composer's reference
 * tray read the same truth. Server-only (node:fs).
 */

export const UploadAssetSchema = z.object({
  id: z.string().min(1),
  /** Filename inside public/content-media/uploads/. */
  file: z.string().min(1),
  kind: z.enum(['image', 'video', 'audio']),
  title: z.string().min(1),
  createdAt: z.string().min(1),
});
export type UploadAsset = z.infer<typeof UploadAssetSchema>;

const UploadsFileSchema = z.object({ uploads: z.array(UploadAssetSchema) });

export function uploadsStorePath(): string {
  return process.env.CONTENT_UPLOADS_PATH ?? dataPath('content-uploads.json');
}

/** Where uploaded files land — CONTENT_UPLOADS_DIR lets tests point at a temp dir. */
export function uploadsDir(): string {
  return process.env.CONTENT_UPLOADS_DIR ?? path.join(process.cwd(), 'public', 'content-media', 'uploads');
}

export function uploadUrl(asset: UploadAsset): string {
  return `/content-media/uploads/${asset.file}`;
}

export function readUploads(file: string = uploadsStorePath()): UploadAsset[] {
  try {
    return UploadsFileSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).uploads;
  } catch {
    return [];
  }
}

export function addUpload(asset: UploadAsset, file: string = uploadsStorePath()): UploadAsset {
  const parsed = UploadAssetSchema.parse(asset);
  const uploads = readUploads(file);
  uploads.push(parsed);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ uploads }, null, 2)}\n`, 'utf8');
  return parsed;
}

export function deleteUpload(id: string, file: string = uploadsStorePath()): boolean {
  const uploads = readUploads(file);
  const next = uploads.filter((u) => u.id !== id);
  if (next.length === uploads.length) return false;
  writeFileSync(file, `${JSON.stringify({ uploads: next }, null, 2)}\n`, 'utf8');
  return true;
}

export function ensureUploadsDir(): string {
  const dir = uploadsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
