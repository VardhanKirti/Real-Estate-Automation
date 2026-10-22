import type {
  LabBeat,
  LabBeatType,
  LabCtaType,
  LabDissection,
  LabFormat,
  LabHookChannel,
  LabHookForm,
  LabHookRec,
  LabIdea,
  LabPacing,
  LabPillar,
  LabPlatform,
  LabScriptBody,
  LabStructure,
  LabTiming,
  LabTrigger,
} from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { recomputeMeasures } from '@/lib/lab/compute';
import { assignVerdicts, CONTROL_SEED_KEY } from '@/lib/lab/measure/case-control';
import { TARGET_AGES_H } from '@/lib/lab/measure/age';
import { distillProfiles } from '@/lib/lab/distill';
import { computeTrendSnapshots } from '@/lib/lab/trends';
import { deterministicGate } from '@/lib/lab/gate';
import { normalizeBeats, quantile, wordBudget, wordCount } from '@/lib/lab/measures';
import { POST_ACTORS, PROFILE_ACTORS } from '@/lib/lab/apify-client';

/**
 * The Content Lab fixture world (SPEC §5.5): a FICTIONAL AI-space niche. Every creator,
 * handle, post, number and script here is invented; none is a real account. It feeds
 *   - Filming mode (written into demo-data's database by `ensureFilmingFixtures`), and
 *   - the `?sample=1` preview on a blank real install (an in-memory database, badged).
 *
 * It is generated, not hand-listed: a seeded PRNG builds sources, posts with metric
 * snapshots and dissections, then the REAL pipeline math runs over it (recomputeMeasures,
 * computeTrendSnapshots, distillProfiles), so every ladder value, quadrant, lift and
 * timing on a fixture page is computed exactly as it will be on scraped data.
 * Dates are relative to the anchor (now, to the hour), so the world never ages out.
 * Same anchor → same world.
 *
 * v2 (08.7.2): this is the v1 world, moved unchanged into lib/lab/fixtures/world.ts and called
 * by lib/lab/fixtures/index.ts, which adds the v2 layers (radar, ledger, gen, ops) on top.
 */

export const FIXTURE_MARKER = '__fixtures';
export const FIXTURE_NAME = 'Content Lab sample: a fictional AI-space niche';

/* ── PRNG ──────────────────────────────────────────────────────────────── */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
class Rand {
  private r: () => number;
  constructor(seed: number) {
    this.r = mulberry32(seed);
  }
  next() {
    return this.r();
  }
  int(lo: number, hi: number) {
    return lo + Math.floor(this.r() * (hi - lo + 1));
  }
  between(lo: number, hi: number) {
    return lo + this.r() * (hi - lo);
  }
  chance(p: number) {
    return this.r() < p;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.r() * xs.length)];
  }
  weighted<T extends string>(w: Partial<Record<T, number>>): T {
    const entries = Object.entries(w) as [T, number][];
    const total = entries.reduce((a, [, v]) => a + v, 0);
    let x = this.r() * total;
    for (const [k, v] of entries) {
      x -= v;
      if (x <= 0) return k;
    }
    return entries[entries.length - 1][0];
  }
  normal() {
    const u = Math.max(1e-9, this.r());
    const v = this.r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  logn(sigma: number) {
    return Math.exp(this.normal() * sigma);
  }
}

/* ── the niche ─────────────────────────────────────────────────────────── */

type CreatorDef = { name: string; handle: string; platform: LabPlatform; followers: number; format: LabFormat; wpm: number };

/** Invented creators. Owned accounts are "your" fictional studio. */
const OWNED: CreatorDef[] = [
  { name: 'Northline Studio', handle: 'northline.studio', platform: 'instagram', followers: 48_000, format: 'tutorial_walkthrough', wpm: 168 },
  { name: 'Northline Studio', handle: 'northline.studio', platform: 'tiktok', followers: 91_000, format: 'tutorial_walkthrough', wpm: 172 },
  { name: 'Northline Studio', handle: 'northlinestudio', platform: 'youtube', followers: 36_000, format: 'screen_recording', wpm: 158 },
];
const TRACKED: CreatorDef[] = [
  { name: 'Mara Quill', handle: 'maraquill.ai', platform: 'tiktok', followers: 410_000, format: 'tutorial_walkthrough', wpm: 178 },
  { name: 'Teo Varga', handle: 'teo.builds', platform: 'tiktok', followers: 120_000, format: 'screen_recording', wpm: 162 },
  { name: 'Juno Halloway', handle: 'junoprompts', platform: 'instagram', followers: 260_000, format: 'talking_head', wpm: 171 },
  { name: 'Ilse Brandvik', handle: 'ilse.automates', platform: 'instagram', followers: 88_000, format: 'tutorial_walkthrough', wpm: 166 },
  { name: 'Omar Castellane', handle: 'omarshipsai', platform: 'youtube', followers: 530_000, format: 'screen_recording', wpm: 155 },
  { name: 'Wren Okonkwo', handle: 'wrenagents', platform: 'tiktok', followers: 74_000, format: 'tutorial_walkthrough', wpm: 181 },
  { name: 'Soren Pike', handle: 'sorenpike.dev', platform: 'youtube', followers: 190_000, format: 'tutorial_walkthrough', wpm: 160 },
  { name: 'Lio Marchetti', handle: 'lio.makes.ai', platform: 'instagram', followers: 140_000, format: 'talking_head', wpm: 174 },
  { name: 'Bea Thornquist', handle: 'bea.workflows', platform: 'tiktok', followers: 52_000, format: 'tutorial_walkthrough', wpm: 169 },
  { name: 'Cass Delarue', handle: 'cassdelarue', platform: 'instagram', followers: 310_000, format: 'talking_head', wpm: 176 },
  { name: 'Niko Arvane', handle: 'nikoarvane', platform: 'tiktok', followers: 680_000, format: 'talking_head', wpm: 183 },
  { name: 'Hollis Grey', handle: 'hollisgrey.ai', platform: 'youtube', followers: 95_000, format: 'screen_recording', wpm: 150 },
  { name: 'Rumi Achterberg', handle: 'rumi.codes', platform: 'tiktok', followers: 230_000, format: 'screen_recording', wpm: 165 },
  { name: 'Zara Felling', handle: 'zarafelling', platform: 'instagram', followers: 66_000, format: 'tutorial_walkthrough', wpm: 170 },
  { name: 'Idris Monroe', handle: 'idris.agentic', platform: 'tiktok', followers: 150_000, format: 'tutorial_walkthrough', wpm: 175 },
  { name: 'Pema Lindgard', handle: 'pema.prompts', platform: 'instagram', followers: 39_000, format: 'talking_head', wpm: 163 },
  { name: 'Ottoline Reyes', handle: 'ottoline.ai', platform: 'youtube', followers: 280_000, format: 'tutorial_walkthrough', wpm: 158 },
  { name: 'Kit Marlo', handle: 'kitmarlo.sun', platform: 'tiktok', followers: 98_000, format: 'talking_head', wpm: 179 },
  { name: 'Anouk Verbeek', handle: 'anouk.builds', platform: 'instagram', followers: 115_000, format: 'screen_recording', wpm: 161 },
  { name: 'Felix Danvers', handle: 'felixdanvers', platform: 'tiktok', followers: 340_000, format: 'tutorial_walkthrough', wpm: 172 },
  { name: 'Saoirse Lunde', handle: 'saoirse.tools', platform: 'instagram', followers: 82_000, format: 'tutorial_walkthrough', wpm: 167 },
  { name: 'Bram Eastwood', handle: 'bram.automata', platform: 'youtube', followers: 61_000, format: 'screen_recording', wpm: 152 },
  { name: 'Ines Calloway', handle: 'ines.calloway', platform: 'tiktok', followers: 205_000, format: 'talking_head', wpm: 177 },
  { name: 'Theron Vask', handle: 'theronvask', platform: 'instagram', followers: 47_000, format: 'tutorial_walkthrough', wpm: 164 },
];
const SUGGESTED: (CreatorDef & { reason: string; score: number })[] = [
  { name: 'Yuki Hollander', handle: 'yukihollander', platform: 'tiktok', followers: 44_000, format: 'tutorial_walkthrough', wpm: 174, reason: '8 of 10 sampled posts are AI tool tutorials, 3 broke out', score: 0.82 },
  { name: 'Marlo Achebe', handle: 'marlo.makes', platform: 'instagram', followers: 29_000, format: 'screen_recording', wpm: 160, reason: '6 of 10 sampled posts are screen-recorded demos; strong overlap on agent memory', score: 0.71 },
  { name: 'Dita Sorensen', handle: 'ditasorensen', platform: 'youtube', followers: 73_000, format: 'tutorial_walkthrough', wpm: 157, reason: '7 of 10 sampled posts match your tutorial format; growing 4% a week', score: 0.64 },
];
const FEEDS = [
  { feed: 'hn', handle: 'hn', name: 'Hacker News' },
  { feed: 'reddit', handle: 'r/LocalModels', name: 'Reddit: local models' },
  { feed: 'producthunt', handle: 'producthunt-ai', name: 'Product Hunt: AI' },
  { feed: 'google_trends', handle: 'trends-ai', name: 'Google Trends: AI terms' },
] as const;

