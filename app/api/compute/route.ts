import { NextResponse } from 'next/server';
import { computeSnapshot } from '@/lib/compute/miosa';

export const dynamic = 'force-dynamic';

/** GET /api/compute — MIOSA computers and credit balance (honest not-configured when no key). */
export async function GET() {
  return NextResponse.json(await computeSnapshot({ fresh: true }), { headers: { 'Cache-Control': 'no-store' } });
}
