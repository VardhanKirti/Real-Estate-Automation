import { describe, expect, test } from 'vitest';
import { buildStatCards, perDay, replyByChannel, unreadBars } from '@/lib/inbox-stats';
import { sortThreads, whatsappNumber } from '@/lib/inbox';
import { displayName, indexAvatars, jidKey, mediaKind } from '@/lib/connectors/whatsapp';
import type { InboxSource, InboxThread } from '@/lib/inbox';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const NOW = new Date('2026-09-17T12:00:00.000Z');

function thread(over: Partial<InboxThread> = {}): InboxThread {
  return {
    key: 'k',
    source: 'whatsapp',
    sender: 'Someone',
    context: 'WhatsApp',
    preview: 'hello',
    ts: NOW.toISOString(),
    unread: 0,
    triage: 'fyi',
    reasons: [],
    ...over,
  };
}

const ALL_OFF: Record<InboxSource, boolean> = { email: false, slack: false, whatsapp: false, calendar: false };

describe('jidKey', () => {
  test('takes the numeric head of a jid', () => {
    expect(jidKey('87501536546980@lid')).toBe('87501536546980');
    expect(jidKey('120363407294649022@g.us')).toBe('120363407294649022');
  });
  test('rejects anything that is not a plain number', () => {
    expect(jidKey('0@status')).toBe(null); // too short to be a contact
    expect(jidKey('../../secret@lid')).toBe(null);
    expect(jidKey(null)).toBe(null);
  });
});

describe('indexAvatars', () => {
  test('prefers the full-size jpg over the thumb for the same jid', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'glados-av-'));
    writeFileSync(path.join(dir, '12345678901-111.thumb'), 'x');
    writeFileSync(path.join(dir, '12345678901-222.jpg'), 'x');
    writeFileSync(path.join(dir, '99999999999-333.thumb'), 'x');
    const map = indexAvatars(dir);
    expect(map.get('12345678901')).toBe('12345678901-222.jpg');
    expect(map.get('99999999999')).toBe('99999999999-333.thumb');
  });
  test('an unreadable directory yields an empty index, never a throw', () => {
    expect(indexAvatars('/nope/does/not/exist').size).toBe(0);
  });
});

describe('unreadBars', () => {
  test('one bar per unread conversation, busiest first, each labelled', () => {
    const bars = unreadBars([
      thread({ unread: 2, sender: 'Bali' }),
      thread({ unread: 0, sender: 'Quiet' }),
      thread({ unread: 24, sender: 'Vancouver' }),
    ]);
    expect(bars.map((b) => b.value)).toEqual([24, 2]);
    expect(bars[0].label).toBe('Vancouver: 24 unread');
  });
});

describe('replyByChannel', () => {
  test('splits needs-reply threads across the four channels', () => {
    const bars = replyByChannel([
      thread({ triage: 'reply', source: 'whatsapp' }),
      thread({ triage: 'reply', source: 'whatsapp' }),
      thread({ triage: 'fyi', source: 'email' }),
    ]);
    expect(bars).toHaveLength(4);
    expect(bars.find((b) => b.label.startsWith('WhatsApp'))!.value).toBe(2);
    expect(bars.find((b) => b.label.startsWith('Email'))!.value).toBe(0);
  });
});

describe('perDay', () => {
  test('buckets the trailing week, oldest first, one labelled bar per day', () => {
    const days = perDay(
      [thread({ ts: NOW.toISOString() }), thread({ ts: '2026-09-16T09:00:00.000Z' })],
      NOW,
    );
    expect(days).toHaveLength(7);
    expect(days[6].value).toBe(1); // today
    expect(days[5].value).toBe(1); // yesterday
    expect(days[6].label).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat): 1 message$/);
  });
});

