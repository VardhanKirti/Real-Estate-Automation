import type { LabOutcome, LabScriptBody } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { tokens } from '@/lib/lab/clusters';

/**
 * Mark published → outcomes (SPEC §4.12 last bullet, §4.13). A published script points
 * at one of your posts; each time that post is re-scraped (a newer lab_post_metrics row
 * than the last outcome) an outcome row is appended with the post's current breakout and
 * depth. Outcomes are append-only, like metrics.
 */

/** Append an outcome per published script whose post has a read newer than its last outcome. */
export function recordOutcomes(store: LabStore, _opts: { now?: Date } = {}): LabOutcome[] {
  const last = new Map<string, string>();
  for (const o of store.outcomes.all()) if (!last.has(o.scriptId) || o.capturedAt > last.get(o.scriptId)!) last.set(o.scriptId, o.capturedAt);
  const out: LabOutcome[] = [];
  for (const s of store.scripts.all()) {
    if (s.status !== 'published' || !s.publishedPostId) continue;
    const reads = store.metrics.forPost(s.publishedPostId);
    const read = reads[reads.length - 1];
    if (!read) continue;
    const prev = last.get(s.id);
    if (prev && read.capturedAt <= prev) continue;
    const m = store.measures.get(s.publishedPostId);
    const o: LabOutcome = { scriptId: s.id, postId: s.publishedPostId, capturedAt: read.capturedAt, breakout: m?.breakout ?? null, depth: m?.depth ?? null };
    store.outcomes.add(o);
    out.push(o);
  }
  return out;
}

/** Spoken text of a script version (hook + sections + CTA). */
export const scriptText = (b: LabScriptBody): string => [b.hooks[b.hookChoice]?.spoken ?? '', ...b.sections.map((s) => s.spoken), b.cta].join(' ');

/** Jaccard similarity of two texts' content-word sets (0-1). */
export function textSimilarity(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export type PublishCandidate = { postId: string; postedAt: string | null; platform: string; similarity: number | null; caption: string };

/**
 * Your posts ranked as the live version of a script: by transcript similarity once a
 * transcript exists (caption similarity otherwise, marked by `similarity` being from the
 * caption), newest first among ties; only posts published after the script was created.
 */
export function publishCandidates(store: LabStore, scriptId: string, limit = 8): PublishCandidate[] {
  const s = store.scripts.get(scriptId);
  const v = store.scripts.latestVersion(scriptId);
  if (!s || !v) return [];
  const text = scriptText(v.body);
  const since = Date.parse(s.createdAt) - 86_400_000;
  return store.posts
    .all()
    .filter((p) => p.isOwned && (!p.postedAt || Date.parse(p.postedAt) >= since))
    .map((p) => {
      const t = store.transcripts.get(p.id);
      const basis = t?.status === 'done' && t.text ? t.text : p.caption;
      return { postId: p.id, postedAt: p.postedAt, platform: p.platform, caption: p.caption.slice(0, 140), similarity: basis ? Math.round(textSimilarity(text, basis) * 1000) / 1000 : null };
    })
    .sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1) || (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))
    .slice(0, limit);
}
