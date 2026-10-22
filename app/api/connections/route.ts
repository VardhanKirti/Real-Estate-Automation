import { NextResponse } from 'next/server';
import { allConnectorStatuses } from '@/lib/connectors';

export const dynamic = 'force-dynamic';

/** Always a check made now (and it refreshes what the pages render from, lib/swr.ts). */
export async function GET() {
  const connections = await allConnectorStatuses({ fresh: true });
  return NextResponse.json({ connections });
}
