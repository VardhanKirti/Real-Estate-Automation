import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { avatarPathFor, profileDirFor, resolveChatDb } from '@/lib/connectors/whatsapp';

export const dynamic = 'force-dynamic';

/**
 * Serve a chat's cached WhatsApp avatar. The images live outside the project
 * (inside WhatsApp's macOS group container), so they cannot be served
 * statically and have to come through here.
 *
 * The key is the numeric part of a JID and nothing else: it is re-validated
 * here rather than trusted from the URL, and the resolved file is required to
 * sit inside Media/Profile. Without both checks the path segment would be a
 * read primitive for any file the server can reach.
 */
export async function GET(_req: Request, { params }: { params: { key: string } }) {
  if (!/^[0-9]{5,25}$/.test(params.key)) {
    return NextResponse.json({ error: 'bad key' }, { status: 400 });
  }
  const dbPath = resolveChatDb();
  if (!dbPath) return NextResponse.json({ error: 'whatsapp not found' }, { status: 404 });

  const file = avatarPathFor(params.key);
  if (!file) return NextResponse.json({ error: 'no cached avatar' }, { status: 404 });

  const dir = path.resolve(profileDirFor(dbPath));
  const resolved = path.resolve(file);
  if (resolved !== path.join(dir, path.basename(resolved))) {
    return NextResponse.json({ error: 'bad key' }, { status: 400 });
  }

  let body: Buffer;
  try {
    body = fs.readFileSync(resolved);
  } catch {
    return NextResponse.json({ error: 'unreadable' }, { status: 404 });
  }
  // Both .jpg and .thumb are JPEG despite the extension.
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(body.length),
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