type ClusterDef = { id: string; label: string; topic: string; angles: string[]; weights: number[]; boost: number };
/** 8 topic clusters with a 12-week intensity curve each (oldest week first). */
const CLUSTERS: ClusterDef[] = [
  { id: 'fx-c-memory', label: 'Agent memory', topic: 'agent memory', angles: ['the cost nobody shows', 'memory vs RAG', 'why your agent forgets', 'build it in ten minutes'], weights: [2, 2, 2, 3, 3, 3, 4, 5, 6, 8, 10, 12], boost: 1.6 },
  { id: 'fx-c-voice', label: 'Voice cloning', topic: 'voice cloning', angles: ['clone yourself for a course', 'the consent problem', 'cheapest clone that passes'], weights: [1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 4, 6], boost: 1.5 },
  { id: 'fx-c-browser', label: 'Browser agents', topic: 'browser agents', angles: ['the launch recap', 'a week running my inbox', 'where they still break', 'the cost breakdown'], weights: [3, 5, 8, 11, 13, 14, 14, 13, 12, 11, 10, 9], boost: 0.8 },
  { id: 'fx-c-local', label: 'Local models on a laptop', topic: 'local models', angles: ['beat my paid plan', 'the setup in one command', 'private by default'], weights: [5, 5, 5, 6, 6, 6, 6, 6, 7, 7, 7, 7], boost: 1.1 },
  { id: 'fx-c-video', label: 'AI video generators', topic: 'AI video', angles: ['why it still looks fake', 'the one prompt trick', 'ads made in an hour'], weights: [10, 12, 13, 12, 10, 8, 6, 5, 4, 3, 2, 2], boost: 0.7 },
  { id: 'fx-c-coding', label: 'Coding agents in the terminal', topic: 'coding agents', angles: ['what they still get wrong', 'my daily setup', 'ship a feature while you sleep'], weights: [8, 8, 9, 9, 9, 9, 10, 10, 10, 10, 10, 11], boost: 1.0 },
  { id: 'fx-c-mcp', label: 'MCP servers', topic: 'MCP servers', angles: ['explained with one real build', 'the five worth installing', 'security nobody checks'], weights: [1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8, 9], boost: 1.4 },
  { id: 'fx-c-cache', label: 'Prompt caching costs', topic: 'prompt caching', angles: ['cut my bill by 80%', 'how the cache actually works', 'when it costs you more'], weights: [1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 4], boost: 1.5 },
];

const HOOKS: Partial<Record<LabHookForm, string[]>> = {
  results_first: ['This agent booked 40 calls while I slept', 'I cut my {topic} bill to three dollars a month', 'I replaced my VA with {topic} and kept the money'],
  contrarian: ['{Topic} is the wrong thing to learn this year', 'Stop building {topic} like a chatbot'],
  open_loop: ['Nobody tells you what {topic} really costs', 'I tried {topic} for 30 days and one thing broke'],
  howto_promise: ['How to set up {topic} in under ten minutes', 'Here is how I run {topic} every morning'],
  list_tease: ['Five {topic} tools I actually use', 'Three {topic} mistakes I see every week'],
  direct_question: ['Why does your {topic} keep forgetting things?', 'Is {topic} worth paying for yet?'],
  pattern_interrupt: ['Close your laptop. Watch this first.', 'Do not touch {topic} until you see this'],
  number_stat: ['92% of {topic} demos skip this step', '{Topic} saved me 11 hours this week'],
  news_react: ['{Topic} just changed overnight', 'The {topic} update everyone missed'],
  identity_call: ['If you run a small team, {topic} is for you', 'Solo founders, this {topic} setup is yours'],
  confession: ['I was wrong about {topic}', 'I wasted a month on {topic} so you do not have to'],
};
const HOOK_WEIGHTS: Partial<Record<LabHookForm, number>> = { results_first: 18, contrarian: 10, open_loop: 12, howto_promise: 12, list_tease: 10, direct_question: 8, pattern_interrupt: 6, number_stat: 8, news_react: 6, identity_call: 5, confession: 5 };
const HOOK_MULT: Partial<Record<LabHookForm, number>> = { results_first: 3.2, contrarian: 1.5, open_loop: 1.4, list_tease: 0.45, pattern_interrupt: 2.6, howto_promise: 0.85, direct_question: 0.8 };
const TRIGGER_FOR: Partial<Record<LabHookForm, Partial<Record<LabTrigger, number>>>> = {
  results_first: { curiosity: 6, aspiration: 3, surprise_shock: 1 },
  contrarian: { controversy: 5, curiosity: 3, frustration: 2 },
  open_loop: { curiosity: 7, fear_fomo: 2 },
  pattern_interrupt: { surprise_shock: 6, urgency: 3 },
  news_react: { urgency: 4, fear_fomo: 4, curiosity: 2 },
};
const STRUCTURES: Partial<Record<LabFormat, Partial<Record<LabStructure, number>>>> = {
  tutorial_walkthrough: { tutorial: 45, demo_reveal: 35, problem_solution: 20 },
  talking_head: { hot_take: 30, story_lesson: 25, myth_bust: 20, listicle: 15, news_breakdown: 10 },
  screen_recording: { demo_reveal: 40, comparison: 25, tutorial: 20, listicle: 15 },
  carousel: { listicle: 1 },
  long_form: { tutorial: 1 },
};
const TEMPLATES: Record<string, [LabBeatType, number][]> = {
  demo_reveal: [['hook', 8], ['reveal', 20], ['demo', 72], ['payoff', 90], ['cta', 100]],
  tutorial: [['hook', 7], ['promise', 15], ['demo', 45], ['rehook', 50], ['demo', 80], ['payoff', 92], ['cta', 100]],
  hot_take: [['hook', 10], ['claim', 30], ['evidence', 65], ['contrast', 82], ['payoff', 94], ['cta', 100]],
  story_lesson: [['hook', 9], ['context', 35], ['reveal', 60], ['payoff', 90], ['cta', 100]],
  listicle: [['hook', 8], ['promise', 14], ['evidence', 85], ['cta', 100]],
  myth_bust: [['hook', 8], ['claim', 25], ['contrast', 55], ['evidence', 85], ['cta', 100]],
  comparison: [['hook', 8], ['context', 20], ['contrast', 70], ['payoff', 90], ['cta', 100]],
  problem_solution: [['hook', 10], ['context', 30], ['demo', 75], ['payoff', 92], ['cta', 100]],
  news_breakdown: [['hook', 8], ['context', 30], ['claim', 60], ['evidence', 88], ['cta', 100]],
};
const SENTENCES: Record<LabBeatType, string[]> = {
  hook: ['Watch this.'],
  context: ['Here is the setup.', 'Most teams still do this by hand.', 'I run a five person studio, so time is the whole game.'],
  promise: ['By the end you will have it running.', 'Three steps, no code.'],
  demo: ['Watch what happens when I paste this in.', 'It pulls the docs, writes the summary and files it.', 'Now I change one setting.', 'This is the part that used to take an hour.'],
  claim: ['Here is the claim.', 'Most people get this backwards.'],
  evidence: ['I tested it on forty real tasks.', 'The numbers were not close.', 'Here is the receipt.'],
  contrast: ['Before, it took a full afternoon.', 'Compare that with the old way.'],
  reveal: ['The trick is one memory file.', 'And this is where it gets interesting.'],
  payoff: ['That is the whole system.', 'Ten minutes, and it runs every day.'],
  rehook: ['But wait, it gets better.'],
  cta: ['Follow for the next build.', 'Save this for later.'],
  other: ['One more thing.'],
};

