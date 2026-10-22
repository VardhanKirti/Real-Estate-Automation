import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isToggleable } from '@/lib/modules';
import { getModulesOff, setModulesOff } from '@/lib/modules-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, off: getModulesOff() });
}

const Body = z.object({ href: z.string(), on: z.boolean() });

/** Switch one module on or off. Only rewrites .glados-modules.json; no module data is touched. */
export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 400 });
  }
  if (!isToggleable(body.href)) {
    return NextResponse.json({ ok: false, error: `${body.href} cannot be switched off` }, { status: 400 });
  }
  const current = getModulesOff();
  const next = body.on ? current.filter((h) => h !== body.href) : [...current, body.href];
  return NextResponse.json({ ok: true, off: setModulesOff(next) });
}
