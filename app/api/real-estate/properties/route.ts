/**
 * Real properties for the Real Estate dashboard. The actual fetch + cache
 * lives in lib/real-estate-live.ts (shared, stale-while-revalidate) — this
 * route is just the client-facing endpoint.
 */
import { NextResponse } from 'next/server';
import { skyescraperLiveProperties } from '@/lib/real-estate-live';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await skyescraperLiveProperties());
}
