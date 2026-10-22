import { NextResponse } from 'next/server';
import { desktopEmbed } from '@/lib/compute/miosa';

export const dynamic = 'force-dynamic';

/** GET /api/compute/embed?id=<computer id> — a fresh, short-lived desktop link. Never cached. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'Pass ?id=<computer id>.' }, { headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json(await desktopEmbed(id), { headers: { 'Cache-Control': 'no-store' } });
}
