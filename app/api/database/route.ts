import { NextResponse } from 'next/server';
import { scanBrain } from '@/lib/database/scan';

export const dynamic = 'force-dynamic';

/** GET /api/database — the brain folder as a size tree (cached 60 s; ?fresh=1 rescans). */
export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get('fresh') === '1';
  return NextResponse.json(scanBrain(fresh ? 0 : 60_000));
}
