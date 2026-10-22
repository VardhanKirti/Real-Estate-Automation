import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { BrandDealRulesSchema } from '@/lib/schemas';
import { BRAND_DEAL_RULES_TARGET, writeRules } from '@/lib/brand-deal-rules';

export const dynamic = 'force-dynamic';

/** Restores a recorded rules version. Body: `{ versionId: string }`. A
 *  restore is itself a new version (nothing is ever deleted), noted as
 *  "restore of vN". */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { versionId?: unknown } | null;
  if (typeof body?.versionId !== 'string') return NextResponse.json({ error: 'versionId required' }, { status: 400 });
  const db = getDb();
  const v = db.configVersions.get(body.versionId);
  if (!v || v.target !== BRAND_DEAL_RULES_TARGET) return NextResponse.json({ error: `unknown version: ${body.versionId}` }, { status: 404 });
  const rules = BrandDealRulesSchema.safeParse(v.snapshot);
  if (!rules.success) return NextResponse.json({ error: 'that version no longer validates against the current schema' }, { status: 422 });
  try {
    const version = writeRules(db, rules.data, `restore of v${v.version}`);
    return NextResponse.json({ rules: rules.data, version });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
