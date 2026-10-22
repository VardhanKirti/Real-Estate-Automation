import { NextResponse } from 'next/server';
import { buildUsagePayload } from '@/lib/usage-payload';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The /usage payload (pages/usage.md §2, lib/usage-payload.ts). Polled every
 * 10 s while the page is visible, so it reads the reader's 60 s cache, never a
 * fresh transcript parse (U-4). Off on demo and filming instances: then it
 * reads nothing and says "not available" (U-1, AC-12). `?range=7|30`,
 * `?sample=1` on a blank install.
 */
export async function GET(req: Request) {
  return NextResponse.json(await buildUsagePayload({ url: req.url }));
}
