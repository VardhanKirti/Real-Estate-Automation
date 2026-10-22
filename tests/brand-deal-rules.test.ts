process.env.GLADOS_DB = ':memory:';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { GET, PUT } from '@/app/api/brand-deals/rules/route';
import { POST as restore } from '@/app/api/brand-deals/rules/restore/route';
import { listRuleBackups, patchRules, readRules, writeRules } from '@/lib/brand-deal-rules';
import { getDb } from '@/lib/data';
import type { BrandDealRules } from '@/lib/schemas';

const VALID: BrandDealRules = {
  pass_below: 25,
  qual_criteria: 'The creator makes Instagram Reels about AI automation for a B2B audience of founders and operators.',
  draft_rules:
    'You are the deal agent, negotiating brand deals from the shared inbox. One organic Reel 6.5k; Reel with 30-day usage 8.5k. Never discount unprompted.',
  unique_hints: ['event', 'retainer', 'equity'],
  deal_hints: ['sponsor', 'collab', 'budget'],
  audit_every_days: 3,
  stale_days: 3,
  max_retry_attempts: 8,
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdpilot-rules-'));
  process.env.BDPILOT_RULES = path.join(dir, 'rules.json');
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BDPILOT_RULES;
});

describe('brand-deal rules bridge', () => {
  test('missing daemon dir or file reads as not configured with a reason', () => {
    process.env.BDPILOT_RULES = path.join(dir, 'nope', 'rules.json');
    expect(readRules()).toMatchObject({ configured: false, reason: expect.stringContaining('not installed') });
    process.env.BDPILOT_RULES = path.join(dir, 'rules.json');
    expect(readRules()).toMatchObject({ configured: false, reason: expect.stringContaining('not been generated') });
  });

  test('write backs up the previous file, writes atomically, records a version', () => {
    const db = getDb();
    fs.writeFileSync(path.join(dir, 'rules.json'), JSON.stringify(VALID));
    const v1 = writeRules(db, { ...VALID, pass_below: 30 }, 'raise threshold');
    expect(v1).toMatchObject({ target: 'bdpilot-rules', version: 1, note: 'raise threshold' });
    expect(listRuleBackups()).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'rules.json'), 'utf8')).pass_below).toBe(30);
    expect(fs.readdirSync(dir).some((f) => f.includes('.tmp-'))).toBe(false);
    const read = readRules();
    expect(read.configured && read.rules.pass_below).toBe(30);
  });

  test('a bad partial edit is rejected before anything is written', () => {
    const db = getDb();
    fs.writeFileSync(path.join(dir, 'rules.json'), JSON.stringify(VALID));
    expect(() => patchRules(db, { pass_below: 500 } as Partial<BrandDealRules>, 'bad')).toThrow();
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'rules.json'), 'utf8')).pass_below).toBe(25);
    expect(listRuleBackups()).toHaveLength(0);
  });

  test('GET/PUT/restore routes round-trip and history only grows', async () => {
    fs.writeFileSync(path.join(dir, 'rules.json'), JSON.stringify(VALID));
    const empty = await PUT(new Request('http://test', { method: 'PUT', body: JSON.stringify({ rules: {} }) }));
    expect(empty.status).toBe(400);

    const put = await PUT(
      new Request('http://test', { method: 'PUT', body: JSON.stringify({ rules: { stale_days: 5 }, note: 'give them five days' }) }),
    );
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as { rules: BrandDealRules; version: { version: number } };
    expect(putBody.rules.stale_days).toBe(5);
    expect(putBody.rules.pass_below).toBe(25);
    // the in-memory DB is shared across this file's tests, so count relatively
    const v = putBody.version.version;

    const put2 = await PUT(new Request('http://test', { method: 'PUT', body: JSON.stringify({ rules: { stale_days: 7 } }) }));
    expect(((await put2.json()) as { version: { version: number } }).version.version).toBe(v + 1);

    const got = (await (await GET()).json()) as { configured: boolean; rules: BrandDealRules; versions: { id: string; version: number }[] };
    expect(got.configured).toBe(true);
    expect(got.rules.stale_days).toBe(7);
    expect(got.versions.slice(0, 2).map((x) => x.version)).toEqual([v + 1, v]);

    const res = await restore(new Request('http://test', { method: 'POST', body: JSON.stringify({ versionId: `bdpilot-rules-v${v}` }) }));
    expect(res.status).toBe(200);
    const restored = (await res.json()) as { rules: BrandDealRules; version: { version: number; note: string } };
    expect(restored.rules.stale_days).toBe(5);
    expect(restored.version).toMatchObject({ version: v + 2, note: `restore of v${v}` });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'rules.json'), 'utf8')).stale_days).toBe(5);
  });

  test('PUT on a machine without the daemon returns 409, not a fake success', async () => {
    process.env.BDPILOT_RULES = path.join(dir, 'nope', 'rules.json');
    const res = await PUT(new Request('http://test', { method: 'PUT', body: JSON.stringify({ rules: { stale_days: 5 } }) }));
    expect(res.status).toBe(409);
  });
});
