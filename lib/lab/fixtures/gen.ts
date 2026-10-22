/**
 * Generation fixture layer (08.7.2 "Ideas and scripts", "Comments", "Frames", "Embeddings").
 * Four launch ideas grounded in E1 and E2 (12 ideas in all with the v1 eight), 120 hashed
 * comments on 8 owned posts with two comment seeds, contact-sheet markers on 6 owned posts and
 * local-hash embeddings for every transcript, idea and comment (so Ask the Lab answers in sample).
 * S0 builds the rows directly from the 07 shapes; lane G replaces them with its own builders.
 */
import type { LabCommentIntent, LabGrounding, LaunchAngle } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { EMBED_MODEL } from '@/lib/lab/clusters';
import { embedLocalNow } from '@/lib/lab/gen/embed';
import { authorHash } from '@/lib/lab/gen/comments';
import { stream } from '@/lib/lab/fixtures/rand';
import { COMMENTER_HANDLES, COMMENT_TEXT, LAUNCH_NAMES, SEED_ASKS } from '@/lib/lab/fixtures/text';
import { eventId } from '@/lib/lab/fixtures/radar';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

/** The fixture world's commenter salt (fictional; the real salt is LAB_COMMENT_SALT, never in code). */
export const FIXTURE_COMMENT_SALT = 'fixture-salt-not-a-secret';

export function seedGen(store: LabStore, anchor: Date): { ideas: number; comments: number; embeddings: number; sheets: number } {
  const T = anchor.getTime();
  const r = stream('gen');
  const measures = new Map(store.measures.all().map((m) => [m.postId, m]));
  const dis = new Map(store.dissections.all().map((d) => [d.postId, d]));
  const owned = store.posts.all().filter((p) => p.isOwned && p.postedAt);
  let ideas = 0;
  let comments = 0;
  let embeddings = 0;
  let sheets = 0;

  store.transaction(() => {
    // four launch ideas: two per open event (E1, E2), grounded in the event's covering breakouts
    const launchIdeas: { n: number; angle: LaunchAngle; title: string }[] = [
      { n: 1, angle: 'first_look', title: `${LAUNCH_NAMES[0]}: first look` },
      { n: 1, angle: 'real_examples', title: `${LAUNCH_NAMES[0]}: real examples` },
      { n: 2, angle: 'how_to', title: `${LAUNCH_NAMES[1]}: how to set it up` },
      { n: 2, angle: 'comparison', title: `${LAUNCH_NAMES[1]}: against last year's flagship` },
    ];
    launchIdeas.forEach((d, i) => {
      const cov = store.eventCoverage.forEvent(eventId(d.n)).filter((c) => !c.isOwned);
      const refs = cov.slice(0, 4).map((c) => ({ postId: c.postId, creatorId: c.sourceId, ratio: c.ratio ?? 1, hookText: dis.get(c.postId)?.hookText ?? '', angle: c.angle, ageH: Math.max(0, Math.round((T - Date.parse(c.postedAt)) / HOUR)) }));
      const grounding: LabGrounding = { exemplars: refs.slice(0, 3), duds: refs.slice(3, 4), contrast: '', query: d.title, embedModel: EMBED_MODEL, thin: refs.length < 3 };
      store.ideas.upsert({
        id: `fx-idea-${9 + i}`, title: d.title, clusterId: null, angle: d.angle.replace('_', ' '), tension: null, formatFamily: 'tutorial_walkthrough', strand: [], hookRecs: [],
        evidence: refs.slice(0, 3).map((x) => ({ postId: x.postId, why: `${x.ratio.toFixed(1)}x its creator's normal on this launch` })),
        // two open, one used, one dismissed: the v1 sync keeps at most 10 open ideas (SYNC_OPEN_CAP), and the world already holds six
        timing: 'open', fit: Math.round((0.8 - i * 0.05) * 100) / 100, thin: refs.length < 3, status: i < 2 ? 'open' : i === 2 ? 'used' : 'dismissed', dismissReason: i === 3 ? 'Not my angle' : null, createdAt: iso(T - (2 + i) * HOUR), actedOnAt: i < 2 ? null : iso(T - HOUR),
        eventId: eventId(d.n), launchAngle: d.angle, source: 'event', batchId: null, seedId: null, notes: null, hookForm: 'results_first', hookTrigger: 'curiosity', vsProbability: null, mmrRank: null, grounding, promptVersion: 'event-idea-v1',
      });
      ideas++;
    });

    // comments: 15 on each of 8 owned posts, hashed authors, @mentions read '@someone'
    const targets = owned.filter((p) => p.platform !== 'linkedin').slice(0, 8);
    const intents: LabCommentIntent[] = ['request', 'request', 'question', 'praise', 'praise', 'objection', 'bait', 'other'];
    targets.forEach((p, pi) => {
      for (let k = 0; k < 15; k++) {
        const seedAsk = pi < 3 && k < 2 ? SEED_ASKS[k][pi] : null;
        const intent: LabCommentIntent = seedAsk ? 'request' : intents[(k + pi) % intents.length];
        const pool = COMMENT_TEXT[intent];
        const text = seedAsk ?? pool[(k * 3 + pi) % pool.length];
        const handle = COMMENTER_HANDLES[(pi * 7 + k * 3) % COMMENTER_HANDLES.length];
        store.comments.upsert({
          id: `${p.platform}:fx-c-${pi}-${k}`, postId: p.id, platform: p.platform, authorHash: authorHash(p.platform, handle, FIXTURE_COMMENT_SALT), text: k === 4 ? `${text} @someone` : text,
          likes: r.int(0, 40), replies: r.int(0, 3), isReply: k % 6 === 5, byCreator: k === 14, creatorHeart: p.platform === 'youtube' ? k % 4 === 0 : null,
          postedAt: iso(Date.parse(p.postedAt!) + (k + 1) * 2 * HOUR), capturedAt: iso(Date.parse(p.postedAt!) + 3 * DAY), intent, intentRule: seedAsk ? 'what-tool' : intent === 'other' ? null : intent, runId: null,
        });
        comments++;
      }
    });

    // contact sheets: 6 owned posts dissected with frames (07 7.14.4; image built by lane G, never fetched)
    owned.filter((p) => dis.has(p.id) && p.platform !== 'linkedin').slice(0, 6).forEach((p) => {
      const d = dis.get(p.id)!;
      store.dissections.upsert({ ...d, framesUsed: 1, onScreenTextDensity: 2, faceFirstFrame: true, sheetPath: `data/lab/frames/${p.id}.jpg`, promptVersion: 'dissect-v2-frames' });
      sheets++;
    });

    // local-hash embeddings of every post, idea and comment, from the same texts lane G's backfill embeds
    embeddings += embedLocalNow(store, ['post', 'idea', 'comment'], iso(T));
  });
  void measures;
  return { ideas, comments, embeddings, sheets };
}
