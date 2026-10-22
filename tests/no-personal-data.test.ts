import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { EXCLUDE_PREFIX, NEVER_PUBLISH_DIRS, assertPublishable, excluded, publishable } from '@/scripts/publish-rules';

/**
 * SPEC G7: no personal data in published code. Scans every file the client
 * repo publish would ship (the same rules as scripts/publish-oss.ts, shared
 * through scripts/publish-rules.ts) for a fixed denylist, plus the operator's
 * real venture and watchlist brand names read from data/ at test time when
 * they exist on this machine (never written into this file).
 *
 * The literals below are assembled from parts so this file is scanned too:
 * pasting a real id into it fails the test like anywhere else.
 */

const ROOT = path.resolve(__dirname, '..');

const j = (...parts: string[]) => parts.join('');

/**
 * Fixed denylist (FR-G7.1). Case-sensitive substrings, except a leading `~`
 * marks a case-insensitive word (letters on either side do not count, so
 * `ScriptVersion` is not a product name).
 */
export const DENY_LITERALS: readonly string[] = [
  j('/Us', 'ers/'), // home paths
  j('brody', 'glanville'), // the operator's account name
  j('100', '.88.'), // the tailnet range of the operator's machines
  j('ae-', 'aa4a633b'), // a real campaign id
  j('~ip', 'tv'), // a real product name
  j('@exo', 'soft.io'), // the operator's mail domain
  j('brody', '@'), // the operator's mailbox
];

/** Files allowed to hold anything (they name the product or its licence on purpose). */
const ALLOW_FILES = new Set(['LICENSE', 'lib/brand.ts']);

/**
 * Lines allowed to hold names that would otherwise match: the S11 globe
 * attribution header names its upstream source (FounderOS-DEMO by Bennettxai).
 */
const ALLOW_LINE = /FounderOS-DEMO|Bennettxai/;

/** Documented fictional names used by samples and fixtures (§3.4). Never treated as real. */
export const FICTIONAL_NAMES = new Set(['Lumen Desk', 'Northwind Tools', 'Kestrel Systems', 'Orbit Labs', 'Pinion', 'Halyard']);

/** Brand names the product ships under; allowed everywhere (lib/brand.ts constants). */
const PRODUCT_NAMES = new Set(['GladOS', 'FounderOS', 'GLADOS', 'FOUNDEROS']);

/** Words too generic to scan for even when a venture is named after them. */
const GENERIC = new Set(['personal', 'work', 'home', 'health', 'family', 'business', 'other', 'default']);

const MAX_BYTES = 2_000_000;

export type Leak = { file: string; line: number; term: string };

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A matcher for one term: literals anywhere, names on word boundaries. */
function matcher(term: string, kind: 'literal' | 'name'): RegExp {
  if (kind === 'name') return new RegExp(`(?<![\\w-])${escapeRe(term)}(?![\\w-])`);
  if (term.startsWith('~')) return new RegExp(`(?<![a-z])${escapeRe(term.slice(1))}(?![a-z])`, 'i');
  return new RegExp(escapeRe(term));
}

/** Pure scan, so the guard itself is testable on synthetic files. */
export function findLeaks(
  files: readonly string[],
  read: (rel: string) => string | null,
  literals: readonly string[],
  names: readonly string[] = [],
): Leak[] {
  const rules = [
    ...literals.map((t) => ({ term: t.replace(/^~/, ''), re: matcher(t, 'literal') })),
    ...names.map((t) => ({ term: t, re: matcher(t, 'name') })),
  ];
  const leaks: Leak[] = [];
  for (const file of files) {
    if (ALLOW_FILES.has(file)) continue;
    const text = read(file);
    if (text === null) continue;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (ALLOW_LINE.test(line)) return;
      for (const r of rules) if (r.re.test(line)) leaks.push({ file, line: i + 1, term: r.term });
    });
  }
  return leaks;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Real names on this machine: venture labels and watchlist brands. Empty on a fresh clone. */
