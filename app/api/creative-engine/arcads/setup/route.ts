import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createArcadsClient, explainArcadsError, resolveArcadsAuth } from '@/lib/arcads/client';
import { probeFree } from '@/lib/creative-engine/health';
import { isDry } from '@/lib/creative-engine/dry';
import { readCreditsSnapshot, readHealth, readSettings, writeSettings } from '@/lib/creative-engine/store';
import { startSession } from '@/lib/creative-engine/generate';
import { DRY_CATALOG } from '@/lib/arcads/catalog';
import { filmingMode } from '@/lib/paths';
import { SESSION_CAP_MAX, SESSION_CAP_MIN } from '@/lib/creative-engine/connect';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Connect Arcads, inside the software. The key itself is written by
 * /api/connections/connect (never echoed back). This route does the rest:
 * GET  → what is known: configured, last probe, balance, products, the
 *        chosen product, the UGC path, the cap
 * POST → {action:'verify'} runs the free probes + credits
 *        {action:'product', productId, productName} | {action:'createProduct', name, description}
 *        {action:'settings', ugcPath?, sessionCreditCap?, sessionStartedAt?} · {action:'newSession'}
 *
 * SPEC G8: the cap is a whole number from 1 (an empty field never saves 0);
 * sessionStartedAt is how the sheet's Undo puts a reset session back; in
 * Filming, creating an Arcads product is refused (Q-ENG-14).
 */
export async function GET() {
  const configured = isDry() || !!resolveArcadsAuth();
  const settings = readSettings();
  let products: { id: string; name: string; description?: string }[] = [];
  let productsError: string | null = null;
  if (isDry()) products = DRY_CATALOG.products;
  else if (configured) {
    const client = createArcadsClient();
    try {
      products = client ? await client.products() : [];
    } catch (err) {
      productsError = explainArcadsError(err).message;
    }
  }
  return NextResponse.json({ ok: true, dry: isDry(), configured, health: readHealth(), balance: readCreditsSnapshot(), products, productsError, settings });
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('verify') }),
  z.object({ action: z.literal('product'), productId: z.string().min(1), productName: z.string().min(1).max(120) }),
  z.object({ action: z.literal('createProduct'), name: z.string().min(1).max(80), description: z.string().max(500).default('') }),
  z.object({ action: z.literal('settings'), ugcPath: z.enum(['v2', 'v1']).optional(), sessionCreditCap: z.number().int().min(SESSION_CAP_MIN).max(SESSION_CAP_MAX).optional(), sessionStartedAt: z.string().datetime().nullable().optional() }),
  z.object({ action: z.literal('newSession') }),
]);

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const b = parsed.data;
  try {
    if (b.action === 'verify') {
      const { health, credits } = await probeFree();
      return NextResponse.json({ ok: true, health, credits, configured: isDry() || !!resolveArcadsAuth() });
    }
    if (b.action === 'product') {
      return NextResponse.json({ ok: true, settings: writeSettings({ arcadsProductId: b.productId, arcadsProductName: b.productName }) });
    }
    if (b.action === 'createProduct') {
      if (filmingMode()) return NextResponse.json({ ok: false, error: 'Filming mode: creating Arcads products is off', kind: 'filming' }, { status: 409 });
      if (isDry()) return NextResponse.json({ ok: true, settings: writeSettings({ arcadsProductId: 'dry-product-1', arcadsProductName: b.name }) });
      const client = createArcadsClient();
      if (!client) return NextResponse.json({ ok: false, error: 'Arcads not configured', kind: 'not-configured' }, { status: 503 });
      const p = await client.createProduct({ name: b.name, description: b.description });
      return NextResponse.json({ ok: true, product: p, settings: writeSettings({ arcadsProductId: p.id, arcadsProductName: p.name }) });
    }
    if (b.action === 'settings') {
      const patch: Record<string, unknown> = {};
      if (b.ugcPath) patch.ugcPath = b.ugcPath;
      if (b.sessionCreditCap !== undefined) patch.sessionCreditCap = b.sessionCreditCap;
      if (b.sessionStartedAt !== undefined) patch.sessionStartedAt = b.sessionStartedAt;
      return NextResponse.json({ ok: true, settings: writeSettings(patch) });
    }
    startSession();
    return NextResponse.json({ ok: true, settings: readSettings() });
  } catch (err) {
    const ex = explainArcadsError(err);
    return NextResponse.json({ ok: false, error: ex.message, kind: ex.kind }, { status: ex.httpStatus });
  }
}