/* ── helpers ──────────────────────────────────────────────────────────── */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fill = (t: string, topic: string) => t.replaceAll('{Topic}', cap(topic)).replaceAll('{topic}', topic);
const pad = (n: number) => String(n).padStart(4, '0');

function beatsFor(structure: LabStructure, r: Rand): LabBeat[] {
  const tpl = TEMPLATES[structure] ?? TEMPLATES.tutorial;
  let start = 0;
  const out: LabBeat[] = [];
  tpl.forEach(([type, end], i) => {
    const e = i === tpl.length - 1 ? 100 : Math.max(start + 2, Math.min(98, end + r.between(-2, 2)));
    out.push({ type, startPct: Math.round(start * 10) / 10, endPct: Math.round(e * 10) / 10, summary: '' });
    start = e;
  });
  return normalizeBeats(out);
}

/** Spoken text of exactly `words` words: the hook, then sentences matching each beat. */
function spokenText(hook: string, beats: LabBeat[], words: number, r: Rand): string {
  const parts: string[] = [hook.endsWith('.') || hook.endsWith('?') ? hook : `${hook}.`];
  let i = 0;
  while (wordCount(parts.join(' ')) < words && i < 400) {
    const b = beats[Math.min(beats.length - 1, Math.floor((i / 12) * beats.length) % beats.length)];
    parts.push(r.pick(SENTENCES[b.type]));
    i++;
  }
  return parts.join(' ').split(/\s+/).slice(0, Math.max(1, words)).join(' ');
}

/** Views reached h hours after posting, as a share of the final count. */
function curve(kind: 'fast' | 'slow' | 'steady', h: number): number {
  if (kind === 'fast') return 1 - Math.exp(-h / 9);
  if (kind === 'slow') return h / (h + 110);
  return 1 - Math.exp(-h / 45);
}

export type FixtureSummary = { sources: number; posts: number; metrics: number; breakouts: number; profiles: number; ideas: number; scripts: number; runs: number; anchor: string };

/**
 * 04 8 fixture cases the generated corpus does not reach, written without the PRNG (so the rest of
 * the world is unchanged): an owned X account judged on the X action score (no view counts) with
 * one tweet under 2 h old (dense reads), a YouTube Short from before the 2025-03-31 view rule, and a
 * newly tracked creator whose older posts were only read once, past 14 days, so its two new posts
 * are judged on the projected route. Returns the metric rows written.
 */
