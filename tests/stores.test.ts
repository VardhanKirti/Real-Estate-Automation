import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { invalidateModeCache } from '@/lib/paths';
import {
  bdpilotListFile,
  bdpilotStatePath,
  brainProviderName,
  brainStoreDir,
  funnelProviderName,
  gbrainBin,
  skillsDir,
} from '@/lib/stores';
import { rulesPath } from '@/lib/brand-deal-rules';
import { readDriftInsights } from '@/lib/drift-store';

// Filming mode must move EVERY outside store onto demo-data/, and real mode
// must keep reading exactly what the settings say.
const KEYS = ['GLADOS_MODE_FILE', 'GBRAIN_STORE', 'GBRAIN_BIN', 'GLADOS_SKILLS_DIR', 'BDPILOT_STATE', 'BDPILOT_LIST_FILE', 'BDPILOT_RULES', 'BRAIN_PROVIDER', 'FUNNEL_PROVIDER', 'DEMO_MODE', 'GLADOS_DATA_DIR'];
const saved: Record<string, string | undefined> = {};
let dir: string;

function setMode(mode: 'filming' | 'real') {
  fs.writeFileSync(process.env.GLADOS_MODE_FILE!, mode);
  invalidateModeCache();
}

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glados-stores-'));
  process.env.GLADOS_MODE_FILE = path.join(dir, '.glados-mode');
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  invalidateModeCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('outside stores follow Filming mode', () => {
  test('filming points every store inside demo-data/, whatever the settings say', () => {
    process.env.GBRAIN_STORE = '/real/brain';
    process.env.GBRAIN_BIN = '/real/gbrain';
    process.env.GLADOS_SKILLS_DIR = '/real/skills';
    process.env.BDPILOT_STATE = '/real/state.json';
    process.env.BDPILOT_RULES = '/real/rules.json';
    process.env.FUNNEL_PROVIDER = 'attio';
    setMode('filming');
    const demo = path.join(process.cwd(), 'demo-data');
    expect(brainStoreDir()).toBe(path.join(demo, 'brain'));
    expect(gbrainBin()).toBe(path.join(demo, 'bin', 'gbrain'));
    expect(skillsDir()).toBe(path.join(demo, 'skills'));
    expect(bdpilotStatePath()).toBe(path.join(demo, 'bdpilot', 'state.json'));
    expect(bdpilotListFile()).toBe(path.join(demo, 'bdpilot', 'pending.tsv'));
    expect(rulesPath()).toBe(path.join(demo, 'demo-bdpilot-rules.json'));
    expect(brainProviderName()).toBe('gbrain');
    expect(funnelProviderName()).toBe('seed');
  });

  test('real mode reads the settings untouched', () => {
    process.env.GBRAIN_STORE = '/real/brain';
    process.env.GBRAIN_BIN = '/real/gbrain';
    process.env.GLADOS_SKILLS_DIR = '/real/skills';
    process.env.BDPILOT_STATE = '/real/state.json';
    process.env.BDPILOT_RULES = '/real/rules.json';
    setMode('real');
    expect(brainStoreDir()).toBe('/real/brain');
    expect(gbrainBin()).toBe('/real/gbrain');
    expect(skillsDir()).toBe('/real/skills');
    expect(bdpilotStatePath()).toBe('/real/state.json');
    expect(bdpilotListFile()).toBeUndefined();
    expect(rulesPath()).toBe('/real/rules.json');
    expect(funnelProviderName()).toBe('attio');
  });
});

describe('drift insights', () => {
  test('a missing or malformed drift.json reads as no insights', () => {
    expect(readDriftInsights(path.join(dir, 'none.json'))).toEqual([]);
    fs.writeFileSync(path.join(dir, 'bad.json'), '{"not": "a list"}');
    expect(readDriftInsights(path.join(dir, 'bad.json'))).toEqual([]);
  });
});
