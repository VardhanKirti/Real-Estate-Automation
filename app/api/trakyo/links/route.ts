import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  TrakyoError,
  TrakyoValidationError,
  createTrakyoContent,
  createTrakyoLink,
  trakyoKey,
  trakyoLinkWorkspace,
  validateTrakyoContent,
  validateTrakyoLink,
} from '@/lib/connectors/trakyo';
import { filmingMode } from '@/lib/paths';
import { gateResponse, writesEnabled } from '@/lib/gates';
import { setupHrefFor } from '@/lib/integrations-catalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  link: z.object({
    url: z.string(),
    /** an existing Trakyo content item, or omit and pass `content` to create one first */
    contentItemId: z.string().optional(),
    domain: z.string().optional(),
    slug: z.string().optional(),
    appendTrackingParam: z.boolean().optional(),
  }),
  content: z
    .object({ source: z.string(), name: z.string(), description: z.string().optional(), url: z.string().optional(), publishedAt: z.string().optional() })
    .optional(),
});

/**
 * The link studio's workspace: the key's scopes, its short-link domains and
 * the first 100 saved links with clicks. Free reads; no key means no request
 * (state not_configured). Filming answers an empty badged workspace.
 */
export async function GET() {
  if (filmingMode()) {
    return NextResponse.json({ state: 'ready', scopes: [], domains: [], links: [], hasMore: false, messages: [], writes: false, sample: true });
  }
  const ws = await trakyoLinkWorkspace();
  return NextResponse.json({ ...ws, setupHref: setupHrefFor('trakyo'), writes: writesEnabled(), sample: false });
}

/**
 * The Trakyo link studio's create (pages/feature-additions.md F6). Publishes a
 * public short link, so: 403 unless GLADOS_WRITES=1, then 409 unless
 * `confirm: true` ("Create link in Trakyo?"). Input is validated before
 * anything is sent. With `content`, the content item is created first and the
 * link second, as two calls, so a failed link never recreates the content.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const refused = gateResponse('GLADOS_WRITES', body);
  if (refused) return refused;
  if (!trakyoKey()) return NextResponse.json({ error: 'Trakyo is not configured', setupHref: setupHrefFor('trakyo') }, { status: 503 });
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'link.url is required', issues: parsed.error.flatten() }, { status: 400 });
  const { link, content } = parsed.data;
  try {
    if (content) validateTrakyoContent(content);
    else validateTrakyoLink({ ...link, contentItemId: link.contentItemId ?? '' });
    let contentItemId = link.contentItemId ?? '';
    let createdContent = null;
    if (content) {
      createdContent = await createTrakyoContent(content);
      contentItemId = createdContent.id;
    }
    const created = await createTrakyoLink({ ...link, contentItemId });
    return NextResponse.json({ ok: true, link: created, content: createdContent }, { status: 201 });
  } catch (err) {
    if (err instanceof TrakyoValidationError) return NextResponse.json({ error: err.message, field: err.field }, { status: 400 });
    if (err instanceof TrakyoError) return NextResponse.json({ error: err.message, uncertain: err.uncertain }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