function seedMeasureExtras(store: LabStore, T: number): number {
  const at = (ms: number) => new Date(ms).toISOString();
  let rows = 0;
  const read = (postId: string, posted: number, h: number, views: number | null, likes: number, comments: number, shares: number | null, readKind: 'snapshot' | 'dense' | 'discover' | 'cycle', target: number | null, quotes: number | null = null) => {
    store.metrics.add({ postId, capturedAt: at(posted + h * HOUR), ageH: h, readKind, targetAgeH: target, views, likes, comments, shares, saves: null, quotes });
    rows++;
  };
  store.transaction(() => {
    // owned X: tweets 15 to 41 days old (outside the hit-rate window) and one an hour old
    const xSrc = 'fx-s-owned-twitter-northlinestudio';
    store.sources.upsert({ id: xSrc, kind: 'owned', platform: 'twitter', handle: 'northline.studio', url: 'https://x.com/northline.studio', displayName: 'Northline Studio', status: 'active', addedAt: at(T - 120 * DAY), reason: null, score: null });
    store.creatorSnapshots.add({ sourceId: xSrc, capturedAt: at(T - 60 * DAY), followers: 12_400, following: 310, postCount: 820 });
    const tweetAges = [15, 18, 21, 24, 27, 30, 33, 36, 41].map((d) => d * DAY + 3 * HOUR);
    tweetAges.forEach((age, i) => {
      const id = `fx-x-${String(i + 1).padStart(2, '0')}`;
      const posted = T - age;
      store.posts.upsert({ id, sourceId: xSrc, platform: 'twitter', externalId: `fxx${i + 1}`, url: `https://x.com/northline.studio/status/fxx${i + 1}`, postedAt: at(posted), caption: ['Three agent memory patterns we ship with', 'The prompt cache saved us a week of tokens', 'Browser agents fail on login walls: here is the fix'][i % 3], contentType: 'text', thumbnailUrl: null, mediaUrl: null, durationS: null, isOwned: true });
      const scale = [1, 1.3, 0.8, 4.2, 0.9, 1.1, 0.7, 1.2, 0.95][i];
      for (const h of [0.5, 1, 1.5, 2, 3, 6, 12, 24, 48]) {
        const f = (1 - Math.exp(-h / 6)) * scale;
        read(id, posted, h, null, Math.round(180 * f), Math.round(14 * f), Math.round(22 * f), h <= 2 ? 'dense' : 'snapshot', h, Math.round(4 * f));
      }
    });
    const fresh = T - HOUR;
    store.posts.upsert({ id: 'fx-x-10', sourceId: xSrc, platform: 'twitter', externalId: 'fxx10', url: 'https://x.com/northline.studio/status/fxx10', postedAt: at(fresh), caption: 'We gave the agent a scratchpad and it stopped looping', contentType: 'text', thumbnailUrl: null, mediaUrl: null, durationS: null, isOwned: true });
    read('fx-x-10', fresh, 0.5, null, 41, 3, 5, 'dense', 0.5, 1);

    // a Short posted before YouTube's 2025-03-31 view rule: its own baseline cell
    const ytSrc = 'fx-s-owned-youtube-northlinestudio';
    const old = Date.parse('2025-03-20T15:00:00.000Z');
    store.posts.upsert({ id: 'fx-yt-pre', sourceId: ytSrc, platform: 'youtube', externalId: 'fxytpre', url: 'https://www.youtube.com/shorts/fxytpre', postedAt: at(old), caption: 'Agent memory in sixty seconds', contentType: 'short', thumbnailUrl: null, mediaUrl: null, durationS: 52, isOwned: true, epoch: 'yt_shorts_pre_2025_03_31' });
    for (const h of [24, 72, 168, 336]) read('fx-yt-pre', old, h, Math.round(9_000 * (1 - Math.exp(-h / 50))), Math.round(300 * (1 - Math.exp(-h / 50))), 21, null, 'cycle', null);

    // a creator tracked three days ago: older posts read once past 14 days, two new posts read young
    const newSrc = 'fx-s-tracked-tiktok-rookvanceai';
    store.sources.upsert({ id: newSrc, kind: 'tracked', platform: 'tiktok', handle: 'rook.vance.ai', url: 'https://www.tiktok.com/@rook.vance.ai', displayName: 'Rook Vance', status: 'active', addedAt: at(T - 3 * DAY), reason: null, score: null });
    store.creatorSnapshots.add({ sourceId: newSrc, capturedAt: at(T - 3 * DAY), followers: 64_000, following: 120, postCount: 210 });
    for (let i = 0; i < 12; i++) {
      const id = `fx-rv-${String(i + 1).padStart(2, '0')}`;
      const posted = T - (17 + i * 3) * DAY;
      store.posts.upsert({ id, sourceId: newSrc, platform: 'tiktok', externalId: `fxrv${i + 1}`, url: `https://www.tiktok.com/@rook.vance.ai/video/9${i + 1}`, postedAt: at(posted), caption: 'Coding agents, one real build', contentType: 'video', thumbnailUrl: null, mediaUrl: null, durationS: 44, isOwned: false });
      const v = Math.round(14_000 * [1, 1.4, 0.7, 1.1, 0.9, 1.3, 0.8, 1.05, 0.95, 1.2, 0.85, 1.15][i]);
      read(id, posted, (T - 2 * DAY - posted) / HOUR, v, Math.round(v * 0.06), Math.round(v * 0.006), Math.round(v * 0.004), 'cycle', null);
    }
    for (const [i, days] of [[13, 3], [14, 2]] as const) {
      const id = `fx-rv-${i}`;
      const posted = T - days * DAY;
      store.posts.upsert({ id, sourceId: newSrc, platform: 'tiktok', externalId: `fxrv${i}`, url: `https://www.tiktok.com/@rook.vance.ai/video/9${i}`, postedAt: at(posted), caption: 'Prompt caching, the bill before and after', contentType: 'video', thumbnailUrl: null, mediaUrl: null, durationS: 39, isOwned: false });
      for (const h of [6, 24, 30, 70]) {
        if (h > days * 24) continue;
        const v = Math.round((i === 13 ? 52_000 : 9_000) * (1 - Math.exp(-h / 30)));
        read(id, posted, h, v, Math.round(v * 0.06), Math.round(v * 0.006), Math.round(v * 0.004), 'cycle', null);
      }
    }
  });
  return rows;
}

/**
 * Write the whole fixture world into `store` (which should be empty). Returns counts.
 * Deterministic for a given anchor hour.
 */