export function localRealNames(root = ROOT): string[] {
  const names = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v !== 'string') return;
    const s = v.trim();
    if (s.length < 4 || GENERIC.has(s.toLowerCase())) return;
    if (PRODUCT_NAMES.has(s) || FICTIONAL_NAMES.has(s)) return;
    names.add(s);
  };
  const ventures = readJson(path.join(root, 'data', 'ventures.json'));
  if (Array.isArray(ventures)) for (const v of ventures) add((v as { label?: unknown })?.label);
  for (const rel of [['ad-intel', 'watchlist.json'], ['adscout', 'watchlist.json']]) {
    const list = readJson(path.join(root, 'data', ...rel));
    if (Array.isArray(list)) for (const b of list) add((b as { name?: unknown })?.name);
  }
  return [...names];
}

function repoFiles(): string[] {
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n')
      .filter(Boolean);
  // Tracked plus new-but-not-ignored, so a leak is caught before its first commit.
  const all = new Set([...git(['ls-files']), ...git(['ls-files', '--others', '--exclude-standard'])]);
  return [...all].filter((f) => {
    try {
      return fs.statSync(path.join(ROOT, f)).isFile();
    } catch {
      return false; // deleted in the working tree
    }
  });
}

function readText(rel: string): string | null {
  const abs = path.join(ROOT, rel);
  const stat = fs.statSync(abs);
  if (stat.size > MAX_BYTES) return null;
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) return null; // binary
  return buf.toString('utf8');
}

describe('no personal data in published code (G7)', () => {
  const published = publishable(repoFiles());

  it('scans a real file set', () => {
    expect(published.length).toBeGreaterThan(100);
    expect(published).toContain('tests/no-personal-data.test.ts');
  });

  it('published files hold no denylisted literal or local real name (ACG7.1)', () => {
    const leaks = findLeaks(published, readText, DENY_LITERALS, localRealNames());
    const report = leaks.map((l) => `${l.file}:${l.line} contains "${l.term}"`).join('\n');
    expect(report).toBe('');
  });

  it('the published list holds no withheld path (ACG7.2)', () => {
    const withheld = ['docs/projects/', 'data/', 'demo-data/', 'filming/', 'operator/'];
    const bad = published.filter((f) => withheld.some((p) => f.startsWith(p)) || f === 'docs/PROJECTS.md');
    expect(bad).toEqual([]);
    for (const p of withheld) expect(EXCLUDE_PREFIX).toContain(p);
  });

  it('the hard rule refuses data dirs even if the lists stop excluding them', () => {
    for (const dir of NEVER_PUBLISH_DIRS) {
      expect(excluded(`${dir}/x.json`)).toBe(true);
      expect(() => assertPublishable(`${dir}/x.json`)).toThrow(/never leaves/);
    }
  });
});

describe('the guard itself', () => {
  const realId = j('ae-', 'aa4a633b');
  const files: Record<string, string> = {
    'tests/fixture.test.ts': `const id = '${realId}';\n`,
    'lib/clean.ts': 'export const x = 1;\n',
    'LICENSE': `Copyright ${j('brody', 'glanville')}\n`,
    'components/adpilot/Globe.tsx': '/* adapted from FounderOS-DEMO (github.com/Bennettxai/FounderOS-DEMO) */\n',
  };
  const read = (f: string) => files[f] ?? null;

  it('fails when a real campaign id is added under tests/ (ACG7.1)', () => {
    const leaks = findLeaks(Object.keys(files), read, DENY_LITERALS);
    expect(leaks).toEqual([{ file: 'tests/fixture.test.ts', line: 1, term: realId }]);
  });

  it('matches real names on word boundaries only and honours the allow-list', () => {
    const names = ['Acme Rocket'];
    const src: Record<string, string> = {
      'a.ts': 'const brand = "Acme Rocket";\n',
      'b.ts': 'const brand = "Acme Rocketry";\n',
      'c.ts': '// Lumen Desk sample\n',
    };
    const leaks = findLeaks(Object.keys(src), (f) => src[f] ?? null, [], names);
    expect(leaks.map((l) => l.file)).toEqual(['a.ts']);
  });

  it('reads no real names from a machine without data/', () => {
    expect(localRealNames(path.join(ROOT, 'tests', 'no-such-root'))).toEqual([]);
  });
});
