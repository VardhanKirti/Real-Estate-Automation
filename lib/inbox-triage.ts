/**
 * Inbox triage store (S04 F-I6, H32). Done and Snooze are the operator's own
 * decisions about a thread; until a triage engine persists them server side
 * they live in this browser's localStorage under one versioned key, so they
 * survive a reload here and the UI can say exactly that ("Saved on this
 * browser").
 *
 * Pure functions over a plain value, plus two storage helpers that never
 * throw (private windows and blocked storage fall back to session-only).
 */

export const INBOX_TRIAGE_KEY = 'inbox-triage:v1';
/** Snooze hides a thread for 24 hours (S04 Q6 default). */
export const SNOOZE_MS = 24 * 60 * 60 * 1000;

export type SnoozeEntry = { key: string; until: string };
export type TriageStore = { done: string[]; snoozed: SnoozeEntry[] };

export const EMPTY_TRIAGE: TriageStore = { done: [], snoozed: [] };

/** Parse a stored value; anything malformed reads as empty, never throws. */
export function parseTriage(raw: string | null | undefined): TriageStore {
  if (!raw) return EMPTY_TRIAGE;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object') return EMPTY_TRIAGE;
    const o = v as Record<string, unknown>;
    const done = Array.isArray(o.done) ? o.done.filter((k): k is string => typeof k === 'string') : [];
    const snoozed = Array.isArray(o.snoozed)
      ? o.snoozed.filter(
          (e): e is SnoozeEntry =>
            !!e &&
            typeof e === 'object' &&
            typeof (e as SnoozeEntry).key === 'string' &&
            typeof (e as SnoozeEntry).until === 'string' &&
            Number.isFinite(Date.parse((e as SnoozeEntry).until)),
        )
      : [];
    return { done: [...new Set(done)], snoozed };
  } catch {
    return EMPTY_TRIAGE;
  }
}

/**
 * Drop expired snoozes (S04 edge 18) and, when the current thread keys are
 * known, keys for threads that no longer exist (edge 19). An empty `known`
 * list means the feed could not be read, so nothing is pruned on that basis.
 */
export function pruneTriage(store: TriageStore, now: number, known?: readonly string[]): TriageStore {
  const keep = known && known.length > 0 ? new Set(known) : null;
  const live = (k: string) => !keep || keep.has(k);
  return {
    done: store.done.filter(live),
    snoozed: store.snoozed.filter((e) => Date.parse(e.until) > now && live(e.key)),
  };
}

export function setDone(store: TriageStore, key: string, done: boolean): TriageStore {
  const rest = store.done.filter((k) => k !== key);
  return { ...store, done: done ? [...rest, key] : rest };
}

export function snooze(store: TriageStore, key: string, now: number, ms: number = SNOOZE_MS): TriageStore {
  const rest = store.snoozed.filter((e) => e.key !== key);
  return { ...store, snoozed: [...rest, { key, until: new Date(now + ms).toISOString() }] };
}

export function unsnooze(store: TriageStore, key: string): TriageStore {
  return { ...store, snoozed: store.snoozed.filter((e) => e.key !== key) };
}

/** Keys hidden right now. */
export function snoozedKeys(store: TriageStore, now: number): Set<string> {
  return new Set(store.snoozed.filter((e) => Date.parse(e.until) > now).map((e) => e.key));
}

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem' | 'removeItem'>;

/** `window.localStorage`, or null where reading it throws or it is absent. */
export function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Read, parse and prune. Never throws. */
export function loadTriage(storage: ReadStorage | null, now: number, known?: readonly string[]): TriageStore {
  if (!storage) return EMPTY_TRIAGE;
  try {
    return pruneTriage(parseTriage(storage.getItem(INBOX_TRIAGE_KEY)), now, known);
  } catch {
    return EMPTY_TRIAGE;
  }
}

/** Write the store; true only when it was actually saved. Never throws. */
export function saveTriage(storage: WriteStorage | null, store: TriageStore): boolean {
  if (!storage) return false;
  try {
    if (store.done.length === 0 && store.snoozed.length === 0) storage.removeItem(INBOX_TRIAGE_KEY);
    else storage.setItem(INBOX_TRIAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}
