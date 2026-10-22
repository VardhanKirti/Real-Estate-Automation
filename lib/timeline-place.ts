/**
 * Event placement on a horizontal time strip (SPEC X4, S02 §11).
 *
 * Moved out of `lib/creative-engine/timeline.ts` (`placeRuns`), not
 * rewritten: the maths is the same, generalised from runs to any event with
 * an id, a start time, a lane and a status. The Creative Engine timeline
 * calls it through `placeRuns`; the kit's `GTimelineStrip` calls it directly
 * (Brand Deals send activity). Pure: no React, no node imports.
 *
 * - x is linear in start time between the inner track's edges (the side
 *   labels sit in the padding, so no dot lands on one);
 * - a start in the future (clock skew) reads as now;
 * - events older than the window are counted in `earlier`, not drawn;
 * - dots closer than `mergePx` in a lane merge into a cluster; if more than
 *   `maxItems` remain, the merge distance doubles until they fit.
 */

export type PlaceableEvent<S extends string = string> = {
  id: string;
  /** ISO string or epoch ms. Unparseable reads as now. */
  at: string | number;
  lane: number;
  status: S;
};

export type PlacedEventDot<S extends string = string> = { kind: 'dot'; id: string; runIds: [string]; x: number; lane: number; status: S; t: number };
export type PlacedEventCluster = { kind: 'cluster'; id: string; runIds: string[]; x: number; lane: number; t: number };
export type PlacedEvent<S extends string = string> = PlacedEventDot<S> | PlacedEventCluster;

export type EventPlacement<S extends string = string> = {
  dots: PlacedEventDot<S>[];
  clusters: PlacedEventCluster[];
  /** dots and clusters together, in time order */
  items: PlacedEvent<S>[];
  /** events older than the window, not drawn */
  earlier: number;
  /** each in-window event's own x (px), for snapping and keyboard stepping */
  xOf: Record<string, number>;
  /** the drawable track, px from the strip's left edge */
  track: { left: number; right: number };
};

export type PlaceOptions = { padLeft?: number; padRight?: number; mergePx?: number; maxItems?: number };

/** Start time in ms, clamped to `now`; unparseable reads as now. */
export function eventMs(at: string | number, now: number): number {
  const t = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(t)) return now;
  return Math.min(t, now); // clock skew: a future start reads as now
}

export function placeEvents<S extends string>(
  events: readonly PlaceableEvent<S>[],
  spanMs: number,
  widthPx: number,
  now = Date.now(),
  opts: PlaceOptions = {},
): EventPlacement<S> {
  const { padLeft = 76, padRight = 52, maxItems = 40 } = opts;
  let mergePx = opts.mergePx ?? 10;
  const span = spanMs;
  const from = now - span;
  const left = padLeft;
  const right = Math.max(left + 1, widthPx - padRight);
  const inRange = events.filter((e) => eventMs(e.at, now) >= from);
  const earlier = events.length - inRange.length;
  const xOf: Record<string, number> = {};
  const raw = inRange
    .map((e) => {
      const t = eventMs(e.at, now);
      const x = left + ((t - from) / span) * (right - left);
      xOf[e.id] = x;
      return { ev: e, t, x, lane: e.lane };
    })
    .sort((a, b) => a.t - b.t);
  const lanes = Array.from(new Set(raw.map((d) => d.lane))).sort((a, b) => a - b);

  const build = (merge: number): PlacedEvent<S>[] => {
    const out: PlacedEvent<S>[] = [];
    for (const lane of lanes) {
      const inLane = raw.filter((d) => d.lane === lane).sort((a, b) => a.x - b.x);
      let group: typeof inLane = [];
      const flush = () => {
        if (group.length === 1) {
          const d = group[0];
          out.push({ kind: 'dot', id: d.ev.id, runIds: [d.ev.id], x: d.x, lane, status: d.ev.status, t: d.t });
        } else if (group.length > 1) {
          const x = group.reduce((s, d) => s + d.x, 0) / group.length;
          const t = Math.max(...group.map((d) => d.t));
          out.push({ kind: 'cluster', id: `c-${group.map((d) => d.ev.id).join('+')}`, runIds: group.map((d) => d.ev.id), x, lane, t });
        }
        group = [];
      };
      for (const d of inLane) {
        if (group.length && d.x - group[group.length - 1].x >= merge) flush();
        group.push(d);
      }
      flush();
    }
    return out.sort((a, b) => a.t - b.t);
  };

  let items = build(mergePx);
  while (items.length > maxItems && mergePx < widthPx) {
    mergePx *= 2;
    items = build(mergePx);
  }
  return {
    dots: items.filter((i): i is PlacedEventDot<S> => i.kind === 'dot'),
    clusters: items.filter((i): i is PlacedEventCluster => i.kind === 'cluster'),
    items,
    earlier,
    xOf,
    track: { left, right },
  };
}

/** In-window events oldest first (ties by id): the slider's value order. */
export function orderedEvents<E extends Pick<PlaceableEvent, 'id' | 'at'>>(events: readonly E[], spanMs: number, now = Date.now()): E[] {
  const from = now - spanMs;
  return events.filter((e) => eventMs(e.at, now) >= from).sort((a, b) => eventMs(a.at, now) - eventMs(b.at, now) || a.id.localeCompare(b.id));
}
