import { NextResponse } from 'next/server';
import { createDraftSkill, resolveSkillsDir } from '@/lib/skills-catalog';

export const dynamic = 'force-dynamic';

/**
 * POST { name, description, domain, group } -> writes a real draft skill
 * (SKILL.md + GROUP) into the dir readUserSkills() reads, so it shows up in
 * the /skills hierarchy on the next load. All sanitization/collision/
 * writability checks live in lib/skills-catalog.ts (createDraftSkill) so
 * they're covered by pure unit tests as well as this route's own tests.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { name, description, domain, group } = (body ?? {}) as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (typeof description !== 'string' || description.trim().length < 8) {
    return NextResponse.json({ error: 'description must be at least 8 characters' }, { status: 400 });
  }
  if (typeof domain !== 'string' || !domain.trim() || typeof group !== 'string' || !group.trim()) {
    return NextResponse.json({ error: 'domain and group are required' }, { status: 400 });
  }

  const result = createDraftSkill(name, description, domain, group, resolveSkillsDir());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
