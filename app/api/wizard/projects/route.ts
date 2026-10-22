import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createProject, readProjects } from '@/lib/wizard/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, projects: readProjects() });
}

const CreateSchema = z.object({ name: z.string().max(80).optional() });

export async function POST(request: Request) {
  const parsed = CreateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });
  return NextResponse.json({ ok: true, project: createProject(parsed.data) });
}
