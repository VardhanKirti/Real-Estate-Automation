import { NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteProject, readProject, setTaskState, updateProject } from '@/lib/wizard/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const project = readProject(params.id);
  if (!project) return NextResponse.json({ ok: false, error: 'no such project' }, { status: 404 });
  return NextResponse.json({ ok: true, project });
}

const PatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  status: z.enum(['active', 'done']).optional(),
  task: z.object({ id: z.string().min(1), state: z.enum(['open', 'done']) }).optional(),
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid patch' }, { status: 400 });
  const { task, ...rest } = parsed.data;
  let project = Object.keys(rest).length ? updateProject(params.id, rest) : readProject(params.id);
  if (task) project = setTaskState(params.id, task.id, task.state);
  if (!project) return NextResponse.json({ ok: false, error: 'no such project' }, { status: 404 });
  return NextResponse.json({ ok: true, project });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  deleteProject(params.id);
  return NextResponse.json({ ok: true });
}
