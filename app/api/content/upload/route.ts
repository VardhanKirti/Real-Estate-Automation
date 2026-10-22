import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { addUpload, ensureUploadsDir, type UploadAsset } from '@/lib/content-uploads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // writes to the local filesystem — keep off the edge runtime

/**
 * Real multipart upload into the content studio's reference library.
 * Whitelisted by extension only (never by declared MIME, which the client
 * controls); the file lands under public/content-media/uploads/<uuid>.<ext>
 * and a row is appended to the uploads store so the Composer's reference
 * tray and the Library's Uploads section read the same truth.
 */

const EXT_KIND: Record<string, UploadAsset['kind']> = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
};

const MAX_BYTES = 200 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: 'a file is required' }, { status: 400 });
  }

  const ext = path.extname(file.name).slice(1).toLowerCase();
  const kind = EXT_KIND[ext];
  if (!kind) {
    return NextResponse.json({ error: `unsupported file type: .${ext || 'unknown'}` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'file exceeds the 200MB upload limit' }, { status: 400 });
  }

  const id = randomUUID();
  const filename = `${id}.${ext}`;
  const dir = ensureUploadsDir();
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, filename), buffer);

  const titleRaw = form.get('title');
  const title = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim() : file.name;

  const asset = addUpload({ id, file: filename, kind, title, createdAt: new Date().toISOString() });
  return NextResponse.json({ upload: asset }, { status: 201 });
}
