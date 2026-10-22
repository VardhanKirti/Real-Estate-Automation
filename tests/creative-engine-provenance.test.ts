import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CampaignSchema } from '@/lib/creative-engine/schemas';
import { createCampaign, createWorkflow, deleteCampaign, readCampaign, readWorkflows, appendLedger, readLedger, assetRoot } from '@/lib/creative-engine/store';
import { startRun, listRuns } from '@/lib/creative-engine/runs';
import { hiddenCampaigns, hiddenLine, pickInitialCampaign } from '@/lib/creative-engine/pick';
import { statusCard } from '@/lib/creative-engine/status-card';
import { buildHealthSnapshot } from '@/lib/creative-engine/snapshot';
import { DRY_POOL } from '@/lib/creative-engine/fixtures';

/** S03 FR-1 to FR-3, FR-6, FR-17, FR-18, FR-20 and SPEC §5 C8. */

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-prov-'));
  process.env.CREATIVE_ENGINE_STORE_DIR = dir;
  process.env.CREATIVE_ENGINE_ASSET_DIR = path.join(dir, 'assets');
});
afterEach(() => {
  delete process.env.CREATIVE_ENGINE_STORE_DIR;
  delete process.env.CREATIVE_ENGINE_ASSET_DIR;
  delete process.env.CREATIVE_ENGINE_DRY;
  delete process.env.DEMO_MODE;
  fs.rmSync(dir, { recursive: true, force: true });
});

