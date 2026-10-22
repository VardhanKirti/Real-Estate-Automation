import { describe, expect, it } from 'vitest';
import { findMention } from '@/lib/knowledge-index';

describe('findMention — a shown connection has to be a true one', () => {
  it('finds a plain multi-word name and quotes the sentence around it', () => {
    const t = 'The account was opened last spring. Northwind Logistics renewed in March. Nothing else changed.';
    expect(findMention(t, 'Northwind Logistics')).toBe('Northwind Logistics renewed in March.');
  });

  it('matches a multi-word name case-insensitively', () => {
    expect(findMention('we spoke to northwind logistics today.', 'Northwind Logistics')).toBeTruthy();
  });

  it('requires exact case for a single word that is also an ordinary word', () => {
    // "Future" the agent, not "future" the noun — matching the noun would fill
    // the graph with edges that mean nothing
    expect(findMention('we will revisit this in the future.', 'Future')).toBeNull();
    expect(findMention('Future summarised the thread.', 'Future')).toBeTruthy();
  });

  it('does not match inside a longer word', () => {
    expect(findMention('the offsetting entry was posted.', 'Offset')).toBeNull();
    expect(findMention('Slackers are not Slack.', 'Slack')).toBeTruthy();
  });

  it('returns null when the name is absent', () => {
    expect(findMention('nothing relevant here at all.', 'Kestrel Capital')).toBeNull();
  });

  it('handles a name at the very start and very end of the text', () => {
    expect(findMention('Kestrel Capital is parked.', 'Kestrel Capital')).toBeTruthy();
    expect(findMention('The account is Kestrel Capital', 'Kestrel Capital')).toBeTruthy();
  });

  it('caps the quoted evidence so a panel cannot be flooded', () => {
    const long = `${'x'.repeat(400)} Vertex Freight ${'y'.repeat(400)}`;
    const snip = findMention(long, 'Vertex Freight')!;
    expect(snip.length).toBeLessThanOrEqual(220);
  });
});
