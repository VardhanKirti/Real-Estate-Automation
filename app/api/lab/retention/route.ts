import { resolveLab } from '@/lib/lab/context';
import { json } from '@/lib/lab/api';
import { beatRetention, beatsFor, retentionLine, rowAt7d } from '@/lib/lab/ledger/retention/map';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/lab/retention?post=<id> -> { ok, postId, rows, retention: PostRetention | null, line } (06 9.3). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const postId = url.searchParams.get('post');
  if (!postId) return json({ ok: false, error: 'pass ?post=<id>' }, 400);
  const ctx = resolveLab({ sample: url.searchParams.get('sample') === '1' });
  const post = ctx.store.posts.get(postId);
  if (!post) return json({ ok: false, error: 'unknown post' }, 404);
  const rows = ctx.store.retention.forPost(postId);
  const row = rowAt7d(rows);
  const beats = beatsFor(ctx.store, postId);
  const retention = row ? beatRetention(row, beats, post.durationS) : null;
  return json({ ok: true, postId, rows: rows.map(({ raw, ...r }) => (void raw, r)), retention, line: retention ? retentionLine(retention, beats) : null });
}
