import { NextResponse } from 'next/server';
import type { LabContext } from '@/lib/lab/context';

/**
 * Shared response helpers for app/api/lab/*. Every answer is JSON `{ ok, … }`.
 * Writes never touch the sample world (it is a read-only, in-memory preview).
 */

export const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status });

export function readOnlyRefusal(ctx: LabContext): NextResponse | null {
  return ctx.readOnly ? json({ ok: false, error: 'Sample data is a read-only preview. Connect Apify to work on real data.', setupHref: ctx.flags.setupHref }, 409) : null;
}

/** A POST action a later lane fills in (CONTRACT.md "Lanes"). Says who owns it; never pretends. */
export function notBuilt(action: string, owner: string) {
  return json({ ok: false, error: `${action} is not built yet`, owner }, 501);
}

export async function body(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}
