/**
 * Shared chart cursor (GP3 `syncId`, ACGP3.5). Charts with the same
 * `syncId` share one crosshair and one keyboard cursor: a pointer move or an
 * arrow key on one moves every chart in the group to the same bucket index.
 * The S03 combined audience area and the posting bars are the first pair.
 *
 * Pure module state, no React: the kit reads it through
 * `useSyncExternalStore`, and the unit test drives it directly.
 */

export type SyncCursor = { index: number | null; source: string | null };

const IDLE: SyncCursor = { index: null, source: null };
const cursors = new Map<string, SyncCursor>();
const listeners = new Map<string, Set<() => void>>();

export function getCursor(syncId: string): SyncCursor {
  return cursors.get(syncId) ?? IDLE;
}

/** Move the group's cursor; `null` clears it. No-op (no notify) when unchanged. */
export function setCursor(syncId: string, index: number | null, source: string | null = null): void {
  const prev = getCursor(syncId);
  if (prev.index === index && prev.source === source) return;
  cursors.set(syncId, index === null ? IDLE : { index, source });
  listeners.get(syncId)?.forEach((fn) => fn());
}

export function subscribeCursor(syncId: string, fn: () => void): () => void {
  let set = listeners.get(syncId);
  if (!set) { set = new Set(); listeners.set(syncId, set); }
  set.add(fn);
  return () => {
    set!.delete(fn);
    // the cursor itself stays: React re-subscribes on re-render, and a hover must survive that
    if (set!.size === 0) listeners.delete(syncId);
  };
}

/**
 * Next index for a keyboard step on an `n`-bucket chart (Left/Right step,
 * Home/End jump). Starting from no cursor, Left/End land on the newest
 * bucket and Right/Home on the oldest. Returns null for keys it does not own.
 */
export function stepCursor(current: number | null, key: string, n: number): number | null {
  if (n <= 0) return null;
  const last = n - 1;
  switch (key) {
    case 'ArrowLeft': return current === null ? last : Math.max(0, current - 1);
    case 'ArrowRight': return current === null ? 0 : Math.min(last, current + 1);
    case 'Home': return 0;
    case 'End': return last;
    default: return null;
  }
}
