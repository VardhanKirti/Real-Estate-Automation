import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { SocialPlatformSchema, type SocialPost } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

/** The post queue, newest first. */
export async function GET() {
  return NextResponse.json({ posts: getDb().socialPosts.all() });
}

const CreateSchema = z.object({
  caption: z.string().min(1, 'caption is required'),
  platforms: z.array(SocialPlatformSchema).min(1, 'pick at least one platform'),
  mediaUrl: z.string().url().nullish(),
  scheduledFor: z.string().nullish(),
});

/**
 * Queue a post for the Zernio-publishing agent. This does NOT post live — it
 * persists with status 'queued'; the Social agent on the Agents page picks it
 * up. Wiring an actual Zernio publish is a deliberate later step.
 */
export async function POST(request: Request) {
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const post: SocialPost = {
    id: randomUUID(),
    caption: parsed.data.caption,
    mediaUrl: parsed.data.mediaUrl ?? null,
    platforms: parsed.data.platforms,
    status: 'queued',
    scheduledFor: parsed.data.scheduledFor ?? null,
    createdAt: new Date().toISOString(),
  };
  getDb().socialPosts.enqueue(post);
  return NextResponse.json({ post }, { status: 201 });
}

/**
 * Withdraw a queued post: DELETE /api/social/posts?id=<id> (SPEC H40). Only a
 * post still in the queue can go; anything the agent has picked up answers
 * 409 so the UI restores the row. Nothing is sent or published here.
 */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const result = getDb().socialPosts.removeQueued(id);
  if (result === 'missing') return NextResponse.json({ error: 'no such post' }, { status: 404 });
  if (result === 'not_queued') {
    return NextResponse.json({ error: 'already picked up for publishing' }, { status: 409 });
  }
  return NextResponse.json({ removed: id });
}
