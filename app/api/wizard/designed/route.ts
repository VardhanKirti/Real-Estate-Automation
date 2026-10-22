import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createDesignedAgent, readDesignedAgents } from '@/lib/wizard/designed';
import { parseToolsInput } from '@/lib/wizard/helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ ok: true, agents: readDesignedAgents() });
}

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  departmentId: z.string().min(1),
  purpose: z.string().min(1).max(2000),
  tools: z.string().max(400).optional(),
});

export async function POST(request: Request) {
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'name, department and purpose are required' }, { status: 400 });
  const agent = createDesignedAgent({
    name: parsed.data.name,
    departmentId: parsed.data.departmentId,
    purpose: parsed.data.purpose,
    tools: parseToolsInput(parsed.data.tools ?? ''),
  });
  return NextResponse.json({ ok: true, agent });
}
