import { describe, expect, test } from 'vitest';
import {
  EMPTY_TRIAGE, INBOX_TRIAGE_KEY, SNOOZE_MS, loadTriage, parseTriage, pruneTriage, saveTriage,
  setDone, snooze, snoozedKeys, unsnooze,
} from '@/lib/inbox-triage';
import { buildThreads, threadKey } from '@/lib/inbox';
import type { CommsItem } from '@/lib/comms';

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('inbox triage store (H32)', () => {
  test('uses the versioned key', () => {
    expect(INBOX_TRIAGE_KEY).toBe('inbox-triage:v1');
  });

  test('done round-trips through storage, so it survives a reload', () => {
    const storage = memoryStorage();
    expect(saveTriage(storage, setDone(EMPTY_TRIAGE, 'email:ana', true))).toBe(true);
    const reloaded = loadTriage(storage, NOW, ['email:ana', 'slack:bo']);
    expect(reloaded.done).toEqual(['email:ana']);
  });

  test('done toggles off and never duplicates', () => {
    let s = setDone(EMPTY_TRIAGE, 'a', true);
    s = setDone(s, 'a', true);
    expect(s.done).toEqual(['a']);
    expect(setDone(s, 'a', false).done).toEqual([]);
  });

  test('snooze hides for 24 hours, then expires and is pruned on load (edge 18)', () => {
    const s = snooze(EMPTY_TRIAGE, 'a', NOW);
    expect(snoozedKeys(s, NOW + 1000).has('a')).toBe(true);
    expect(snoozedKeys(s, NOW + SNOOZE_MS + 1).has('a')).toBe(false);
    const storage = memoryStorage({ [INBOX_TRIAGE_KEY]: JSON.stringify(s) });
    expect(loadTriage(storage, NOW + SNOOZE_MS + 1, ['a']).snoozed).toEqual([]);
    expect(unsnooze(s, 'a').snoozed).toEqual([]);
  });

  test('keys for threads that no longer exist are pruned (edge 19), but not when the feed is empty', () => {
    const s = setDone(setDone(EMPTY_TRIAGE, 'gone', true), 'here', true);
    expect(pruneTriage(s, NOW, ['here']).done).toEqual(['here']);
    expect(pruneTriage(s, NOW, []).done).toEqual(['gone', 'here']);
  });

  test('malformed storage reads as empty and blocked storage never throws', () => {
    expect(parseTriage('{not json')).toEqual(EMPTY_TRIAGE);
    expect(parseTriage(JSON.stringify({ done: [1, 'a'], snoozed: [{ key: 'b', until: 'nope' }] }))).toEqual({
      done: ['a'],
      snoozed: [],
    });
    const throwing = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(loadTriage(throwing, NOW)).toEqual(EMPTY_TRIAGE);
    expect(saveTriage(throwing, setDone(EMPTY_TRIAGE, 'a', true))).toBe(false);
    expect(saveTriage(null, EMPTY_TRIAGE)).toBe(false);
  });

  test('an empty store removes the key instead of writing an empty value', () => {
    const storage = memoryStorage({ [INBOX_TRIAGE_KEY]: '{"done":["a"],"snoozed":[]}' });
    saveTriage(storage, EMPTY_TRIAGE);
    expect(storage.data.has(INBOX_TRIAGE_KEY)).toBe(false);
  });
});

describe('thread keys are stable, so a saved Done finds its thread again', () => {
  const item = (over: Partial<CommsItem> = {}): CommsItem => ({
    source: 'email',
    title: 'Ana Ruiz · Partnerships',
    preview: 'Can we move Thursday?',
    ts: '2026-10-09T10:00:00.000Z',
    ...over,
  });

  test('the same message keeps its key when its time or position changes', () => {
    const a = buildThreads([item()], [], new Date(NOW))[0].key;
    const shifted = buildThreads(
      [
        item({ title: 'Bo Lind · Ops', preview: 'New thing', ts: '2026-10-09T11:00:00.000Z' }),
        item({ ts: '2026-10-09T10:30:00.000Z' }),
      ],
      [],
      new Date(NOW),
    ).find((t) => t.preview === 'Can we move Thursday?')!.key;
    expect(shifted).toBe(a);
  });

  test('a new message in the chat is a new key; identical items stay unique', () => {
    expect(threadKey(item({ preview: 'Following up' }))).not.toBe(threadKey(item()));
    const keys = buildThreads([item(), item()], [], new Date(NOW)).map((t) => t.key);
    expect(new Set(keys).size).toBe(2);
  });
});