describe('buildStatCards', () => {
  test('carries a delta only when real weekly history is supplied', () => {
    const withHistory = buildStatCards([thread()], ALL_OFF, { thisWeek: 120, lastWeek: 100 }, NOW);
    const messages = withHistory.find((c) => c.id === 'messages')!;
    expect(messages.delta).toEqual({ text: '+20%', dir: 'up', note: 'vs. last week' });

    const without = buildStatCards([thread()], ALL_OFF, null, NOW);
    expect(without.find((c) => c.id === 'messages')!.delta).toBeUndefined();
  });

  test('no other card ever invents a comparison', () => {
    const cards = buildStatCards([thread({ unread: 3 })], ALL_OFF, { thisWeek: 10, lastWeek: 5 }, NOW);
    for (const card of cards) {
      if (card.id !== 'messages') expect(card.delta).toBeUndefined();
    }
  });

  test('unread and needs-reply count what is actually there', () => {
    const threads = [thread({ unread: 24, triage: 'reply' }), thread({ unread: 0, triage: 'fyi' })];
    const cards = buildStatCards(threads, ALL_OFF, null, NOW);
    expect(cards.find((c) => c.id === 'unread')!.value).toBe('24');
    expect(cards.find((c) => c.id === 'reply')!.value).toBe('1');
  });

  test('every chart says what one bar or block represents', () => {
    const cards = buildStatCards([thread({ unread: 3, triage: 'reply' })], ALL_OFF, null, NOW);
    for (const card of cards) expect(card.chart.caption.length).toBeGreaterThan(0);
  });

  test('channels live reports the real connector count', () => {
    const cards = buildStatCards([thread()], { ...ALL_OFF, whatsapp: true }, null, NOW);
    const channels = cards.find((c) => c.id === 'channels')!;
    expect(channels.value).toBe('1');
    expect(channels.unit).toBe('of 4');
    expect(channels.sub).toBe('WhatsApp');
  });
});

describe('sortThreads', () => {
  test('urgency puts a tagged contact above a louder untagged thread', () => {
    const tagged = thread({ key: 'p1', priority: 1, triage: 'fyi', unread: 0 });
    const loud = thread({ key: 'loud', triage: 'reply', unread: 40 });
    const [first] = sortThreads([loud, tagged], 'urgency', NOW);
    expect(first.key).toBe('p1');
  });

  test('urgency ranks needs-reply above read chatter, and unread breaks ties', () => {
    const quiet = thread({ key: 'quiet', triage: 'fyi', unread: 0 });
    const some = thread({ key: 'some', triage: 'reply', unread: 2 });
    const lots = thread({ key: 'lots', triage: 'reply', unread: 24 });
    expect(sortThreads([quiet, some, lots], 'urgency', NOW).map((t) => t.key)).toEqual(['lots', 'some', 'quiet']);
  });

  test('oldest is the exact reverse of newest by timestamp', () => {
    const a = thread({ key: 'a', ts: '2026-09-10T10:00:00.000Z' });
    const b = thread({ key: 'b', ts: '2026-09-14T10:00:00.000Z' });
    expect(sortThreads([a, b], 'oldest', NOW).map((t) => t.key)).toEqual(['a', 'b']);
    expect(sortThreads([a, b], 'newest', NOW).map((t) => t.key)).toEqual(['b', 'a']);
  });

  test('sorting never adds or drops a thread', () => {
    const all = [thread({ key: 'a' }), thread({ key: 'b', unread: 5 }), thread({ key: 'c', triage: 'done' })];
    for (const s of ['newest', 'oldest', 'urgency'] as const) {
      expect(sortThreads(all, s, NOW)).toHaveLength(3);
    }
  });
});

describe('displayName', () => {
  test('keeps real names', () => {
    expect(displayName('Jesse Rurka')).toBe('Jesse Rurka');
    expect(displayName('Bali')).toBe('Bali');
    expect(displayName('Anne-Marie')).toBe('Anne-Marie');
  });
  test('drops the opaque group tokens WhatsApp stores in the same column', () => {
    expect(displayName('CLOgsdUGIABIAZ')).toBeUndefined();
    expect(displayName('CKuhsdUGGhMxNj')).toBeUndefined();
  });
  test('keeps a long ordinary name and an all-caps group name', () => {
    expect(displayName('Christopher')).toBe('Christopher');
    expect(displayName('MARKETINGTEAM')).toBe('MARKETINGTEAM');
  });
  test('drops empty and absurd values', () => {
    expect(displayName(null)).toBeUndefined();
    expect(displayName('   ')).toBeUndefined();
    expect(displayName('x'.repeat(60))).toBeUndefined();
  });
});

describe('mediaKind', () => {
  test('reads the extension, and uses the type only to split gif from video', () => {
    expect(mediaKind('Media/x/a.opus', 3)).toBe('voice');
    expect(mediaKind('Media/x/a.mp4', 2)).toBe('video');
    expect(mediaKind('Media/x/a.mp4', 11)).toBe('gif');
    expect(mediaKind('Media/x/a.jpg', 1)).toBe('image');
    expect(mediaKind('Media/x/a.pdf', 8)).toBe('document');
  });
});

describe('whatsappNumber', () => {
  test('only a real phone-number jid is addressable', () => {
    expect(whatsappNumber('14155551234@s.whatsapp.net')).toBe('14155551234');
  });
  test('linked ids and groups have no number the Cloud API can reach', () => {
    expect(whatsappNumber('87501536546980@lid')).toBeNull();
    expect(whatsappNumber('120363407294649022@g.us')).toBeNull();
    expect(whatsappNumber(undefined)).toBeNull();
  });
});
