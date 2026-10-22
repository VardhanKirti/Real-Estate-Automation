import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { mediaRootFor, resolveChatDb } from '@/lib/connectors/whatsapp';

export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.opus': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.caf': 'audio/x-caf',
  '.pdf': 'application/pdf',
};

/**
 * Serve one downloaded WhatsApp media file. Like the avatar route, these live
 * outside the project and cannot be served statically.
 *
 * The `f` parameter is a path, which makes containment the whole security
 * story: it is rejected outright if it escapes, and the resolved file must
 * still sit under Message/ after normalisation. Range requests are honoured so
 * voice notes and video can seek instead of re-downloading.
 */
export async function GET(req: Request) {
  const rel = new URL(req.url).searchParams.get('f') ?? '';
  if (!rel || rel.includes('..') || path.isAbsolute(rel)) {
    return NextResponse.json({ error: 'bad path' }, { status: 400 });
  }
  const dbPath = resolveChatDb();
  if (!dbPath) return NextResponse.json({ error: 'whatsapp not found' }, { status: 404 });

  const root = path.resolve(mediaRootFor(dbPath));
  const file = path.resolve(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) {
    return NextResponse.json({ error: 'bad path' }, { status: 400 });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return NextResponse.json({ error: 'not downloaded' }, { status: 404 });
  }
  if (!stat.isFile()) return NextResponse.json({ error: 'not a file' }, { status: 400 });

  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const range = req.headers.get('range');
  const base = {
    'Content-Type': type,
    'Cache-Control': 'private, max-age=86400',
    'Accept-Ranges': 'bytes',
  };

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
      if (Number.isFinite(start) && start <= end && start < stat.size) {
        const fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(end - start + 1);
        fs.readSync(fd, buf, 0, buf.length, start);
        fs.closeSync(fd);
        return new NextResponse(new Uint8Array(buf), {
          status: 206,
          headers: {
            ...base,
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Content-Length': String(buf.length),
          },
        });
      }
    }
  }

  const body = fs.readFileSync(file);
  return new NextResponse(new Uint8Array(body), {
    headers: { ...base, 'Content-Length': String(stat.size) },
  });
}
