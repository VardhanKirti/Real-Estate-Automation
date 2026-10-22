import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lifeAreaById } from '@/lib/ventures';
import { getVenture, readVentures, ventureAgentSet, venturesForAgent, ventureAreaAgents } from '@/lib/ventures-store';

// Ventures are data: a fresh install has none; the operator's live in
// ventures.json in the data directory.
let dir: string;
const saved = process.env.GLADOS_DATA_DIR;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glados-ventures-'));
  process.env.GLADOS_DATA_DIR = dir;
});
afterEach(() => {
  if (saved === undefined) delete process.env.GLADOS_DATA_DIR;
  else process.env.GLADOS_DATA_DIR = saved;
  fs.rmSync(dir, { recursive: true, force: true });
});

const acme = {
  id: 'acme',
  label: 'Acme',
  kind: 'Agency',
  color: '#89cff0',
  detail: 'An example business.',
  brainTag: 'acme',
  focus: ['Ship the offer'],
  areaAgents: { clients: ['sales-agent', 'crm-pulse'], ops: ['conductor'] },
};

describe('a fresh install', () => {
  test('ships no ventures, and every lookup is empty', () => {
    expect(readVentures()).toEqual([]);
    expect(getVenture('anything')).toBeNull();
    expect(ventureAgentSet('anything').size).toBe(0);
    expect(venturesForAgent('conductor')).toEqual([]);
    expect(ventureAreaAgents('anything', 'clients')).toEqual([]);
  });

  test('a malformed file reads as no ventures', () => {
    fs.writeFileSync(path.join(dir, 'ventures.json'), '{"oops": true}');
    expect(readVentures()).toEqual([]);
  });
});

describe('ventures.json', () => {
  beforeEach(() => fs.writeFileSync(path.join(dir, 'ventures.json'), JSON.stringify([acme])));

  test('is read from the data directory', () => {
    expect(readVentures().map((v) => v.id)).toEqual(['acme']);
    expect(getVenture('acme')?.label).toBe('Acme');
  });

  test('agents resolve across every life area', () => {
    expect([...ventureAgentSet('acme')].sort()).toEqual(['conductor', 'crm-pulse', 'sales-agent']);
    expect(venturesForAgent('crm-pulse').map((v) => v.id)).toEqual(['acme']);
    expect(venturesForAgent('nobody')).toEqual([]);
    expect(ventureAreaAgents('acme', 'clients')).toEqual(['sales-agent', 'crm-pulse']);
  });
});

describe('lifeAreaById', () => {
  test('returns null for an unknown area', () => {
    expect(lifeAreaById('nope')).toBeNull();
  });
});