export function seedWorld(store: LabStore, now: Date = new Date()): FixtureSummary {
  const anchor = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
  const T = anchor.getTime();
  const at = (ms: number) => new Date(ms).toISOString();
  const r = new Rand(20261010);
  const SPAN_DAYS = 112;
  let metricsCount = 0;

  type Planned = { id: string; sourceId: string; handle: string; platform: LabPlatform; owned: boolean; postedAt: number; format: LabFormat; durationS: number; wpm: number; dissection: LabDissection; cluster: ClusterDef; angle: string; views: number; depthBase: number; curveKind: 'fast' | 'slow' | 'steady' };
  const planned: Planned[] = [];
  let postSeq = 0;

  const clusterAt = (t: number, rr: Rand): ClusterDef => {
    const week = Math.min(11, Math.max(0, 11 - Math.floor((T - t) / (7 * DAY))));
    const w: Record<string, number> = {};
    for (const c of CLUSTERS) w[c.id] = c.weights[week];
    const id = rr.weighted(w);
    return CLUSTERS.find((c) => c.id === id)!;
  };

  store.transaction(() => {
    const allCreators: { def: CreatorDef; kind: 'owned' | 'tracked' | 'suggested'; reason?: string; score?: number }[] = [
      ...OWNED.map((def) => ({ def, kind: 'owned' as const })),
      ...TRACKED.map((def) => ({ def, kind: 'tracked' as const })),
      ...SUGGESTED.map((s) => ({ def: s, kind: 'suggested' as const, reason: s.reason, score: s.score })),
    ];

    allCreators.forEach(({ def, kind, reason, score }, ci) => {
      const sourceId = `fx-s-${kind}-${def.platform}-${def.handle.replace(/[^a-z0-9]/g, '')}`;
      const added = kind === 'suggested' ? T - r.int(1, 4) * DAY : T - (SPAN_DAYS + 5) * DAY;
      store.sources.upsert({
        id: sourceId,
        kind,
        platform: def.platform,
        handle: def.handle,
        url: def.platform === 'youtube' ? `https://www.youtube.com/@${def.handle}` : def.platform === 'tiktok' ? `https://www.tiktok.com/@${def.handle}` : `https://www.instagram.com/${def.handle}/`,
        displayName: def.name,
        status: 'active',
        addedAt: at(added),
        reason: reason ?? null,
        score: score ?? null,
      });
      // weekly follower snapshots, a gentle growth curve
      const growth = r.between(0.002, 0.012);
      for (let w = Math.floor(SPAN_DAYS / 7); w >= 0; w--) {
        if (kind === 'suggested' && w > 1) continue;
        store.creatorSnapshots.add({ sourceId, capturedAt: at(T - w * 7 * DAY), followers: Math.round(def.followers * Math.pow(1 + growth, -w)), following: r.int(80, 900), postCount: 300 + ci * 7 - w * 2 });
      }

      const count = kind === 'owned' ? (def.platform === 'youtube' ? 26 : 32) : kind === 'suggested' ? 10 : 110;
      const span = kind === 'suggested' ? 30 : SPAN_DAYS;
      const reachBase = { tiktok: 0.22, instagram: 0.12, youtube: 0.16, twitter: 0.1, linkedin: 0.05 }[def.platform];
      for (let k = 0; k < count; k++) {
        postSeq++;
        const id = `fx-p-${pad(postSeq)}`;
        const posted = T - (span * DAY * (k + r.between(0.05, 0.6))) / count - r.int(0, 10) * HOUR;
        const format: LabFormat =
          def.platform === 'instagram' && kind === 'owned' && k % 9 === 4 ? 'carousel'
          : def.platform === 'youtube' && k % 11 === 7 ? 'long_form'
          : r.chance(0.86) ? def.format
          : r.pick(['tutorial_walkthrough', 'talking_head', 'screen_recording'] as const);
        const cluster = clusterAt(posted, r);
        const angle = r.pick(cluster.angles);
        const hookForm = r.weighted(HOOK_WEIGHTS);
        const trigger = r.weighted<LabTrigger>(TRIGGER_FOR[hookForm] ?? { curiosity: 4, aspiration: 2, frustration: 2, relatability: 2, authority_status: 1, fear_fomo: 1 });
        const channel = r.weighted<LabHookChannel>({ spoken: 5, mixed: 3, on_screen_text: 2, visual: 1 });
        const structure = r.weighted<LabStructure>(STRUCTURES[format] ?? { tutorial: 1 });
        const beats = format === 'carousel' ? [] : beatsFor(structure, r);
        const durationS = format === 'carousel' ? 0 : format === 'long_form' ? r.int(420, 840) : format === 'screen_recording' ? r.int(55, 92) : format === 'talking_head' ? r.int(22, 58) : r.int(30, 62);
        const wpm = Math.round(def.wpm + r.normal() * 8);
        const hookText = fill(r.pick(HOOKS[hookForm] ?? ['{Topic} in one minute']), cluster.topic);
        const cta = r.weighted<LabCtaType>({ follow: 6, comment_keyword: 2, link: 1, product: 1, none: 2 });
        const hasRehook = beats.some((b) => b.type === 'rehook');

        // the hidden "truth" the fixture world runs on (the measures must rediscover it)
        let mult = HOOK_MULT[hookForm] ?? 1;
        if (channel === 'mixed' || channel === 'on_screen_text') mult *= 1.6;
        if (structure === 'demo_reveal') mult *= 1.8;
        if (structure === 'listicle') mult *= 0.55;
        if (wpm >= 160 && wpm < 185) mult *= 1.3;
        if (hasRehook) mult *= 1.3;
        if (T - posted < 21 * DAY) mult *= cluster.boost;
        if (T - posted < 8 * DAY && cluster.boost > 1.2) mult *= 1.8;
        const noise = r.logn(0.3);
        const views = Math.max(200, Math.round(def.followers * reachBase * mult * noise));
        const depthBase = { tiktok: 0.072, instagram: 0.055, youtube: 0.042, twitter: 0.02, linkedin: 0.03 }[def.platform] * r.logn(0.25) * (hookForm === 'pattern_interrupt' ? 0.35 : Math.pow(mult, 0.45)) * (structure === 'story_lesson' ? 1.3 : 1);
        const curveKind = r.weighted<'fast' | 'slow' | 'steady'>(mult * noise > 2.5 ? { slow: 5, steady: 3, fast: 2 } : { fast: 5, steady: 4, slow: 1 });

        const dissection: LabDissection = {
          postId: id,
          format,
          hookForm,
          emotionalTrigger: trigger,
          hookChannel: channel,
          hookText,
          firstFrameText: channel === 'spoken' ? '' : hookText.split(' ').slice(0, 6).join(' '),
          structureType: structure,
          beats,
          pacing: r.weighted<LabPacing>(wpm > 175 ? { rapid_fire: 3, punchy: 2 } : { conversational: 3, punchy: 1, slow_build: 1 }),
          pillar: r.weighted<LabPillar>({ educational: 6, entertainment: 2, inspirational: 1, behind_scenes: 1, promotional: 0.5 }),
          ctaType: cta,
          tension: r.chance(0.4) ? { falseBelief: `${cap(cluster.topic)} is plug and play`, reframe: `The setup is the product: ${angle}` } : null,
          confidences: { format: Math.round(r.between(0.7, 0.98) * 100) / 100, hook_form: Math.round(r.between(0.6, 0.95) * 100) / 100, structure_type: Math.round(r.between(0.6, 0.95) * 100) / 100 },
          qualityNotes: '',
          modelId: 'claude-cli',
          promptVersion: 'dissect-v1',
          analysedAt: at(Math.min(T, posted + 26 * HOUR)),
        };
        planned.push({ id, sourceId, handle: def.handle, platform: def.platform, owned: kind === 'owned', postedAt: posted, format, durationS, wpm, dissection, cluster, angle, views, depthBase, curveKind });
      }
    });

    for (const c of CLUSTERS) store.clusters.upsert({ id: c.id, label: c.label, createdAt: at(T - (SPAN_DAYS + 5) * DAY) });
    for (const f of FEEDS) {
      store.sources.upsert({ id: `fx-s-feed-${f.feed}`, kind: 'feed', platform: f.feed, handle: f.handle, url: null, displayName: f.name, status: 'active', addedAt: at(T - (SPAN_DAYS + 5) * DAY), reason: null, score: null });
    }

    // v2 (04 4): owned posts are read at the fixed target ages after a discovery read at 2h. For the
    // snapshot hit rate (04 4, AC-08-15: byTarget[6] = 8 of 10 over the default 14 days) the ten newest
    // owned posts whose 6h window closed in that span include two missed 6h reads; older posts in it
    // were discovered late (overnight), after their 3h and 6h windows, so they are not due.
    const inWeek = planned
      .filter((p) => p.owned && p.postedAt + 6 * HOUR >= T - 14 * DAY && p.postedAt + 7 * HOUR <= T)
      .sort((a, b) => b.postedAt - a.postedAt);
    const missed6 = new Set(inWeek.slice(0, 10).filter((_, i) => i === 2 || i === 6).map((p) => p.id));
    const lateFound = new Set(inWeek.slice(10).map((p) => p.id));

    for (const p of planned) {
      store.posts.upsert({
        id: p.id,
        sourceId: p.sourceId,
        platform: p.platform,
        externalId: `fx${p.id.slice(5)}${p.platform.slice(0, 2)}`,
        url: p.platform === 'youtube' ? `https://www.youtube.com/watch?v=fx${p.id.slice(5)}` : p.platform === 'tiktok' ? `https://www.tiktok.com/@${p.handle}/video/7${p.id.slice(5)}` : `https://www.instagram.com/p/fx${p.id.slice(5)}/`,
        postedAt: at(p.postedAt),
        caption: `${p.dissection.hookText}. ${cap(p.cluster.topic)}, ${p.angle}. #ai #${p.cluster.topic.replace(/\s+/g, '').toLowerCase()}`,
        contentType: p.format === 'carousel' ? 'carousel' : p.platform === 'youtube' ? (p.format === 'long_form' ? 'video' : 'short') : p.platform === 'instagram' ? 'reel' : 'video',
        thumbnailUrl: null,
        mediaUrl: null,
        durationS: p.durationS || null,
        isOwned: p.owned,
      });
      store.dissections.upsert(p.dissection);
      store.topics.replaceForPost(p.id, [
        { postId: p.id, topic: p.cluster.topic, angle: p.angle, isPrimary: true, clusterId: p.cluster.id },
        ...(r.chance(0.3) ? [{ postId: p.id, topic: r.pick(CLUSTERS).topic, angle: '', isPrimary: false, clusterId: null }] : []),
      ]);
      // metric snapshots: re-read every cycle while younger than 14 days, then frozen
      const age = (T - p.postedAt) / HOUR;
      const discoverH = lateFound.has(p.id) ? 7.5 : 2;
      const ownedReads = [discoverH, ...TARGET_AGES_H.filter((h) => h > discoverH && !(h === 6 && missed6.has(p.id)))];
      const reads = (p.owned ? ownedReads : [5, 24, 72, 168, 336]).filter((h) => h <= age);
      if (age < 336 && (reads.length === 0 || reads[reads.length - 1] < age - 1)) reads.push(Math.floor(age));
      for (const h of reads) {
        const share = curve(p.curveKind, h) / curve(p.curveKind, Math.min(Math.max(age, 336), 336));
        const v = p.format === 'carousel' && p.platform === 'instagram' ? null : Math.max(1, Math.round(p.views * share));
        const eng = (v ?? p.views * share) * p.depthBase;
        // v2 (04 8): owned reads are fixed-age snapshots after the first (discover) read; tracked reads are sync cycles
        const snapTarget = (TARGET_AGES_H as readonly number[]).includes(h) ? h : null;
        store.metrics.add({
          postId: p.id,
          capturedAt: at(p.postedAt + h * HOUR),
          ageH: h,
          readKind: !p.owned ? 'cycle' : h === reads[0] ? 'discover' : snapTarget !== null ? 'snapshot' : 'cycle',
          targetAgeH: p.owned && snapTarget !== null && h !== reads[0] ? snapTarget : null,
          views: v,
          likes: Math.round(eng * 0.8),
          comments: Math.round(eng * 0.08),
          shares: p.platform === 'tiktok' ? Math.round(eng * 0.1) : null,
          // honest-or-absent: Instagram and YouTube do not return saves
          saves: p.platform === 'tiktok' ? Math.round(eng * 0.12) : null,
        });
        metricsCount++;
      }
    }
  });

  metricsCount += seedMeasureExtras(store, T);

  // the real pipeline math over the invented corpus: v2 measures, then the case-control verdicts
  // (04 5.2) with a fixed control seed so the world stays deterministic
  const measured = recomputeMeasures(store, anchor);
  store.priors.set({ key: CONTROL_SEED_KEY, value: 'fx-cc-1', n: 0, supersedesDefault: false, updatedAt: anchor.toISOString() });
  assignVerdicts(store, anchor);
  const roles = new Map(store.controls.all().map((c) => [c.postId, c]));

  // transcripts (04 5.2): every owned post, every case and drawn control; v1 rows (breakout 2x or
  // more) are kept for specimens and search but enter the profile only through lab_controls
  const measures = new Map(store.measures.all().map((m) => [m.postId, m]));
  store.transaction(() => {
    for (const p of planned) {
      if (p.format === 'carousel') continue;
      const m = measures.get(p.id);
      const teach = p.owned || roles.has(p.id) || (m?.breakout ?? 0) >= 2;
      if (!teach) continue;
      const words = Math.round((p.durationS * p.wpm) / 60);
      const text = spokenText(p.dissection.hookText, p.dissection.beats, words, r);
      store.transcripts.upsert({ postId: p.id, text, wordCount: wordCount(text), wpm: Math.round((wordCount(text) / p.durationS) * 60 * 10) / 10, provider: p.platform === 'youtube' ? 'youtube-subtitles' : 'whisper-1', costUsd: p.platform === 'youtube' ? 0 : Math.round(p.durationS * 0.0001 * 1000) / 1000, status: 'done' });
    }
    // control statuses follow the pipeline: dissected with a transcript, caption-only without one,
    // and one failed transcription (08.7.2)
    let failed = false;
    for (const c of [...roles.values()].sort((a, b) => a.postId.localeCompare(b.postId))) {
      const done = store.transcripts.get(c.postId)?.status === 'done';
      const status = c.role === 'control' && !failed && done ? 'failed' : done ? 'dissected' : 'caption_only';
      if (status === 'failed') failed = true;
      store.controls.setStatus(c.postId, status);
    }
  });

  // trend items from the feeds, weighted toward each cluster's recent weeks
  store.transaction(() => {
    let n = 0;
    for (const c of CLUSTERS) {
      for (let w = 0; w < 12; w++) {
        const k = Math.round(c.weights[w] / 3);
        for (let j = 0; j < k; j++) {
          n++;
          const f = FEEDS[(n + w) % FEEDS.length];
          const seen = T - (11 - w) * 7 * DAY - r.int(0, 6) * DAY - r.int(0, 20) * HOUR;
          store.trendItems.upsert({
            id: `fx-t-${pad(n)}`,
            feed: f.feed,
            url: `https://example.com/lab-sample/${c.id}/${n}`,
            title: `${cap(c.topic)}: ${r.pick(c.angles)}`,
            score: f.feed === 'google_trends' ? r.int(20, 100) : r.int(15, 900),
            comments: f.feed === 'google_trends' ? null : r.int(2, 300),
            sources: r.chance(0.3) ? [FEEDS[(n + w + 1) % FEEDS.length].feed] : [],
            sourceCount: 1,
            clusterId: c.id,
            seenAt: at(Math.min(T, seen)),
            actedOnAt: null,
          });
        }
      }
    }
  });
  computeTrendSnapshots(store, { now: anchor, days: 84 });

  // four weekly distillations, so the profile carries a real version history
  const families = [
    { family: 'tutorial_walkthrough', label: 'AI tool tutorials · 30-60 s' },
    { family: 'talking_head', label: 'Talking head takes · under 60 s' },
    { family: 'screen_recording', label: 'Screen-recorded demos · 60-90 s' },
  ];
  let profiles = 0;
  for (const back of [21, 14, 7, 0]) profiles += distillProfiles(store, { now: new Date(T - back * DAY), families }).length;

  const ideas = seedIdeas(store, anchor, planned.map((p) => ({ id: p.id, owned: p.owned, clusterId: p.cluster.id, format: p.format })));
  const scripts = seedScripts(store, anchor, ideas);
  const runs = seedRunsAndSpend(store, anchor, r);

  store.priors.set({ key: FIXTURE_MARKER, value: { anchor: anchor.toISOString(), name: FIXTURE_NAME }, n: 0, supersedesDefault: false, updatedAt: anchor.toISOString() });
  store.priors.set({ key: 'yours:wpm', value: { value: 168, band: '160-185 wpm' }, n: 14, supersedesDefault: true, updatedAt: anchor.toISOString() });
  store.priors.set({ key: 'yours:hook_lift:results_first', value: { lift: 1.9 }, n: 4, supersedesDefault: false, updatedAt: anchor.toISOString() });
  store.priors.set({ key: 'yours:duration:tutorial_walkthrough', value: { value: 44 }, n: 11, supersedesDefault: false, updatedAt: anchor.toISOString() });

  const counts = store.counts();
  return { sources: counts.lab_sources, posts: counts.lab_posts, metrics: metricsCount, breakouts: measured.breakouts, profiles, ideas: ideas.length, scripts, runs, anchor: anchor.toISOString() };
}

