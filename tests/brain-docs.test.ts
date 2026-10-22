import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb, type GladosDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import { buildBrainDocs, writeBrainDocs, GENERATED_MARKER } from '@/lib/brain-docs';

let db: GladosDb;

afterEach(() => {
  db?.close();
});

function seeded(): GladosDb {
  db = openDb(':memory:');
  seedDatabase(db);
  return db;
}

function docsFor(d: GladosDb) {
  return buildBrainDocs({
    departments: d.departments.all(),
    agents: d.agents.all(),
    people: d.people.all(),
    tasks: d.sopTasks.all(),
    tools: d.tools.all(),
  });
}

describe('buildBrainDocs', () => {
  test('one doc per agent, sop, tool, person and pillar', () => {
    const d = seeded();
    const docs = docsFor(d);
    const paths = new Set(docs.map((x) => x.path));
    expect(docs.filter((x) => x.path.startsWith('agents/')).length).toBe(d.agents.all().length);
    expect(docs.filter((x) => x.path.startsWith('sops/')).length).toBe(d.sopTasks.all().length);
    expect(docs.filter((x) => x.path.startsWith('tools/')).length).toBe(d.tools.all().length);
    expect(docs.filter((x) => x.path.startsWith('people/')).length).toBe(d.people.all().length);
    expect(docs.filter((x) => x.path.startsWith('org/pillar-')).length).toBe(d.departments.all().length);
    expect(paths.has('agents/conductor.md')).toBe(true);
    expect(paths.has('org/pillar-clients.md')).toBe(true);
  });

  test('every doc carries the generated marker in frontmatter', () => {
    const docs = docsFor(seeded());
    for (const doc of docs) expect(doc.content).toContain(GENERATED_MARKER);
  });

  test('an agent doc holds its charter and links its pillar', () => {
    const docs = docsFor(seeded());
    const doc = docs.find((x) => x.path === 'agents/conductor.md')!.content;
    expect(doc).toContain('Wizard');
    expect(doc).toContain('[[pillar-');
  });

  test('no SOP docs are generated until SOPs exist', () => {
    const docs = docsFor(seeded());
    expect(docs.some((x) => x.path.startsWith('sops/'))).toBe(false);
  });

  test('no tool docs are generated until tools exist', () => {
    const docs = docsFor(seeded());
    expect(docs.some((x) => x.path.startsWith('tools/'))).toBe(false);
  });

  test('a pillar doc rosters its agents', () => {
    const docs = docsFor(seeded());
    const clients = docs.find((x) => x.path === 'org/pillar-clients.md')!.content;
    expect(clients).toContain('[[deal-alerts]]');
  });

  test('deterministic output', () => {
    const d = seeded();
    expect(docsFor(d)).toEqual(docsFor(d));
  });
});

describe('writeBrainDocs', () => {
  test('writes files, is idempotent, and never clobbers a non-generated file', () => {
    const d = seeded();
    const docs = docsFor(d);
    const dir = mkdtempSync(path.join(tmpdir(), 'brain-docs-'));
    const first = writeBrainDocs(docs, dir);
    expect(first.written).toBeGreaterThan(0);
    expect(existsSync(path.join(dir, 'agents', 'conductor.md'))).toBe(true);

    // hand-edited (non-generated) file must be left alone
    const handmade = path.join(dir, 'agents', 'conductor.md');
    writeFileSync(handmade, '# my own notes, no marker');
    const second = writeBrainDocs(docs, dir);
    expect(readFileSync(handmade, 'utf8')).toBe('# my own notes, no marker');
    expect(second.skipped).toBeGreaterThan(0);

    // everything else regenerated cleanly
    expect(readdirSync(path.join(dir, 'agents')).length).toBe(d.agents.all().length);
  });
});
