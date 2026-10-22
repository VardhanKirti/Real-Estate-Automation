import { NextResponse } from 'next/server';
import { readVentures } from '@/lib/ventures-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ventures: readVentures() });
}
