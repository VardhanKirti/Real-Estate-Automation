import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LAB_SPEND_LINES, LAB_SPEND_PROVIDERS } from '@/lib/schemas';
import { capEnvFor } from '@/lib/lab/spend';
import { LAB_KEYS, LAB_SETTINGS } from '@/lib/lab/setup/keys';

/** AC-08-27: every Lab env name is in .env.example. */
const EXAMPLE = fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf8');
const listed = new Set([...EXAMPLE.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));

/** The 08.6.2 table. */
const TABLE = [
  'LAB_APIFY_CAP_USD', 'LAB_APIFY_SYNC_CAP_USD', 'LAB_APIFY_SNAPSHOTS_CAP_USD', 'LAB_APIFY_X_CAP_USD', 'LAB_APIFY_VERIFY_CAP_USD',
  'LAB_APIFY_RADAR_X_CAP_USD', 'LAB_APIFY_RADAR_TIKTOK_CAP_USD', 'LAB_APIFY_RADAR_PRODUCTHUNT_CAP_USD', 'LAB_STT_CAP_USD', 'LAB_STT_CONTROLS_CAP_USD',
  'LAB_COMMENTS_CAP_USD', 'LAB_DOWNLOADS_CAP_USD', 'LAB_EMBED_CAP_USD', 'LAB_RUN_MAX_USD', 'LAB_COMMENTS', 'LAB_TIKTOK_DOWNLOADS',
  'LAB_TIKTOK_DOWNLOAD_PRICE_USD', 'LAB_EMBED_PROVIDER', 'LAB_FRAMES', 'LAB_JUDGE', 'LAB_JUDGE_MODEL', 'LAB_GROUNDING_CONTROL', 'LAB_COMMENT_SALT',
  'LAB_X_POLL_MIN', 'LAB_BRIEF_TELEGRAM', 'GITHUB_TOKEN', 'GLADOS_TZ', 'LAB_DRY', 'LAB_FIXTURE_SCENARIO', 'LAB_SYNC_WAIT_MIN', 'LAB_DISSECT_MODEL',
];

describe('AC-08-27: every Lab env name is in .env.example', () => {
  test('the 08.6.2 table, every LAB_KEYS field, every LAB_SETTINGS env, every derived cap env', () => {
    const want = new Set<string>(TABLE);
    for (const k of LAB_KEYS) for (const f of k.fields) want.add(f.env);
    for (const s of LAB_SETTINGS) if (s.env) want.add(s.env);
    for (const t of [...LAB_SPEND_PROVIDERS, ...LAB_SPEND_LINES]) {
      const env = capEnvFor(t);
      if (env) want.add(env);
    }
    expect([...want].filter((n) => !listed.has(n))).toEqual([]);
  });

  test('no LAB_* name read through resolveCred or process.env under lib/lab/** is missing', () => {
    const read = new Set<string>();
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) {
          const src = fs.readFileSync(p, 'utf8');
          for (const m of src.matchAll(/(?:process\.env|env)\.(LAB_[A-Z0-9_]+)/g)) read.add(m[1]);
          for (const m of src.matchAll(/(?:resolveCred|cred)\(\s*'(LAB_[A-Z0-9_]+)'/g)) read.add(m[1]);
          for (const m of src.matchAll(/env:\s*'(LAB_[A-Z0-9_]+)'/g)) read.add(m[1]);
        }
      }
    };
    walk(path.join(process.cwd(), 'lib/lab'));
    expect(read.size).toBeGreaterThan(10);
    expect([...read].filter((n) => !listed.has(n)).sort()).toEqual([]);
  });
});
