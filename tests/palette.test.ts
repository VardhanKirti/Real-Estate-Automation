import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ACTION_COMMANDS, filterCommands, type Command } from '@/lib/palette';

const COMMANDS: Command[] = [
  { id: 'nav-home', label: 'Home', keywords: 'dashboard today overview', href: '/' },
  { id: 'nav-agents', label: 'Agents', keywords: 'runtime run real', href: '/agents' },
  { id: 'nav-connections', label: 'Connections', keywords: 'integrations tools status', href: '/integrations' },
  { id: 'tool-gbrain', label: 'G-Brain', keywords: 'knowledge brain search supabase zeroentropy', href: '/integrations' },
  { id: 'agent-inbox-triage', label: 'Inbox Triage', keywords: 'email imap unread', href: '/agents' },
];

describe('filterCommands', () => {
  test('returns everything for an empty query', () => {
    expect(filterCommands(COMMANDS, '')).toEqual(COMMANDS);
  });

  test('matches case-insensitively on the label', () => {
    const hits = filterCommands(COMMANDS, 'agents');
    expect(hits.map((c) => c.id)).toContain('nav-agents');
  });

  test('matches on keywords, not just labels', () => {
    const hits = filterCommands(COMMANDS, 'unread');
    expect(hits.map((c) => c.id)).toEqual(['agent-inbox-triage']);
  });

  test('ranks label prefix matches above keyword matches', () => {
    const hits = filterCommands(COMMANDS, 'g');
    expect(hits[0].id).toBe('tool-gbrain');
  });

  test('matches all terms of a multi-word query', () => {
    expect(filterCommands(COMMANDS, 'brain search').map((c) => c.id)).toEqual(['tool-gbrain']);
    expect(filterCommands(COMMANDS, 'brain zzz')).toEqual([]);
  });
});

describe('Toggle sidebar (SPEC S09 FR-15)', () => {
  test('an action command with no destination, found by sidebar words', () => {
    const toggle = ACTION_COMMANDS.find((c) => c.id === 'ui-sidebar');
    expect(toggle).toMatchObject({ label: 'Toggle sidebar', action: 'sidebar:toggle' });
    expect(toggle?.href).toBeUndefined();
    for (const q of ['toggle sidebar', 'collapse', 'minimize nav', 'rail']) {
      expect(filterCommands(ACTION_COMMANDS, q).map((c) => c.id), q).toContain('ui-sidebar');
    }
  });

  test('the layout puts the action commands in the palette', () => {
    expect(readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8')).toContain('...ACTION_COMMANDS');
  });
});