/* ── ideas, scripts, runs ─────────────────────────────────────────────── */

const IDEA_DEFS: { cluster: string; angle: string; title: string; family: string; tension: { falseBelief: string; reframe: string } | null; status: LabIdea['status']; reason?: string }[] = [
  { cluster: 'fx-c-memory', angle: 'the cost nobody shows', title: 'Agent memory: the cost nobody shows', family: 'tutorial_walkthrough', tension: { falseBelief: 'Memory is free once it is built', reframe: 'Every remembered token is billed again on every call' }, status: 'open' },
  { cluster: 'fx-c-mcp', angle: 'explained with one real build', title: 'MCP servers explained with one real build', family: 'screen_recording', tension: { falseBelief: 'MCP is only for developers', reframe: 'One config file gives any assistant your tools' }, status: 'open' },
  { cluster: 'fx-c-voice', angle: 'clone yourself for a course', title: 'Clone your voice for a course in ten minutes', family: 'tutorial_walkthrough', tension: null, status: 'open' },
  { cluster: 'fx-c-cache', angle: 'cut my bill by 80%', title: 'Prompt caching cut my bill by 80%', family: 'tutorial_walkthrough', tension: { falseBelief: 'Cheaper models are the only way to cut cost', reframe: 'The same model costs a fifth when the prompt repeats' }, status: 'open' },
  { cluster: 'fx-c-browser', angle: 'the cost breakdown', title: 'Browser agents: the cost breakdown nobody did', family: 'talking_head', tension: { falseBelief: 'Browser agents are cheap to run', reframe: 'Screenshots are the bill' }, status: 'open' },
  { cluster: 'fx-c-local', angle: 'beat my paid plan', title: 'The local model that beat my paid plan', family: 'screen_recording', tension: null, status: 'open' },
  { cluster: 'fx-c-coding', angle: 'what they still get wrong', title: 'Coding agents: what they still get wrong', family: 'talking_head', tension: { falseBelief: 'Coding agents replace the review', reframe: 'They move the work to the review' }, status: 'used' },
  { cluster: 'fx-c-video', angle: 'why it still looks fake', title: 'Why AI video still looks fake, and the fix', family: 'talking_head', tension: null, status: 'dismissed', reason: 'Window closed' },
];

