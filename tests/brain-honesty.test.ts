import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { createGBrainProvider, type ExecFn } from '@/lib/connectors/gbrain';
import { storageLayers, supabaseState } from '@/lib/brain-layers';
import { BrainViz } from '@/components/BrainViz';

/**
 * GladOS UI H33 (S05 F05.16, AC05.4, AC05.7): /brain shows the CLI version and
 * the Supabase page/chunk counts only when the provider reports them, and a
 * layer nobody checked reads "Unknown", never "Live".
 */

function makeStore(): string {
  const dir = mkdtempSync(join(tmpdir(), 'brain-honesty-'));
  mkdirSync(join(dir, 'Notes'));
  writeFileSync(join(dir, 'Notes', 'a.md'), '# A\n');
  writeFileSync(join(dir, 'Notes', 'b.md'), '# B\n');
  return dir;
}

const doctorOnly = (doctor: object): ExecFn => async (_cmd, args) =>
  args[0] === 'doctor'
    ? { stdout: JSON.stringify(doctor), stderr: '', code: 0 }
    : { stdout: '', stderr: 'stats: cannot connect', code: 1 };

const STATS_TEXT = 'Pages: 812\nChunks: 9400\nEmbedded: 9400\nBy type:\n  note: 812\n';
const full = (doctor: object): ExecFn => async (_cmd, args) =>
  args[0] === 'doctor'
    ? { stdout: JSON.stringify(doctor), stderr: '', code: 0 }
    : { stdout: STATS_TEXT, stderr: '', code: 0 };

const down: ExecFn = async () => ({ stdout: '', stderr: 'gbrain: command not found', code: 127 });

async function layersFor(exec: ExecFn) {
  const provider = createGBrainProvider({ exec, storePath: makeStore() });
  const overview = await provider.overview();
  const stats = overview.doctor.connected ? await provider.stats() : null;
  return { overview, stats, layers: storageLayers({ overview, stats, storeShort: '~/brain' }) };
}

const HARD_CODED = /v0\.41|1240|15k/;

describe('/brain storage layers come from the provider (H33)', () => {
  test('a provider with no version and no counts shows neither (AC05.4)', async () => {
    const { layers } = await layersFor(doctorOnly({ status: 'ok', health_score: 90, checks: [] }));
    const text = JSON.stringify(layers);
    expect(text).not.toMatch(HARD_CODED);
    const cli = layers.find((l) => l.name === 'engine CLI')!;
    expect(cli.sub).toBe('engine CLI · doctor --fast');
    const supa = layers.find((l) => l.name === 'Supabase Second Brain')!;
    expect(supa.sub).toMatch(/^counts unavailable/);
    expect(supa.val).toBe('Unknown');
  });

  test('ZeroEntropy with no matching check reads Unknown, not Live (AC05.7)', async () => {
    const { layers } = await layersFor(doctorOnly({ status: 'ok', health_score: 90, checks: [{ name: 'brain-store', status: 'ok' }] }));
    const ze = layers.find((l) => l.name === 'ZeroEntropy')!;
    expect(ze.val).toBe('Unknown');
    expect(ze.state).not.toBe('connected');
  });

  test('a ZeroEntropy check drives the row when it exists', async () => {
    const { layers } = await layersFor(doctorOnly({ status: 'warn', checks: [{ name: 'embeddings', status: 'warn', message: 'slow' }] }));
    expect(layers.find((l) => l.name === 'ZeroEntropy')!.val).toBe('Warn');
  });

  test('reported version and stats counts are shown', async () => {
    const { layers } = await layersFor(full({ status: 'ok', version: '0.52.1', checks: [{ name: 'supabase', status: 'ok' }] }));
    expect(layers.find((l) => l.name === 'engine CLI')!.sub).toBe('v0.52.1 · engine CLI · doctor --fast');
    const supa = layers.find((l) => l.name === 'Supabase Second Brain')!;
    expect(supa.sub).toMatch(/^812 pages \/ 9,400 chunks/);
    expect(supa.val).toBe('Live');
  });

  test('a failing Supabase check reads Paused with no counts', async () => {
    const { overview, layers } = await layersFor(doctorOnly({ status: 'warn', checks: [{ name: 'database', status: 'error' }] }));
    const supa = layers.find((l) => l.name === 'Supabase Second Brain')!;
    expect(supa.val).toBe('Paused');
    expect(supa.sub).toMatch(/^counts unavailable while paused/);
    expect(supabaseState(overview.doctor, null).val).toBe('Paused');
  });

  test('an unreachable CLI reports Unreachable and claims nothing else', async () => {
    const { layers, stats } = await layersFor(down);
    expect(stats).toBeNull();
    expect(layers.find((l) => l.name === 'engine CLI')!.val).toBe('Unreachable');
    expect(layers.find((l) => l.name === 'ZeroEntropy')!.val).toBe('Unknown');
    expect(layers.find((l) => l.name === 'Supabase Second Brain')!.val).toBe('Unknown');
    expect(JSON.stringify(layers)).not.toMatch(HARD_CODED);
  });
});

describe('the /brain sources hold no remembered numbers (H33)', () => {
  test.each(['app/brain/page.tsx', 'components/BrainViz.tsx', 'components/BrainCore.tsx', 'lib/brain-layers.ts'])('%s', (f) => {
    const src = readFileSync(join(process.cwd(), f), 'utf8');
    expect(src).not.toMatch(HARD_CODED);
    expect(src).not.toMatch(/last known/);
  });

  test('BrainViz omits the version and counts it was not given', () => {
    const html = renderToStaticMarkup(BrainViz({ clusters: [{ label: 'Notes', pages: 2 }], health: 80 }));
    expect(html).not.toMatch(HARD_CODED);
    expect(html).not.toMatch(/engine v/);
    expect(html).toMatch(/Supabase · counts unavailable/);
    const given = renderToStaticMarkup(
      BrainViz({ clusters: [{ label: 'Notes', pages: 2 }], health: 80, version: '0.52.1', supabasePages: 812, supabaseState: 'Live' }),
    );
    expect(given).toMatch(/engine v0\.52\.1/);
    expect(given).toMatch(/Supabase · 812 pages · live/);
  });
});
