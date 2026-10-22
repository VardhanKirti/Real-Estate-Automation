import { afterEach, describe, expect, test } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addUpload, readUploads } from '@/lib/content-uploads';

/** Both the JSON store and the on-disk upload dir point at fresh temp
 *  locations per test — the real data/content-uploads.json and
 *  public/content-media/uploads/ are never touched. */
function tempPaths() {
  const dir = mkdtempSync(path.join(tmpdir(), 'content-uploads-'));
  return { storeFile: path.join(dir, 'uploads.json'), uploadsDir: path.join(dir, 'files'), dir };
}

const prevStore = process.env.CONTENT_UPLOADS_PATH;
const prevDir = process.env.CONTENT_UPLOADS_DIR;
const cleanupDirs: string[] = [];

afterEach(() => {
  if (prevStore === undefined) delete process.env.CONTENT_UPLOADS_PATH;
  else process.env.CONTENT_UPLOADS_PATH = prevStore;
  if (prevDir === undefined) delete process.env.CONTENT_UPLOADS_DIR;
  else process.env.CONTENT_UPLOADS_DIR = prevDir;
  for (const d of cleanupDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('upload store round trip (lib/content-uploads helpers)', () => {
  test('addUpload writes a row, readUploads reads it back', () => {
    const { storeFile, dir } = tempPaths();
    cleanupDirs.push(dir);
    const asset = addUpload(
      { id: 'u1', file: 'u1.jpg', kind: 'image', title: 'Test upload', createdAt: '2026-09-02T00:00:00Z' },
      storeFile,
    );
    expect(asset.id).toBe('u1');
    const rows = readUploads(storeFile);
    expect(rows).toHaveLength(1);
    expect(rows[0].file).toBe('u1.jpg');
  });

  test('readUploads on a missing file is an honest empty array, never a crash', () => {
    const { storeFile, dir } = tempPaths();
    cleanupDirs.push(dir);
    expect(readUploads(storeFile)).toEqual([]);
  });
});

describe('POST /api/content/upload', () => {
  test('accepts a whitelisted image, writes the file, and appends the row', async () => {
    const { storeFile, uploadsDir, dir } = tempPaths();
    cleanupDirs.push(dir);
    process.env.CONTENT_UPLOADS_PATH = storeFile;
    process.env.CONTENT_UPLOADS_DIR = uploadsDir;

    const { POST } = await import('@/app/api/content/upload/route');
    const form = new FormData();
    form.set('file', new File([new Uint8Array([1, 2, 3, 4])], 'reference.png', { type: 'image/png' }));
    const res = await POST(new Request('http://test/api/content/upload', { method: 'POST', body: form }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.upload.kind).toBe('image');
    expect(body.upload.file.endsWith('.png')).toBe(true);

    expect(existsSync(path.join(uploadsDir, body.upload.file))).toBe(true);
    const onDisk = JSON.parse(readFileSync(storeFile, 'utf8'));
    expect(onDisk.uploads.some((u: any) => u.id === body.upload.id)).toBe(true);
  });

  test('rejects an unsupported extension with 400 and writes nothing', async () => {
    const { storeFile, uploadsDir, dir } = tempPaths();
    cleanupDirs.push(dir);
    process.env.CONTENT_UPLOADS_PATH = storeFile;
    process.env.CONTENT_UPLOADS_DIR = uploadsDir;

    const { POST } = await import('@/app/api/content/upload/route');
    const form = new FormData();
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'script.exe', { type: 'application/octet-stream' }));
    const res = await POST(new Request('http://test/api/content/upload', { method: 'POST', body: form }));
    expect(res.status).toBe(400);
    expect(existsSync(storeFile)).toBe(false);
  });

  test('rejects a request with no file', async () => {
    const { storeFile, uploadsDir, dir } = tempPaths();
    cleanupDirs.push(dir);
    process.env.CONTENT_UPLOADS_PATH = storeFile;
    process.env.CONTENT_UPLOADS_DIR = uploadsDir;

    const { POST } = await import('@/app/api/content/upload/route');
    const res = await POST(new Request('http://test/api/content/upload', { method: 'POST', body: new FormData() }));
    expect(res.status).toBe(400);
  });
});
