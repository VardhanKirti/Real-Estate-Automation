import { describe, expect, it } from 'vitest';
import { parseWizardBlock, plainText, resolveOwner, systemAppend } from '@/lib/wizard/protocol';
import { projectOwners, projectSubline } from '@/lib/wizard/ui';

const roster = [
  { id: 'drake', name: 'Drake', role: 'Closer' },
  { id: 'don-toliver', name: 'Don Toliver', role: 'Tone Check' },
];

describe('wizard block protocol', () => {
  it('parses and strips a well-formed block', () => {
    const reply = 'Drake has the thread.\n\n```wizard\n{"tasks":[{"title":"Draft the counter","owner":"drake"}],"done":["Pull the thread"],"run":["drake"]}\n```';
    const { text, block } = parseWizardBlock(reply);
    expect(text).toBe('Drake has the thread.');
    expect(block.tasks).toEqual([{ title: 'Draft the counter', owner: 'drake' }]);
    expect(block.done).toEqual(['Pull the thread']);
    expect(block.run).toEqual(['drake']);
  });

  it('is a no-op on a missing or malformed block', () => {
    expect(parseWizardBlock('plain reply')).toEqual({ text: 'plain reply', block: { tasks: [], done: [], run: [] } });
    const { text, block } = parseWizardBlock('reply\n```wizard\n{not json\n```');
    expect(text).toBe('reply');
    expect(block.tasks).toEqual([]);
  });

  it('resolves owners by id or name and falls back to the Wizard', () => {
    expect(resolveOwner('drake', roster)).toEqual({ ownerId: 'drake', ownerName: 'Drake' });
    expect(resolveOwner('don toliver', roster)).toEqual({ ownerId: 'don-toliver', ownerName: 'Don Toliver' });
    expect(resolveOwner('nobody', roster)).toEqual({ ownerId: null, ownerName: 'Wizard' });
    expect(resolveOwner(undefined, roster)).toEqual({ ownerId: null, ownerName: 'Wizard' });
  });

  it('plainText strips the markdown a model slips in', () => {
    expect(plainText('## Plan\n- **Pull the thread** goes to Drake, *then* `tone-check`.')).toBe('Plan\n- Pull the thread goes to Drake, then tone-check.');
    expect(plainText('2 * 3 = 6')).toBe('2 * 3 = 6');
  });

  it('system append names the roster and the block contract', () => {
    const s = systemAppend(roster);
    expect(s).toContain('drake = Drake (Closer)');
    expect(s).toContain('```wizard');
    expect(s).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});

describe('wizard card helpers', () => {
  const project = {
    tasks: [
      { id: 'a', title: 'First', ownerId: 'drake', ownerName: 'Drake', state: 'done' as const, createdAt: '', doneAt: '' },
      { id: 'b', title: 'Second', ownerId: 'drake', ownerName: 'Drake', state: 'open' as const, createdAt: '', doneAt: null },
      { id: 'c', title: 'Third', ownerId: null, ownerName: 'Wizard', state: 'open' as const, createdAt: '', doneAt: null },
    ],
    messages: [{ role: 'user' as const, text: 'hello there', at: '' }],
  };
  it('dedupes owners and picks the newest open task for the subline', () => {
    expect(projectOwners(project)).toEqual([
      { id: 'drake', name: 'Drake' },
      { id: null, name: 'Wizard' },
    ]);
    expect(projectSubline(project)).toEqual({ label: 'Task', text: 'Third' });
    expect(projectSubline({ tasks: [], messages: project.messages })).toEqual({ label: 'You', text: 'hello there' });
  });
});
