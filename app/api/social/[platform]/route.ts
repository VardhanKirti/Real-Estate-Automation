import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { platformDetail, syncFromZernioConfig } from '@/lib/social';
import { SocialPlatformSchema, type SocialPlatform } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { platform: string } }) {
  const db = getDb();
  syncFromZernioConfig(db);
  if (!SocialPlatformSchema.safeParse(params.platform).success) {
    return NextResponse.json({ error: `unknown platform: ${params.platform}` }, { status: 404 });
  }
  const detail = platformDetail(db, params.platform as SocialPlatform);
  // Known platform, no account yet: an honest empty state, not an error.
  if (!detail) {
    return NextResponse.json({ platform: params.platform, account: null, followers: null, growth: null, snapshots: [] });
  }
  return NextResponse.json({ platform: params.platform, ...detail });
}
