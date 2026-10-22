import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  toKebabCase,
  deriveSkillName,
  proposePlacement,
  createDraftSkill,
  type CatalogSkill,
} from '@/lib/skills-catalog';

describe('toKebabCase', () => {
  it('lowercases and hyphenates', () => {
    expect(toKebabCase('Invoice Chaser')).toBe('invoice-chaser');
  });
  it('strips punctuation and collapses runs of separators', () => {
    expect(toKebabCase("Sam's  Weekly -- Report!!")).toBe('sam-s-weekly-report');
  });
  it('trims leading/trailing hyphens', () => {
    expect(toKebabCase('  --hello world--  ')).toBe('hello-world');
  });
  it('refuses to leave path-traversal characters standing', () => {
    expect(toKebabCase('../../etc/passwd')).not.toContain('.');
    expect(toKebabCase('../../etc/passwd')).not.toContain('/');
  });
  it('truncates to the max length without a trailing hyphen', () => {
    const long = 'a'.repeat(10) + '-' + 'b'.repeat(60);
    expect(toKebabCase(long, 12)).toBe('aaaaaaaaaa-b');
  });
});

describe('deriveSkillName', () => {
  it('picks the first meaningful words, dropping stopwords', () => {
    expect(deriveSkillName('I want a skill that chases overdue invoices automatically')).toBe(
      'chases-overdue-invoices-automatically',
    );
  });
  it('falls back to draft-skill when nothing meaningful survives', () => {
    expect(deriveSkillName('the a an of')).toBe('draft-skill');
  });
});

const catalog: CatalogSkill[] = [
  {
    slug: 'invoice-nudge',
    name: 'invoice-nudge',
    description: 'Follow up on overdue client invoices and payment reminders.',
    group: 'Finance/Collections',
    path: '~/.claude/skills/invoice-nudge/SKILL.md',
  },
  {
    slug: 'my-voice-writing',
    name: 'my-voice-writing',
    description: 'Write public-facing copy in the operator voice for sales pages and emails.',
    group: 'Voice/the operator registers',
    path: '~/.claude/skills/my-voice-writing/SKILL.md',
  },
  {
    slug: 'deck-dna',
    name: 'deck-dna',
    description: 'Build a brand-accurate slide deck from reference decks.',
    group: 'Design/Decks & slides',
    path: '~/.claude/skills/deck-dna/SKILL.md',
  },
];

describe('proposePlacement — token-overlap scoring against the real taxonomy', () => {
  it('scores the best-matching group highest, deterministically', () => {
    const guesses = proposePlacement('chase overdue client invoices for payment', catalog);
    expect(guesses[0]).toEqual({ domain: 'Finance', group: 'Collections' });
  });
  it('returns up to 3 candidates, best first', () => {
    const guesses = proposePlacement('write sales copy in a consistent voice', catalog);
    expect(guesses.length).toBeLessThanOrEqual(3);
    expect(guesses[0]).toEqual({ domain: 'Voice', group: 'the operator registers' });
  });
  it('is deterministic — same input, same output, run twice', () => {
    const a = proposePlacement('build a slide deck for the pitch', catalog);
    const b = proposePlacement('build a slide deck for the pitch', catalog);
    expect(a).toEqual(b);
  });
  it('falls back to General/Uncategorised when the catalog is empty', () => {
    expect(proposePlacement('anything at all', [])).toEqual([{ domain: 'General', group: 'Uncategorised' }]);
  });
  it('breaks zero-score ties alphabetically', () => {
    const guesses = proposePlacement('zzz nonsense query matching nothing', catalog);
    // no token overlap anywhere -> every candidate scores 0 -> alpha order by domain then group
    const domains = guesses.map((g) => g.domain);
    expect(domains).toEqual([...domains].sort());
  });
});

describe('createDraftSkill', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('writes a real SKILL.md + GROUP file into the skills dir', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'glados-skills-'));
    const result = createDraftSkill('Invoice Chaser', 'Chases overdue invoices automatically.', 'Finance', 'Collections', dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slug).toBe('invoice-chaser');
    expect(result.path).toBe('Finance/Collections/invoice-chaser');

    const md = fs.readFileSync(path.join(dir, 'invoice-chaser', 'SKILL.md'), 'utf8');
    expect(md).toContain('name: invoice-chaser');
    expect(md).toContain('Chases overdue invoices automatically.');
    expect(md).toContain('Draft — flesh out before first use.');

    const group = fs.readFileSync(path.join(dir, 'invoice-chaser', 'GROUP'), 'utf8').trim();
    expect(group).toBe('Finance/Collections');
  });

  it('derives a kebab-case name from a messy raw name', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'glados-skills-'));
    const result = createDraftSkill('  My Cool Skill!! ', 'Does something useful.', 'General', 'Uncategorised', dir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.slug).toBe('my-cool-skill');
  });

  it('refuses path traversal in the name', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'glados-skills-'));
    const result = createDraftSkill('../../etc/evil', 'Escapes the skills dir.', 'General', 'Uncategorised', dir);
    // toKebabCase strips the slashes/dots, so this either sanitizes to a safe
    // slug or is rejected outright — either way nothing lands outside `dir`.
    if (result.ok) {
      const resolved = path.resolve(dir, result.slug);
      expect(resolved.startsWith(path.resolve(dir) + path.sep)).toBe(true);
      expect(fs.existsSync(path.join(dir, '..', 'evil'))).toBe(false);
    } else {
      expect(result.error).toBeTruthy();
    }
  });

  it('refuses a name that sanitizes to nothing', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'glados-skills-'));
    const result = createDraftSkill('***', 'Some description here.', 'General', 'Uncategorised', dir);
    expect(result.ok).toBe(false);
  });

  it('refuses a collision with an existing skill', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'glados-skills-'));
    fs.mkdirSync(path.join(dir, 'taken'));
    fs.writeFileSync(path.join(dir, 'taken', 'SKILL.md'), '---\nname: taken\n---\n');
    const result = createDraftSkill('taken', 'A description long enough.', 'General', 'Uncategorised', dir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already exists/);
  });

  it('honestly fails when the skills dir does not exist', () => {
    const missing = path.join(tmpdir(), 'glados-skills-does-not-exist-' + Date.now());
    const result = createDraftSkill('some-skill', 'A description long enough.', 'General', 'Uncategorised', missing);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not found/);
  });

  it('refuses an empty description', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'glados-skills-'));
    const result = createDraftSkill('some-skill', '   ', 'General', 'Uncategorised', dir);
    expect(result.ok).toBe(false);
  });
});
