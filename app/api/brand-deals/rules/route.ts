import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { BrandDealRulesSchema } from '@/lib/schemas';
import { BRAND_DEAL_RULES_TARGET, listRuleBackups, patchRules, readRules } from '@/lib/brand-deal-rules';

export const dynamic = 'force-dynamic';

/** The live bdpilot rules plus their version history. `configured: false`
 *  (with the reason) on a machine that doesn't host the daemon. */
export async function GET() {
  const db = getDb();
  const read = readRules();
  return NextResponse.json({
    ...read,
    versions: db.configVersions.list(BRAND_DEAL_RULES_TARGET),
    backups: listRuleBackups(),
  });
}

/** Partial edit of the rules. Body: `{ rules: Partial<BrandDealRules>, note?: string }`.
 *  Validates the merged result, backs up the file, writes atomically, and
 *  records a config version. The daemon picks the change up on its next
 *  cycle (about two minutes) without a restart. */
export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { rules?: unknown; note?: unknown } | null;
  const parsed = BrandDealRulesSchema.partial().safeParse(body?.rules);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (Object.keys(parsed.data).length === 0) return NextResponse.json({ error: 'no rule fields in body' }, { status: 400 });
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : `edit: ${Object.keys(parsed.data).join(', ')}`;
  try {
    const { rules, version } = patchRules(getDb(), parsed.data, note);
    return NextResponse.json({ rules, version });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
