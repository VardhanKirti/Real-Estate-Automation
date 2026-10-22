import { NextResponse } from 'next/server';
import { allConnectorStatuses } from '@/lib/connectors';

export const dynamic = 'force-dynamic';

/**
 * How many connectors are live, for the Bennett Legacy sidebar footer
 * ("n/N systems live", FounderOS ui merge SCAFFOLD §3.2). Reads the shared
 * stale-while-revalidate board (lib/swr.ts) the pages render from, so it never
 * forces a new round of checks; a cold server answers once the checks finish.
 */
export async function GET() {
  const all = await allConnectorStatuses();
  const up = all.filter((c) => c.state === 'connected').length;
  return NextResponse.json({ up, total: all.length });
}
