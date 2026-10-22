import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { buildCrew } from '@/lib/wizard/crew';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, crew: buildCrew(getDb()) });
}