function seedIdeas(store: LabStore, anchor: Date, posts: { id: string; owned: boolean; clusterId: string; format: LabFormat }[]): LabIdea[] {
  const measures = new Map(store.measures.all().map((m) => [m.postId, m]));
  const dis = new Map(store.dissections.all().map((d) => [d.postId, d]));
  const profiles = new Map(store.profiles.latest().map((p) => [p.formatFamily, p]));
  const lastTiming = new Map<string, LabTiming | null>();
  for (const s of store.trendSnapshots.all()) lastTiming.set(s.clusterId, s.timing);
  const ownedShare = (family: string) => {
    const own = posts.filter((p) => p.owned);
    return own.length ? own.filter((p) => p.format === family).length / own.length : 0;
  };
  const out: LabIdea[] = [];
  IDEA_DEFS.forEach((d, i) => {
    // evidence: the cluster's strongest competitor posts (AC4: at least two real posts; thin when fewer than three are breakouts)
    const inCluster = posts
      .filter((p) => !p.owned && p.clusterId === d.cluster)
      .map((p) => ({ p, m: measures.get(p.id) }))
      .filter((x) => x.m?.breakout != null)
      .sort((a, b) => Number(b.m!.isBreakout) - Number(a.m!.isBreakout) || (b.m!.breakout ?? 0) - (a.m!.breakout ?? 0));
    const top = inCluster.slice(0, 3);
    const evidence = top.map(({ p, m }) => ({ postId: p.id, why: `${(m!.breakout ?? 0).toFixed(1)}x its creator's normal, ${dis.get(p.id)?.hookForm.replaceAll('_', ' ')} hook` }));
    const breakoutEvidence = top.filter((x) => x.m!.isBreakout).length;
    // the top hook form × trigger cells among the family's breakouts
    const cells = new Map<string, number>();
    for (const p of posts) {
      const m = measures.get(p.id);
      const dd = dis.get(p.id);
      if (p.owned || !m?.isBreakout || !dd || dd.format !== d.family) continue;
      const k = `${dd.hookForm}|${dd.emotionalTrigger}`;
      cells.set(k, (cells.get(k) ?? 0) + 1);
    }
    const prof = profiles.get(d.family);
    const hookRecs: LabHookRec[] = [...cells.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => {
      const [form, trigger] = k.split('|') as [LabHookForm, LabTrigger];
      return { form, trigger, n, lift: prof?.features.find((f) => f.feature === 'hook_form' && f.value === form)?.lift ?? null };
    });
    const timing = lastTiming.get(d.cluster) ?? null;
    const covered = posts.some((p) => p.owned && p.clusterId === d.cluster);
    const fit = Math.round(Math.min(1, 0.45 * ownedShare(d.family) + 0.3 * (covered ? 0.6 : 1) + (timing === 'early' || timing === 'open' ? 0.25 : 0.05) + 0.1) * 100) / 100;
    const created = new Date(anchor.getTime() - (i + 1) * 9 * HOUR).toISOString();
    const idea: LabIdea = {
      id: `fx-idea-${i + 1}`,
      title: d.title,
      clusterId: d.cluster,
      angle: d.angle,
      tension: d.tension,
      formatFamily: d.family,
      strand: prof?.strand ?? [],
      hookRecs,
      evidence,
      timing,
      fit,
      thin: breakoutEvidence < 3,
      status: d.status,
      dismissReason: d.reason ?? null,
      createdAt: created,
      actedOnAt: d.status === 'open' ? null : new Date(anchor.getTime() - 2 * DAY).toISOString(),
    };
    store.ideas.upsert(idea);
    out.push(idea);
  });
  return out;
}

function scriptBody(idea: LabIdea, opts: { durationS: number; wpm: number; over?: number }): LabScriptBody {
  const budget = wordBudget(opts.durationS, opts.wpm);
  const strand = idea.strand.length ? idea.strand : beatsFor('demo_reveal', new Rand(7));
  const r = new Rand(idea.id.length * 97);
  const sections = strand.map((b, i) => {
    const share = (b.endPct - b.startPct) / 100;
    const words = Math.max(3, Math.round(budget * share * (opts.over !== undefined && i === opts.over ? 1.28 : 1)));
    const lead = b.type === 'hook' ? `I gave my agent a memory and the bill doubled` : '';
    const text = spokenText(lead || r.pick(SENTENCES[b.type]), [b], words, r);
    return { type: b.type, startPct: b.startPct, endPct: b.endPct, spoken: text, onScreen: b.type === 'hook' ? 'The bill doubled' : b.type === 'cta' ? 'Follow for part two' : '', visualNote: b.type === 'demo' ? 'Screen: the usage page, then the config file' : '' };
  });
  return {
    durationS: opts.durationS,
    wpm: opts.wpm,
    hooks: (idea.hookRecs.length ? idea.hookRecs : [{ form: 'results_first' as LabHookForm, trigger: 'curiosity' as LabTrigger, lift: null, n: 0 }]).slice(0, 3).map((h, i) => {
      const spoken = ['I gave my agent a memory and the bill doubled', 'Nobody shows you this part of the bill', 'Your agent remembers everything, and you pay for it'][i] ?? 'Watch this';
      return { form: h.form, trigger: h.trigger, spoken, onScreen: spoken.split(' ').slice(0, 5).join(' '), words: wordCount(spoken) };
    }),
    hookChoice: 0,
    sections,
    cta: 'Follow for part two, where I cut it back down.',
    caption: `${idea.title}. The setup and the real numbers.`,
    titles: [idea.title, 'The bill nobody shows you'],
  };
}

