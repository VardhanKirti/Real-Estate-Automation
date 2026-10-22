/**
 * Dry and Filming fixtures for the retention bridge (06 section 14): deterministic retention rows
 * written instead of any network call. Fictional numbers only, seeded by post id and age.
 */
import type { LabPost, LabRetention } from '@/lib/schemas';
import { rng } from '@/lib/lab/ledger/metrics';

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

/** One fixture retention row for a post at an age (YouTube: a 100-point curve; Instagram: insights). */
export function fixtureRetention(post: Pick<LabPost, 'id' | 'platform' | 'postedAt'>, ageH: number, capturedAt: string): LabRetention {
  const next = rng(`retention|${post.id}|${Math.round(ageH)}`);
  if (post.platform === 'youtube') {
    const k = 4 + next() * 4;
    const floor = 0.3 + next() * 0.15;
    const curve = Array.from({ length: 100 }, (_, i) => {
      const x = (i + 1) / 100;
      return { x, awr: round(floor + (1 - floor) * Math.exp(-x * k)), rrp: round(0.35 + next() * 0.35) };
    });
    return {
      postId: post.id, platform: 'youtube', source: 'fixture', capturedAt, ageH, partial: false, curve,
      views: Math.round(2000 + next() * 30000), avgViewDurationS: round(20 + next() * 200, 1), avgViewPct: round(30 + next() * 30, 1),
      reach: null, likes: null, comments: null, saved: null, shares: null, totalInteractions: null, avgWatchTimeMs: null, totalWatchTimeMs: null, skipRate: null, raw: {}, dry: true,
    };
  }
  const reach = Math.round(1500 + next() * 15000);
  return {
    postId: post.id, platform: 'instagram', source: 'fixture', capturedAt, ageH, partial: ageH < 48, curve: null,
    views: Math.round(reach * (1.1 + next() * 0.5)), avgViewDurationS: null, avgViewPct: null, reach, likes: Math.round(reach * 0.05), comments: Math.round(reach * 0.004),
    saved: Math.round(reach * 0.01), shares: Math.round(reach * (0.004 + next() * 0.012)), totalInteractions: Math.round(reach * 0.07),
    avgWatchTimeMs: Math.round(4000 + next() * 10000), totalWatchTimeMs: Math.round(reach * 9000), skipRate: round(25 + next() * 30, 1), raw: {}, dry: true,
  };
}
