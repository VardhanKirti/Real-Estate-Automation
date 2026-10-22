import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { LAB_DDL } from '@/lib/db';
import { labStore, type LabStore } from '@/lib/lab/store';
import type { LabPost } from '@/lib/schemas';
import { invalidateModeCache } from '@/lib/paths';
import { DISSECT_PROMPT_VERSION, DissectReplySchema, buildDissectPrompt, dissectCycle, dissectTargets, toDissection, type DissectReply, type DissectRunner } from '@/lib/lab/dissect';
import { dryDissectionReply } from '@/lib/lab/dry-items';

/** Dissection (SPEC §4.5). The claude CLI is never spawned: dry fixtures or an injected runner. */
const KEYS = ['LAB_DRY', 'LAB_DISSECT_MODEL', 'GLADOS_ENV_LOCAL', 'GLADOS_MODE_FILE', 'DEMO_MODE'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-dissect-'));
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
const post = (id: string, over: Partial<LabPost> = {}): LabPost => ({ id, sourceId: 's1', platform: 'tiktok', externalId: id, url: `https://x.test/${id}`, postedAt: NOW.toISOString(), caption: 'Nobody tells you what agent memory costs', contentType: 'video', thumbnailUrl: null, mediaUrl: null, durationS: 45, isOwned: false, ...over });
const reply = (over: Partial<DissectReply> = {}): DissectReply => DissectReplySchema.parse({ ...dryDissectionReply({ externalId: 'x', caption: 'agent memory', contentType: 'video' }, true), ...over });

/** Tracked posts get a lab_controls row (04 5.2: only owned posts, cases and controls are dissected) unless `sampled` is false. */
function storeWith(posts: LabPost[], sampled = true): LabStore {
  const db = new Database(':memory:');
  db.exec(LAB_DDL);
  const s = labStore(db);
  for (const p of posts) {
    s.posts.upsert(p);
    if (sampled && !p.isOwned) s.controls.upsert({ postId: p.id, role: 'control', stratum: `${p.sourceId}|2026-10`, samplingProb: 0.1, eligibleN: 1, drawnN: 1, seed: 'seed', verdictAgeH: 168, verdictRatio: 1, drawnAt: NOW.toISOString(), status: 'selected', measureVersion: 'measure-v2' });
  }
  return s;
}

describe('the prompt', () => {
  test('carries the caption and transcript, the version, every enum; never a metric', () => {
    const p = buildDissectPrompt(post('a'), { text: 'I gave my agent a memory and it cost me forty dollars', status: 'done' });
    expect(p).toContain('agent memory costs');
    expect(p).toContain('forty dollars');
    expect(p).toContain(`prompt_version: ${DISSECT_PROMPT_VERSION}`);
    expect(p).toContain('results_first');
    expect(p).toContain('tutorial_walkthrough');
    expect(p).not.toMatch(/views|likes|breakout/i);
  });
  test('without a transcript it asks for no beats', () => {
    expect(buildDissectPrompt(post('a'), null)).toContain('transcript: none');
    expect(buildDissectPrompt(post('a'), { text: '', status: 'none' })).toContain('"beats": []');
  });
});

describe('the reply schema and mapping', () => {
  test('an enum outside §4.5 fails validation (claudeJson then retries once)', () => {
    expect(DissectReplySchema.safeParse({ ...reply(), hook_form: 'storytime' }).success).toBe(false);
    expect(DissectReplySchema.safeParse({ ...reply(), format_confidence: 1.4 }).success).toBe(false);
  });

  test('maps to the stored row with model id, prompt version and confidences; beats normalised; exactly one primary topic', () => {
    const r = reply({
      beats: [
        { start_pct: 40, end_pct: 100, type: 'demo', summary: 'demo' },
        { start_pct: 0, end_pct: 10, type: 'hook', summary: 'hook' },
        { start_pct: 5, end_pct: 40, type: 'reveal', summary: 'overlaps' },
      ],
      topics: [
        { topic: ' agent memory ', angle: 'the cost', is_primary: true },
        { topic: 'pricing', angle: 'per user', is_primary: true },
      ],
    });
    const { dissection, topics } = toDissection(r, 'p1', { modelId: 'm', hasTranscript: true, now: NOW });
    expect(dissection).toMatchObject({ postId: 'p1', modelId: 'm', promptVersion: DISSECT_PROMPT_VERSION, analysedAt: NOW.toISOString() });
    expect(dissection.beats.map((b) => [b.type, b.startPct, b.endPct])).toEqual([
      ['hook', 0, 10],
      ['reveal', 10, 40],
      ['demo', 40, 100],
    ]);
    expect(dissection.confidences).toMatchObject({ format: r.format_confidence, transcript: 1 });
    expect(topics.map((t) => [t.topic, t.isPrimary])).toEqual([
      ['agent memory', true],
      ['pricing', false],
    ]);
  });

  test('caption-only: beats dropped whatever the model said, transcript confidence 0, noted', () => {
    const { dissection } = toDissection(reply(), 'p1', { modelId: 'm', hasTranscript: false, now: NOW });
    expect(dissection.beats).toEqual([]);
    expect(dissection.confidences.transcript).toBe(0);
    expect(dissection.qualityNotes).toMatch(/^caption-only/);
  });
});

describe('dissectCycle', () => {
  test('targets: undissected only, owned first, then transcribed, then newest', () => {
    const s = storeWith([post('old', { postedAt: '2026-10-01T00:00:00.000Z' }), post('new'), post('mine', { isOwned: true, postedAt: '2026-09-01T00:00:00.000Z' }), post('heard', { postedAt: '2026-09-02T00:00:00.000Z' }), post('done')]);
    s.transcripts.upsert({ postId: 'heard', text: 'words', wordCount: 1, wpm: null, provider: 'whisper-1', costUsd: 0, status: 'done' });
    s.dissections.upsert(toDissection(reply(), 'done', { modelId: 'm', hasTranscript: true, now: NOW }).dissection);
    expect(dissectTargets(s).map((p) => p.id)).toEqual(['mine', 'heard', 'new', 'old']);
  });

  test('v2 (04 5.2): a tracked post that is neither a case nor a control is never dissected', () => {
    const s = storeWith([post('free'), post('mine', { isOwned: true })], false);
    expect(dissectTargets(s).map((p) => p.id)).toEqual(['mine']);
  });

  test('v2 (04 6.3, AC-04-27): outcome cues never reach the prompt', () => {
    const p = buildDissectPrompt(post('a', { caption: 'This blew up, 2.3M views and 40k likes' }), null);
    for (const cue of ['2.3M', '40k', 'blew up', 'views', '2300000', '40000']) expect(p).not.toContain(cue);
    expect(p).toContain('[redacted]');
    expect(DISSECT_PROMPT_VERSION).toBe('dissect-v1.1');
  });

  test('dry: the fixture reply, modelId dry-fixture, a 0-cost dry llm run; the CLI is never called', async () => {
    process.env.LAB_DRY = '1';
    const s = storeWith([post('a')]);
    let called = 0;
    const runner: DissectRunner = async () => {
      called++;
      return { ok: false, unavailable: true, error: 'must not run' };
    };
    const r = await dissectCycle({ store: s, now: NOW, runner });
    expect(r.done).toBe(1);
    expect(called).toBe(0);
    expect(s.dissections.get('a')).toMatchObject({ modelId: 'dry-fixture', promptVersion: DISSECT_PROMPT_VERSION });
    expect(s.topics.forPost('a').filter((t) => t.isPrimary)).toHaveLength(1);
    expect(s.spend.all()[0]).toMatchObject({ provider: 'llm', dry: true, actualUsd: 0 });
  });

  test('live: the runner gets the prompt and schema; the row records the model id; LAB_DISSECT_MODEL is passed through', async () => {
    process.env.LAB_DISSECT_MODEL = 'sonnet';
    const s = storeWith([post('a')]);
    const seen: { prompt: string; model?: string }[] = [];
    const runner: DissectRunner = async (prompt, _schema, o) => {
      seen.push({ prompt, model: o.model });
      return { ok: true, data: reply() };
    };
    await dissectCycle({ store: s, now: NOW, runner });
    expect(seen[0].model).toBe('sonnet');
    expect(seen[0].prompt).toContain('transcript: none');
    expect(s.dissections.get('a')).toMatchObject({ modelId: 'sonnet', beats: [] });
    expect(s.runs.recent()[0]).toMatchObject({ kind: 'dissect', actor: 'sonnet', dry: false, status: 'succeeded', costUsd: 0 });
  });

  test('a missing claude CLI fails the run once and stops the cycle (every post would fail the same way)', async () => {
    const s = storeWith([post('a'), post('b')]);
    const runner: DissectRunner = async () => ({ ok: false, unavailable: true, error: 'spawn claude ENOENT' });
    const r = await dissectCycle({ store: s, now: NOW, runner });
    expect(r).toMatchObject({ done: 0, failed: 1 });
    expect(r.errors[0]).toMatch(/unavailable/);
    expect(s.runs.recent()[0].status).toBe('failed');
    expect(s.dissections.all()).toHaveLength(0);
  });

  test('a bad reply fails that post only', async () => {
    const s = storeWith([post('a'), post('b', { postedAt: '2026-10-09T00:00:00.000Z' })]);
    let n = 0;
    const runner: DissectRunner = async () => (n++ === 0 ? { ok: false, unavailable: false, error: 'reply was not valid JSON' } : { ok: true, data: reply() });
    const r = await dissectCycle({ store: s, now: NOW, runner });
    expect(r).toMatchObject({ done: 1, failed: 1 });
  });
});