function seedScripts(store: LabStore, anchor: Date, ideas: LabIdea[]): number {
  const T = anchor.getTime();
  const plan: { id: string; idea: LabIdea; versions: number; published: boolean; over?: number }[] = [
    { id: 'fx-script-1', idea: ideas[0], versions: 3, published: false, over: 2 },
    { id: 'fx-script-2', idea: ideas[1], versions: 1, published: false },
    { id: 'fx-script-3', idea: ideas[6], versions: 2, published: true },
  ];
  const ownedRecent = store.posts.all().filter((p) => p.isOwned && p.postedAt && Date.parse(p.postedAt) < T - 2 * DAY);
  for (const s of plan) {
    const created = new Date(T - (s.published ? 9 : 2) * DAY).toISOString();
    const publishedPost = s.published ? (ownedRecent.find((p) => p.platform === 'tiktok') ?? ownedRecent[0] ?? null) : null;
    store.scripts.upsert({ id: s.id, ideaId: s.idea.id, title: s.idea.title, status: s.published ? 'published' : 'draft', publishedPostId: publishedPost?.id ?? null, createdAt: created });
    for (let v = 1; v <= s.versions; v++) {
      const body = scriptBody(s.idea, { durationS: 45, wpm: 165, over: v === s.versions ? s.over : undefined });
      store.scripts.addVersion({ scriptId: s.id, version: v, body, gate: deterministicGate(body), createdAt: new Date(Date.parse(created) + v * 3 * HOUR).toISOString(), editDiff: v > 1 ? '@@ hook @@\n-I added memory to my agent\n+I gave my agent a memory' : null });
    }
    if (publishedPost) {
      const m = store.measures.get(publishedPost.id);
      for (const d of [1, 3, 7]) store.outcomes.add({ scriptId: s.id, postId: publishedPost.id, capturedAt: new Date(Date.parse(publishedPost.postedAt!) + d * DAY).toISOString(), breakout: m?.breakout ?? null, depth: m?.depth ?? null });
    }
  }
  return plan.length;
}

function seedRunsAndSpend(store: LabStore, anchor: Date, r: Rand): number {
  const T = anchor.getTime();
  let n = 0;
  const add = (day: number, minute: number, kind: Parameters<LabStore['runs']['insert']>[0]['kind'], actor: string | null, items: number | null, provider: 'apify' | 'stt' | 'llm' | null, cost: number, status: 'succeeded' | 'failed' | 'timed_out' = 'succeeded') => {
    n++;
    const id = `fx-run-${pad(n)}`;
    const started = T - day * DAY - (T % DAY) + 6 * HOUR + minute * 60_000;
    if (started > T) return;
    const finished = started + r.int(40, 400) * 1000;
    store.runs.insert({ id, kind, apifyRunId: provider === 'apify' ? `fxApify${pad(n)}` : null, datasetId: provider === 'apify' ? `fxDs${pad(n)}` : null, actor, input: {}, status, items, costUsd: provider ? cost : null, dry: false, startedAt: new Date(started).toISOString(), finishedAt: new Date(finished).toISOString(), error: status === 'succeeded' ? null : status === 'timed_out' ? 'Apify run timed out after 300 s' : 'Actor failed: profile is private' });
    if (provider) store.spend.add({ runId: id, provider, units: items ?? 0, estUsd: null, actualUsd: cost, dry: false, at: new Date(finished).toISOString() });
  };
  for (let day = 27; day >= 0; day--) {
    const ig = r.int(140, 220);
    const tt = r.int(160, 240);
    const yt = r.int(80, 130);
    add(day, 0, 'scrape', POST_ACTORS.instagram.actorId, ig, 'apify', Math.round(ig * 0.0023 * 100) / 100);
    add(day, 4, 'scrape', POST_ACTORS.tiktok.actorId, day === 5 ? 0 : tt, 'apify', day === 5 ? 0.02 : Math.round(tt * 0.003 * 100) / 100, day === 5 ? 'timed_out' : 'succeeded');
    add(day, 9, 'scrape', POST_ACTORS.youtube.actorId, yt, 'apify', Math.round(yt * 0.0025 * 100) / 100);
    add(day, 13, 'profile', PROFILE_ACTORS.instagram!.actorId, 12, 'apify', 0.03);
    add(day, 16, 'transcribe', 'whisper-1', r.int(4, 14), 'stt', Math.round(r.between(0.02, 0.09) * 100) / 100);
    add(day, 21, 'dissect', 'claude-cli', r.int(10, 30), 'llm', 0);
    add(day, 30, 'distill', null, 3, null, 0);
    if (day % 2 === 0) add(day, 33, 'ideas', 'claude-cli', r.int(1, 3), 'llm', 0);
  }
  return n;
}

/* ── v2 extensions of the world (08.7.2): X watch list, one outside push, case-control rows ── */

/**
 * After seedWorld: 12 X watch accounts and one owned post flagged as an outside push (excluded from
 * mining, counted in heroes). lab_controls rows come from section 04's assignVerdicts inside
 * seedWorld (a fixed control seed), so this only reports their count.
 */
export function seedWorldV2(store: LabStore, anchor: Date, watchHandles: readonly string[]): { watch: number; controls: number; exogenous: string | null } {
  const T = anchor.getTime();
  const at = (ms: number) => new Date(ms).toISOString();
  let controlsN = 0;
  let exo: string | null = null;
  store.transaction(() => {
    watchHandles.forEach((handle, i) => {
      store.sources.upsert({ id: `fx-s-watch-x-${handle.replace(/[^a-z0-9]/g, '')}`, kind: 'watch', platform: 'x', handle, url: `https://x.com/${handle}`, displayName: handle, status: 'active', addedAt: at(T - (30 + i) * DAY), reason: null, score: null });
    });

    const posts = store.posts.all();
    const owned = posts.filter((p) => p.isOwned && p.postedAt && T - Date.parse(p.postedAt) > 4 * DAY);
    const flag = owned[owned.length > 3 ? 3 : 0];
    if (flag) {
      store.posts.flagExo(flag.id, 'collab', 'Shared by a partner channel on day 3.', at(Date.parse(flag.postedAt!) + 80 * HOUR));
      exo = flag.id;
    }

    controlsN = store.controls.all().length;
  });
  return { watch: watchHandles.length, controls: controlsN, exogenous: exo };
}
