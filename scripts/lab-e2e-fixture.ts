/**
 * The dry end-to-end fixture (08.12.5, ruling in BUILD-REPORT.md section 6). TEST LAYER ONLY:
 * `scripts/lab-e2e-dry.ts` calls these on its own temp store. Nothing in lib/ imports this file,
 * so production sync, measure and radar code keep every rule (04 3.1, AC-05-3, 05 18).
 *
 * Why it exists: a one-shot dry sync reads each post once, today. Posts older than ~9 days then
 * have no read near 7 days, and 04 3.1 judges at 168h and never extrapolates, so no breakout can
 * be judged. A real install gets the 7-day read from the snapshot scheduler over a week; the e2e
 * cannot wait a week, so it writes the read the dry curve says that post had at 168h. And dry
 * radar runs must not write lab_event* (AC-05-3), so the Radar step reads the fixture world's
 * launches (the same ones Filming persists, 05 18) instead.
 */
import type { LabStore } from '@/lib/lab/store';
import { dryViewsAt } from '@/lib/lab/dry-items';
import { seedRadar } from '@/lib/lab/fixtures/radar';
import { TARGET_AGES_H } from '@/lib/lab/measure/age';

const HOUR = 3_600_000;
const SEVEN_D_H = 168;
/** 04 3.1 rule 2 tolerance at 168h: max(0.5, 0.25 x 168) = 42h. */
const TOL_H = 0.25 * SEVEN_D_H;

/**
 * For every non-X post older than 168h + tolerance that has no read inside the 168h tolerance,
 * add one `snapshot` read at exactly posted_at + 168h. Its value comes from the dry world's own
 * growth curve (dryViewsAt: views = scale x (1 - e^(-h/36))), solved for the post's scale from its
 * newest read, so the fixture read and the dry sync agree. Counters scale with views.
 */
export function seedSevenDayReads(store: LabStore, now: Date): { posts: number; added: number } {
  if (!TARGET_AGES_H.includes(SEVEN_D_H)) throw new Error('168h is no longer a target age (04 3.1)');
  const byPost = store.metrics.byPost();
  let added = 0;
  const posts = store.posts.all();
  store.transaction(() => {
    for (const p of posts) {
      if (!p.postedAt || p.platform === 'twitter') continue; // X stops at 48h (04 3.8)
      const posted = Date.parse(p.postedAt);
      const ageNowH = (now.getTime() - posted) / HOUR;
      if (ageNowH <= SEVEN_D_H + TOL_H) continue; // the scheduler can still take a real 7-day read
      const reads = (byPost.get(p.id) ?? []).filter((m) => m.views !== null);
      if (reads.length === 0) continue;
      const ageOf = (m: { capturedAt: string }) => (Date.parse(m.capturedAt) - posted) / HOUR;
      if (reads.some((m) => Math.abs(ageOf(m) - SEVEN_D_H) <= TOL_H)) continue;
      const newest = reads[reads.length - 1];
      const h = ageOf(newest);
      const atNewest = 1 - Math.exp(-h / 36);
      if (!(h > SEVEN_D_H) || atNewest <= 0) continue;
      const scale = (newest.views as number) / atNewest;
      const views = dryViewsAt(scale, SEVEN_D_H);
      const f = (newest.views as number) > 0 ? views / (newest.views as number) : 0;
      const sc = (x: number | null) => (x === null ? null : Math.round(x * f));
      store.metrics.add({
        postId: p.id,
        capturedAt: new Date(posted + SEVEN_D_H * HOUR).toISOString(),
        views,
        likes: sc(newest.likes),
        comments: sc(newest.comments),
        shares: sc(newest.shares),
        saves: sc(newest.saves),
        ageH: SEVEN_D_H,
        targetAgeH: SEVEN_D_H,
        readKind: 'snapshot',
      });
      added++;
    }
  });
  return { posts: posts.length, added };
}

/** The fixture world's launches E1 to E8 with their pings and coverage (08.7.2, 05 18 Filming). */
export function seedFixtureRadar(store: LabStore, now: Date): { events: number; pings: number; coverage: number } {
  return seedRadar(store, now, now.toISOString().slice(0, 10));
}

/** Rows in the three lab_event* tables. */
export function eventRowCounts(store: LabStore): { events: number; pings: number; coverage: number } {
  const c = store.counts();
  return { events: c.lab_events, pings: c.lab_event_pings, coverage: c.lab_event_coverage };
}

/**
 * The post Brody publishes from the frozen script (08.12.5 step 8). A dry sync only re-reads the
 * posts it already knows (lib/lab/dry-items.ts), so it can never discover a new one. The fixture
 * stands in for "the post went up": one owned post shaped like the newest owned post, posted at
 * `postedAt` (after the freeze). Its reads then come from the real dry `snapshots` job.
 */
export function seedPublishedPost(store: LabStore, postedAt: Date): string {
  const owned = store.posts.all().filter((p) => p.isOwned && p.postedAt).sort((a, b) => (a.postedAt! < b.postedAt! ? 1 : -1));
  const like = owned[0];
  if (!like) throw new Error('no owned post to shape the published post on');
  const externalId = `${like.externalId}e2e`;
  const id = `${like.id}-e2e`;
  store.posts.upsert({ ...like, id, externalId, url: like.url.replace(like.externalId, externalId), postedAt: postedAt.toISOString(), caption: `Published from the e2e script: ${like.caption}` });
  return id;
}
