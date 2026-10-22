import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { LAB_DDL } from '@/lib/db';
import { labStore, type LabStore } from '@/lib/lab/store';
import type { LabSource } from '@/lib/schemas';
import { invalidateModeCache } from '@/lib/paths';
import { cosine, discoveryTerms, followerSlope, formatFamilies, ingestSearch, planSearch, rescoreSuggestions, scoreCandidate, similarity, startSearches, termVector, tokens } from '@/lib/lab/discover';
import { drySearchItems } from '@/lib/lab/dry-items';
import { parseFeed } from '@/lib/lab/sources';

/** Discovery (SPEC §4.8): terms, search, candidates, scoring. Search runs are dry or fake only. */
const KEYS = ['LAB_DRY', 'GLADOS_ENV_LOCAL', 'GLADOS_MODE_FILE', 'DEMO_MODE'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-disc-'));
  process.env.GLADOS_ENV_LOCAL = path.join(dir, '.env.local');
  process.env.GLADOS_MODE_FILE = path.join(dir, '.glados-mode');
  process.env.DEMO_MODE = '0';
  invalidateModeCache();
});
afterEach(() => {
  for (const k of KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
  invalidateModeCache();
});

const NOW = new Date('2026-10-10T12:00:00.000Z');
const src = (id: string, kind: LabSource['kind'], platform: LabSource['platform'], handle: string, status: LabSource['status'] = 'active'): LabSource => ({ id, kind, platform, handle, url: null, displayName: handle, status, addedAt: NOW.toISOString(), reason: null, score: null });
const fresh = (): LabStore => {
  const db = new Database(':memory:');
  db.exec(LAB_DDL);
  return labStore(db);
};

function withOwnedTopics(store: LabStore) {
  store.sources.upsert(src('me', 'owned', 'tiktok', 'me'));
  const topics = ['agent memory', 'agent memory', 'voice cloning'];
  topics.forEach((t, i) => {
    const id = `own-${i}`;
    store.posts.upsert({ id, sourceId: 'me', platform: 'tiktok', externalId: id, url: `https://x.test/${id}`, postedAt: NOW.toISOString(), caption: `${t} explained #${t.replace(/\s/g, '')}`, contentType: 'video', thumbnailUrl: null, mediaUrl: null, durationS: 40, isOwned: true });
    store.topics.replaceForPost(id, [{ postId: id, topic: t, angle: 'the cost', isPrimary: true, clusterId: null }]);
    store.dissections.upsert({ postId: id, format: i < 2 ? 'tutorial_walkthrough' : 'talking_head', hookForm: 'results_first', emotionalTrigger: 'curiosity', hookChannel: 'spoken', hookText: '', firstFrameText: '', structureType: 'tutorial', beats: [], pacing: 'conversational', pillar: 'educational', ctaType: 'none', tension: null, confidences: {}, qualityNotes: '', modelId: 'm', promptVersion: 'v', analysedAt: NOW.toISOString() });
  });
}

describe('similarity (token-overlap cosine; no embedding provider)', () => {
  test('tokens drop stop and short words and fold plurals', () => {
    expect(tokens('The Agents and their memory, for AI')).toEqual(['agent', 'their', 'memory']);
  });
  test('cosine is 1 for the same text, 0 for disjoint, symmetric', () => {
    expect(similarity(['agent memory costs'], ['agent memory costs'])).toBe(1);
    expect(similarity(['agent memory'], ['banana bread'])).toBe(0);
    const a = termVector(['agent memory cost']);
    const b = termVector(['memory for voice agents']);
    expect(cosine(a, b)).toBeCloseTo(cosine(b, a));
    expect(cosine(new Map(), b)).toBe(0);
  });
});

describe('scoring', () => {
  test('score = format share × overlap × breakout factor × growth, with the reason in words', () => {
    const s = scoreCandidate({ sampled: 10, inFamilies: 8, familyLabel: 'AI tool tutorials', overlap: 0.6, breakouts: 3, followerSlope: 0.1 });
    expect(s.score).toBeCloseTo(0.8 * 0.6 * 0.8 * (1.1 / 1.5), 3);
    expect(s.reason).toBe('8 of 10 sampled posts are AI tool tutorials, 3 broke out, topic overlap 60%, followers +10% a month');
  });
  test('before a sample: neutral format share, no breakout credit, says not sampled', () => {
    const s = scoreCandidate({ sampled: 0, inFamilies: 0, familyLabel: null, overlap: 0.5, breakouts: 0, followerSlope: null });
    expect(s.score).toBeCloseTo(0.5 * 0.5 * 0.5 * (1 / 1.5), 3);
    expect(s.reason).toBe('not sampled yet, topic overlap 50%');
  });
  test('follower slope per 30 days needs two snapshots a day apart', () => {
    expect(followerSlope([{ capturedAt: '2026-10-01T00:00:00Z', followers: 1000 }])).toBeNull();
    expect(followerSlope([{ capturedAt: '2026-10-01T00:00:00Z', followers: 1000 }, { capturedAt: '2026-10-01T05:00:00Z', followers: 1100 }])).toBeNull();
    expect(followerSlope([{ capturedAt: '2026-10-01T00:00:00Z', followers: 1000 }, { capturedAt: '2026-10-16T00:00:00Z', followers: 1100 }])).toBeCloseTo(0.2);
  });
});

describe('terms and search plan', () => {
  test('terms are your most frequent primary topics; families are formats with 10%+ of your posts', () => {
    const s = fresh();
    expect(discoveryTerms(s)).toEqual([]);
    withOwnedTopics(s);
    expect(discoveryTerms(s)).toEqual(['agent memory', 'voice cloning']);
    expect(formatFamilies(s)).toEqual(['tutorial_walkthrough', 'talking_head']);
  });

  test('one search per platform you are on (search actor permitting); Instagram gets hashtags', () => {
    const s = fresh();
    withOwnedTopics(s);
    const plan = planSearch(s, ['agent memory']);
    expect(plan.map((g) => g.platform)).toEqual(['tiktok']);
    expect(plan[0].actorInput).toMatchObject({ searchQueries: ['agent memory'], resultsPerPage: 20 });
    s.sources.upsert(src('ig', 'owned', 'instagram', 'me2'));
    expect(planSearch(s, ['agent memory']).find((g) => g.platform === 'instagram')?.actorInput).toMatchObject({ hashtags: ['agentmemory'] });
  });
});

describe('candidates', () => {
  test('search results become suggestions; known creators, dismissed ones included, are never suggested again', () => {
    const s = fresh();
    withOwnedTopics(s);
    const items = drySearchItems('tiktok', ['agent memory'], 20, NOW);
    const first = ingestSearch(s, 'tiktok', items, ['agent memory'], NOW);
    expect(first.candidates).toBeGreaterThan(0);
    const sugg = s.sources.all('suggested');
    expect(sugg[0].reason).toMatch(/^Found in TikTok search for "agent memory" \(\d+ posts?\); not sampled yet$/);
    expect(sugg.every((x) => x.score !== null && x.score > 0)).toBe(true);
    s.sources.setStatus(sugg[0].id, 'dismissed');
    const again = ingestSearch(s, 'tiktok', items, ['agent memory'], new Date(NOW.getTime() + 1000));
    expect(again.candidates).toBe(0);
    expect(again.skippedKnown).toBe(first.candidates);
    expect(s.sources.all('suggested')).toHaveLength(first.candidates);
  });

  test('dry search through the gate: a 0-cost dry search run, suggestions written', async () => {
    process.env.LAB_DRY = '1';
    const s = fresh();
    withOwnedTopics(s);
    const out = await startSearches({ store: s, client: null, now: NOW }, planSearch(s, discoveryTerms(s)));
    expect(out[0].run).toMatchObject({ kind: 'search', dry: true, status: 'succeeded', actor: 'clockworks/tiktok-scraper' });
    expect(s.sources.all('suggested').length).toBeGreaterThan(0);
  });

  test('rescore after the 10-post sample: format share and breakouts in the reason', () => {
    const s = fresh();
    withOwnedTopics(s);
    s.sources.upsert(src('cand', 'suggested', 'tiktok', 'cand'));
    for (let i = 0; i < 10; i++) {
      const id = `c-${i}`;
      s.posts.upsert({ id, sourceId: 'cand', platform: 'tiktok', externalId: id, url: `https://x.test/${id}`, postedAt: NOW.toISOString(), caption: 'agent memory walkthrough', contentType: 'video', thumbnailUrl: null, mediaUrl: null, durationS: 40, isOwned: false });
      if (i < 8) s.dissections.upsert({ postId: id, format: 'tutorial_walkthrough', hookForm: 'results_first', emotionalTrigger: 'curiosity', hookChannel: 'spoken', hookText: '', firstFrameText: '', structureType: 'tutorial', beats: [], pacing: 'conversational', pillar: 'educational', ctaType: 'none', tension: null, confidences: {}, qualityNotes: '', modelId: 'm', promptVersion: 'v', analysedAt: NOW.toISOString() });
      s.measures.upsert({ postId: id, depth: 0.05, breakout: i < 3 ? 4 : 1, breakoutLo: null, breakoutHi: null, baselineN: 9, baselineConfidence: 'low', reach: null, velocity: null, trajectory: null, quadrant: null, isBreakout: false, computedAt: NOW.toISOString() });
    }
    expect(rescoreSuggestions(s)).toBe(1);
    expect(s.sources.get('cand')?.reason).toMatch(/^8 of 10 sampled posts are in your formats, 3 broke out, topic overlap \d+%$/);
  });
});

describe('feeds', () => {
  test('feed keys: subreddits, changelog URLs, phrases', () => {
    expect(parseFeed('reddit', 'r/LocalLLaMA')).toEqual({ platform: 'reddit', handle: 'localllama', url: 'https://www.reddit.com/r/LocalLLaMA/' });
    expect(parseFeed('reddit', 'https://www.reddit.com/r/OpenAI/')).toMatchObject({ handle: 'openai' });
    expect(parseFeed('reddit', 'not a sub!')).toBeNull();
    expect(parseFeed('changelog', 'https://docs.example.test/changelog/')).toMatchObject({ handle: 'docs.example.test/changelog' });
    expect(parseFeed('changelog', 'nope')).toBeNull();
    expect(parseFeed('keyword_search', '  Agent   Memory ')).toEqual({ platform: 'keyword_search', handle: 'agent memory', url: null });
  });
});
