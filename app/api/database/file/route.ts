import { NextResponse } from 'next/server';
import { previewFile } from '@/lib/database/scan';

export const dynamic = 'force-dynamic';

/** GET /api/database/file?path=<relative> — size, date and a text preview; private paths show metadata only. */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get('path');
  if (!p) return NextResponse.json({ ok: false, error: 'Pass ?path=<file inside the brain folder>.' });
  return NextResponse.json(previewFile(p));
}
