import { describe, expect, test } from 'vitest';
import { ApifyError, POST_ACTORS, PROFILE_ACTORS, SEARCH_ACTORS, SINGLE_POST_INPUT, SINGLE_RUN_ACTORS, actorPath, createApifyClient, isTerminal, labRunStatus, type FetchLike } from '@/lib/lab/apify-client';
import fs from 'node:fs';

/** A fake fetch that records calls and answers from a script. Nothing leaves the process. */
function fakeFetch(answers: { match: RegExp; status?: number; body: unknown }[]) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const f: FetchLike = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    const a = answers.find((x) => x.match.test(url));
    const status = a?.status ?? (a ? 200 : 404);
    const text = JSON.stringify(a?.body ?? { error: { message: 'not found' } });
    return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text), text: async () => text };
  };
  return { f, calls };
}

const RUN = { data: { id: 'run123', actId: 'act1', status: 'RUNNING', statusMessage: 'Scraping 3 of 10 profiles', startedAt: '2026-10-10T10:00:00.000Z', finishedAt: null, defaultDatasetId: 'ds9', usageTotalUsd: 0.0123, chargedEventCounts: { post: 12, 'post-details': 12 }, options: { maxTotalChargeUsd: 1.5 }, stats: { runTimeSecs: 41.5, itemCount: 99 } } };

describe('Apify REST client (fake fetch)', () => {
  test('startRun posts the input to /acts/{owner~name}/runs with the bearer token and caps in the query', async () => {
    const { f, calls } = fakeFetch([{ match: /\/acts\/apify~instagram-post-scraper\/runs/, status: 201, body: RUN }]);
    const c = createApifyClient({ token: 'tok_test', fetch: f });
    const input = POST_ACTORS.instagram.buildInput(['maker.one'], 50);
    const run = await c.startRun(POST_ACTORS.instagram.actorId, input, { maxItems: 50, maxTotalChargeUsd: 1.5, timeoutSecs: 300 });
    expect(run).toMatchObject({ id: 'run123', status: 'RUNNING', defaultDatasetId: 'ds9', usageTotalUsd: 0.0123, chargedEventCounts: { post: 12, 'post-details': 12 }, statusMessage: 'Scraping 3 of 10 profiles', runTimeSecs: 41.5, maxTotalChargeUsd: 1.5 });
    // AC-09-19: there is no stats.itemCount on the run object; it is never read
    expect(run).not.toHaveProperty('itemCount');
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://api.apify.com/v2/acts/apify~instagram-post-scraper/runs?maxItems=50&maxTotalChargeUsd=1.5&timeout=300');
    expect(calls[0].headers.Authorization).toBe('Bearer tok_test');
    expect(JSON.parse(calls[0].body!)).toEqual({ username: ['maker.one'], resultsLimit: 50, skipPinnedPosts: false, scrapeComments: false, dataDetailLevel: 'detailedData' });
  });

  test('getRun and datasetItems read the run and its items', async () => {
    const { f, calls } = fakeFetch([
      { match: /\/actor-runs\/run123$/, body: { data: { ...RUN.data, status: 'SUCCEEDED', usageTotalUsd: 0.21 } } },
      { match: /\/datasets\/ds9\/items/, body: [{ id: 'a' }, { id: 'b' }] },
    ]);
    const c = createApifyClient({ token: 't', fetch: f, base: 'https://api.example/v2/' });
    const run = await c.getRun('run123');
    expect(run.status).toBe('SUCCEEDED');
    expect(run.usageTotalUsd).toBe(0.21);
    expect(await c.datasetItems('ds9', { limit: 100, offset: 50 })).toHaveLength(2);
    expect(calls[1].url).toBe('https://api.example/v2/datasets/ds9/items?clean=true&format=json&offset=50&limit=100');
  });

  test('datasetInfo reads itemCount; abortRun posts to /abort (09.4.3, 09.4.5)', async () => {
    const { f, calls } = fakeFetch([
      { match: /\/datasets\/ds9$/, body: { data: { itemCount: 37, cleanItemCount: 37 } } },
      { match: /\/actor-runs\/run123\/abort$/, body: { data: { ...RUN.data, status: 'ABORTED' } } },
    ]);
    const c = createApifyClient({ token: 't', fetch: f });
    expect(await c.datasetInfo('ds9')).toEqual({ itemCount: 37 });
    expect((await c.abortRun('run123')).status).toBe('ABORTED');
    expect(calls[1]).toMatchObject({ method: 'POST', url: 'https://api.apify.com/v2/actor-runs/run123/abort' });
  });

  test('AC-09-19: toRun reads chargedEventCounts, statusMessage and stats.runTimeSecs, never stats.itemCount', () => {
    const src = fs.readFileSync('lib/lab/apify-client.ts', 'utf8');
    const body = src.slice(src.indexOf('function toRun('), src.indexOf('export type StartOpts'));
    for (const k of ['chargedEventCounts', 'statusMessage', 'runTimeSecs', 'maxTotalChargeUsd']) expect(body).toContain(k);
    expect(body).not.toContain('itemCount');
  });

  test('an error answer becomes ApifyError with the status and Apify’s message', async () => {
    const { f } = fakeFetch([{ match: /runs/, status: 402, body: { error: { type: 'not-enough-usage', message: 'Monthly usage hard limit exceeded' } } }]);
    const c = createApifyClient({ token: 't', fetch: f });
    const err = await c.startRun('apify/instagram-post-scraper', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApifyError);
    expect(err.status).toBe(402);
    expect(err.message).toContain('Monthly usage hard limit exceeded');
  });

  test('a reply without a run id is an error, not a silent success', async () => {
    const { f } = fakeFetch([{ match: /runs/, body: { data: {} } }]);
    await expect(createApifyClient({ token: 't', fetch: f }).startRun('a/b', {})).rejects.toThrow('no run id');
  });

  test('dataset items that are not a list are rejected', async () => {
    const { f } = fakeFetch([{ match: /items/, body: { data: [] } }]);
    await expect(createApifyClient({ token: 't', fetch: f }).datasetItems('x')).rejects.toThrow('not a list');
  });

  test('status mapping and terminal states', () => {
    expect(labRunStatus('READY')).toBe('queued');
    expect(labRunStatus('RUNNING')).toBe('running');
    expect(labRunStatus('SUCCEEDED')).toBe('succeeded');
    expect(labRunStatus('TIMED-OUT')).toBe('timed_out');
    expect(isTerminal('RUNNING')).toBe(false);
    expect(isTerminal('ABORTED')).toBe(true);
    expect(actorPath('clockworks/tiktok-scraper')).toBe('clockworks~tiktok-scraper');
  });
});

