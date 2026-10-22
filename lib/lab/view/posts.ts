/**
 * Post-level pieces several page models share: the age-matched read, the tile, the platform label,
 * the snapshot curve. Wraps 04's ageMatchedView unchanged.
 */
import type { LabMeasureV2, LabPlatform, LabPost } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import type { AgeMatchedView, LabPlatformId } from '@/lib/lab/view/shared';
import type { PostTileView } from '@/lib/lab/view/today';
import { ageMatchedView } from '@/lib/lab/measure/view';
import { LAB_LAYERS_BUILT } from '@/lib/lab/view/layers';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fill, fmtAge, nText } from '@/lib/lab/view/format';
import { withSample } from '@/lib/lab/view/section';

const HOUR = 3_600_000;

export function platformLabel(platform: LabPlatform, durationS: number | null): string {
  switch (platform) {
    case 'instagram': return 'Reel';
    case 'tiktok': return 'TikTok';
    case 'youtube': return durationS !== null && durationS <= 180 ? 'Short' : 'YouTube';
    case 'linkedin': return 'LinkedIn';
    case 'twitter': return 'X';
    default: return String(platform);
  }
}

/** First `max` characters, cut at a word boundary. */
export function clip(text: string, max = 48): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > 20 ? cut.slice(0, at) : t.slice(0, max)).replace(/[,.;:!?]+$/, '')}...`;
}

export function readOf(m: LabMeasureV2 | null, post: Pick<LabPost, 'postedAt' | 'platform'>, now: Date): AgeMatchedView {
  return ageMatchedView(m, post, now, LAB_LAYERS_BUILT.measure);
}

/** 01 7.6 footer per read state. */
export function tileFooter(read: AgeMatchedView): string {
  switch (read.state) {
    case 'judged': return read.atLabel ?? '';
    case 'too_new': return LAB_COPY.today.firstReadAt6;
    case 'no_baseline': return `${read.atLabel ?? ''}, ${nText(read.n)}`;
    default: return LAB_COPY.notAgeMatched;
  }
}

/**
 * Snapshot views by age, over the owner's normal at the reads that have one. The normal band at a
 * read age is the views divided by the ratio interval (views / hi to views / lo); null under 2 snapshots.
 */
export function postCurve(store: LabStore, post: LabPost, m: LabMeasureV2 | null): PostTileView['curve'] {
  if (!post.postedAt) return null;
  const t0 = Date.parse(post.postedAt);
  const points = store.metrics
    .forPost(post.id)
    .filter((s) => s.views !== null)
    .map((s) => ({ h: Math.max(0, Math.round(((s.ageH ?? (Date.parse(s.capturedAt) - t0) / HOUR) as number) * 10) / 10), views: s.views as number }))
    .sort((a, b) => a.h - b.h);
  if (points.length < 2) return null;
  const band: { h: number; lo: number; hi: number }[] = [];
  for (const [k, a] of Object.entries(m?.ages ?? {})) {
    const h = Number(k);
    if (a.ratio === null || a.lo === null || a.hi === null || a.n < 5 || !(a.lo > 0) || !(a.hi > 0)) continue;
    const near = points.reduce((best, p) => (Math.abs(p.h - h) < Math.abs(best.h - h) ? p : best), points[0]);
    if (Math.abs(near.h - h) > h * 0.25) continue;
    band.push({ h, lo: Math.round(near.views / a.hi), hi: Math.round(near.views / a.lo) });
  }
  band.sort((a, b) => a.h - b.h);
  return { points, band };
}

export function postTile(store: LabStore, post: LabPost, m: LabMeasureV2 | null, hookText: string, now: Date, since: number, sample: boolean): PostTileView {
  const read = readOf(m, post, now);
  const ageH = post.postedAt ? (now.getTime() - Date.parse(post.postedAt)) / HOUR : 0;
  return {
    postId: post.id,
    href: withSample(`?post=${encodeURIComponent(post.id)}`, sample),
    platform: post.platform as LabPlatformId,
    platformLabel: platformLabel(post.platform, post.durationS),
    title: clip(hookText || post.caption || post.id),
    postedAt: post.postedAt ?? '',
    ageText: fmtAge(ageH),
    read,
    curve: postCurve(store, post, m),
    footer: tileFooter(read),
    isNew: post.postedAt ? Date.parse(post.postedAt) >= since : false,
  };
}

export { fill };