const research = (expandedBy: 'dry' | 'claude') => ({ depth: 'light', expandedBy, minDays: 21, format: 'any', probes: [], pool: DRY_POOL, pooled: 5, apiCalls: 0, ranAt: '2026-10-01T00:00:00.000Z' });
const legacy = (expandedBy: 'dry' | 'claude' | null) => ({ id: 'ae-legacy', name: 'old', concept: { text: 'an old concept' }, research: expandedBy ? research(expandedBy) : null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' });

describe('campaign origin (FR-1)', () => {
  test('a legacy campaign with dry research and no origin reads as dry, without a rewrite', () => {
    expect(CampaignSchema.parse(legacy('dry')).origin).toBe('dry');
    expect(CampaignSchema.parse(legacy('claude')).origin).toBe('live');
    expect(CampaignSchema.parse(legacy(null)).origin).toBe('live');
  });
  test('a stored origin wins over the derivation', () => {
    expect(CampaignSchema.parse({ ...legacy('dry'), origin: 'live' }).origin).toBe('live');
  });
  test('created under CREATIVE_ENGINE_DRY=1 the campaign is dry; otherwise live', () => {
    process.env.CREATIVE_ENGINE_DRY = '1';
    expect(createCampaign({ text: 'a lamp that dims', product: '', audience: '', goal: 'unset' }).origin).toBe('dry');
    delete process.env.CREATIVE_ENGINE_DRY;
    expect(createCampaign({ text: 'a lamp that dims', product: '', audience: '', goal: 'unset' }).origin).toBe('live');
  });
  test('created in Filming the campaign is filming', () => {
    process.env.DEMO_MODE = '1';
    expect(createCampaign({ text: 'a lamp that dims', product: '', audience: '', goal: 'unset' }).origin).toBe('filming');
  });
});

describe('pickInitialCampaign (FR-2)', () => {
  const s = (id: string, origin: 'live' | 'dry' | 'filming', updatedAt: string) => ({ id, origin, updatedAt });
  const list = [s('dry-new', 'dry', '2026-10-05'), s('live-old', 'live', '2026-10-01'), s('live-mid', 'live', '2026-10-03'), s('film', 'filming', '2026-09-01')];
  test('the newest live campaign wins; dry ones never auto-open', () => {
    expect(pickInitialCampaign(list, { dry: false, filming: false })?.id).toBe('live-mid');
  });
  test('only dry campaigns: nothing opens, unless this is a dry session', () => {
    const only = [s('d1', 'dry', '2026-10-01'), s('d2', 'dry', '2026-10-02')];
    expect(pickInitialCampaign(only, { dry: false, filming: false })).toBeNull();
    expect(pickInitialCampaign(only, { dry: true, filming: false })?.id).toBe('d2');
  });
  test('Filming opens its own campaign first', () => {
    expect(pickInitialCampaign(list, { dry: false, filming: true })?.id).toBe('film');
  });
  test('the hidden line counts what was kept back', () => {
    const hidden = hiddenCampaigns(list, { dry: false, filming: false });
    expect(hidden.map((h) => h.id)).toEqual(['dry-new', 'film']);
    expect(hiddenLine([{ origin: 'dry' }])).toBe('1 dry-run campaign hidden.');
    expect(hiddenLine([{ origin: 'dry' }, { origin: 'dry' }])).toBe('2 dry-run campaigns hidden.');
    expect(hiddenLine([{ origin: 'dry' }, { origin: 'filming' }])).toBe('2 campaigns hidden.');
    expect(hiddenLine([])).toBeNull();
  });
});

describe('status card precedence (C8)', () => {
  const base = { sample: false, dryEnv: false, filming: false, foreplayConfigured: true, campaign: null };
  test('sample > dry session > dry campaign > Filming > Foreplay missing > live', () => {
    expect(statusCard({ ...base, sample: true, dryEnv: true }).kind).toBe('sample');
    expect(statusCard({ ...base, dryEnv: true, campaign: { origin: 'dry', assets: 0 } }).kind).toBe('dry-session');
    expect(statusCard({ ...base, filming: true, campaign: { origin: 'dry', assets: 5 } })).toMatchObject({ kind: 'dry-campaign', title: 'Dry-run data', body: "This campaign's research came from fixtures. Its delivered videos are real." });
    expect(statusCard({ ...base, campaign: { origin: 'dry', assets: 0 } }).body).toBe("This campaign's research came from fixtures.");
    expect(statusCard({ ...base, filming: true, foreplayConfigured: false })).toMatchObject({ kind: 'filming', badge: 'Filming', title: 'Dry runs, nothing charged' });
    // Filming forces dry (Q-ENG-7): its card never claims live credits.
    expect(JSON.stringify(statusCard({ ...base, filming: true }))).not.toMatch(/Live|Credits in play/);
    expect(statusCard({ ...base, foreplayConfigured: false })).toMatchObject({ kind: 'arcads-only', title: 'Arcads only' });
    expect(statusCard(base)).toMatchObject({ kind: 'live', title: 'Credits in play' });
  });
  test('no card ever says "Real"', () => {
    for (const k of [true, false]) for (const f of [true, false]) for (const fp of [true, false]) {
      const c = statusCard({ ...base, dryEnv: k, filming: f, foreplayConfigured: fp });
      expect(`${c.title} ${c.body}`).not.toMatch(/\bReal\b/);
    }
  });
});

describe('health snapshot honesty (FR-18, B24)', () => {
  test('no Foreplay number while Foreplay is not configured', async () => {
    const h = await buildHealthSnapshot();
    if (!h.foreplay.configured) {
      expect(h.foreplay.remaining).toBeNull();
      expect(h.foreplay.total).toBeNull();
    }
    expect(typeof h.filming).toBe('boolean');
    expect(h.dryEnv).toBe(false);
  });
});

describe('hard delete (FR-6, Q-ENG-4)', () => {
  test('removes the JSON, its asset folder and its workflows; runs and ledger stay', () => {
    const c = createCampaign({ text: 'a throwaway concept', product: '', audience: '', goal: 'unset' });
    const other = createCampaign({ text: 'a concept that stays', product: '', audience: '', goal: 'unset' });
    createWorkflow({ campaignId: c.id, name: 'mine' });
    createWorkflow({ campaignId: other.id, name: 'theirs' });
    fs.mkdirSync(path.join(assetRoot(), c.id), { recursive: true });
    fs.writeFileSync(path.join(assetRoot(), c.id, 'a.mp4'), 'x');
    startRun({ campaignId: c.id, kind: 'brief', title: 'kept' });
    appendLedger({ at: new Date().toISOString(), kind: 'motion', model: 'seedance-2.0', durationSec: 8, creditsCharged: 3, runId: 'r1', dry: false, source: 'response' });

    deleteCampaign(c.id);

    expect(readCampaign(c.id)).toBeNull();
    expect(fs.existsSync(path.join(assetRoot(), c.id))).toBe(false);
    expect(readWorkflows(c.id)).toEqual([]);
    expect(readWorkflows(other.id)).toHaveLength(1);
    expect(listRuns(c.id)).toHaveLength(1);
    expect(readLedger()).toHaveLength(1);
    expect(readCampaign(other.id)).not.toBeNull();
  });
});
