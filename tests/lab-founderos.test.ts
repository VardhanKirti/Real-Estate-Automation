import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { LAB_DDL } from '@/lib/db';
import { labStore } from '@/lib/lab/store';
import { invalidateModeCache } from '@/lib/paths';
import { BRAND } from '@/lib/brand';
import { publishable } from '@/scripts/publish-rules';
import { setupView } from '@/lib/lab/setup/view';
import { setBinProbe } from '@/lib/lab/setup/health';
import { checklistView } from '@/lib/lab/setup/checklist';
import { installRefusal } from '@/lib/lab/setup/agent';

/**
 * AC-08-20 and AC-09-26: the FounderOS client build. vitest runs as the default brand, which IS
 * the client build (lib/brand.ts: anything but GLADOS_BRAND=glados), so these assert the client
 * behaviour directly.
 */
const KEYS = ['LAB_DRY', 'GLADOS_ENV_LOCAL', 'GLADOS_MODE_FILE', 'DEMO_MODE', 'GLADOS_AUTOMATION_DIR'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-fos-'));
  process.env.GLADOS_ENV_LOCAL = path.join(dir, '.env.local');
  fs.writeFileSync(process.env.GLADOS_ENV_LOCAL, 'APIFY_API_TOKEN=\n');
  process.env.GLADOS_MODE_FILE = path.join(dir, '.glados-mode');
  process.env.GLADOS_AUTOMATION_DIR = path.join(dir, 'automation');
  process.env.DEMO_MODE = '0';
  invalidateModeCache();
  setBinProbe(() => true);
});
afterEach(() => {
  for (const k of KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
  setBinProbe(null);
  invalidateModeCache();
});

const fresh = () => {
  const db = new Database(':memory:');
  db.exec(LAB_DDL);
  return labStore(db);
};

describe('AC-08-20: the FounderOS publish set', () => {
  test('no path under docs/projects/content-lab/ or deploy/ ships; the fictional fixture text does; lab-agent ships', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: process.cwd(), encoding: 'utf8' }).split('\n').filter(Boolean);
    const out = publishable(tracked);
    expect(out.filter((p) => p.startsWith('docs/projects/content-lab/') || p.startsWith('deploy/'))).toEqual([]);
    expect(out).toContain('lib/lab/fixtures/text.ts');
    expect(out).toContain('scripts/lab-agent.ts');
  });
});

describe('AC-09-26 and AC-08-20: Setup > Schedule on FounderOS', () => {
  test('the cron line, client rows, no GladOS wording and no agent label', () => {
    expect(BRAND.id).toBe('founderos');
    const v = setupView(fresh(), { now: new Date('2026-10-12T03:00:00Z'), dry: false, section: 'schedule' });
    expect(v.focus).toBe('schedule');
    expect(v.schedule.label).toBe('Runs when lab-sync tick is called. Call it every 15 minutes from cron or launchd.');
    expect(v.schedule.agentLabel).toBeNull();
    expect(v.schedule.privateInstance).toBe(false);
    expect(v.schedule.jobs.every((j) => j.state === 'client')).toBe(true);
    const text = JSON.stringify(v);
    expect(text).not.toMatch(/GladOS/i);
    expect(text).not.toContain('glados.agent.lab');
  });
  test('checklist step 10 is skipped with the cron copy; the agent install refuses', () => {
    const c = checklistView(fresh(), { health: [], dry: false, now: new Date() });
    expect(c.steps.find((s) => s.id === 'scheduled')).toMatchObject({ state: 'skipped', detail: 'Schedule your own runs with `npm run lab-sync -- tick` from cron or launchd.' });
    expect(installRefusal({ GLADOS_DATA_DIR: '/x/data' }, 'darwin', BRAND.id)).toMatch(/client build/);
  });
});
