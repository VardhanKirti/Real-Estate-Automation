import { NextResponse } from 'next/server';
import { readUserSkills, proposePlacement, deriveSkillName, toKebabCase, resolveSkillsDir } from '@/lib/skills-catalog';

export const dynamic = 'force-dynamic';

/**
 * POST { description, name? } -> where a new skill would land in the REAL
 * taxonomy: a proposed Domain/Group + name plus up to 2 alternates. Read-only
 * — nothing is written until POST /api/skills/create confirms.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { description, name } = (body ?? {}) as { description?: unknown; name?: unknown };
  if (typeof description !== 'string' || description.trim().length < 8) {
    return NextResponse.json({ error: 'description must be at least 8 characters' }, { status: 400 });
  }

  const rawName = typeof name === 'string' && name.trim() ? name.trim() : '';
  const slug = (rawName ? toKebabCase(rawName) : '') || deriveSkillName(description);

  const catalog = readUserSkills(resolveSkillsDir());
  const [proposed, ...alternates] = proposePlacement(description, catalog);

  const withPath = (p: { domain: string; group: string }) => ({ ...p, path: `${p.domain}/${p.group}/${slug}` });

  return NextResponse.json({
    name: slug,
    proposed: withPath(proposed),
    alternates: alternates.map(withPath),
  });
}
