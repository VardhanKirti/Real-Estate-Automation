import { describe, it, expect } from 'vitest';
import { parseSkillFrontmatter, skillGroup, splitGroup } from '@/lib/skills-catalog';

describe('parseSkillFrontmatter', () => {
  it('reads an inline name + description', () => {
    const md = `---\nname: codex\ndescription: Delegate a task to Codex.\n---\n\n# Codex\nbody`;
    expect(parseSkillFrontmatter(md)).toEqual({ name: 'codex', description: 'Delegate a task to Codex.' });
  });

  it('strips surrounding quotes', () => {
    const md = `---\nname: "nano-banana"\ndescription: 'Make images'\n---\n`;
    expect(parseSkillFrontmatter(md)).toEqual({ name: 'nano-banana', description: 'Make images' });
  });

  it('reads a literal block scalar (|), preserving line breaks', () => {
    const md = `---\nname: fc\ndescription: |\n  Line one.\n  Line two.\n---\n`;
    expect(parseSkillFrontmatter(md).description).toBe('Line one.\nLine two.');
  });

  it('reads a folded block scalar (>-), joining with spaces', () => {
    const md = `---\nname: dr\ndescription: >-\n  Folded line one\n  folded line two\n---\n`;
    expect(parseSkillFrontmatter(md).description).toBe('Folded line one folded line two');
  });

  it('returns empty when there is no frontmatter', () => {
    expect(parseSkillFrontmatter('# just a heading\ntext')).toEqual({});
  });
});

describe('skillGroup — the scope taxonomy (where a skill is allowed to live)', () => {
  // The taxonomy became two-level ("Domain/Group") when the library outgrew a
  // flat scope ring; splitGroup is what the hierarchy renders from.
  it('buckets brand-scoped skills to their brand', () => {
    // No brand prefixes are configured on a fresh install: brand slugs stay uncategorised.
    expect(skillGroup('acme-proposal')).toBe('General/Uncategorised');
    expect(skillGroup('my-voice-writing')).toBe('Voice/Registers');
    expect(skillGroup('my-voice-satirical-video')).toBe('Voice/Registers');
  });
  it('buckets craft and system skills', () => {
    expect(skillGroup('01-cinematic')).toBe('Content/Video prompts');
    expect(skillGroup('reel')).toBe('Content/Analysis');
    expect(skillGroup('youtube-transcribe')).toBe('Content/Analysis');
    expect(skillGroup('deck-dna')).toBe('Design/Decks & slides');
    expect(skillGroup('slide-copy')).toBe('Design/Decks & slides');
    expect(skillGroup('glados-futurism')).toBe('Design/Decks & slides');
    expect(skillGroup('learn')).toBe('Operating system/Meta');
    expect(skillGroup('skill-distiller')).toBe('Operating system/Meta');
    expect(skillGroup('attack-surface-audit')).toBe('Engineering/Security');
  });
  it('splits a two-level group into its levels', () => {
    expect(splitGroup('Brands/Venture A')).toEqual({ domain: 'Brands', group: 'Venture A' });
    expect(splitGroup('General/Uncategorised')).toEqual({ domain: 'General', group: 'Uncategorised' });
    // a bare label is its own domain, so a group file that says one word still renders
    expect(splitGroup('Solo')).toEqual({ domain: 'Solo', group: 'Solo' });
  });
});