describe('actor inputs match the public input schemas (04 2.2, AC-04-3)', () => {
  test('TikTok: profiles, resultsPerPage, covers off, downloads off by default and on for transcription', () => {
    expect(POST_ACTORS.tiktok.actorId).toBe('clockworks/tiktok-scraper');
    expect(POST_ACTORS.tiktok.buildInput(['a'], 15)).toEqual({ profiles: ['a'], resultsPerPage: 15, shouldDownloadVideos: false, shouldDownloadCovers: false });
    expect(POST_ACTORS.tiktok.buildInput(['a'], 15, { downloadVideos: true }).shouldDownloadVideos).toBe(true);
    expect(SINGLE_POST_INPUT.tiktok(['https://www.tiktok.com/@a/video/1'], ['a'])).toEqual({ postURLs: ['https://www.tiktok.com/@a/video/1'], resultsPerPage: 1, shouldDownloadVideos: false, shouldDownloadCovers: false });
  });
  test('YouTube: /videos and /shorts start urls, no downloadSubtitles, never always-transcribe', () => {
    const input = POST_ACTORS.youtube.buildInput(['@chan'], 30);
    expect(input).toEqual({ startUrls: [{ url: 'https://www.youtube.com/@chan/videos' }, { url: 'https://www.youtube.com/@chan/shorts' }], maxResults: 30, maxResultsShorts: 30, subtitlesLanguage: 'en' });
    expect(input).not.toHaveProperty('downloadSubtitles');
    expect(SEARCH_ACTORS.youtube!.buildInput(['ai'], 5)).not.toHaveProperty('downloadSubtitles');
  });
  test('X: maxItems 50 or more, no maxTweets, replies filtered in the query', () => {
    const input = POST_ACTORS.twitter.buildInput(['@who'], 20);
    expect(input).toEqual({ searchTerms: ['from:who -filter:replies'], maxItems: 50, sort: 'Latest' });
    expect(input).not.toHaveProperty('maxTweets');
    expect(input).not.toHaveProperty('includeReplies');
    expect(SINGLE_RUN_ACTORS).toEqual(['apidojo/tweet-scraper']);
  });
  test('LinkedIn: targetUrls, no profileUrls, reactions and comments off', () => {
    const input = POST_ACTORS.linkedin.buildInput(['someone'], 10);
    expect(input).toEqual({ targetUrls: ['https://www.linkedin.com/in/someone/'], maxPosts: 10, includeReposts: false, scrapeReactions: false, scrapeComments: false });
    expect(input).not.toHaveProperty('profileUrls');
  });
  test('Instagram: every input (profile and single post) sends dataDetailLevel detailedData (C19)', () => {
    expect(POST_ACTORS.instagram.buildInput(['a'], 5).dataDetailLevel).toBe('detailedData');
    expect(SINGLE_POST_INPUT.instagram(['https://www.instagram.com/reel/abc/'], ['a'])).toMatchObject({ username: ['https://www.instagram.com/reel/abc/'], dataDetailLevel: 'detailedData' });
  });
  test('actor ids; verified is read from actor_fields, not a constant', () => {
    expect(POST_ACTORS.youtube.actorId).toBe('streamers/youtube-scraper');
    expect(POST_ACTORS.twitter.actorId).toBe('apidojo/tweet-scraper');
    expect(POST_ACTORS.linkedin.actorId).toBe('harvestapi/linkedin-profile-posts');
    expect(Object.values(POST_ACTORS).some((a) => 'verified' in a)).toBe(false);
    expect(PROFILE_ACTORS.instagram && 'verified' in PROFILE_ACTORS.instagram).toBe(false);
  });
});
