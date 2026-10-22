/**
 * Real field-agent roster for the Real Estate dashboard, aggregated from the
 * SAME cached lead fetch leads/route.ts uses (lib/real-estate-live.ts) — no
 * second network round trip to Skyescraper.
 */
import { NextResponse } from 'next/server';
import { skyescraperLiveBrokers } from '@/lib/real-estate-live';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await skyescraperLiveBrokers());
}
