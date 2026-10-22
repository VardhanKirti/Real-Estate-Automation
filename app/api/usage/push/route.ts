import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { authorizePush } from '@/lib/push-auth';
import { UsagePushSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Another machine's usage push (pages/usage.md §2):
 *   { machine, readings: [{ plan: claude|codex|ollama, day: YYYY-MM-DD, model, input, output, cacheWrite }] }
 * `Authorization: Bearer <USAGE_PUSH_TOKEN>`; a bad token is 401 and writes
 * nothing (U-5). Each (plan, day) named replaces that machine's rows for it.
 */
export async function POST(req: Request) {
  const auth = authorizePush(req, 'USAGE_PUSH_TOKEN');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = UsagePushSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid push', issues: parsed.error.flatten() }, { status: 400 });
  const stored = getDb().usageReadings.replaceForMachine(parsed.data.machine, parsed.data.readings);
  return NextResponse.json({ ok: true, machine: parsed.data.machine, stored });
}
